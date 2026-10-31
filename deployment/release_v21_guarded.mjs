/** Owner-approved code-only V21 release; no Cron/binding/secret changes.
 * Never logs tokens, chat IDs, namespace IDs or full settings. Verifies exact
 * original source before replacement and restores exact bytes on failure.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const healthUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={authorization:'Bearer '+token,accept:'application/json'};
const OLD_SHA='d7b9b3187fe338ec3ae2c422bedc1035bd1de5a543e74c00bbf4f8eaf141736a';
const NEW_SHA='71212954bcfee2d52a568c0c5980ed34ab749fbf5e17c538c92dec4c484bdc93';
const OLD_VERSION='IRYS-V20-ACCURACY-FIRST-NO-UNVALIDATED-DIRECTION-20261031';
const NEW_VERSION='IRYS-V21-LEARNED-FORECAST-FORWARD-EVIDENCE-20261031';
const candidate=readFileSync(new URL('./IRYS_V21_LEARNED_FORECAST_WORKER.mjs',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
const must=(condition,message)=>{if(!condition)throw Error(message)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(url,auth=true){
 const r=await fetch(url,{headers:auth?headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 must(r.ok,'GET_HTTP_'+r.status);return r;
}
async function script(){
 const response=await get(root);const mime=response.headers.get('content-type')||'';
 let bytes,part='worker.js';
 if(mime.toLowerCase().startsWith('multipart/form-data')){
  const form=await response.formData();const metaPart=form.get('metadata');let metadata={};
  if(metaPart!==null){metadata=JSON.parse(typeof metaPart==='string'?metaPart:await metaPart.text());}
  part=metadata.main_module||metadata.body_part||response.headers.get('cf-worker-main-module-part')||'worker.js';
  const entry=form.get(part);must(entry!==null,'WORKER_MULTIPART_SOURCE_MISSING');
  bytes=Buffer.from(typeof entry==='string'?entry:await entry.arrayBuffer());
 }else{
  must(/javascript|ecmascript|text\/plain|octet-stream/i.test(mime),'UNEXPECTED_WORKER_MIME');
  bytes=Buffer.from(await response.arrayBuffer());
 }
 must(bytes.length>0,'EMPTY_WORKER_SOURCE');return {bytes,part,sha:digest(bytes)};
}
async function configuration(){
 const [a,b,h]=await Promise.all([get(root+'/settings'),get(root+'/schedules'),get(healthUrl,false)]);
 const settings=await a.json(),schedule=await b.json(),health=await h.json();
 const binding=(settings.result?.bindings||[]).map(x=>({name:x.name,type:x.type,
   namespace:x.type==='kv_namespace'?x.namespace_id:null,text:x.type==='plain_text'?x.text:null}))
   .sort((x,y)=>x.name.localeCompare(y.name));
 const rows=Array.isArray(schedule.result?.schedules)?schedule.result.schedules:schedule.result;
 must(Array.isArray(rows),'SCHEDULE_SCHEMA');const cron=rows.map(x=>x.cron).sort();
 for(const [name,type] of [['AI','ai'],['IRYS_KV','kv_namespace'],['GITHUB_DISPATCH_TOKEN','secret_text'],
   ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']])
  must(binding.some(x=>x.name===name&&x.type===type),'REQUIRED_BINDING_MISSING_'+name);
 must(JSON.stringify(cron)==='["*/5 * * * *"]','EXISTING_CRON_CHANGED');
 must(health.kvConfigured===true&&health.telegramSecretConfigured===true&&health.githubDispatchConfigured===true,
  'REQUIRED_RUNTIME_BINDING_NOT_CONFIGURED');
 return {binding,cron,health};
}
async function upload(bytes){
 const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');
 const r=await fetch(root+'/content',{method:'PUT',headers:{authorization:'Bearer '+token},
  body:form,signal:AbortSignal.timeout(30000)});
 const d=await r.json().catch(()=>({success:false}));
 must(r.ok&&d.success===true,'CODE_ONLY_UPLOAD_NOT_ACKED_'+r.status);
}
function sameConfig(a,b){return JSON.stringify(a.binding)===JSON.stringify(b.binding)&&JSON.stringify(a.cron)===JSON.stringify(b.cron);}
async function confirmSource(hash,config){
 const deadline=Date.now()+60000;
 do{
  const current=await script();
  if(current.sha===hash){const cfg=await configuration();must(sameConfig(cfg,config),'BINDINGS_OR_CRON_CHANGED');return true;}
  await sleep(2000);
 }while(Date.now()<deadline);
 return false;
}
async function main(){
 must(/^[a-f0-9]{32}$/.test(account)&&token.length>=20,'SCOPED_CREDENTIALS_UNAVAILABLE');
 must(process.env.V21_RELEASE_INTENT==='USER_APPROVED_PREDICTIVE_REIMPLEMENTATION','OWNER_INTENT_MISSING');
 must(process.env.GITHUB_REF==='refs/heads/feature/irys-v21-causal-forecast-20261031','UNREVIEWED_RELEASE_BRANCH');
 must(digest(candidate)===NEW_SHA,'CANDIDATE_NOT_THE_TESTED_SOURCE');
 const text=candidate.toString('utf8');
 for(const anchor of [NEW_VERSION,'sendV21Forecasts(env,state,base.snap','v21ForecastDelivery:v21Run',
  'V21_PROSPECTIVE_FORECAST','const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;',
  'const AI_ALERT_TRANSPORT_ENABLED=false;','coverage_ratio)>=.95','readV21CurrentReport',
  'async function scheduledCore(','async function telegramTransportProofOnce('])
   must(text.includes(anchor),'TESTED_CONTRACT_MISSING');
 const [old,config]=await Promise.all([script(),configuration()]);
 if(old.sha===NEW_SHA){console.log('V21_ALREADY_DEPLOYED_SOURCE_AND_BINDINGS_VERIFIED');return;}
 must(old.sha===OLD_SHA&&old.part==='worker.js','LIVE_SOURCE_NOT_EXPECTED_V20');
 must(config.health.last?.codeVersion===OLD_VERSION,'LIVE_RUNTIME_NOT_EXPECTED_V20');
 must(config.health.last?.status==='PASS','CURRENT_WORKER_NOT_HEALTHY');
 // Separate production report must be genuinely executing before connecting it.
 const report=await (await get('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v21_latest.json?at='+Date.now(),false)).json();
 must(report.version==='IRYS_V21_SUPERVISED_PROSPECTIVE_V1'&&report.status==='ACTIVE',
   'V21_ACTUAL_PRODUCER_NOT_ACTIVE');
 const at=Date.parse(report.at_utc||'');
 must(Number.isFinite(at)&&Date.now()-at>=0&&Date.now()-at<15*60000,'V21_ACTUAL_PRODUCER_STALE');
 must(report.model_status?.bitget_5==='PROSPECTIVE_VALIDATION_REQUIRED','REVIEWED_BITGET5_MODEL_NOT_READY_FOR_FORWARD_STUDY');
 must((await script()).sha===OLD_SHA,'SOURCE_CHANGED_DURING_PREFLIGHT');
 console.log('V21_PRODUCTION_PREFLIGHT_VERIFIED',JSON.stringify({old_source:old.sha,new_source:NEW_SHA,
   old_runtime:config.health.last?.codeVersion,producer_status:report.status,producer_at:report.at_utc,
   source_status:report.source_status,model_status:report.model_status,cron:config.cron,
   bindings_preserved_names:config.binding.map(x=>x.name),no_messages_sent_by_deployment:true}));
 if(process.env.V21_DRY_RUN==='true'){console.log('V21_DRY_RUN_NO_MUTATION');return;}
 let attempted=false;
 try{
  attempted=true;await upload(candidate);
  must(await confirmSource(NEW_SHA,config),'NEW_SOURCE_NOT_VERIFIED');
  console.log('V21_CODE_ONLY_DEPLOY_VERIFIED',JSON.stringify({worker:'irys-surge-monitor',
   source_sha256:NEW_SHA,deployed_at_utc:new Date().toISOString(),cron_preserved:true,
   bindings_preserved:true,original_legacy_monitoring_preserved:true,
   V19_spam_not_reenabled:true,future_forecast_accuracy_unverified:true,
   actual_telegram_delivery_not_attempted:true,natural_cron_not_yet_verified:true}));
 }catch(err){
  if(attempted){
   try{
    const current=await script();
    if(current.sha===NEW_SHA){await upload(old.bytes);must(await confirmSource(OLD_SHA,config),'ROLLBACK_NOT_VERIFIED');console.error('V21_ROLLBACK_V20_VERIFIED');}
    else if(current.sha===OLD_SHA)console.error('V21_OLD_SOURCE_STILL_ACTIVE');
    else console.error('V21_CONCURRENT_SOURCE_CHANGE_NO_UNSAFE_OVERWRITE');
   }catch(e){console.error('V21_ROLLBACK_UNVERIFIED',String(e?.message||e).slice(0,100));}
  }
  throw err;
 }
}
main().catch(err=>{console.error('V21_RELEASE_FAILED',String(err?.message||err).slice(0,160));process.exitCode=2;});
