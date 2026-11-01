/** V23 one-time code-only guarded Cloudflare release.
 * Does not change Cron, original KV binding, Telegram ID/token or AI.
 * Strict exact-source lease avoids overwriting any concurrent user changes.
 * Rollback the exact prior bytes only when the V23 bytes are active.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const PUBLIC_URL='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={authorization:'Bearer '+token,accept:'application/json'};
const OLD_SHA='f53ced30287544784d92bf74bb644177add46379781cdb7e3874a9ec1ee2c182';
const OLD_VERSION='IRYS-V23-DIRECT-FIRST-SCOUT-AND-LEGACY-PRESERVED-20261101';
const NEW_SHA='26f72a82351480c14ef1361c7ee38ced0189ccf6b307bfca57ade3f8cfb3926e';
const NEW_VERSION='IRYS-V23.1-VENUE-ISOLATED-DIRECT-SCOUT-20261101';
const scriptNew=readFileSync(new URL('./IRYS_V23_1_VENUE_ISOLATED_WORKER.mjs',import.meta.url));
const digest=buf=>createHash('sha256').update(buf).digest('hex');
const assert=(condition,why)=>{if(!condition)throw Error(why);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,auth=true){
 const r=await fetch(url,{headers:auth?headers:{accept:'application/json'},
   signal:AbortSignal.timeout(24000)});
 assert(r.ok,'READ_HTTP_'+r.status+' '+new URL(url).pathname);
 return r;
}
async function workerSource(){
 const response=await get(ROOT);
 let bytes,part='worker.js';
 if((response.headers.get('content-type')||'').toLowerCase().startsWith('multipart/form-data')){
   const form=await response.formData(),raw=form.get('metadata');
   let meta={};
   if(raw)meta=JSON.parse(typeof raw==='string'?raw:await raw.text());
   part=meta.main_module||meta.body_part||'worker.js';
   const payload=form.get(part);
   assert(payload!==null,'WORKER_MULTIPART_PART_ABSENT');
   bytes=Buffer.from(typeof payload==='string'?payload:await payload.arrayBuffer());
 }else{
   bytes=Buffer.from(await response.arrayBuffer());
 }
 assert(bytes.length>10000,'UNEXPECTED_EMPTY_WORKER_SOURCE');
 return {bytes,sha:digest(bytes),part};
}
async function config(){
 const [bindingRes,cronRes,statusRes]=await Promise.all([
   get(ROOT+'/settings'),get(ROOT+'/schedules'),get(PUBLIC_URL,false)]);
 const bindingJson=await bindingRes.json(),cronJson=await cronRes.json(),
   health=await statusRes.json();
 const bindings=(bindingJson.result?.bindings||[]).map(x=>({
   name:x.name,type:x.type,
   namespace:x.type==='kv_namespace'?x.namespace_id:null,
   text:x.type==='plain_text'?x.text:null})).sort((a,b)=>a.name.localeCompare(b.name));
 const rows=Array.isArray(cronJson.result?.schedules)?cronJson.result.schedules:
   cronJson.result;
 assert(Array.isArray(rows),'CRON_SCHEMA');
 const schedule=rows.map(x=>x.cron).sort();
 assert(JSON.stringify(schedule)==='["*/5 * * * *"]','CRON_NOT_ORIGINAL');
 for(const [name,type] of [
   ['AI','ai'],['IRYS_KV','kv_namespace'],
   ['GITHUB_DISPATCH_TOKEN','secret_text'],
   ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']
 ]){
   assert(bindings.some(x=>x.name===name&&x.type===type),'REQUIRED_BINDING_MISSING_'+name);
 }
 assert(health.telegramSecretConfigured===true&&health.kvConfigured===true&&
   health.githubDispatchConfigured===true,'WORKER_RUNTIME_BINDINGS_UNAVAILABLE');
 return {bindings,schedule,health};
}
function sameSettings(a,b){return JSON.stringify(a.bindings)===JSON.stringify(b.bindings) &&
 JSON.stringify(a.schedule)===JSON.stringify(b.schedule);}
