#!/usr/bin/env python3
"""V26 forward-only causal direction study, *never* an automatic alert sender.

Reads previously issued V22 authentic public quote observations. Freezes several
direction hypotheses while their future 5m/15m prices are unknown, then reads
only later independently saved actual V22 bid/ask quote outcomes.
No network/API keys/Cloudflare/Telegram/ordering. Writes V26-only local files.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import pathlib
import tempfile
import time
from v26_direction_core import (
    MINUTE,HORIZONS,METHODS,COST_SCENARIO_PCT,number,quote_ok,
    direction_hypotheses,label_from_v22,evaluate_records)

BASE=pathlib.Path(__file__).resolve().parent
DATA=BASE/'data'
MAX_FRESH_MS=12*MINUTE
MAX_NEW_ISSUE_AGE_MS=4*MINUTE
MAX_RECORDS=6000
MAX_WAIT_MS=3*3_600_000
UTC=dt.timezone.utc

def iso_ms(value):
    try:
        stamp=dt.datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if stamp.tzinfo is None:return None
        return int(stamp.timestamp()*1000)
    except (ValueError,TypeError,OverflowError):
        return None

def read_json(path):
    try:
        obj=json.loads(path.read_text(encoding='utf-8'))
        return obj if isinstance(obj,dict) else {}
    except (FileNotFoundError,ValueError,UnicodeError):
        return {}

def write_atomic(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    data=json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'
    tmp=None
    try:
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,
            prefix='.v26-temp-',suffix='.json',delete=False) as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
            tmp=pathlib.Path(stream.name)
        os.replace(tmp,path)
    finally:
        if tmp is not None and tmp.exists():tmp.unlink()

def key(event):
    venue=event.get('venue');symbol=event.get('symbol');issued=event.get('issued_ms')
    if venue not in ('bitget','bithumb') or not isinstance(symbol,str) or not isinstance(issued,int):
        return None
    if (venue=='bitget' and not symbol.endswith('USDT') or
        venue=='bithumb' and not symbol.startswith('KRW-')):return None
    return f'{venue}:{symbol}:{issued}'

def run(source,ledger,old,now_ms):
    """Idempotent: repeats do not change frozen predictions or rewrite labels."""
    state=dict(old) if isinstance(old,dict) else {}
    current=state.get('records') or []
    current=[r for r in current if isinstance(r,dict) and key(r)]
    by_id={key(r):r for r in current}
    summary={'stale_source':False,'event_source_count':0,
             'late_or_future_issues':0,'source_events_with_existing_outcomes':0,
             'invalid_entry_quotes':0,'new_predictions':0,
             'new_future_labels':0,'unmeasured_new':0,
             'duplicates':0,'source_event_without_original':0,
             'flow_verified_new':0,'flow_missing_new':0}
    source_at=iso_ms(source.get('asof_utc'))
    valid_source=(source.get('status') in ('RESEARCH_ACTIVE','RESEARCH_PARTIAL')
        and source_at is not None and 0<=now_ms-source_at<=MAX_FRESH_MS)
    summary['stale_source']=not valid_source
    all_events=[z for z in (ledger.get('completed') or [])+(ledger.get('pending') or [])
        if isinstance(z,dict)]
    summary['event_source_count']=len(all_events)
    lookup={key(z):z for z in all_events if key(z)}
    # Existing predictions were issued when their future outcomes were unavailable.
    # Mutate only their *labels*, never their votes/side/issue timestamp.
    if valid_source:
        for r in current:
            original=lookup.get(key(r))
            if original is None:
                summary['source_event_without_original']+=1
                continue
            labels=dict(r.get('labels') or {})
            entry=original.get('entry_quote') or {}
            frozen=r.get('entry_quote') or {}
            # V22 may only annotate future outcomes. Its original bid, ask and
            # issued quote timestamp must never change after V26 freezes them.
            same_entry=(quote_ok(entry) and quote_ok(frozen)
                and entry.get('at_ms')==frozen.get('at_ms')
                and number(entry.get('bid'))==number(frozen.get('bid'))
                and number(entry.get('ask'))==number(frozen.get('ask')))
            if not same_entry:
                summary['source_event_without_original']+=1
                continue
            for horizon in HORIZONS:
                k=str(horizon)
                if k in labels:continue
                source_outcome=(original.get('outcomes') or {}).get(k)
                known=label_from_v22(original,horizon,now_ms)
                if known is not None:
                    labels[k]=known;summary['new_future_labels']+=1
                elif isinstance(source_outcome,dict) and source_outcome.get('status')=='UNMEASURED_AFTER_TARGET':
                    labels[k]={'status':'SOURCE_OUTCOME_UNMEASURED',
                        'actual_fill_verified':False}
                    summary['unmeasured_new']+=1
                elif now_ms-r['issued_ms']>=MAX_WAIT_MS:
                    labels[k]={'status':'SOURCE_EXPIRED_NO_REAL_QUOTE',
                        'actual_fill_verified':False}
                    summary['unmeasured_new']+=1
            r['labels']=labels
        # New events can be enrolled ONLY if their actual future outcome is
        # not yet known, and the publicly quoted entry is still fresh.
        for original in (ledger.get('pending') or []):
            if not isinstance(original,dict):continue
            oid=key(original)
            if oid is None:continue
            if oid in by_id:summary['duplicates']+=1;continue
            issued=original['issued_ms']
            if not 0<=now_ms-issued<=MAX_NEW_ISSUE_AGE_MS:
                summary['late_or_future_issues']+=1;continue
            if original.get('outcomes'):
                summary['source_events_with_existing_outcomes']+=1;continue
            entry=original.get('entry_quote')
            if not quote_ok(entry) or abs(entry['at_ms']-issued)>MINUTE:
                summary['invalid_entry_quotes']+=1;continue
            f=original.get('features') or {}
            flag=original.get('real_taker_verified') is True
            check=direction_hypotheses(f,original['venue'],flag)
            if check['status']!='EVALUATED':continue
            record={'venue':original['venue'],'symbol':original['symbol'],
              'issued_ms':issued,'id':oid,
              'frozen_at_ms':now_ms,'source':'EXISTING_V22_REAL_ISSUED_QUOTE',
              'evidence_class':check['evidence_class'],
              'source_has_reconciled_15m_taker':check['source_has_reconciled_15m_taker'],
              'votes':check['votes'],'explanation':{
                k:check.get(k) for k in (
                'flow_price_agree','flow_price_disagree','taker_bias',
                'price_1m_pct','price_5m_pct','price_15m_pct',
                'first_reversal_vs_15m','close_location_observed',
                'top5_book_ratio_log_observed_not_absorption',
                'oi_change_observed_not_position_side',
                'spread_pct_observed','strength_not_probability')},
              'entry_quote':{
                  'bid':entry['bid'],'ask':entry['ask'],'at_ms':entry['at_ms']},
              'labels':{},'order_allowed':False,'telegram_sent':False,
              'future_accurate_proven':False}
            current.append(record);by_id[oid]=record
            summary['new_predictions']+=1
            if flag:summary['flow_verified_new']+=1
            else:summary['flow_missing_new']+=1
    # Store only a bounded original research ledger, preserving recent pending
    # measurements. Never import V22's mutable weight/model state.
    current.sort(key=lambda r:(r['issued_ms'],r['venue'],r['symbol']))
    state.update({'version':'V26_PROSPECTIVE_SOURCE_FROZEN_V1',
        'records':current[-MAX_RECORDS:],
        'asof_ms':now_ms,'last_source_asof_ms':source_at})
    selected=state['records']
    recent=[r for r in selected if now_ms-r['issued_ms']<5*MINUTE][:10]
    evidence_counts={}
    for r in selected:evidence_counts[r.get('evidence_class')]=evidence_counts.get(r.get('evidence_class'),0)+1
    measurements={}
    for h in HORIZONS:
        measurements[str(h)]={}
        for venue in ('bitget','bithumb'):
            measurements[str(h)][venue]={
              method:evaluate_records(selected,h,venue,method) for method in METHODS}
    unmeasured={}
    for h in HORIZONS:
        due=[r for r in selected if r['issued_ms']+h*MINUTE<=now_ms]
        measured=sum((r.get('labels') or {}).get(str(h),{}).get('status')==
                     'ACTUAL_DELAYED_BID_ASK_MEASURED' for r in due)
        missed=sum((r.get('labels') or {}).get(str(h),{}).get('status') in
                    ('SOURCE_OUTCOME_UNMEASURED','SOURCE_EXPIRED_NO_REAL_QUOTE') for r in due)
        unmeasured[str(h)]={'due':len(due),'real_quote_measured':measured,
            'source_missing_or_expired':missed,'still_waiting_source':len(due)-measured-missed,
            'real_quote_coverage':round(measured/len(due),5) if due else None}
    status='SOURCE_STALE_NO_NEW_ENROLLMENT' if not valid_source else 'PROSPECTIVE_RESEARCH_ACTIVE'
    report={'version':'V26_CAUSAL_REAL_TAKER_PRICE_PROSPECTIVE_V1',
      'asof_utc':dt.datetime.fromtimestamp(now_ms/1000,UTC).isoformat(),
      'source_v22_asof_utc':source.get('asof_utc'),
      'source_v22_status':source.get('status'),'status':status,
      'new_predictions':summary['new_predictions'],
      'new_future_quote_labels':summary['new_future_labels'],
      'total_frozen_forecast_events':len(selected),
      'diagnostics':summary,'evidence_class_counts':evidence_counts,
      'latest_preissued_hypotheses':[{
          'venue':r['venue'],'symbol':r['symbol'],'issued_ms':r['issued_ms'],
          'evidence_class':r['evidence_class'],'side':r['votes'].get('v26_primary',0),
          'future_direction_proven':False,'telegram_sent':False} for r in recent],
      'quote_coverage':unmeasured,
      'forward_quote_results':measurements,
      'cost_scenario_pct_beyond_public_spread':COST_SCENARIO_PCT,
      'real_execution_verified':False,'future_accuracy_improvement_proven':False,
      'statistical_independence_of_symbols_unproven':True,
      'future_direction_guaranteed':False,
      'orders_sent':False,'telegram_sent':False,
      'production_signal_eligible':False}
    return report,state

def main():
    now=int(time.time()*1000)
    report,state=run(read_json(DATA/'v22_evidence_latest.json'),
        read_json(DATA/'v22_evidence_state.json'),
        read_json(DATA/'v26_direction_state.json'),now)
    # Even stale-source episodes are honest; state is updated only when live
    # outcomes were inspected, leaving old frozen sides unchanged.
    write_atomic(DATA/'v26_direction_latest.json',report)
    if report['status']=='PROSPECTIVE_RESEARCH_ACTIVE':
        write_atomic(DATA/'v26_direction_state.json',state)
    print('IRYS_V26_CAUSAL_FORWARD',json.dumps({
      k:report[k] for k in ('status','new_predictions','new_future_quote_labels',
        'total_frozen_forecast_events','quote_coverage','evidence_class_counts',
        'orders_sent','telegram_sent')},ensure_ascii=False))
    return 0 if report['status']=='PROSPECTIVE_RESEARCH_ACTIVE' else 2
if __name__=='__main__':
    raise SystemExit(main())
