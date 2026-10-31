/** Read-only verification. Never invokes scheduled handler or sends messages. */
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_READ_CREDS_MISSING');
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const healthUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={authorization:'Bearer '+token,accept:'application/json'};
const expectedSha='71212954bcfee2d52a568c0c5980ed34ab749fbf5e17c538c92dec4c484bdc93';
const expectedVersion='IRYS-V21-LEARNED-FORECAST-FORWARD-EVIDENCE-20261031';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,auth=true){
 const r=await fetch(url,{headers:auth?headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('READ_HTTP_'+r.status);return r;
}
function require(x,name){if(!x)throw Error(name);}
const [src,configResp,cronResp]=await Promise.all([get(base),get(base+'/settings'),get(base+'/schedules')]);
let bytes;
if((src.headers.get('content-type')||'').toLowerCase().startsWith('multipart/form-data')){
 const form=await src.formData();const meta=form.get('metadata');let config={};
 if(meta!==null)config=JSON.parse(typeof meta==='string'?meta:await meta.text());
 const part=config.main_module||config.body_part||src.headers.get('cf-worker-main-module-part')||'worker.js';
 const value=form.get(part);require(value!==null&&part==='worker.js','WORKER_SOURCE_PART_MISSING');
 bytes=Buffer.from(typeof value==='string'?value:await value.arrayBuffer());
}else bytes=Buffer.from(await src.arrayBuffer());
require(createHash('sha256').update(bytes).digest('hex')===expectedSha,'LIVE_SOURCE_HASH_MISMATCH');
const config=await configResp.json(),schedules=await cronResp.json();
const bindings=(config.result?.bindings||[]).map(x=>x.name+':'+x.type).sort();
for(const entry of ['AI:ai','IRYS_KV:kv_namespace','GITHUB_DISPATCH_TOKEN:secret_text',
 'TELEGRAM_BOT_TOKEN:secret_text','TELEGRAM_CHAT_ID:plain_text'])require(bindings.includes(entry),'MISSING_BINDING');
const cron=(Array.isArray(schedules.result?.schedules)?schedules.result.schedules:schedules.result||[]).map(x=>x.cron);
require(cron.length===1&&cron[0]==='*/5 * * * *','CRON_CHANGED');
let state=null;const deadline=Date.now()+2*5*60000;
// Observe existing Cron for at most two normal intervals; do not create a new run.
while(true){
 const h=await (await get(healthUrl,false)).json();state=h.last||{};
 if(state.codeVersion===expectedVersion)break;
 if(Date.now()>=deadline)throw Error('NATURAL_V21_TICK_NOT_OBSERVED');
 await pause(10000);
}
require(state.status==='PASS','NATURAL_WORKER_MARKET_NOT_PASS');
require(state.githubDispatchStatus==='ACCEPTED','ORIGINAL_GITHUB_DISPATCH_NOT_ACCEPTED');
require(state.v21ForecastDelivery&&typeof state.v21ForecastDelivery.status==='string','V21_CONSUMER_NOT_EXECUTED');
require(!state.v21ForecastDelivery.send_error,'V21_TELEGRAM_ERROR');
require(state.v20UnverifiedDirectionalSuppressionActive===true,'V19_REACTIVE_SPAM_WAS_REENABLED');
const model=await (await get('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v21_latest.json?at='+Date.now(),false)).json();
require(model.version==='IRYS_V21_SUPERVISED_PROSPECTIVE_V1','MODEL_REPORT_SCHEMA');
const at=Date.parse(model.at_utc||'');
require(Number.isFinite(at)&&Date.now()-at>=0&&Date.now()-at<15*60000,'MODEL_REPORT_STALE');
const summary={version:expectedVersion,actual_source_sha256:expectedSha,
 source_verified:true,cron_preserved:cron,bindings_preserved_names:bindings,
 natural_tick_kst:state.time,worker_status:state.status,
 dispatch_status:state.githubDispatchStatus,
 v21_delivery:state.v21ForecastDelivery,
 original_V19_spam_suppression_active:state.v20UnverifiedDirectionalSuppressionActive,
 telegram_api_ack_this_tick:state.telegramApiAckedThisRun??null,
 telegram_api_ack_total:state.telegramApiAcknowledgementsTotal??null,
 last_v21_delivery:state.v21LastDelivery||null,
 model_runtime_status:model.status,model_source_status:model.source_status,
 model_report_utc:model.at_utc,model_integrity_errors:model.model_integrity_errors,
 model_status:model.model_status,forecasts_this_run:model.forecast_count,
 pending_forecasts:model.pending_count,completed_quote_outcomes:model.completed_quote_outcomes,
 unmeasured_quote_targets:model.unmeasured_quote_targets,
 forward_certificates:model.certificates,
 actual_new_direction_accuracy_unverified:true,
 no_test_messages_or_orders:true};
console.log('V21_ACTUAL_PRODUCTION_VERIFICATION',JSON.stringify(summary));
require(model.status==='ACTIVE','V21_RUNTIME_NOT_ACTIVE');
console.log('V21_CODE_PRODUCER_NATURAL_CONSUMER_VERIFIED_NOT_A_PROFITABILITY_CLAIM');
