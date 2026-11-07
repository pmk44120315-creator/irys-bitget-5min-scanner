"""Read-only actual-market proof for existing, pre-issued V22 predictions.
No fabricated event/entry timestamps. Wait for a real pending target, then
compare the original first quote batch with target-aware recollection.
Writes only local proof artifacts; never production state, orders or Telegram.
"""
import copy
import hashlib
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import collector
from v21_runtime import fetch_quotes
from v22_direction_core import HORIZONS, MIN, is_quote
from v41_quote_capture import capture_outcomes, outcome_key


def main():
    out=Path('v41_proof');out.mkdir(exist_ok=True)
    raw=Path('data/v22_evidence_state.json').read_bytes();state=json.loads(raw)
    before=hashlib.sha256(raw).hexdigest();now=int(time.time()*1000)
    pending=[]
    for r in state.get('pending',[]):
        issue=r.get('issued_ms');q=r.get('entry_quote')
        if (type(issue) is int and issue<=now and is_quote(q) and 0<=issue-q['at_ms']<=MIN
            and r.get('venue') in ('bitget','bithumb') and isinstance(r.get('symbol'),str)):
            pending.append(r)
    upcoming=sorted({r['issued_ms']+h*MIN for r in pending for h in HORIZONS
                     if str(h) not in r.get('outcomes',{}) and r['issued_ms']+h*MIN>now+1000})
    if not upcoming:
        raise RuntimeError('NO_REAL_PENDING_TARGET_AVAILABLE')
    target=upcoming[0]
    wait=max(0,(target-2000-now)/1000)
    print('V41_WAIT_FOR_EXISTING_PREDICTION',json.dumps({'source_sha256':before,'pending_events':len(pending),
          'target_ms':target,'now_ms':now,'wait_seconds':wait,'synthetic_events':False}),flush=True)
    if wait:time.sleep(wait)
    requested=int(time.time()*1000)
    pairs={(r['venue'],r['symbol']) for r in pending}
    batches=[]
    def read(pairs,stamp):
        quotes,errors=fetch_quotes(pairs,collector.http_json,stamp)
        batches.append({'requested_at_ms':stamp,'received_at_ms':int(time.time()*1000),
                       'quotes':[{'venue':p[0],'symbol':p[1],**q} for p,q in sorted(quotes.items())],
                       'errors':errors})
        return quotes,errors
    first,errors=read(pairs,requested)
    result=capture_outcomes(pending,first,pairs,int(time.time()*1000),read=read)
    captured=[]
    for (venue,symbol,issued,h),label in result['outcomes'].items():
        assert issued+h*MIN<=label['exit_quote']['at_ms']<=issued+h*MIN+150000
        assert label['exit_quote']['at_ms']<=label['received_at_ms']
        captured.append({'venue':venue,'symbol':symbol,'issued_ms':issued,'horizon':h,'label':label})
    assert captured,'NO_ACTUAL_VALID_FUTURE_QUOTES_CAPTURED'
    assert hashlib.sha256(Path('data/v22_evidence_state.json').read_bytes()).hexdigest()==before
    proof={'version':'V41_ACTUAL_PENDING_QUOTE_CAPTURE_PROOF_V1','source_state_sha256':before,
           'existing_prediction_target_ms':target,'first_request_at_ms':requested,
           'receipt':result['receipt'],'first_batch_errors':errors,'captured':captured,
           'source_state_unchanged':True,'synthetic_events':False,'orders_sent':False,
           'telegram_sent':False,'direction_accuracy_improvement_proven':False}
    (out/'live_capture.json').write_text(json.dumps(proof,indent=2))
    (out/'provider_batches.json').write_text(json.dumps(batches,indent=2))
    print('V41_ACTUAL_CAPTURE_RESULT',json.dumps({'captured':len(captured),'initial':result['receipt']['initial_measured'],
          'recovered':result['receipt']['recovered_after_reread'],'wait_ms':result['receipt']['wait_ms'],
          'read_batches':result['receipt']['read_batches'],'errors':result['receipt']['errors'],
          'source_state_unchanged':True,'direction_accuracy_improvement_proven':False}),flush=True)

if __name__=='__main__':main()
