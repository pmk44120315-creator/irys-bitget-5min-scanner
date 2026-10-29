"""Read-only official Bitget 1m outcomes for saved verified flow candidates.

No future features, auto orders, Telegram sends, chart imputation or fabricated
wins. Report missing exchange candles as unavailable. This is a shadow audit.
"""
import datetime as dt
import json
import math
import statistics
import time
import urllib.parse
import urllib.request
from collections import defaultdict

from audits.v15_replay_verified_flow import read_all, evidence_sign, KST, MIN

HORIZONS=(5,15,30,60)
API='https://api.bitget.com/api/v2/mix/market/history-candles'

def fetch_official(sym,event_ms):
    start=(event_ms//MIN)*MIN-MIN
    end=(event_ms//MIN)*MIN+63*MIN
    params={'symbol':sym,'productType':'USDT-FUTURES',
            'granularity':'1m','startTime':str(start),
            'endTime':str(end),'limit':'200'}
    url=API+'?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={'Accept':'application/json',
        'User-Agent':'IRYS-flow-v15-read-only-outcome-audit'})
    with urllib.request.urlopen(req,timeout=22) as response:
        doc=json.load(response)
    if not isinstance(doc,dict) or doc.get('code')!='00000' or not isinstance(doc.get('data'),list):
        raise ValueError('INVALID_BITGET_PUBLIC_HISTORY_RESPONSE')
    candles={}
    for row in doc['data']:
        if not isinstance(row,list) or len(row)<5:continue
        try:
            ts=int(row[0]);op=float(row[1]);hi=float(row[2]);lo=float(row[3]);close=float(row[4])
        except (TypeError,ValueError,OverflowError):
            continue
        if (ts%MIN or not all(math.isfinite(x) for x in (op,hi,lo,close)) or
            close<=0 or lo<=0 or hi<max(op,close) or lo>min(op,close)):
            continue
        candles[ts]={'close':close,'high':hi,'low':lo}
    return candles

def required_candle_outcome(e,h,rows,now):
    target=e['now']+h*MIN
    bucket=(target//MIN)*MIN
    if bucket+MIN>now:return None,'PENDING_HORIZON'
    x=rows.get(bucket)
    if x is None:return None,'MISSING_EXACT_MINUTE'
    p=100*(x['close']/e['price']-1)
    signed=p if e['side']=='LONG' else -p
    first=e['now']//MIN*MIN
    # Count only complete observations available at decision and after.
    # Price high/low excursions require all source minutes, no zero fill.
    start=(e['now']//MIN)*MIN
    mids=[rows.get(t) for t in range(start,bucket+1,MIN)]
    all_ok=all(v is not None for v in mids)
    favourable=adverse=None
    if all_ok:
        high=max(v['high'] for v in mids);low=min(v['low'] for v in mids)
        favourable=(high/e['price']-1)*100 if e['side']=='LONG' else (1-low/e['price'])*100
        adverse=(1-low/e['price'])*100 if e['side']=='LONG' else (high/e['price']-1)*100
    return {'signed_pct':signed,'actual_close':x['close'],
            'favourable_excursion_pct':round(favourable,4) if favourable is not None else None,
            'adverse_excursion_pct':round(adverse,4) if adverse is not None else None,
            'excursion_full_minute_coverage':all_ok},None

def main():
    timeline,commits,invalid=read_all()
    # One independent 60-minute same-symbol opportunity, no repeated pseudo-wins.
    raw=defaultdict(list)
    count=defaultdict(int)
    for snap in timeline:
        for obs in (snap['flows'].get('observations') or []):
            e=evidence_sign(snap,obs)
            if not e:continue
            count['last5_flow_and_price_observations']+=1
            raw['last5'].append(e)
            if e['all15']:raw['all15'].append(e)
            if e['book']:raw['last5_two_books'].append(e)
            if e['book'] and e['all15']:raw['all15_two_books'].append(e)
    to_probe={}
    groups={}
    for key,items in raw.items():
        selected=[];seen={}
        for e in items:
            if e['now']-seen.get(e['symbol'],-10**20)<60*MIN:continue
            seen[e['symbol']]=e['now']
            selected.append(e)
            to_probe[(e['symbol'],e['now'])]=e
        groups[key]=selected

    requested=len(to_probe);now=int(time.time()*1000)
    candles_cache={};errors={}
    for (sym,stamp),e in to_probe.items():
        try:
            candles_cache[(sym,stamp)]=fetch_official(sym,stamp)
        except Exception as exc:
            errors[(sym,stamp)]=type(exc).__name__
    summary={}
    for key,events in groups.items():
        horizons={}
        for h in HORIZONS:
            vals=[];favourable=[];adverse=[]
            missing=defaultdict(int)
            for e in events:
                lookup=(e['symbol'],e['now'])
                if lookup in errors:
                    missing[errors[lookup]]+=1
                    continue
                item,reason=required_candle_outcome(e,h,candles_cache[lookup],now)
                if not item:
                    missing[reason]+=1
                    continue
                vals.append(item['signed_pct'])
                if item['excursion_full_minute_coverage']:
                    favourable.append(item['favourable_excursion_pct'])
                    adverse.append(item['adverse_excursion_pct'])
            horizons[str(h)+'m']={
                'measured':len(vals),'right':sum(x>=.15 for x in vals),
                'wrong':sum(x<=-.15 for x in vals),
                'flat':sum(-.15<x<.15 for x in vals),
                'mean_signed_pct':round(statistics.mean(vals),4) if vals else None,
                'median_signed_pct':round(statistics.median(vals),4) if vals else None,
                'excursion_full_coverage':len(favourable),
                'median_favourable_pct':round(statistics.median(favourable),4) if favourable else None,
                'median_adverse_pct':round(statistics.median(adverse),4) if adverse else None,
                'unavailable':dict(missing)}
        summary[key]={'candidate_episodes':len(events),'horizons':horizons}
    report={
        'status':'EXACT_PUBLIC_BITGET_CLOSED_1M_SHADOW_AUDIT',
        'api':'Bitget official v2 USDT-FUTURES history-candles',
        'history_commits':commits,'valid_source_snapshots':len(timeline),
        'unique_events_requested':requested,
        'historical_outcome_requests_succeeded':len(candles_cache),
        'historical_outcome_requests_failed':len(errors),
        'request_failure_types':dict((v,list(errors.values()).count(v)) for v in set(errors.values())),
        'groups':summary,
        'limitations':['Snapshot candidate price is not a trade fill or Telegram ACK price.',
            'Only the first fully closed 1m candle at/after the horizon is scored.',
            'Missing candles and uncompleted future horizons have NO win/loss assigned.',
            'Old two-book evidence is point-in-time, not continuous orderbook absorption.',
            'Short 2-3 day samples and correlated markets cannot establish future direction accuracy.']}
    print('IRYS_V15_OFFICIAL_EXACT_1M_OUTCOMES '+json.dumps(report,ensure_ascii=False,separators=(',',':')))

if __name__=='__main__':main()
