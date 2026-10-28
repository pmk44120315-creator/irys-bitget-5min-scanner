"""IRYS-like early Bithumb KRW spot BUY observations from public API only.
NOT trading advice, not complete market CVD; no secrets, orders or private APIs.
"""
from __future__ import annotations
import datetime as dt
import math
import statistics
from spot_continuity import verify_continuity
KST=dt.timezone(dt.timedelta(hours=9))
MAX_DETAIL=8

def n(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except (TypeError,ValueError,OverflowError):return None

def candles(raw,now):
    end=now//60000*60000
    out={}
    for c in raw if isinstance(raw,list) else []:
        try:
            stamp=int(dt.datetime.fromisoformat(c['candle_date_time_utc']).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
            v=[n(c.get(z)) for z in ('opening_price','high_price','low_price','trade_price','candle_acc_trade_price')]
            if stamp<end and stamp>=end-125*60000 and all(x is not None for x in v) and v[0]>0 and v[4]>=0:out[stamp]=v
        except (TypeError,ValueError,KeyError,OverflowError):continue
    return out

def window(rows,now,count):
    end=now//60000*60000
    bars=[rows.get(end-i*60000) for i in range(count,0,-1)]
    if any(x is None for x in bars):return None
    o=bars[0][0];close=bars[-1][3];hi=max(x[1] for x in bars);lo=min(x[2] for x in bars)
    return {'open':o,'close':close,'high':hi,'low':lo,'quote_krw':sum(x[4] for x in bars),
            'price_change_pct':100*(close/o-1),
            'upper_wick_ratio':max(0,hi-max(o,close))/(hi-lo) if hi>lo else 0}

def past_context(rows,now):
    end=now//60000*60000
    old=[rows.get(end-i*60000) for i in range(60,5,-1)]
    if sum(x is not None for x in old)<50:return None
    old=[x for x in old if x is not None]
    o=old[0][0]
    calm={'sample_count':len(old),'range_pct':100*(max(x[1] for x in old)-min(x[2] for x in old))/o,
          'drift_pct':100*(old[-1][3]/o-1)}
    amounts=[]
    for k in range(1,12):
        q=[rows.get(end-i*60000) for i in range(5*k+1,5*k+6)]
        if all(q):amounts.append(sum(x[4] for x in q))
    base=statistics.median(amounts) if len(amounts)>=8 else None
    return calm,base,len(amounts)

def trade_sample(symbol,now,api):
    trades=[];cursor=None;ids=set()
    for _ in range(2):
        opts={'market':symbol,'count':500}
        if cursor is not None:opts['cursor']=cursor
        batch=api('bithumb','/v1/trades/ticks',opts)
        if not isinstance(batch,list):raise ValueError('invalid Bithumb trades')
        trades.extend(batch)
        stamps=[n(t.get('trade_timestamp',t.get('timestamp'))) for t in batch]
        stamps=[x for x in stamps if x is not None]
        if len(batch)<500 or (stamps and min(stamps)<=now-120000):break
        last=batch[-1].get('sequential_id')
        cursor=str(last) if last is not None else None
        if not cursor or not cursor.isdigit() or cursor in ids:break
        ids.add(cursor)
    sides=[{'buy':0.,'sell':0.,'count':0},{'buy':0.,'sell':0.,'count':0}]
    seen=set();oldest=now;newest=0;count=0
    for t in trades:
        side={'BID':'buy','ASK':'sell'}.get(t.get('ask_bid'))
        when=n(t.get('trade_timestamp',t.get('timestamp')));price=n(t.get('trade_price'));qty=n(t.get('trade_volume'))
        if side is None or when is None or price is None or qty is None or price<=0 or qty<=0 or when<now-120000 or when>now:continue
        # A repeated sequential_id may contain a distinct fill (observed in live Bithumb API).
        trade_id=(str(t.get('sequential_id')),int(when),side,price,qty)
        if trade_id in seen:continue
        seen.add(trade_id)
        half=int(when>=now-60000);sides[half][side]+=price*qty;sides[half]['count']+=1
        count+=1;oldest=min(oldest,when);newest=max(newest,when)
    bought=sum(z['buy'] for z in sides);sold=sum(z['sell'] for z in sides)
    portions=[z['buy']/(z['buy']+z['sell']) if z['buy']+z['sell'] else None for z in sides]
    return {'coverage':count>=18 and min(z['count'] for z in sides)>=5 and oldest<=now-100000 and newest>=now-60000,
            'count':count,'buy_krw':bought,'sell_krw':sold,'net_buy_krw':bought-sold,
            'buy_share':bought/(bought+sold) if bought+sold else None,
            'early_buy_share':portions[0],'recent_buy_share':portions[1],
            'recent_net_buy_krw':sides[1]['buy']-sides[1]['sell'],'full_cvd_verified':False}


def sparse_hour(rows, now):
    """Use historical trade-only candle prices; do not invent zero-volume bars."""
    end=now//60000*60000
    observed=sorted((ts,bar) for ts,bar in rows.items()
                    if end-60*60000<=ts<end)
    if len(observed)<18 or observed[-1][0]-observed[0][0]<35*60000:return None
    op=observed[0][1][0];last=observed[-1][1][3]
    high=max(c[1] for _,c in observed);low=min(c[2] for _,c in observed)
    return {'open':op,'close':last,'high':high,'low':low,
            'quote_krw':sum(c[4] for _,c in observed),
            'price_change_pct':100*(last/op-1),
            'upper_wick_ratio':max(0,high-max(op,last))/(high-low) if high>low else 0,
            'coverage':len(observed)/60,'partial_history':True,
            'quote_is_partial_lower_bound':True}

def native_5m_context(symbol, now, api, minute_rows):
    """Cross-check old sparse history against native completed Bithumb 5m bars."""
    raw=api('bithumb','/v1/candles/minutes/5',{'market':symbol,'count':40})
    if not isinstance(raw,list):return None
    end=now//60000*60000
    history=[]
    for bar in raw:
        if not isinstance(bar,dict):continue
        try:
            tm=int(dt.datetime.fromisoformat(bar['candle_date_time_utc']).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
        except (KeyError,TypeError,ValueError,OverflowError):continue
        vals=[n(bar.get(key)) for key in ('opening_price','high_price','low_price','trade_price','candle_acc_trade_price')]
        if any(v is None for v in vals) or vals[0]<=0 or vals[4]<0:continue
        if tm%300000:continue
        if end-65*60000<=tm and tm+300000<=end-5*60000:
            history.append((tm,vals))
    history.sort(key=lambda x:x[0])
    if len(history)<4 or history[-1][0]-history[0][0]<25*60000:return None
    median=statistics.median(bar[4] for _,bar in history)
    if median<=0:return None
    op=history[0][1][0];close=history[-1][1][3]
    high=max(v[1] for _,v in history);low=min(v[2] for _,v in history)
    actual_minutes=sum(end-60*60000<=ts<end-5*60000 for ts in minute_rows)
    quiet={'sample_count':actual_minutes,'range_pct':100*(high-low)/op,
           'drift_pct':100*(close/op-1),
           'history_source':'NATIVE_5M_TRADE_CANDLES',
           'native_5m_samples':len(history),
           'span_minutes':(history[-1][0]-history[0][0])/60000+5,
           'history_missing_minutes_not_zero_filled':True,
           'sparse_verified':True}
    return quiet,median,len(history)


def detailed_check(sym,ticker,now,api):
    rows=candles(api('bithumb','/v1/candles/minutes/1',{'market':sym,'count':125}),now)
    bars={str(m)+'m':window(rows,now,m) for m in (1,5,15,60)}
    # Recent 1/5/15 minute data must still be complete: NO unverified zero filling.
    if any(bars[str(m)+'m'] is None for m in (1,5,15)):
        return None,'WAIT_RECENT_CANDLE_GAP'
    if bars['60m'] is None:
        bars['60m']=sparse_hour(rows,now)
        if bars['60m'] is None:return None,'WAIT_HOURLY_CONTEXT'
    context=past_context(rows,now)
    if context is None or not context[1]:
        try: context=native_5m_context(sym,now,api,rows)
        except Exception:return None,'WAIT_HISTORICAL_5M_API'
        if context is None or not context[1]:return None,'WAIT_HISTORICAL_NATIVE_5M'
    calm,baseline,samples=context
    if calm['range_pct']>6 or abs(calm['drift_pct'])>4:return None,'PRIOR_PRICE_NOT_CALM'
    five=bars['5m'];fifteen=bars['15m'];hour=bars['60m'];ratio=five['quote_krw']/baseline
    if five['quote_krw']<25000000 or ratio<3:return None,'NO_MEANINGFUL_VOLUME'
    if (five['price_change_pct']<.12 or five['price_change_pct']>3.8 or
        fifteen['price_change_pct']>6.5 or hour['price_change_pct']>8 or hour['price_change_pct']<-4):
        return None,'PRICE_NOT_EARLY'
    retrace=100*(fifteen['high']-five['close'])/fifteen['high']
    if five['upper_wick_ratio']>.38 or fifteen['upper_wick_ratio']>.43 or retrace>1.6:
        return None,'WICK_OR_HIGH_RETRACE'
    last=n(ticker.get('trade_price'))
    if not last or abs(last/five['close']-1)>.03:return None,'LATEST_PRICE_DIVERGED'
    flow=trade_sample(sym,now,api)
    if not flow['coverage']:return None,'WAIT_RECENT_TAKER_COVERAGE'
    if flow['net_buy_krw']<=0 or flow['recent_net_buy_krw']<=0 or flow['buy_share'] is None or flow['recent_buy_share'] is None:
        return None,'SELLING_OR_BUY_FADES'
    if (flow['buy_share']<.62 or flow['early_buy_share']<.55 or flow['recent_buy_share']<.58 or
        flow['net_buy_krw']<5000000):return None,'INSUFFICIENT_PERSISTENT_BUY'
    now_dt=dt.datetime.fromtimestamp(now/1000,dt.timezone.utc)
    return {'venue':'bithumb','market':sym,'direction':'BUY_OBSERVATION',
            'timestamp_utc':now_dt.isoformat(),'timestamp_kst':now_dt.astimezone(KST).isoformat(timespec='seconds'),
            'price_krw':last,'windows':bars,'volume_ratio_5m':ratio,
            'five_minute_baseline_krw':baseline,'baseline_buckets':samples,'prior_55m_quiet':calm,
            'spot_taker_sample_2m':flow,'retrace_from_15m_high_pct':retrace,
            'official_warning_checked':True,'risk_status':'NO_OFFICIAL_WARNING_AT_COLLECTION',
            'full_cvd_verified':False,'orderbook_absorption_verified':False,
            'ticker_identity_cross_exchange':'UNVERIFIED','observation_only':True,
            'source':'Bithumb official public market, warning, ticker, minute candles, trade ticks APIs'},'EARLY_SPOT_BUY_OBSERVED'

def collect_spot_flow(now,state,api):
    now_ms=int(now.timestamp()*1000);kst=now.astimezone(KST);today=kst.date().isoformat()
    listings=api('bithumb','/v1/market/all',{'isDetails':'true'})
    alerts=api('bithumb','/v1/market/virtual_asset_warning')
    if not isinstance(listings,list) or not isinstance(alerts,list):raise ValueError('Bithumb risk feed unavailable')
    markets=[x for x in listings if isinstance(x,dict) and str(x.get('market','')).startswith('KRW-')]
    if len(markets)<100:raise ValueError('Bithumb market listing incomplete')
    risk={x.get('market') for x in alerts if isinstance(x,dict) and x.get('market')}
    prices=[]
    for off in range(0,len(markets),180):
        part=api('bithumb','/v1/ticker',{'markets':','.join(x['market'] for x in markets[off:off+180])})
        if not isinstance(part,list):raise ValueError('Bithumb tickers unavailable')
        prices.extend(part)
    tickers={x['market']:x for x in prices if isinstance(x,dict) and x.get('market')}
    if len(tickers)<.95*len(markets):raise ValueError('Bithumb ticker coverage incomplete')
    previous=state.get('spot_fast') or {};prior=previous.get('prices') or {}
    prev_time=n(previous.get('time_ms'));minutes=(now_ms-prev_time)/60000 if prev_time else None
    comparison=minutes is not None and 3<=minutes<=8 and previous.get('kst_day')==today
    fresh={};short=[];rally_watch=[];prescreen_drops={}
    def record_drop(reason):
        prescreen_drops[reason]=prescreen_drops.get(reason,0)+1
    for listing in markets:
        sym=listing['market'];t=tickers.get(sym)
        if not t:continue
        price=n(t.get('trade_price'));daily=n(t.get('acc_trade_price'));last24=n(t.get('acc_trade_price_24h'))
        daily_pct=n(t.get('signed_change_rate'))
        if price is None or price<=0 or daily is None or daily<0 or not last24 or last24<=0:continue
        old=prior.get(sym);old_acc=n(old[1]) if isinstance(old,list) and len(old)>=4 else None
        five=(daily-old_acc)*(5/minutes) if comparison and old_acc is not None and daily>=old_acc else None
        past_ema=n(old[2]) if isinstance(old,list) and len(old)>=4 else None
        count=int(old[3]) if isinstance(old,list) and len(old)>=4 else 0
        ema=past_ema if five is None else five if past_ema is None else .4*five+.6*past_ema
        fresh[sym]=[price,daily,ema,0 if five is None else min(count+1,100)]
        warning=listing.get('market_warning','UNKNOWN')!='NONE' or sym in risk
        suspended=t.get('is_trading_suspended') is True or bool(t.get('delisting_date')) or t.get('market_state') not in (None,'ACTIVE')
        prior_price=n(old[0]) if isinstance(old,list) and len(old)>=4 else None
        change=100*(price/prior_price-1) if prior_price and prior_price>0 else None
        # Independent observability only. This must never be put into spot_flow.signals.
        # Explicitly track fast movers that the strict alert preselector rejects.
        if five is not None and five>=25000000 and change is not None and change>=.8:
            if warning: reason='OFFICIAL_WARNING'
            elif suspended: reason='MARKET_SUSPENDED'
            elif past_ema is None or past_ema<=0 or count<3: reason='BASELINE_WARMING_UP'
            elif change>3.5: reason='PRICE_ABOVE_EARLY_ENTRY_LIMIT'
            elif daily_pct is None or not -.08<=daily_pct<=.09: reason='DAILY_MOVE_LIMIT'
            elif five/past_ema<3 or five/(last24/288)<2: reason='VOLUME_RATIO_BELOW_EARLY_ENTRY'
            else: reason='ELIGIBLE_FOR_DETAILED_CHECK'
            rally_watch.append({'market':sym,'price_krw':price,
                'observed_5m_price_change_pct':round(change,3),
                'estimated_5m_turnover_krw':round(five),
                'previous_5m_turnover_ema_krw':round(past_ema) if past_ema is not None else None,
                'reason':reason,'observation_only':True,'send_allowed':False,
                'turnover_method':'TICKER_KST_DAY_CUMULATIVE_DELTA_SCALED_TO_5M_NOT_CANDLE'})
        if warning or suspended:
            record_drop('WARNING_OR_SUSPENDED');continue
        if five is None or past_ema is None or past_ema<=0 or count<3:
            record_drop('BASELINE_NOT_READY');continue
        if change is None or not .1<=change<=3.5 or daily_pct is None or not -.08<=daily_pct<=.09:
            record_drop('PRICE_OR_DAILY_MOVE');continue
        if five<25000000 or five/past_ema<3 or five/(last24/288)<2:
            record_drop('TURNOVER_OR_RATIO');continue
        short.append((min(five/past_ema,80)*math.log10(1+five/10000000),sym,t))
    short.sort(key=lambda z:(-z[0],z[1]))
    rally_watch.sort(key=lambda x:(-x['observed_5m_price_change_pct'],-x['estimated_5m_turnover_krw'],x['market']))
    state['spot_fast']={'time_ms':now_ms,'kst_day':today,'prices':fresh}
    examined=0;errors=0;decisions={};signals=[];detail_diagnostics=[]
    for rank,sym,t in short[:8]:
        try:
            signal,verdict=detailed_check(sym,t,now_ms,api)
            examined+=1;decisions[verdict]=decisions.get(verdict,0)+1
            detail_diagnostics.append({'market':sym,'verdict':verdict,'rank':round(rank,3)})
            if signal:
                # A two-minute taker burst is observation ONLY, not an alert.
                # Candidate state survives across scheduled 5m snapshots.
                confirmed, proof_status = verify_continuity(signal, now_ms, state, api)
                detail_diagnostics[-1]['confirmation'] = proof_status
                decisions[proof_status] = decisions.get(proof_status, 0) + 1
                if confirmed:
                    signals.append(confirmed)
        except Exception as exc:
            errors+=1;decisions['DETAIL_ERROR']=decisions.get('DETAIL_ERROR',0)+1
            detail_diagnostics.append({'market':sym,'verdict':'DETAIL_ERROR',
                'exception_type':type(exc).__name__,'rank':round(rank,3)})
    return {'status':'PASS' if errors==0 else 'PARTIAL','observed_utc':now.isoformat(),
            'observed_kst':kst.isoformat(timespec='seconds'),'markets':len(markets),'tickers':len(tickers),
            'shortlisted':len(short),'details_checked':examined,'details_failed':errors,
            'verdicts':decisions,'detail_diagnostics':detail_diagnostics,'signals':signals[:8],
            'prescreen_drop_counts':prescreen_drops,'rally_watch_only':rally_watch[:20],
            'rally_watch_total':len(rally_watch),
            'limitations':{'marketwide_full_CVD':False,'continuous_orderbook_absorption':False,
                 'exchange_inout_whale_tracking':False,'project_lockup':False,
                 'same_kst_hour_historical_baseline':'NOT_COLLECTED',
                 'spot_taker_15m':'ONLY_WHEN_PAGED_TICKS_MATCH_CANDLE_TURNOVER',
                 'orderbook_snapshots':'FOUR_SEPARATE_READS_NOT_CONTINUOUS_ABSORPTION',
                 'alert_gate':'FOUR_NON_OVERLAPPING_5M_SPOT_OBSERVATIONS',
                 'ticker_symbol_equivalence_across_venues':'UNVERIFIED'}}