async function upload(buf){
 const form=new FormData();
 form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([buf],{type:'application/javascript+module'}),'worker.js');
 const response=await fetch(ROOT+'/content',{method:'PUT',
    headers:{authorization:'Bearer '+token},body:form,
    signal:AbortSignal.timeout(35000)});
 const result=await response.json().catch(()=>({success:false}));
 assert(response.ok&&result.success===true,'CLOUDFLARE_CODE_UPLOAD_FAILED_'+response.status);
}
async function verify(hash,settings){
 for(let i=0;i<25;i++){
   const current=await workerSource();
   if(current.sha===hash){
     const cfg=await config();
     assert(sameSettings(settings,cfg),'ORIGINAL_BINDINGS_OR_CRON_CHANGED');
     return true;
   }
   await wait(1500);
 }
 return false;
}
async function main(){
 assert(/^[a-f0-9]{32}$/.test(account)&&token.length>=20,'READ_WRITE_AUTH_UNAVAILABLE');
 assert(process.env.GITHUB_REF==='refs/heads/fix/irys-v23-isolate-venue-failures-20261101',
   'DEPLOY_FROM_UNREVIEWED_BRANCH');
 assert(process.env.IRYS_V23_1_RELEASE_INTENT==='USER_APPROVED_REPAIR_V23_BITGET_OUTAGE_DOES_NOT_BLOCK_BITHUMB_20261101',
   'OWNER_DEPLOY_SCOPE_UNCONFIRMED');
 assert(digest(scriptNew)===NEW_SHA,'CANDIDATE_CONTENT_NOT_TESTED_SHA');
 const source=scriptNew.toString('utf8');
 for(const marker of [
   "const VERSION='"+NEW_VERSION+"'",
   "const AI_ALERT_TRANSPORT_ENABLED=false;",
   "const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;",
   "const V23_MAX_HOURLY_NOTICES=2;",
   "async function v23ScoutTick(",
   "const v23Fast=await v23ScoutTick(env,state,Date.now());",
   "function futuresSnapshotProof(",
   "async function sendV21Forecasts(",
   "async function sendSpotDirectional(",
   "async function updateFuturesOutcomes(",
   "function v23SpotTradeMs(",
   "const V23_VER='IRYS_V23_1_VENUE_ISOLATED_SCOUT_V1';",
   "output.venue_availability=availability;",
   "if(!availability.bithumb&&!availability.bitget)",
   "spot_at_ms:spotReady?now:spotOld",
   "futures_at_ms:futuresReady?now:futuresOld",
   "v23DirectFastScout:v23Fast",
   "const MAX_ALERTS=2;",
 ]){
   assert(source.includes(marker),'REVIEWED_SOURCE_MARKER_MISSING');
 }
 const [old,settings]=await Promise.all([workerSource(),config()]);
 if(old.sha===NEW_SHA){
   assert(await verify(NEW_SHA,settings),'ALREADY_DEPLOYED_SETTINGS_CHANGED');
   console.log('V23_ALREADY_ACTIVE_EXACT_SOURCE_AND_CONFIG');return;
 }
 assert(old.sha===OLD_SHA&&old.part==='worker.js','EXISTING_PRODUCTION_SOURCE_UNKNOWN');
 assert(settings.health.last?.codeVersion===OLD_VERSION,'CURRENT_RUNTIME_VERSION_MISMATCH');
 assert(settings.health.last?.status==='PASS','CURRENT_RUNTIME_NOT_PASS');
 assert((await workerSource()).sha===OLD_SHA,'PRODUCTION_CHANGED_DURING_PREFLIGHT');
 console.log('V23_LIVE_PREFLIGHT_PASS',JSON.stringify({
   old_version:OLD_VERSION,old_sha256:OLD_SHA,
   candidate_sha256:NEW_SHA,old_last_tick:settings.health.last?.time,
   savedCron:settings.schedule,
   preservedBindings:settings.bindings.map(x=>x.name+':'+x.type),
   originalMarketRunnerUnchanged:true,
   originalTelemetryAndAccountSafe:true}));
 if(process.env.IRYS_V23_1_DRY_RUN==='true'){
   console.log('V23_DRY_RUN_NO_MUTATION');return;
 }
 let attempted=false;
 try{
   attempted=true;
   await upload(scriptNew);
   assert(await verify(NEW_SHA,settings),'CANDIDATE_NOT_VERIFIED_AFTER_UPLOAD');
   console.log('V23_CLOUDFLARE_CODE_ONLY_DEPLOY_VERIFIED',JSON.stringify({
     worker:'irys-surge-monitor',workerVersion:NEW_VERSION,
     source_sha256:NEW_SHA,originalCron:settings.schedule,
     bindings_preserved:true,
     existingV21ModelAndTelegramChannelsPreserved:true,
     fastNewAlertsRequireNaturalCronAndSnapshotWarmup:true,
     noTestTelegramMessagesSent:true,directionalAccuracyImprovementUnverified:true}));
 }catch(e){
   if(attempted)try{
     const current=await workerSource();
     if(current.sha===NEW_SHA){
       await upload(old.bytes);
       assert(await verify(OLD_SHA,settings),'ROLLBACK_INTEGRITY_NOT_VERIFIED');
       console.error('V23_DEPLOY_FAILED_OLD_V21_1_ROLLBACK_VERIFIED');
     }else if(current.sha===OLD_SHA){
       console.error('V23_DEPLOY_FAILED_ORIGINAL_SOURCE_STILL_ACTIVE');
     }else{
       console.error('V23_DEPLOY_CONCURRENT_SOURCE_CHANGED_REFUSING_UNSAFE_OVERWRITE');
     }
   }catch(err){
     console.error('V23_ROLLBACK_NOT_VERIFIED',String(err?.message||err).slice(0,120));
   }
   throw e;
 }
}
main().catch(e=>{console.error('V23_DEPLOY_NOT_SUCCESSFUL',String(e?.message||e).slice(0,160));process.exitCode=2;});
