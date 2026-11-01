#!/usr/bin/env python3
"""Read-only V25 direction forensics from authentic V22 issued-before-outcome events.

This is a retrospective diagnostic, NEVER a trading/backtest performance claim:
- No exchange network, keys, orders, Telegram, Cloudflare or mutable state.
- Only pre-issued predictions/features and subsequently measured authentic quotes.
- Subsampling overlapping signals prevents the same price path inflating n.
- Cost 0.2% is a scenario beyond public best quote crossing, not real execution.
- Unevaluable later quotes count as missing (not wins, not losses).
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import json
import math
import pathlib
import statistics

HORIZONS=(5,15)
COST_PCT=0.20

def n(v):
    if isinstance(v,bool) or v is None:return None
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except (TypeError,ValueError,OverflowError):
        return None

def side(v):
    x=n(v)
    return int(x>0)-int(x<0) if x is not None else 0

def metric(rows):
    if not rows:return {'n':0,'mean_net_pct':None,'net_wins':0,'net_losses':0,
                        'direction_rate':None,'hour_blocks':0,'distinct_coins':0}
    values=[z['net_pct'] for z in rows]
    return {'n':len(rows),'net_wins':sum(x>0 for x in values),
      'net_losses':sum(x<=0 for x in values),
      'mean_net_pct':round(statistics.fmean(values),5),
      'median_net_pct':round(statistics.median(values),5),
      'direction_rate':round(sum(z['mid_correct'] for z in rows)/len(rows),5),
      'hour_blocks':len({z['issued_ms']//3600000 for z in rows}),
      'distinct_coins':len({z['venue']+':'+z['symbol'] for z in rows})}

def observations(data,h):
    """One matured outcome per symbol per h minutes, timestamped at issue time."""
    selected=[];last={}
    all_rows=(data.get('completed') or [])+(data.get('pending') or [])
    valid=0;missing=0;overlap=0
    for r in sorted(all_rows,key=lambda z:(z.get('issued_ms',0),z.get('symbol',''))):
        if not isinstance(r,dict) or r.get('venue') not in ('bitget','bithumb'):
            continue
        issued=r.get('issued_ms');sym=r.get('symbol')
        if not isinstance(issued,int) or not isinstance(sym,str):continue
        outcome=(r.get('outcomes') or {}).get(str(h))
        if not isinstance(outcome,dict) or outcome.get('both_sides_measured') is not True:
            missing+=1;continue
        entry=r.get('entry_quote') or {};future=outcome.get('exit_quote') or {}
        if not isinstance(entry,dict) or not isinstance(future,dict):
            missing+=1;continue
        ep=n(entry.get('bid'));ea=n(entry.get('ask'))
        fp=n(future.get('bid'));fa=n(future.get('ask'))
        it=entry.get('at_ms');ft=future.get('at_ms')
        if not all(z is not None and z>0 for z in (ep,ea,fp,fa)) or ea<ep or fa<fp:
            missing+=1;continue
        if not isinstance(it,int) or not isinstance(ft,int) or ft<issued+h*60000 or ft>issued+h*60000+150000:
            missing+=1;continue
        if r.get('venue')=='bithumb' and not (r.get('decisions') or {}).get(str(h)):
            continue
        key=(r['venue'],sym)
        previous=last.get(key)
        if previous is not None and issued-previous<h*60000:
            overlap+=1;continue
        last[key]=issued
        baseline=(ep+ea)/2
        after=(fp+fa)/2
        mid_change=100*(after/baseline-1)
        move=side(mid_change)
        predictions=(r.get('decisions') or {}).get(str(h)) or {}
        votes=(r.get('votes') or {}).get(str(h)) or {}
        for model in ('online_ensemble','momentum5','countertrend5','taker_bias','v21_frozen'):
            prediction=predictions.get('direction') if model=='online_ensemble' else votes.get(model)
            s=side(prediction)
            if s==0 or (r['venue']=='bithumb' and s==-1):continue
            # Use already recorded authentic quote returns, not recomputed price-only fill.
            returns=(outcome.get('signed_quote_returns') or {}).get(str(s))
            result=n(returns)
            if result is None:continue
            selected.append({'model':model,'venue':r['venue'],'symbol':sym,
                'issued_ms':issued,'horizon_min':h,'side':s,
                'net_pct':result-COST_PCT,
                'mid_correct':move==s, 'mid_flat':move==0,
                'flow_verified':r.get('real_taker_verified') is True,
                'taker_vote':side(votes.get('taker_bias')),
                'price_momentum_vote':side(votes.get('momentum5')),
                'mid_change_pct':mid_change})
            valid+=1
    return selected,{'rows_with_missing_or_unmeasured':missing,
       'rows_skipped_as_overlapping':overlap,'model_projections':valid}

def breakdown(rows,venue,h,model):
    z=[r for r in rows if r['venue']==venue and r['horizon_min']==h and r['model']==model]
    a={'all':metric(z)}
    a['taker_evidence']={
        'verified':metric([r for r in z if r['flow_verified']]),
        'missing':metric([r for r in z if not r['flow_verified']])}
    a['taker_relation']={
        'aligned':metric([r for r in z if r['taker_vote']!=0 and r['taker_vote']==r['side']]),
        'opposed':metric([r for r in z if r['taker_vote']!=0 and r['taker_vote']!=r['side']]),
        'unknown':metric([r for r in z if r['taker_vote']==0])}
    a['price_momentum_relation']={
        'aligned':metric([r for r in z if r['price_momentum_vote']==r['side']]),
        'opposed':metric([r for r in z if r['price_momentum_vote']!=0 and r['price_momentum_vote']!=r['side']]),
        'unknown':metric([r for r in z if r['price_momentum_vote']==0])}
    z.sort(key=lambda r:r['issued_ms'])
    cut=math.ceil(len(z)*0.75)
    a['last_quarter']=metric(z[cut:])
    return a

def run(obj,source_sha='UNKNOWN',observed_at='UNKNOWN'):
    out={'version':'V25_DIRECTION_DIAGNOSTIC_READONLY_V1',
         'source_git_sha':source_sha,'observed_at_utc':observed_at,
         'cost_scenario_pct':COST_PCT,
         'causality':'PREISSUED_FEATURES_AND_REAL_LATER_QUOTE_PROXY',
         'actual_executable_returns_verified':False,
         'out_of_sample_improvement_proved':False,
         'production_change':False,
         'warning':'RETROSPECTIVE_COHORT_ANALYSIS_NOT_TRADE_OR_FORWARD_VALIDATION',
         'raw_events_completed':len(obj.get('completed') or []),
         'raw_events_pending':len(obj.get('pending') or []),
         'timeframes':{}}
    for h in HORIZONS:
        rows,counts=observations(obj,h)
        body={'sample_quality':counts,'results':{}}
        for venue in ('bitget','bithumb'):
            body['results'][venue]={}
            for model in ('online_ensemble','momentum5','countertrend5','taker_bias','v21_frozen'):
                body['results'][venue][model]=breakdown(rows,venue,h,model)
        out['timeframes'][str(h)]=body
    return out

def main():
    p=argparse.ArgumentParser()
    p.add_argument('state_json',type=pathlib.Path)
    p.add_argument('--source-sha',default='UNKNOWN')
    p.add_argument('--observed-at',default='UNKNOWN')
    args=p.parse_args()
    obj=json.loads(args.state_json.read_text(encoding='utf-8'))
    result=run(obj,args.source_sha,args.observed_at)
    print('V25_DIRECTION_FORENSICS_JSON '+json.dumps(result,ensure_ascii=False,separators=(',',':')))
    for h in HORIZONS:
        for venue in ('bitget','bithumb'):
            details=result['timeframes'][str(h)]['results'][venue]['online_ensemble']
            print('V25_DIAG',json.dumps({'horizon':h,'venue':venue,
                'ensemble':details['all'],'verified_taker':details['taker_evidence']['verified'],
                'missing_taker':details['taker_evidence']['missing'],
                'recent_holdout_quarter':details['last_quarter']},ensure_ascii=False))
if __name__=='__main__':main()
