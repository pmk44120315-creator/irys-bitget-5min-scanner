#!/usr/bin/env python3
"""Read-only V19 predictive skill audit on real Bitget official historical
 5-minute snapshots and V18 verified local taker observations.

 Crucially NOT an audit of actual Telegram Bot API receipts; private KV inaccessible.
 Forecast is formed only with evidence present before recorded V18 observation.
 Label uses first completed official price after evidence publication, then future
 exact 5/15/30/60 minute completed market prices.
 No execution prices, spreads, order fills, or future feature leakage.
"""
import bisect
import collections
import datetime as dt
import json
import math
import statistics
import subprocess
import sys
from functools import lru_cache

MIN=60_000
UTC=dt.timezone.utc
START=dt.datetime(2026,10,30,12,45,tzinfo=UTC)
def n(x):
    try:
        if x is None or isinstance(x,bool):return None
        f=float(x)
        return f if math.isfinite(f) else None
    except (TypeError,ValueError,OverflowError):return None
def ms(s):
    try:return int(dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp()*1000)
    except (TypeError,ValueError,AttributeError):return None
def git(*args):
    r=subprocess.run(['git',*args],check=False,capture_output=True)
    if r.returncode:raise RuntimeError('GIT_ERROR '+str(args[:3])+' '+r.stderr.decode('utf8','replace')[:160])
    return r.stdout.decode('utf8','replace')
def read(commit,path):
    try:return json.loads(git('show',commit+':'+path))
    except (json.JSONDecodeError,RuntimeError):return None
def keys(path):
    return [x for x in git('log','refs/remotes/origin/main','--since=2026-10-30T12:45:00Z',
            '--format=%H','--',path).splitlines() if len(x)==40]
def future_sample(rows,when,period_min):
    # rows are official completed candle/close stamps sorted ascending.
    t=[x[0] for x in rows]
    j=bisect.bisect_right(t,when)
    if j>=len(rows):return None
    base_at,base=rows[j]
    if base_at-when<=0 or base_at-when>8*MIN:return None
    want=base_at+period_min*MIN
    k=bisect.bisect_left(t,want)
    if k>=len(rows):return None
    at,close=rows[k]
    if at!=want:return None
    return {'entry_at':base_at,'future_at':at,
      'signed_return_pct':100*(close/base-1),'entry_delay_min':(base_at-when)/MIN}

def primary_outcome(rows,when,dir):
    out={}
    for minutes in (5,15,30,60):
        r=future_sample(rows,when,minutes)
        if r:out[str(minutes)]=r['signed_return_pct']*dir
    return out

def label_rows(events,by_symbol):
    results=[];miss=collections.Counter()
    for e in events:
        series=by_symbol.get(e['symbol'])
        if not series:
            miss['no_price_history']+=1;continue
        outcome=primary_outcome(series,e['at_ms'],e['direction'])
        if '15' not in outcome:miss['no_exact_15m_label']+=1;continue
        results.append({**e,'signed_outcomes':outcome})
    return results,miss

def summary(events,minutes):
    r=[x['signed_outcomes'][str(minutes)] for x in events if str(minutes) in x['signed_outcomes']]
    right=sum(x>=.15 for x in r)
    wrong=sum(x<=-.15 for x in r)
    flat=len(r)-right-wrong
    return {'labeled':len(r),'right':right,'wrong':wrong,'flat':flat,
      'decisive_accuracy':round(right/(right+wrong),4) if right+wrong else None,
      'mean_signed_price_change_pct':round(statistics.fmean(r),4) if r else None,
      'not_actual_trade_fills':True}

