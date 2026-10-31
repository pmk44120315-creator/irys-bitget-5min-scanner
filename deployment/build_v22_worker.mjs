/** Exact reviewed V21.1 is the immutable base. No settings or scheduling edits. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
let source=readFileSync(new URL('deployment/IRYS_V21_LEARNED_FORECAST_WORKER.mjs',root),'utf8');
const digest=s=>createHash('sha256').update(s).digest('hex');
if(digest(source)!=='d05577405be21f4a2c72f076ac5dd3b334b62c4cc52886eb4d69fb7e01ef016d')throw Error('V22_BASE_SOURCE_NOT_REVIEWED_V21_1');
const policy=execFileSync('python',['-c',"import json;from v22_live import policy_hash;print(policy_hash(json.load(open('research/v22_results/seeds.json'))))"],{cwd:root,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{64}$/.test(policy))throw Error('V22_POLICY_HASH_INVALID');
let helper=readFileSync(new URL('deployment/v22_forecast_delivery.mjs',root),'utf8');
helper=helper.replace("'__V22_POLICY_SHA__'",JSON.stringify(policy));
helper=helper.replace('export {sendV22Forecasts,evaluateV22Deliveries,v22Proof,v22Message,readV22ReadyReport};','');
function patch(a,b){if(source.split(a).length!==2)throw Error('V22_UNIQUE_ANCHOR_'+a.slice(0,80));source=source.replace(a,b);}
patch("IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031","IRYS-V22-ADAPTIVE-EXPECTED-RETURN-20261101");
patch('async function scheduledCore(env,now=Date.now(),preDispatch=null){',helper+'\nasync function scheduledCore(env,now=Date.now(),preDispatch=null){');
patch('  const outcomeRun=await updateSpotOutcomes(env,state,now);',`  let v22Run={status:'SOURCE_NOT_READY',sent:0,send_error:null};
  if(base&&dispatch.status==='ACCEPTED'){
    try{v22Run=await sendV22Forecasts(env,state,base.snap,Date.now(),
      Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent-v21Run.sent));}
    catch(e){v22Run={status:'V22_RUNTIME_ERROR',sent:0,send_error:String(e?.message||e).slice(0,120)};}
  }
  const v22OutcomeAudit=await evaluateV22Deliveries(state,Date.now());
  const outcomeRun=await updateSpotOutcomes(env,state,now);`);
patch('try{aiRun=await runMorningAi(env,source,state,Date.now(),\n      Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent-v21Run.sent));}',
      'try{aiRun=await runMorningAi(env,source,state,Date.now(),\n      Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent-v21Run.sent-v22Run.sent));}');
patch('if(aiRun.alerts_sent>0||v21Run.sent>0)state.telegramConnectionVerified=true;',
      'if(aiRun.alerts_sent>0||v21Run.sent>0||v22Run.sent>0)state.telegramConnectionVerified=true;');
patch('telegramApiAckedThisRun:sent+futuresSent+directionalRun.sent+aiRun.alerts_sent+v21Run.sent+',
      'telegramApiAckedThisRun:sent+futuresSent+directionalRun.sent+aiRun.alerts_sent+v21Run.sent+v22Run.sent+');
patch('v21ForecastDelivery:v21Run,v21LastDelivery:state.v21LastMessage||null,',
      'v21ForecastDelivery:v21Run,v21LastDelivery:state.v21LastMessage||null,\n    v22ForecastDelivery:v22Run,v22LastDelivery:state.v22LastMessage||null,v22DeliveredOutcomes:v22OutcomeAudit,');
patch('if(sendError||futuresSendError||v21Run.send_error||aiRun.fastSendError||',
      'if(sendError||futuresSendError||v21Run.send_error||v22Run.send_error||aiRun.fastSendError||');
patch('directionalRun.send_error||v21Run.send_error||aiRun.fastSendError||aiRun.error));',
      'directionalRun.send_error||v21Run.send_error||v22Run.send_error||aiRun.fastSendError||aiRun.error));');
source+='\nexport {sendV22Forecasts,evaluateV22Deliveries,v22Proof,v22Message,readV22ReadyReport};\n';
writeFileSync(new URL('deployment/IRYS_V22_ADAPTIVE_WORKER.mjs',root),source);
writeFileSync(new URL('deployment/v22_candidate.json',root),JSON.stringify({worker_sha256:digest(source),policy_sha256:policy,base_sha256:'d05577405be21f4a2c72f076ac5dd3b334b62c4cc52886eb4d69fb7e01ef016d',version:'IRYS-V22-ADAPTIVE-EXPECTED-RETURN-20261101'},null,2));
console.log('V22_WORKER_BUILD',digest(source),policy,Buffer.byteLength(source));
