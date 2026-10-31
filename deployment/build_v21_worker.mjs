import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=readFileSync(new URL('./IRYS_V20_ACCURACY_FIRST_WORKER.mjs',import.meta.url));
const hash=createHash('sha256').update(base).digest('hex');
if(hash!=='d7b9b3187fe338ec3ae2c422bedc1035bd1de5a543e74c00bbf4f8eaf141736a')
 throw Error('V20_BASE_SOURCE_CHANGED_REVIEW_REQUIRED');
let source=base.toString('utf8');
function once(a,b,name){const i=source.indexOf(a);if(i<0||source.indexOf(a,i+a.length)>=0)throw Error('BUILD_ANCHOR_'+name);source=source.slice(0,i)+b+source.slice(i+a.length);}
once("IRYS-V20-ACCURACY-FIRST-NO-UNVALIDATED-DIRECTION-20261031","IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031","version");
let helper=readFileSync(new URL('./v21_forecast_delivery.mjs',import.meta.url),'utf8');
const exportLine='export {sendV21Forecasts,v21ProofReady,v21Message};';
if(!helper.includes(exportLine))throw Error('HELPER_EXPORT_UNEXPECTED');
helper=helper.replace(exportLine,'');
once('async function scheduledCore(env,now=Date.now(),preDispatch=null){',helper+'\nasync function scheduledCore(env,now=Date.now(),preDispatch=null){','helper');
once('  const outcomeRun=await updateSpotOutcomes(env,state,now);',
 `  // A learned forecast is independent of the disabled V19 reactive sender.
  const v21Run=(base&&dispatch.status==='ACCEPTED')?
    await sendV21Forecasts(env,state,base.snap,Date.now(),
      Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent)):
    {status:'SOURCE_NOT_READY',sent:0,send_error:null};
  const outcomeRun=await updateSpotOutcomes(env,state,now);`,'call');
once('Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent));}',
 'Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent-v21Run.sent));}','ai_capacity');
once('  if(aiRun.alerts_sent>0)state.telegramConnectionVerified=true;',
 '  if(aiRun.alerts_sent>0||v21Run.sent>0)state.telegramConnectionVerified=true;','connection');
once('telegramApiAckedThisRun:sent+futuresSent+directionalRun.sent+aiRun.alerts_sent+',
 'telegramApiAckedThisRun:sent+futuresSent+directionalRun.sent+aiRun.alerts_sent+v21Run.sent+','ack');
once('    aiJudgment:aiRun,aiFastDelivery:aiRun.fastEarly||null,',
 '    v21ForecastDelivery:v21Run,v21LastDelivery:state.v21LastMessage||null,\n    aiJudgment:aiRun,aiFastDelivery:aiRun.fastEarly||null,','health');
once("  if(sendError||futuresSendError||aiRun.fastSendError||aiRun.status==='AI_ALERT_DELIVERY_FAILED'||",
 "  if(sendError||futuresSendError||v21Run.send_error||aiRun.fastSendError||aiRun.status==='AI_ALERT_DELIVERY_FAILED'||",'fail');
once('(sendError||futuresSendError||directionalRun.send_error||aiRun.fastSendError||aiRun.error));',
 '(sendError||futuresSendError||directionalRun.send_error||v21Run.send_error||aiRun.fastSendError||aiRun.error));','failure_detail');
source+='\nexport {sendV21Forecasts,v21ProofReady,v21Message};\n';
const output=new URL('./IRYS_V21_LEARNED_FORECAST_WORKER.mjs',import.meta.url);
writeFileSync(output,source);
console.log('V21_REPRODUCIBLE_WORKER_BUILD',JSON.stringify({base_sha256:hash,
 worker_sha256:createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),
 original_Cron_and_bindings_unchanged:true,legacy_sources_preserved:true,
 V19_experimental_flood_not_reenabled:true}));
