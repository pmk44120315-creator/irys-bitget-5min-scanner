#!/usr/bin/env python3
"""Public read-only Bitget USDT-M five-minute collector.
No API keys, credentials, trading endpoints, or executable orders.
Python 3 standard library only. Designed for public GitHub Actions; outputs public market data only.
"""
from __future__ import annotations
import concurrent.futures
from spot_flow import collect_spot_flow
from spot_direction import collect_spot_directional
from bitget_futures_cvd import collect_futures_flow_observations
import datetime as dt
import json
import math
from early_candidates import build_early_pool
import os
import pathlib
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
LATEST = ROOT / 'data' / 'latest.json'
STATE = ROOT / 'data' / 'state.json'
KST = dt.timezone(dt.timedelta(hours=9))
HTTP_TIMEOUT = int(os.getenv('API_HTTP_TIMEOUT', '10'))
WORKERS = int(os.getenv('API_WORKERS', '14'))
MAX_MARKETS = int(os.getenv('MAX_MARKETS', '0'))  # 0 = full universe, tests only override

class ExchangeAPIError(RuntimeError): pass

class RateLimit:
    def __init__(self, per_second):
        self.delay = 1 / per_second
        self.lock = threading.Lock()
        self.next_time = 0.0
    def wait(self):
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next_time)
            self.next_time = at + self.delay
        time.sleep(max(0, at-now))

LIMITERS = {'bithumb':RateLimit(8), 'bitget':RateLimit(12)}
BASES = {'bithumb':'https://api.bithumb.com', 'bitget':'https://api.bitget.com'}

def number(v, default=None):
    try:
        f=float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError, OverflowError):
        return default

def http_json(venue, path, params=None):
    if venue not in BASES or not path.startswith('/') or '://' in path:
        raise ValueError('Only whitelisted public exchange HTTP API paths are supported')
    q=('?'+urllib.parse.urlencode(params)) if params else ''
    url=BASES[venue]+path+q
    headers={'Accept':'application/json','User-Agent':'IRYS-public-market-readonly/1.0'}
    last_error=None
    for attempt in range(3):
        LIMITERS[venue].wait()
        try:
            req=urllib.request.Request(url, headers=headers, method='GET')
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:
                if res.status != 200:
                    raise ExchangeAPIError(f'{venue} HTTP {res.status}')
                doc=json.loads(res.read(10_000_000).decode('utf-8'))
            if venue=='bitget':
                if not isinstance(doc,dict) or str(doc.get('code'))!='00000':
                    raise ExchangeAPIError(f'bitget application error: {str(doc.get("code"))[:30]} {str(doc.get("msg"))[:120]}')
                return doc.get('data')
            if isinstance(doc,dict) and 'error' in doc:
                raise ExchangeAPIError(f'bithumb application error: {str(doc["error"])[:150]}')
            return doc
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, ExchangeAPIError) as e:
            last_error=e
            if isinstance(e, urllib.error.HTTPError) and e.code in (400, 401, 403, 404): break
            time.sleep(min(2.0*(attempt+1),6.0))
    raise ExchangeAPIError(f'{venue} {path} failed: {type(last_error).__name__} {str(last_error)[:180]}')

def utc_now():
    return dt.datetime.now(dt.timezone.utc)

def load_state():
    try:
        obj=json.loads(STATE.read_text(encoding='utf-8'))
        return obj if isinstance(obj,dict) else {}
    except (FileNotFoundError, json.JSONDecodeError): return {}

def write_json_atomic(path, payload):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
    tmp.replace(path)