def main():
    price_commits=keys('data/latest.json')
    evidence_commits=keys('data/v18_evidence_latest.json')
    print('V20_AUDIT_SOURCE_COMMITS',json.dumps({
      'price_versions':len(price_commits),'evidence_versions':len(evidence_commits)},sort_keys=True),flush=True)
    prices=collections.defaultdict(dict)
    for i,c in enumerate(reversed(price_commits)):
        d=read(c,'data/latest.json')
        if not isinstance(d,dict) or d.get('collector_status')!='PASS':continue
        for sym,row in (d.get('verified_crypto_futures_closed_prices') or {}).items():
            if not isinstance(row,dict):continue
            at=row.get('closed_end_ms');price=n(row.get('close_usdt'))
            if isinstance(at,int) and price and price>0 and at>1_750_000_000_000:
                prices[sym][at]=price
        if (i+1)%100==0:print('V20_AUDIT_MARKET_PROGRESS',i+1,flush=True)
    symbols={k:sorted(v.items()) for k,v in prices.items() if len(v)>=3}
    events=[];stats=collections.Counter()
    prior=set()
    for i,c in enumerate(reversed(evidence_commits)):
        d=read(c,'data/v18_evidence_latest.json')
        if not isinstance(d,dict) or d.get('status')!='PASS':continue
        at=ms(d.get('at_utc'))
        if not at or at<int(START.timestamp()*1000):continue
        for o in d.get('observations') or []:
            sym=o.get('symbol')
            if not isinstance(sym,str) or not sym.endswith('USDT'):continue
            # Imported V18 official read, not a synthetic local book snapshot.
            flow=o.get('taker_flow_15m') or {}
            recent=o.get('recent5_pressure_shift_research') or {}
            p=n(o.get('window_5m_price_pct'))
            p15=n(o.get('window_15m_price_pct'))
            net=n(recent.get('recent_5m_net_taker_usdt'))
            share=n(recent.get('recent_5m_buy_share'))
            at_fill=o.get('price_context_end_ms')
            base_verified=(o.get('price_context_status')=='ALIGNED_REAL_OFFICIAL_1M_CONTEXT' and
               flow.get('verified') is True and
               flow.get('full_exchange_local_public_taker_flow_verified') is True and
               flow.get('completeness')=='COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED' and
               recent.get('status')=='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10' and
               recent.get('price_time_alignment_verified') is True and
               at_fill==flow.get('end_ms') and isinstance(at_fill,int) and
               at_fill<=at and at-at_fill<=14*MIN and
               None not in (p,p15,net,share) and 0<=share<=1 and
               abs((n(recent.get('recent_5m_price_change_pct')) or 999)-p)<=.02)
            if not base_verified:
                stats['not_verified_current_flow']+=1;continue
            stats['valid_verified_real_taker']+=1
            if net==0 or p==0 or (1 if net>0 else -1)!=(1 if p>0 else -1):
                stats['opposing_or_flat_taker_price']+=1;continue
            key=(sym,at)
            if key in prior:continue
            prior.add(key)
            events.append({'symbol':sym,'at_ms':at,'direction':1 if p>0 else -1,
              'current_5m_pct':p,'prior_15m_pct':p15,
              'flow_buy_share':share,
              'net_taker_usdt':net,
              'recent5_trades':n(recent.get('recent_5m_trades')),
              'pressure_shift':n(recent.get('buy_share_delta')),
              'book_second_snapshot':(o.get('book_proof_v13') or {}).get('status')==
                    'TWO_DISTINCT_BOOK_SNAPSHOTS',
              'reversal_5m_15m':p*p15<0,
              'with_price_reversal':abs(p-p15/3),
              'flow_share_extreme':abs(share-.5),
              'close_location_5m':n(recent.get('actual_5m_close_location_in_range'))})
        if (i+1)%100==0:print('V20_AUDIT_EVIDENCE_PROGRESS',i+1,flush=True)
    labeled,missing=label_rows(events,symbols)
    # Detect hidden dependence: eliminate repeat alerts on the same symbol
    # within 90 minutes, and compare independent sign strategies. This is a
    # retrospective *hypothesis*, not a validated production forecast.
    last_signal_by_symbol={}
    distinct=[]
    for e in sorted(labeled,key=lambda z:z['at_ms']):
        last=last_signal_by_symbol.get(e['symbol'])
        if last is not None and e['at_ms']-last<90*MIN:
            continue
        distinct.append(e)
        last_signal_by_symbol[e['symbol']]=e['at_ms']
    def flip(events):
        return [{**e,'signed_outcomes':{k:-v for k,v in e['signed_outcomes'].items()}}
          for e in events]
    def candidate_regime(events):
        return [{**e,'signed_outcomes':{
          k:(v if e['reversal_5m_15m'] else -v)
            for k,v in e['signed_outcomes'].items()}} for e in events]
    strategies={}
    for title,rule in [('prior_V19_direction',lambda z:z),
                       ('opposite_current_5m',flip),
                       ('follow_only_early_reversal_else_countertrend',candidate_regime)]:
        transformed=rule(distinct)
        strategies[title]={'nonoverlap_90m_15m':summary(transformed,15),
          'nonoverlap_90m_5m':summary(transformed,5),
          'nonoverlap_90m_30m':summary(transformed,30),
          'nonoverlap_90m_60m':summary(transformed,60)}
    last30=[x for x in distinct if x['at_ms']>=
      (sorted(set(e['at_ms'] for e in labeled))[int(len(set(e['at_ms'] for e in labeled))*.7)]
       if labeled else float('inf'))]
    strategies['later30_nonoverlap_15m']={
      'V19':summary(last30,15),
      'opposite':summary(flip(last30),15),
      'reversal_aware':summary(candidate_regime(last30),15)}

    # Separate raw 15m outcome and candidate subgroups, no training or post-hoc
    # cherry-picking promoted to production. Includes small-sample warnings.
    groups={
     'all_verified_same_sign':lambda e:True,
     'bullish_taker_and_price':lambda e:e['direction']>0,
     'bearish_taker_and_price':lambda e:e['direction']<0,
     'early_reversal_five_vs_fifteen':lambda e:e['reversal_5m_15m'],
     'trend_continuation':lambda e:not e['reversal_5m_15m'],
     'two_real_book_reads':lambda e:e['book_second_snapshot'],
     'without_two_real_book_reads':lambda e:not e['book_second_snapshot'],
     'recent_strong_buy_share':lambda e:e['flow_buy_share']>=.65 and e['direction']>0,
     'recent_strong_sell_share':lambda e:e['flow_buy_share']<=.35 and e['direction']<0
    }
    summary_table={}
    for key,pred in groups.items():
        group=[x for x in labeled if pred(x)]
        summary_table[key]={'15m':summary(group,15),'5m':summary(group,5),
          '30m':summary(group,30),'60m':summary(group,60)}
    # Sequential holdout by UTC timestamp; earlier 70% not used to choose labels
    # in this diagnostic. No fitting here, simply compare repeatability by segment.
    times=sorted(set(x['at_ms'] for x in labeled))
    boundary=times[int(len(times)*.70)] if times else None
    periods={}
    if boundary:
        for period,pred in [('earlier70',lambda e:e['at_ms']<boundary),
                            ('later30_untouched',lambda e:e['at_ms']>=boundary)]:
            sub=[e for e in labeled if pred(e)]
            periods[period]={'num':len(sub),'all':summary(sub,15),
                             'up':summary([x for x in sub if x['direction']>0],15),
                             'down':summary([x for x in sub if x['direction']<0],15)}
    days=sorted({dt.datetime.fromtimestamp(x['at_ms']/1000,UTC).strftime('%Y-%m-%d') for x in labeled})
    result={
      'version':'V20_V19_FLOW_DIRECTION_BACKTEST_20261031',
      'audited_origin':'actual historic Git main V18 official 15m Bitget real fills and completed future 1m close, not Telegram receipts',
      'current_5m_price_and_local_taker_assumed_to_predict_future':True,
      'commit_versions':{'completed_market_snapshots':len(price_commits),
         'verified_taker_snapshots':len(evidence_commits)},
      'coverage':{'validated_evidence_candidates':len(events),'labeled_15m':len(labeled),
         'missing':dict(missing),'verification':dict(stats),'utc_days':days},
      'all_horizons':{str(m):summary(labeled,m) for m in (5,15,30,60)},
      'risk_subgroups':summary_table,
      'chronological_periods':periods,
      'nonoverlapping_studies_not_deployable':strategies,
      'limits':['Only Bitget official 15-minute local taker flows previously selected by the live collector',
        'Not the complete set of actual V19 Telegram messages; their KV receipts are inaccessible with the current read token',
        'No proof of execution prices, fees, slippage, market impact, wallet accounts or future profitability',
        'Price-return sign is a reactive signal, not a forward forecast',
        'Subgroups are descriptive only, not independently trained and validated models'],
      'no_worker_mutations':True,'no_cloudflare_deployment':True,
      'no_telegram_sends':True,'no_trading':True}
    print('IRYS_V20_V19_REAL_FLOW_FORWARD_AUDIT',json.dumps(result,ensure_ascii=False,sort_keys=True))
if __name__=='__main__':main()
