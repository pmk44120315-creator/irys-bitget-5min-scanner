"""Development-only source correction; does not call any network or deploy.
All anchors are checked before writes. Actual original Cron remains unchanged.
"""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
paths=['v21_runtime.py','deployment/v21_forecast_delivery.mjs','tests/test_v21_delivery.mjs']
text={p:(ROOT/p).read_text(encoding='utf8') for p in paths}
if 'validation_clock_wait_ms' in text['v21_runtime.py']:
    assert 'async function readV21CurrentReport' in text['deployment/v21_forecast_delivery.mjs']
    print('V21_TIMING_REVIEW_ALREADY_APPLIED');raise SystemExit(0)
def patch(path,a,b):
    assert text[path].count(a)==1, ('ANCHOR_MISMATCH',path,a)
    text[path]=text[path].replace(a,b)
p='v21_runtime.py'
patch(p,'import time\n','import time\nfrom v21_clock import align_validation_clock\n')
patch(p,'    state=dict(old or {});active,model_errors=verified_models(models)',
'    state=dict(old or {});active,model_errors=verified_models(models)\n    now,validation_wait_ms=align_validation_clock(state.get(\'pending\') or [],now) if active else (now,0)')
patch(p,'f=futures_features(obs,item,observed_ms)','f=futures_features(obs,item,now)')
patch(p,'spot_sample_features(market_state,sym,source_ms)','spot_sample_features(market_state,sym,now)')
patch(p,"      'delivery_mode':'MEASURED_PROSPECTIVE_EVIDENCE_NOT_PERMANENT_FALSE',",
"      'delivery_mode':'MEASURED_PROSPECTIVE_EVIDENCE_NOT_PERMANENT_FALSE',\n      'validation_clock_wait_ms':validation_wait_ms,")
p='deployment/v21_forecast_delivery.mjs'
patch(p,"try{doc=await read(V21_REPORT_URL+'?minute='+Math.floor(now/60000));}",
"try{doc=await readV21CurrentReport(read,clock,options.pause,options.waitForFresh!==false);}")
helper='''
/** Handle report publication just after Cron reads. No extra timer, dispatch or
 * model invocation. Retry only if the prior report already has eligible future
 * evidence; unqualified research never delays existing legacy monitoring. */
async function readV21CurrentReport(read,clock=Date.now,pause,waitForFresh=true){
 const sleep=pause||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 const deadline=clock()+90000;
 while(true){
  const current=clock();
  const doc=await read(V21_REPORT_URL+'?at='+current);
  const published=Date.parse(doc?.at_utc||'');
  const stale=Number.isFinite(published)&&current-published>90000;
  const ready=Object.values(doc?.certificates||{}).some(group=>
    Object.values(group||{}).some(p=>p?.ready===true));
  if(!waitForFresh||!stale||!ready||doc?.status!=='ACTIVE'||clock()>=deadline)return doc;
  await sleep(Math.min(15000,deadline-clock()));
 }
}
export {readV21CurrentReport};
'''
text[p]+=helper
patch('tests/test_v21_delivery.mjs','return {clock:()=>NOW,readReport:async()=>doc,',
      'return {clock:()=>NOW,waitForFresh:false,readReport:async()=>doc,')
for p,s in text.items():(ROOT/p).write_text(s,encoding='utf8')
print('V21_TIMING_REVIEW_APPLIED',','.join(paths))
