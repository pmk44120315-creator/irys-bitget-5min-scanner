"""Reviewed source-only correction for live-observed STALE_REPORT.
Does not change learned weights, forward evidence standards, token settings,
old legacy channels, source collection or scheduled intervals.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
paths=['deployment/v21_forecast_delivery.mjs','deployment/build_v21_worker.mjs']
texts={p:(ROOT/p).read_text(encoding='utf8') for p in paths}
if 'IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031' in texts[paths[1]]:
    assert 'c.horizon_min*60000/2' in texts[paths[0]]
    print('V21_EXPIRY_ALIGNMENT_ALREADY_APPLIED');raise SystemExit(0)
def patch(path,a,b):
    assert texts[path].count(a)==1, ('PATCH_ANCHOR',path,a)
    texts[path]=texts[path].replace(a,b)
p=paths[0]
patch(p," if(!Number.isFinite(published)||published>at||at-published>90000){out.status='STALE_REPORT';return out;}",
" // A quiet, recently refreshed research report is not a delivery failure.\n if(!Number.isFinite(published)||published>at||at-published>15*60000){out.status='STALE_REPORT';return out;}")
patch(p," if(!list.length){out.status='LEARNING_NO_ELIGIBLE_FORWARD_EVIDENCE';return out;}",
" if(!list.length){out.status='LEARNING_NO_ELIGIBLE_FORWARD_EVIDENCE';return out;}\n // Only the reviewed 5m model is eligible; require at least half its horizon left.\n if(at-published>5*60000/2){out.status='STALE_REPORT';return out;}")
patch(p,'c.issued_ms>at||at-c.issued_ms>90000||c.expires_ms<=at||',
'c.issued_ms>at||at-c.issued_ms>c.horizon_min*60000/2||c.expires_ms<=at||')
patch(p,'current-published>90000','current-published>5*60000/2')
patch(paths[1],'IRYS-V21-LEARNED-FORECAST-FORWARD-EVIDENCE-20261031',
'IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031')
for p,s in texts.items():(ROOT/p).write_text(s,encoding='utf8')
print('V21_EXPIRY_ALIGNMENT_APPLIED_NO_PREDICTION_OR_EVIDENCE_POLICY_CHANGE')