def parse_bithumb_candles(raw):
    out=[]
    for x in raw if isinstance(raw,list) else []:
        t=number(x.get('timestamp'))
        # timestamp = last trade timestamp, NOT candle open; use candle_date_time_utc instead.
        try: stamp=int(dt.datetime.fromisoformat(x['candle_date_time_utc']).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
        except (KeyError, TypeError, ValueError): continue
        row={'ts':stamp,'open':number(x.get('opening_price')),'high':number(x.get('high_price')),
             'low':number(x.get('low_price')),'close':number(x.get('trade_price')),
             'quote':number(x.get('candle_acc_trade_price'))}
        if all(v is not None for k,v in row.items() if k != 'ts'): out.append(row)
    return sorted({r['ts']:r for r in out}.values(),key=lambda x:x['ts'])

def parse_bitget_candles(raw):
    out=[]
    for x in raw if isinstance(raw,list) else []:
        if not isinstance(x,(list,tuple)) or len(x)<7: continue
        row={'ts':number(x[0]),'open':number(x[1]),'high':number(x[2]),
             'low':number(x[3]),'close':number(x[4]),'quote':number(x[6])}
        if all(v is not None for v in row.values()):
            row['ts']=int(row['ts']);out.append(row)
    return sorted({r['ts']:r for r in out}.values(),key=lambda x:x['ts'])

def closed_windows(rows,now_ms):
    minute_end=(now_ms//60000)*60000
    # Recent complete 1-minute intervals; no zero filling for missing candles.
    rows=[r for r in rows if r['ts'] < minute_end and r['ts'] >= minute_end-201*60000]
    by_ts={int(r['ts']):r for r in rows}
    result={'end_utc_ms':minute_end,'sample_candles':len(by_ts)}
    for width in (1,5,15,60):
        current=[by_ts.get(minute_end-(i+1)*60000) for i in range(width)]
        valid=[r for r in current if r is not None]
        prior=[by_ts.get(minute_end-(width+i+1)*60000) for i in range(width)]
        prior_valid=[r for r in prior if r is not None]
        # A window with >=80% of one-minute bars can be compared, but mark gaps.
        quote=sum(r['quote'] for r in valid) if len(valid)>=max(1,math.ceil(width*0.8)) else None
        baseline=sum(r['quote'] for r in prior_valid) if len(prior_valid)>=max(1,math.ceil(width*0.8)) else None
        ratio=quote/baseline if quote is not None and baseline and baseline>0 else None
        result[f'{width}m']={'quote_turnover':quote,'prior_adjacent_quote_turnover':baseline,
                             'adjacent_ratio':ratio,'coverage':len(valid)/width,
                             'baseline_coverage':len(prior_valid)/width}
        if valid:
            earliest=min(valid,key=lambda r:r['ts'])
            latest=max(valid,key=lambda r:r['ts'])
            lo=min(r['low'] for r in valid);hi=max(r['high'] for r in valid)
            op=earliest['open'];cl=latest['close']
            if op>0:
                result[f'{width}m']['price_change_pct']=(cl/op-1)*100
            if hi>lo:
                result[f'{width}m']['upper_wick_ratio']=(hi-max(op,cl))/(hi-lo)
            result[f'{width}m']['open']=op
            result[f'{width}m']['close']=cl
            result[f'{width}m']['high']=hi
            result[f'{width}m']['low']=lo
    return result

def get_markets():
    """Fetch all active USDT perpetuals; classify crypto via authoritative V3 metadata."""
    contracts=http_json('bitget','/api/v2/mix/market/contracts',{'productType':'USDT-FUTURES'})
    if not isinstance(contracts,list):raise ExchangeAPIError('Bitget active contracts response missing')
    # The V2 contract's symbolType='perpetual' does NOT establish underlying type.
    # V3 returns symbolType='crypto/stock/metal/commodity' and instrumentType.
    # Classification outages must never silently turn stocks into crypto picks.
    official_types={}
    try:
        instruments=http_json('bitget','/api/v3/market/instruments',{'category':'USDT-FUTURES'})
        if not isinstance(instruments,list):raise ExchangeAPIError('Bitget V3 instrument response missing')
        for item in instruments:
            if not isinstance(item,dict) or not item.get('symbol'):continue
            symbol_type=str(item.get('symbolType') or '').lower()
            instrument_type=str(item.get('instrumentType') or '').lower()
            if symbol_type=='crypto' and instrument_type=='crypto':
                verdict='VERIFIED_CRYPTO'
            elif symbol_type in {'stock','metal','commodity','energy','etf','forex'} or instrument_type in {'stock','metal','commodity','energy','etf','forex'}:
                verdict='NON_CRYPTO'
            else:
                verdict='UNVERIFIED'
            official_types[item['symbol']]=verdict
    except ExchangeAPIError as e:
        # Futures candles and OI can still be recorded, but no buy-like ranking.
        print('INSTRUMENT_IDENTITY_UNAVAILABLE '+str(e)[:180])
    futures=[{'venue':'bitget','symbol':m['symbol'],'baseCoin':m.get('baseCoin'),
              'quoteCoin':m.get('quoteCoin'),'contract_status':m.get('symbolStatus'),
              'symbolType':m.get('symbolType'),'isRwa':m.get('isRwa'),
              'launchTime':m.get('launchTime'),
              'asset_identity':official_types.get(m['symbol'],'UNVERIFIED')}
          for m in contracts if isinstance(m,dict) and m.get('symbolStatus')=='normal'
          and m.get('symbolType')=='perpetual' and m.get('quoteCoin')=='USDT'
          and str(m.get('symbol','')).endswith('USDT')]
    if not futures:raise ExchangeAPIError('No active USDT perpetual contracts')
    return [],futures

def get_warnings():
    # This Bitget-only service makes no claim about spot risk notices.
    return {}

def get_funding():
    data=http_json('bitget','/api/v2/mix/market/current-fund-rate',{'productType':'USDT-FUTURES'})
    rates={x['symbol']:number(x.get('fundingRate')) for x in data if isinstance(x,dict) and x.get('symbol')}
    if not rates:raise ExchangeAPIError('Bitget funding returned no instruments')
    return rates

def get_oi(symbol):
    obj=http_json('bitget','/api/v2/mix/market/open-interest',{'symbol':symbol,'productType':'USDT-FUTURES'})
    pairs=obj.get('openInterestList',[]) if isinstance(obj,dict) else []
    size=number(pairs[0].get('size')) if pairs else None
    if size is None:raise ExchangeAPIError('Bitget OI missing numeric size: '+symbol)
    return {'size_raw':size,'timestamp_ms':number(obj.get('ts')) if isinstance(obj,dict) else None,
            'unit':'Bitget API raw size, NOT USDT notional'}

def get_candles(market,now_ms):
    venue=market['venue'];symbol=market['symbol']
    if venue=='bithumb':
        raw=http_json('bithumb','/v1/candles/minutes/1',{'market':symbol,'count':200})
        rows=parse_bithumb_candles(raw)
    else:
        raw=http_json('bitget','/api/v2/mix/market/candles',
                      {'symbol':symbol,'productType':'USDT-FUTURES','granularity':'1m','limit':'200'})
        rows=parse_bitget_candles(raw)
    return closed_windows(rows,now_ms)

def get_trade_sample(market,now_ms):
    venue=market['venue'];symbol=market['symbol']
    if venue=='bithumb':
        data=http_json('bithumb','/v1/trades/ticks',{'market':symbol,'count':500})
        def remap(x):return ('buy' if x.get('ask_bid')=='BID' else 'sell' if x.get('ask_bid')=='ASK' else None,
                            number(x.get('trade_price')),number(x.get('trade_volume')),number(x.get('timestamp')))
    else:
        data=http_json('bitget','/api/v2/mix/market/fills',{'symbol':symbol,'productType':'USDT-FUTURES','limit':100})
        def remap(x):return (str(x.get('side','')).lower(),number(x.get('price')),number(x.get('size')),number(x.get('ts')))
    seen=set();events=[]
    for trade in data if isinstance(data,list) else []:
        side,price,volume,stamp=remap(trade)
        if side not in ('buy','sell') or not all(v is not None for v in (price,volume,stamp)):continue
        # Dedup by exchange trade ID where present; fall back to serialized fields.
        key=str(trade.get('sequential_id',trade.get('tradeId',(stamp,side,price,volume))))
        if key in seen: continue
        seen.add(key);events.append((side,price*volume,int(stamp)))
    last_hour=[ev for ev in events if now_ms-3600_000<=ev[2]<=now_ms]
    buy=sum(x[1] for x in last_hour if x[0]=='buy');sell=sum(x[1] for x in last_hour if x[0]=='sell')
    oldest=min((e[2] for e in events),default=None)
    newest=max((e[2] for e in events),default=None)
    return {'venue':venue,'window':'trades_within_last_60m','buy_taker_quote':buy,'sell_taker_quote':sell,
            'net_taker_quote':buy-sell,'total_trades_sampled':len(events),'trades_in_last_hour':len(last_hour),
            'oldest_trade_timestamp_ms':oldest,'newest_trade_timestamp_ms':newest,
            'full_hour_coverage':bool(oldest is not None and oldest<=now_ms-3600_000
                                      and newest is not None and newest>=now_ms-120_000),
            'label':'sampled taker net flow, not historical CVD; venue-specific spot/futures only'}

def interval_score(item):
    windows=item.get('windows',{})
    f15=windows.get('15m',{});f60=windows.get('60m',{})
    v=f15.get('adjacent_ratio') or 0
    q=f15.get('quote_turnover') or 0
    p=f60.get('price_change_pct')
    w=f15.get('upper_wick_ratio')
    # Rank only, NEVER trade/buy signal.
    min_q=1_000_000 if item['venue']=='bithumb' else 2_000
    if p is None or p>10 or p < -8 or (w is not None and w>0.7) or q<min_q: return -1
    return round(min(v,30)*math.log10(max(10,q/min_q)),5)

def weekly_slot_baseline(state,item,now_utc):
    # Same KST hour from previous days: compares last 60m TURNOVER only.
    key=item['venue']+':'+item['symbol']
    slot=str(now_utc.astimezone(KST).hour)  # same ending hour each KST day
    today=now_utc.astimezone(KST).date().isoformat()
    series=state.setdefault('hourly_samples',{}).setdefault(key,{}).setdefault(slot,[])
    out=item['windows'].get('60m',{}).get('quote_turnover')
    old=[x['volume'] for x in series if x.get('date')!=today and number(x.get('volume')) is not None]
    baseline=statistics.median(old) if len(old)>=3 else None
    ratio=out/baseline if out is not None and baseline and baseline>0 else None
    item['same_kst_hour_baseline_60m']={'historical_days':len(old),'median_quote_turnover':baseline,
                                          'ratio':ratio,'status':'verified' if baseline is not None else 'WARMING_UP'}
    if out is not None:
        series[:]=[x for x in series if x.get('date')!=today]
        series.append({'date':today,'volume':out})
        series[:]=series[-8:]

def gather(now_utc=None,old_state=None,fetch_markets=get_markets,fetch_warnings=get_warnings,
           fetch_funding=get_funding,fetch_candles=get_candles,fetch_oi=get_oi,fetch_trades=get_trade_sample):
    now_utc=now_utc or utc_now();now_ms=int(now_utc.timestamp()*1000)
    state=old_state or {'oi_previous':{}}
    errors=[]
    spots,futures=fetch_markets()
    if MAX_MARKETS: spots=spots[:MAX_MARKETS];futures=futures[:MAX_MARKETS]
    try:warnings=fetch_warnings();warning_data_ok=True
    except ExchangeAPIError as e:warnings={};warning_data_ok=False;errors.append(str(e))
    try:funding=fetch_funding();funding_data_ok=True
    except ExchangeAPIError as e:funding={};funding_data_ok=False;errors.append(str(e))
    markets=spots+futures
    result=[]
    def candle_task(m):
        try:return m,fetch_candles(m,now_ms),None
        except ExchangeAPIError as e:return m,None,str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for market,win,err in pool.map(candle_task,markets):
            if err:errors.append(err);continue
            entry={**market,'windows':win,'observation_only':True}
            if market['venue']=='bithumb':
                entry['warnings']=warnings.get(market['symbol'],[])
                entry['risk_clearance']='UNVERIFIED' if not warning_data_ok else ('BLOCK' if market['market_warning']!='NONE' or entry['warnings'] else 'NO_OFFICIAL_WARNING_AT_SNAPSHOT')
            else:
                entry['funding_rate']=funding.get(market['symbol'])
                entry['risk_clearance']='UNVERIFIED' if not funding_data_ok else 'EXCHANGE_ACTIVE_ONLY_NONCRYPTO_AND_NEWS_UNVERIFIED'
            entry['same_kst_hour_baseline_60m']={'status':'NOT_MEASURED_BY_5M_SCANNER'}
            entry['rank_score']=interval_score(entry)
            # Watch: official warning excludes any prospective buy-like candidate.
            if market['venue']=='bithumb' and entry['risk_clearance']!='NO_OFFICIAL_WARNING_AT_SNAPSHOT':entry['rank_score']=-1
            if market['venue']=='bitget' and market.get('asset_identity')!='VERIFIED_CRYPTO':entry['rank_score']=-1
            result.append(entry)
    result.sort(key=lambda x:x['rank_score'],reverse=True)
    # OI for *all* active Bitget USDT perpetual contracts; unavailable is explicit.
    oi_cache={}
    def oi_task(m):
        try:return m['symbol'],fetch_oi(m['symbol']),None
        except ExchangeAPIError as e:return m['symbol'],None,str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for sym,v,err in pool.map(oi_task,futures):
            if err:errors.append(err);continue
            oi_cache[sym]=v
    prior_oi=state.setdefault('oi_previous',{})
    for it in result:
        if it['venue']!='bitget':continue
        sym=it['symbol'];v=oi_cache.get(sym)
        if not v:it['oi']={'status':'NOT_AVAILABLE'};continue
        size=v.get('size_raw');prior=prior_oi.get(sym)
        delta=(size/prior['size']-1)*100 if (size is not None and isinstance(prior,dict) and number(prior.get('size')) and prior['size']>0) else None
        previous_utc=prior.get('utc') if isinstance(prior,dict) else None
        elapsed_min=None
        if previous_utc:
            try:elapsed_min=(now_utc-dt.datetime.fromisoformat(previous_utc.replace('Z','+00:00'))).total_seconds()/60
            except (ValueError,TypeError):pass
        it['oi']={**v,'change_pct_from_previous_run':delta,'previous_snapshot_utc':previous_utc,
                  'elapsed_min_since_previous_snapshot':elapsed_min,
                  'status':'OK' if size is not None else 'EMPTY_RESPONSE'}
        if size is not None:prior_oi[sym]={'size':size,'utc':now_utc.isoformat()}
    # Taker trades only for strongest candle-watch symbols, not all market pairs.
    enriched=[x for x in result if x['rank_score']>=1][:25]
    def trade_task(it):
        try:return it['symbol'],it['venue'],fetch_trades(it,now_ms),None
        except ExchangeAPIError as e:return it['symbol'],it['venue'],None,str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        flow_cache={(s,v):data for s,v,data,err in pool.map(trade_task,enriched) if data is not None}
    for it in result:
        if (it['symbol'],it['venue']) in flow_cache:it['recent_trades_sample']=flow_cache[it['symbol'],it['venue']]
    num_ok=len(result)
    stats={'bithumb_listed_krw':len(spots),'bitget_active_usdt_perpetual':len(futures),
           'candle_symbols_success':num_ok,'candle_symbols_failed':len(markets)-num_ok,
           'oi_symbols_success':len(oi_cache),'oi_symbols_failed':len(futures)-len(oi_cache),
           'instrument_verified_crypto':sum(m.get('asset_identity')=='VERIFIED_CRYPTO' for m in futures),
           'instrument_noncrypto':sum(m.get('asset_identity')=='NON_CRYPTO' for m in futures),
           'instrument_identity_unverified':sum(m.get('asset_identity')=='UNVERIFIED' for m in futures),
           'trade_samples_success':len(flow_cache),'warning_feed_ok':warning_data_ok,'funding_feed_ok':funding_data_ok}
    health_ok=(num_ok==len(markets) and len(oi_cache)==len(futures)
               and warning_data_ok and funding_data_ok and len(markets)>0)
    latest={'schema_version':1,'collector_utc':now_utc.isoformat(),'finished_utc':utc_now().isoformat(),
            'collector_kst':now_utc.astimezone(KST).isoformat(),
            'collector_status':'PASS' if health_ok else 'PARTIAL',
            'stats':stats,'warnings':'FUTURES_VOLUME_WATCH_ONLY_NOT_A_BUY_SIGNAL',
            'limitations':{'historical_60m_CVD':'NOT_MEASURED_FUTURES_FILL_SAMPLE_IS_NOT_SPOT_CVD',
                           'orderbook_absorption':'NOT_MEASURED_BY_HOURLY_SNAPSHOTS',
                           'exchange_inout':'NOT_MEASURED',
                           'underlying_asset_identity':'V3_CLASSIFIED_CRYPTO_ONLY_IN_WATCHLIST_OTHER_UNDERLYINGS_EXCLUDED',
                           'external_announcement_delisting':'REQUIRES_INDEPENDENT_CHECK',
                           'same_time_historical_baseline':'NOT_MEASURED_BY_5M_SCANNER',
                           'top_taker_samples':'TOP_25_FUTURES_ONLY',
                           'OI_unit':'raw exchange OI size, not USD or KRW'},
            'errors':errors[:70],
            'watchlist':[x for x in result if x['rank_score']>=1][:30],
            'early_pool':build_early_pool(result,limit=80),
            'comparison_symbols':[x for x in result if x['symbol'].split('-')[-1].removesuffix('USDT') in
                                  {'BORA','XEC','POLYX','BOUNTY','GAME2','MED','IRYS','IRIS'}][:40],
            'covered_symbols':[x['symbol'] for x in result]}
    state['last_collector_utc']=now_utc.isoformat()
    return latest,state

def reconcile_bithumb_spot_stats(latest):
    """Report separately collected Bithumb listings/tickers truthfully.

    The futures-wide 1m candle count is NOT evidence that all KRW minute candles
    were inspected. Spot detail candles are sampled only for selected candidates.
    """
    stats=latest.get('stats') or {}
    spot=latest.get('spot_flow') or {}
    markets=spot.get('markets');tickers=spot.get('tickers')
    good=(spot.get('status')=='PASS' and isinstance(markets,int) and
          isinstance(tickers,int) and markets>=100 and tickers>=.95*markets)
    if good:
        stats['bithumb_listed_krw']=markets
        stats['bithumb_ticker_snapshots']=tickers
        stats['bithumb_spot_data_scope']='ALL_KRW_LISTINGS_TICKERS_DETAILS_CANDIDATES_ONLY'
    else:
        stats['bithumb_listed_krw']=0
        stats['bithumb_ticker_snapshots']=0
        stats['bithumb_spot_data_scope']='SPOT_NOT_VERIFIED'
    latest['stats']=stats
    return good

def main():
    now=utc_now()
    try:
        latest,state=gather(now,load_state())
        # Morning-style BUY observations from public Bithumb spot; independent
        # of Bitget futures, preserving the original 862-instrument collection.
        try:
            latest['spot_flow']=collect_spot_flow(utc_now(),state,http_json)
            # Futures information is OPTIONAL CONTEXT only: identical ticker is
            # not reliable proof that the two exchanges list the same token.
            context={}
            for contract in list(latest.get('early_pool') or []) + list(latest.get('watchlist') or []):
                if (contract.get('venue')!='bitget' or
                    contract.get('asset_identity')!='VERIFIED_CRYPTO'):continue
                base=contract.get('baseCoin')
                if not isinstance(base,str) or not base or base in context:continue
                context[base]=contract
            for spot_signal in latest['spot_flow'].get('signals',[]):
                base=spot_signal.get('market','').removeprefix('KRW-')
                match=context.get(base)
                if not match:continue
                oi=match.get('oi') or {}
                spot_signal['futures_context']={
                    'venue':'bitget','symbol':match.get('symbol'),
                    'identity':'SYMBOL_MATCH_ONLY_NOT_VERIFIED',
                    'oi_pct':oi.get('change_pct_from_previous_run'),
                    'oi_elapsed_min':oi.get('elapsed_min_since_previous_snapshot'),
                    'funding_rate':match.get('funding_rate'),
                    'time_source':'same GitHub Bitget read-only snapshot'}
        except Exception as e:
            latest['spot_flow']={'status':'FAILED','signals':[],
                'error':type(e).__name__+': '+str(e)[:200],
                'source':'Bithumb public API read-only'}
        reconcile_bithumb_spot_stats(latest)
        # Evidence-backed direction is a separate nonblocking stream.
        # No BUY/SHORT assertion or order follows from ticker/turnover alone.
        try:
            observed_at=dt.datetime.fromisoformat(latest['spot_flow']['observed_utc'].replace('Z','+00:00'))
            stamp=int(observed_at.timestamp()*1000)
            latest['spot_directional']=collect_spot_directional(
                latest['spot_flow'],state,stamp,http_json)
        except Exception as exc:
            latest['spot_directional']={'status':'FAILED','signals':[],
                'error_type':type(exc).__name__,'observation_only':True}
        # An independent public futures read-only evidence stream. If it fails,
        # the original 5m collector/spot alert pipeline is not altered.
        try:
            latest['futures_flow']=collect_futures_flow_observations(
                latest,int(utc_now().timestamp()*1000),http_json,limit=6,state=state)
        except Exception as exc:
            latest['futures_flow']={'status':'FAILED','observations':[],
                'alert_eligible':False,'observation_only':True,
                'error':type(exc).__name__+': '+str(exc)[:150]}
        # Mark actual completion only after both futures and spot observation work.
        latest['finished_utc']=utc_now().isoformat()
        write_json_atomic(LATEST,latest)
        write_json_atomic(STATE,state)
        print(json.dumps({'collector_status':latest['collector_status'],'stats':latest['stats'],
                          'watchlist_size':len(latest['watchlist'])},ensure_ascii=False))
        if latest['collector_status']!='PASS':return 2
        return 0
    except Exception as e:
        # Do not present prior data as fresh, and never overwrite state on a failed scan.
        failure={'schema_version':1,'collector_utc':now.isoformat(),
                 'collector_status':'FAILED','error':type(e).__name__+': '+str(e)[:300],
                 'stats':{},'watchlist':[], 'source_status':'NOT_VERIFIED'}
        write_json_atomic(LATEST,failure)
        print(json.dumps(failure,ensure_ascii=False));return 1

if __name__=='__main__':raise SystemExit(main())
