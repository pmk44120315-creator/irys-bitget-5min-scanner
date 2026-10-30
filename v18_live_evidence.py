#!/usr/bin/env python3
"""V18 independent live evidence collection on existing GitHub runner.
Reads main collector's finished public data; never edits it. Bitget official
public 15m taker+real books for reversal AND established-volume candidates.
Outputs only data/v18_evidence_latest.json and data/v18_evidence_state.json.
No account API, trading, Telegram, Cloudflare deployment, or credentials.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
from pathlib import Path

import collector
from bitget_futures_cvd import collect_futures_flow_observations

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'data/latest.json'
STATE=ROOT/'data/v18_evidence_state.json'
OUTPUT=ROOT/'data/v18_evidence_latest.json'
UTC=dt.timezone.utc
def timestamp_ms(stamp):
    try:return int(dt.datetime.fromisoformat(str(stamp).replace('Z','+00:00')).timestamp()*1000)
    except (TypeError,ValueError,OverflowError):return None
def load(path):
    try:
        item=json.loads(path.read_text(encoding='utf-8'))
        return item if isinstance(item,dict) else {}
    except (FileNotFoundError,ValueError):return {}
def fail(reason,now,source=None):
    return {'version':'V18_EVIDENCE_LIVE_V1','status':'SOURCE_UNAVAILABLE',
            'reason':reason,'at_utc':dt.datetime.fromtimestamp(now/1000,UTC).isoformat(),
            'source_finished_utc':source.get('finished_utc') if isinstance(source,dict) else None,
            'observations':[],'observation_only':True,'orders':False,'telegram_sent':False}

def run(source,state,now,api=collector.http_json,align=None):
    if not isinstance(source,dict) or source.get('collector_status')!='PASS':
        return fail('SOURCE_NOT_PASS',now,source),state
    finished=timestamp_ms(source.get('finished_utc'))
    if finished is None or finished>now+60000 or now-finished>12*60000:
        return fail('SOURCE_NOT_FRESH',now,source),state
    if not isinstance(state,dict):state={}
    # The protected original producer and its state files remain untouched.
    snapshot={'collector_status':'PASS',
       'watchlist':[dict(o) for o in source.get('watchlist') or []],
       'early_pool':[dict(o) for o in source.get('early_pool') or []]}
    try:
        evidence=collect_futures_flow_observations(
           snapshot,now,api,limit=6,state=state,v18_select=True)
    except Exception as exc:
        return {'version':'V18_EVIDENCE_LIVE_V1','status':'EVIDENCE_API_FAILED',
           'reason':type(exc).__name__,'at_utc':dt.datetime.fromtimestamp(now/1000,UTC).isoformat(),
           'source_finished_utc':source.get('finished_utc'),
           'observations':[],'observation_only':True,'orders':False,'telegram_sent':False},state
    snapshot['futures_flow']=evidence
    try:
        # Reuse exact-minute source verification, not old unaligned 5m snapshots.
        reconcile=align(snapshot) if align else collector.align_futures_flow_price_context(snapshot)
    except Exception as exc:
        reconcile={'status':'FAILED','reason':type(exc).__name__}
        for row in evidence.get('observations') or []:
            row['price_context_status']='UNVERIFIED_ALIGNMENT_EXCEPTION'
    observations=evidence.get('observations') or []
    verified=sum(row.get('taker_flow_15m',{}).get('verified') is True for row in observations)
    aligned=sum(row.get('price_context_status')=='ALIGNED_REAL_OFFICIAL_1M_CONTEXT'
                 for row in observations)
    nowutc=dt.datetime.fromtimestamp(now/1000,UTC).isoformat()
    out={'version':'V18_EVIDENCE_LIVE_V1',
       'status':'PASS' if evidence.get('status') in ('EVALUATED','NO_CANDIDATES') else 'PARTIAL',
       'at_utc':nowutc,'source_finished_utc':source['finished_utc'],
       'source_fingerprint':hashlib.sha256(
          str(source.get('finished_utc')).encode()).hexdigest()[:20],
       'selector_version':evidence.get('selector_version','UNKNOWN'),
       'candidates_eligible':evidence.get('markets_eligible_for_proof',0),
       'candidates_selected':len(observations),
       'reversal_selected':evidence.get('selected_reversal_evidence_targets',0),
       'historical_selector_preserved':evidence.get('old_v17_selector_preserved_in_blend') is True,
       'verified_real_taker_15m':verified,'time_aligned_real_taker':aligned,
       'price_alignment':reconcile,'flow_status':evidence.get('status'),
       'observations':observations,
       'limits':{'exchange_local_taker_only':True,'all_exchange_cvd':False,
         'two_point_orderbook_is_not_absorption':True,
         'OI_does_not_identify_long_short_position_owner':True,
         'actual_direction_accuracy_not_claimed':True,
         'this_is_NOT_an_order_or_telegram_alert':True},
       'observation_only':True,'orders':False,'telegram_sent':False}
    return out,state

def main():
    source,state=load(SOURCE),load(STATE)
    now=int(collector.utc_now().timestamp()*1000)
    evidence,newstate=run(source,state,now)
    collector.write_json_atomic(OUTPUT,evidence)
    if evidence['status']=='PASS':
        collector.write_json_atomic(STATE,newstate)
    print('IRYS_V18_REAL_EVIDENCE',json.dumps({
      k:evidence.get(k) for k in ('version','status','source_finished_utc',
       'candidates_eligible','candidates_selected','reversal_selected',
       'verified_real_taker_15m','time_aligned_real_taker','flow_status')},ensure_ascii=False))
    return 0 if evidence['status']=='PASS' else 2
if __name__=='__main__':raise SystemExit(main())
