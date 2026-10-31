"""Apply the reviewed missing-outcome correction on the V21 development branch.
This is a build-time source patch only, not runtime code or a production writer.
Every changed anchor must be unique; all replacements are checked before writes.
"""
import hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
paths=['v21_runtime.py','deployment/v21_forecast_delivery.mjs','tests/test_v21_delivery.mjs']
original={p:(ROOT/p).read_text(encoding='utf8') for p in paths}
if 'unmeasured_outcomes' in original['v21_runtime.py']:
    assert 'coverage_ratio)>=.95' in original['deployment/v21_forecast_delivery.mjs']
    print('V21_COVERAGE_REVIEW_ALREADY_APPLIED')
    raise SystemExit(0)
b=original['v21_runtime.py'].encode()
assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()=='ef53fc3e7be09f1d08ca209dab527725ed254a63', 'RUNTIME_CHANGED_REVIEW_AGAIN'
changed=dict(original)
def patch(path,old,new):
    assert changed[path].count(old)==1, ('NONUNIQUE_PATCH',path,old)
    changed[path]=changed[path].replace(old,new)
p='v21_runtime.py'
patch(p,'def certificate(rows, venue, horizon, side):','def certificate(rows, venue, horizon, side, unmeasured=0):')
patch(p,"    if venue=='bithumb' and side!=1:ready=False;reason='SPOT_SHORT_NOT_ACTIONABLE'",
"    missing=max(0,int(unmeasured))\n    total=metric['signals']+missing\n    coverage=metric['signals']/total if total else 0.0\n    if missing and coverage<.95:\n        ready=False;reason='FORWARD_OUTCOME_COVERAGE_INSUFFICIENT'\n    if venue=='bithumb' and side!=1:ready=False;reason='SPOT_SHORT_NOT_ACTIONABLE'")
patch(p,"        'span_hours':span,'observed_signals':metric['signals'],",
"        'span_hours':span,'observed_signals':metric['signals'],\n        'coverage_ratio':coverage,'unmeasured_outcomes':missing,")
patch(p,"    completed=[dict(r) for r in state.get('completed',[]) if isinstance(r,dict)]",
"    completed=[dict(r) for r in state.get('completed',[]) if isinstance(r,dict)]\n    unmeasured=[dict(r) for r in state.get('unmeasured',[]) if isinstance(r,dict)]")
patch(p,'            expired+=1','            expired+=1\n            unmeasured.append({k:r.get(k) for k in (\'model_key\',\'model_sha256\',\'symbol\',\'side\',\'issued_ms\')})')
patch(p,'    completed=completed[-4000:];certificates={}',
'    completed=completed[-4000:];unmeasured=unmeasured[-4000:];certificates={}')
patch(p,"        certificates[key]={str(side):certificate(own,p['venue'],p['horizon_min'],side)",
"        certificates[key]={str(side):certificate(own,p['venue'],p['horizon_min'],side,\n            unmeasured=sum(1 for r in unmeasured if r.get('model_key')==key\n                and r.get('model_sha256')==p['model_sha256'] and r.get('side')==side\n                and (r.get('issued_ms') or 0)>=p['prospective_validation_start_ms']))")
patch(p,"    state.update({'pending':remaining,'completed':completed,'last_registered':seen,",
"    state.update({'pending':remaining,'completed':completed,'unmeasured':unmeasured,'last_registered':seen,")
patch(p,"      'completed_quote_outcomes':len(completed),'expired_targets_this_run':expired,",
"      'completed_quote_outcomes':len(completed),'expired_targets_this_run':expired,\n      'unmeasured_quote_targets':len(unmeasured),")
patch('deployment/v21_forecast_delivery.mjs','   v21Num(p.cost_scenario_pct)>=.20;',
'   v21Num(p.cost_scenario_pct)>=.20&&v21Num(p.coverage_ratio)>=.95;')
patch('tests/test_v21_delivery.mjs','observed_signals:60,net_wins:40,net_losses:20,cost_scenario_pct:.2};',
'observed_signals:60,net_wins:40,net_losses:20,cost_scenario_pct:.2,coverage_ratio:1};')
for path,text in changed.items():
    (ROOT/path).write_text(text,encoding='utf8')
print('V21_COVERAGE_REVIEW_APPLIED',','.join(paths))
