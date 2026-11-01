#!/usr/bin/env python3
"""Read-only retrospective check of predeclared V26 direction hypotheses.

This is NOT prospective V26 validation. These records were collected before
the new hypothesis code existed; therefore any post-hoc winner is suspect.
This tool compares all predefined methods, without choosing the best after
seeing the future. The real V26 runtime freezes future hypotheses separately.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import pathlib
from v26_direction_core import (
    HORIZONS, METHODS, COST_SCENARIO_PCT, direction_hypotheses,
    label_from_v22,evaluate_records)
from v26_direction_runtime import key

def run(ledger,asof_ms):
    eligible=[r for r in (ledger.get('completed') or [])+
                (ledger.get('pending') or []) if isinstance(r,dict) and key(r)]
    groups={}
    examples={}
    measured_rows=0
    unmeasured=0
    for h in HORIZONS:
        records=[]
        seen={}
        for event in sorted(eligible,key=lambda z:(z.get('issued_ms',0),z.get('venue',''),
                                                    z.get('symbol',''))):
            issued=event.get('issued_ms')
            if not isinstance(issued,int):continue
            if issued+h*60_000>asof_ms:continue
            k=(event['venue'],event['symbol'])
            previous=seen.get(k)
            if previous is not None and issued-previous<h*60_000:continue
            seen[k]=issued
            label=label_from_v22(event,h,asof_ms)
            if label is None:
                unmeasured+=1;continue
            features=event.get('features') or {}
            parsed=direction_hypotheses(features,event['venue'],
                 event.get('real_taker_verified') is True)
            if parsed.get('status')!='EVALUATED':continue
            # V22 online ensemble's preissued vote is an independent baseline
            # anchored to the exact same original timestamp and real outcome.
            methods={**parsed['votes'],'v22_ensemble':
                (event.get('decisions') or {}).get(str(h),{}).get('direction',0)}
            r={'venue':event['venue'],'symbol':event['symbol'],
               'issued_ms':issued,'votes':methods,'labels':{str(h):label},
               'evidence_class':parsed['evidence_class']}
            records.append(r)
            measured_rows+=1
        groups[str(h)]={}
        for venue in ('bitget','bithumb'):
            sub=[r for r in records if r['venue']==venue]
            sub.sort(key=lambda z:z['issued_ms'])
            three_quarters=(len(sub)*3)//4
            last=sub[three_quarters:]
            groups[str(h)][venue]={
                'observations':len(sub),
                'evidence_class_counts':{
                    c:sum(x['evidence_class']==c for x in sub)
                    for c in sorted({x['evidence_class'] for x in sub})},
                'whole_sample':{
                    method:evaluate_records(sub,h,venue,method)
                    for method in METHODS+('v22_ensemble',)},
                'last_quarter_only_descriptive_not_holdout':{
                    method:evaluate_records(last,h,venue,method)
                    for method in METHODS+('v22_ensemble',)}} 
        examples[str(h)]={'unique_events_measured':len(records)}
    return {'version':'V26_HISTORICAL_PREDECLARED_ALTERNATIVES_V1',
        'retrospective_not_forward_proof':True,
        'period_ends_at_utc':dt.datetime.fromtimestamp(asof_ms/1000,dt.timezone.utc).isoformat(),
        'events_present':len(eligible),
        'measured_horizon_event_rows':measured_rows,
        'unmeasured_horizon_event_rows':unmeasured,
        'quote_proxy_not_real_fills':True,'cost_scenario_pct':COST_SCENARIO_PCT,
        'research_only_no_telegram_no_orders':True,'results':groups,
        'caveat':'No statistical winner may be promoted based on this historical sample alone.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('ledger',type=pathlib.Path)
    p.add_argument('--asof-ms',type=int,required=True)
    args=p.parse_args()
    data=json.loads(args.ledger.read_text(encoding='utf-8'))
    report=run(data,args.asof_ms)
    print('V26_AUDIT_COUNTS',json.dumps({k:report[k] for k in
          ('events_present','measured_horizon_event_rows','unmeasured_horizon_event_rows')}))
    for horizon,venues in report['results'].items():
        for venue,content in venues.items():
            print('V26_AUDIT_COHORT',json.dumps({'horizon':horizon,'venue':venue,
                'observations':content['observations'],'groups':content['evidence_class_counts'],
                'predefined_methods':content['whole_sample'],
                'latest_quarter':content['last_quarter_only_descriptive_not_holdout']},
                ensure_ascii=False))
    print('V26_AUDIT_NO_LIVE_ACTION')
if __name__=='__main__':main()
