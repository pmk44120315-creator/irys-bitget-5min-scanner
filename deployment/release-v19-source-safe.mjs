/** One-time Cloudflare V19 code-only release, with explicit source lease.
 * Does NOT edit Cron, Telegram credentials, KV bindings, GitHub main, or orders.
 * Reverts exact previous source on any verified release-integrity failure.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const ACCOUNT=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const TOKEN=process.env.IRYS_V7_CF_API_TOKEN||'';
const NAME='irys-surge-monitor';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+NAME;
const URL='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const HEADERS={authorization:'Bearer '+TOKEN,accept:'application/json'};
const EXISTING='b2a98c8c988157866e28ea8d8c8418454c443c1c0ffd32ff6a1ee6b8c0012423';
const WAS='IRYS-V17-CAUSAL-DIRECTION-VS-WATCH-20261030';
const WILL='IRYS-V19-INDEPENDENT-EARLY-FLOW-DELIVERY-20261030';
const candidate=readFileSync(new URL('./IRYS_V19_EARLY_FLOW_WORKER.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const must=(x,msg)=>{if(!x)throw Error(msg)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(url,auth=true){
 const response=await fetch(url,{
  headers:auth?HEADERS:{accept:'application/json'},
  signal:AbortSignal.timeout(20000)});
 must(response.ok,'READ_HTTP_'+response.status+' '+new URL(url).pathname);
 return response;
}
async function readScript(){return extractWorkerSource(await get(ROOT));}
async function readJson(path){return (await get(ROOT+path)).json();}
async function health(){return (await get(URL,false)).json();}
function bindings(doc){
 return (doc.result?.bindings||[]).map(x=>[x.name,x.type,
   x.type==='kv_namespace'?x.namespace_id:null,
   x.type==='plain_text'?x.text:null]).sort((a,b)=>a[0].localeCompare(b[0]));
}
function crons(doc){
 const s=Array.isArray(doc.result?.schedules)?doc.result.schedules:
   Array.isArray(doc.result)?doc.result:[];
 return s.map(x=>x.cron).filter(Boolean).sort();
}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function configSnapshot(){
 const [cfg,cron,h]=await Promise.all([readJson('/settings'),readJson('/schedules'),health()]);
 const b=bindings(cfg),c=crons(cron);
 for(const [name,type] of [
  ['IRYS_KV','kv_namespace'],['AI','ai'],
  ['GITHUB_DISPATCH_TOKEN','secret_text'],
  ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']]){
  must(b.some(x=>x[0]===name&&x[1]===type),'BINDING_NOT_PRESENT_'+name);
 }
 must(c.length===1&&c[0]==='*/5 * * * *','ORIGINAL_5M_CRON_CHANGED');
 must(h.kvConfigured===true&&h.workersAIConfigured===true&&
  h.telegramSecretConfigured===true&&h.githubDispatchConfigured===true,
  'LIVE_SERVICE_REQUIRED_BINDING_UNAVAILABLE');
 return {b,c,h};
}
async function putScript(bytes){
 const form=new FormData();
 form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');
 const r=await fetch(ROOT+'/content',{method:'PUT',
  headers:{authorization:'Bearer '+TOKEN},body:form,
  signal:AbortSignal.timeout(30000)});
 const obj=await r.json().catch(()=>({success:false}));
 must(r.ok&&obj.success===true,'RELEASE_PUT_NOT_ACKED_HTTP_'+r.status);
}
async function main(){
 must(/^[a-f0-9]{32}$/.test(ACCOUNT)&&TOKEN.length>=20,
  'SCOPED_CLOUDFLARE_RELEASE_CREDENTIALS_UNAVAILABLE');
 must(process.env.IRYS_V19_RELEASE_APPROVED==='OWNER_REQUESTED_FULL_ALERT_REPAIR_20261030',
  'OWNER_RELEASE_SCOPE_MARKER_MISSING');
 must(process.env.GITHUB_REF==='refs/heads/fix/irys-v19-alert-delivery-early-flow-20261030',
  'RELEASE_FROM_WRONG_BRANCH');
 const content=candidate.toString('utf8'),newHash=sha(candidate);
 for(const pattern of [
   "const VERSION='"+WILL+"'",
   "const AI_ALERT_TRANSPORT_ENABLED=true;",
   "async function runMorningAi(",
   "v19SendFastAlerts(env,state,spot,source.snap",
   "AI_QUOTA_BACKOFF_ACTIVE",
   "v19FuturesCandidates(",
   "v19SpotCandidates(",
   "v19FastMessage(",
   "V19_EARLY_NEUTRAL_WATCH",
   "V19_REAL_FLOW_DIRECTION",
   "async function telegramTransportProofOnce(",
   "async function scheduledCore(",
   "async function updateFuturesOutcomes(",
   "async function updateAiV16Outcomes(",
   "const MAX_ALERTS=2;"]){
   must(content.includes(pattern),'PROPOSED_SOURCE_CONTRACT_INCOMPLETE');
 }
 must(!content.includes('AI_V16_EARLY_OBSERVATION'),
   'UNVERIFIED_OLD_DIRECTIONAL_SENDER_STILL_PRESENT');
 const [old,originalConfig]=await Promise.all([readScript(),configSnapshot()]);
 must(old.sha256===EXISTING&&old.selectedPart==='worker.js',
   'LIVE_SOURCE_UNKNOWN_NO_DEPLOY');
 must(originalConfig.h.last?.codeVersion===WAS,
   'LIVE_RUNTIME_VERSION_CHANGED_NO_DEPLOY');
 must(originalConfig.h.last?.status==='PASS',
   'LIVE_WORKER_NOT_PASS_NO_DEPLOY');
 must((await readScript()).sha256===EXISTING,'LIVE_SOURCE_CHANGED_DURING_PREFLIGHT');
 console.log('V19_PREFLIGHT_PASS',JSON.stringify({
  source_before:EXISTING,new_source_sha256:newHash,
  Cron:originalConfig.c,requiredBindings:originalConfig.b.map(x=>x[0]+':'+x[1]),
  existingMarketReady:true,telegramSendNotAttempted:true}));
 if(process.env.IRYS_V19_DRY_RUN==='true'){
   console.log('V19_DRY_RUN_NO_DEPLOYMENT');return;
 }
 let putAttempted=false;
 try{
  putAttempted=true;
  await putScript(candidate);
  let actual=null,success=false;
  for(let i=0;i<12;i++){
   try{
    actual=await readScript();
    if(actual.sha256===newHash&&actual.selectedPart==='worker.js'){
      const newConfig=await configSnapshot();
      must(equal(originalConfig.b,newConfig.b),'POSTDEPLOY_BINDINGS_CHANGED');
      must(equal(originalConfig.c,newConfig.c),'POSTDEPLOY_CRON_CHANGED');
      success=true;break;
    }
   }catch(e){
    if(i===11)throw e;
   }
   await sleep(3000);
  }
  must(success,'NEW_SOURCE_NOT_VERIFIED_AFTER_DEPLOYMENT');
  console.log('V19_CLOUDFLARE_CODE_DEPLOY_VERIFIED',JSON.stringify({
   worker:NAME,source_sha256:newHash,cron:originalConfig.c,
   bindings_preserved:true,existing_Telegram_bot_preserved:true,
   existing_V18_GitHub_data_untouched:true,
   next_natural_Cron_execution_not_yet_verified:true,
   actual_telegram_API_ack_not_yet_verified:true,
   directional_accuracy_improvement_unverified:true
  }));
 }catch(e){
  if(putAttempted){
   try{
    const current=await readScript();
    if(current.sha256===newHash){
     await putScript(old.data);
     must((await readScript()).sha256===EXISTING,'ROLLBACK_SOURCE_HASH_MISMATCH');
     const again=await configSnapshot();
     must(equal(again.b,originalConfig.b)&&equal(again.c,originalConfig.c),
      'ROLLBACK_CONFIG_MISMATCH');
     console.error('V19_FAIL_V17_ROLLBACK_VERIFIED');
    }else if(current.sha256===EXISTING){
     console.error('V19_FAIL_ORIGINAL_V17_STILL_ACTIVE');
    }else console.error('V19_FAIL_CONCURRENT_SOURCE_CHANGE_NO_UNSAFE_OVERWRITE');
   }catch(err){
    console.error('V19_ROLLBACK_UNVERIFIED',String(err?.message||err).slice(0,120));
   }
  }
  throw e;
 }
}
main().catch(e=>{console.error('V19_RELEASE_FAILED',String(e?.message||e).slice(0,170));process.exitCode=2;});
