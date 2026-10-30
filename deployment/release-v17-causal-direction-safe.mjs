/** V17 one-time code-only Cloudflare release; fail-closed with byte-for-byte rollback. **/
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
const worker='irys-surge-monitor',base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker;
const publicUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={authorization:'Bearer '+token,accept:'application/json'};
const beforeSha='8668138db2c213c7b675e1a10f6b8bb9c5824b757a1648a9feeae073094c9f73';
const candidate=readFileSync(new URL('./IRYS_V17_CAUSAL_AI_DIRECTION_WORKER.mjs',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const must=(value,msg)=>{if(!value)throw Error(msg)};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function get(url,headers=auth){const r=await fetch(url,{headers,signal:AbortSignal.timeout(17000)});
 if(!r.ok)throw Error('CLOUDFLARE_GET_HTTP_'+r.status);return r;}
async function getScript(){return extractWorkerSource(await get(base));}
async function getSettings(){return (await get(base+'/settings')).json();}
async function getSchedules(){return (await get(base+'/schedules')).json();}
async function getHealth(){return (await get(publicUrl,{accept:'application/json'})).json();}
function bindIdentity(doc){
 return (doc.result?.bindings||[]).map(x=>[x.name,x.type,
  x.type==='kv_namespace'?x.namespace_id:null,x.type==='plain_text'?x.text:null])
  .sort((a,b)=>a[0].localeCompare(b[0]));
}
function cronIdentity(doc){
 const z=Array.isArray(doc.result?.schedules)?doc.result.schedules:
   Array.isArray(doc.result)?doc.result:[];
 return z.map(x=>x.cron).filter(Boolean).sort();
}
async function configSnapshot(){
 const [cfg,cron,health]=await Promise.all([getSettings(),getSchedules(),getHealth()]);
 const binds=bindIdentity(cfg),crons=cronIdentity(cron);
 for(const [name,type] of [['AI','ai'],['IRYS_KV','kv_namespace'],
   ['GITHUB_DISPATCH_TOKEN','secret_text'],['TELEGRAM_BOT_TOKEN','secret_text'],
   ['TELEGRAM_CHAT_ID','plain_text']]){
   must(binds.some(x=>x[0]===name&&x[1]===type),'MISSING_REQUIRED_BINDING_'+name);
 }
 must(crons.length===1&&crons[0]==='*/5 * * * *','CRON_INVALID');
 must(health.kvConfigured===true&&health.telegramSecretConfigured===true&&
   health.githubDispatchConfigured===true&&health.workersAIConfigured===true,'HEALTH_BINDING_FAILED');
 return {binds,crons,health};
}
async function upload(bytes){
 const form=new FormData();
 form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');
 const r=await fetch(base+'/content',{method:'PUT',
   headers:{authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(30000)});
 const j=await r.json().catch(()=>({success:false}));
 must(r.ok&&j.success===true,'CLOUDFLARE_CODE_PUT_FAILED_'+r.status);
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function main(){
 must(/^[a-f0-9]{32}$/.test(account)&&token.length>=20,'SCOPED_CF_CREDENTIAL_UNAVAILABLE');
 must(process.env.IRYS_V17_RELEASE_MARKER==='USER_APPROVED_CAUSAL_DIRECTION_FIX_20261030',
   'EXPLICIT_RELEASE_MARKER_MISSING');
 must(process.env.GITHUB_REF==='refs/heads/fix/irys-v17-causal-direction-vs-watch-20261030',
   'WRONG_GITHUB_BRANCH');
 const text=candidate.toString('utf8'),candidateSha=sha(candidate);
 for(const mustExist of ["IRYS-V17-CAUSAL-DIRECTION-VS-WATCH-20261030",
  "const AI_ALERT_TRANSPORT_ENABLED=true;","function aiNeutralWatchMessage(",
  "AI_V17_CAUSAL_DIRECTION_OBSERVATION","AI_V17_NEUTRAL_DISCOVERY_WATCH",
  "r.recent_5m_net_taker_usdt","AI_MODEL_TEMPORARILY_AT_CAPACITY",
  "function telegramTransportProofOnce(","async function scheduledCore(",
  "async function updateFuturesOutcomes(","async function updateAiV16Outcomes("]){
   must(text.includes(mustExist),'RELEASE_SOURCE_CONTRACT_MISSING_'+mustExist);
 }
 must(!text.includes("AI_V16_EARLY_OBSERVATION"),'OLD_UNVERIFIED_DIRECTION_TRANSPORT_PRESENT');
 const [original,conf]=await Promise.all([getScript(),configSnapshot()]);
 must(original.sha256===beforeSha&&original.selectedPart==='worker.js','UNEXPECTED_LIVE_SOURCE_NO_DEPLOY');
 must(conf.health.last?.codeVersion==='IRYS-V16-AI-FIRST-OBSERVATIONAL-ALERT-20261030',
   'UNEXPECTED_LIVE_VERSION_NO_DEPLOY');
 must(conf.health.last?.status==='PASS','LIVE_NOT_HEALTHY_NO_DEPLOY');
 // Last-second lease: only replace the exact verified source, not concurrent operator changes.
 must((await getScript()).sha256===beforeSha,'SOURCE_CHANGED_DURING_PREFLIGHT');
 console.log('IRYS_V17_CODE_ONLY_DEPLOY_PREFLIGHT_PASS',JSON.stringify({
  expected_existing_sha256:beforeSha,proposed_sha256:candidateSha,
  cron:conf.crons,required_bindings_preserved:true,
  telegram_delivery_not_sent:true}));
 if(process.env.IRYS_V17_DRY_RUN==='true'){
  console.log('IRYS_V17_DRY_RUN_ONLY_NOT_DEPLOYED');return;
 }
 let triedPut=false;
 try{
  triedPut=true;await upload(candidate);
  let now=null,confirmed=false;
  for(let i=0;i<12;i++){
   try{now=await getScript();
    if(now.sha256===candidateSha&&now.selectedPart==='worker.js'){
      const current=await configSnapshot();
      must(same(current.binds,conf.binds),'BINDINGS_CHANGED_DURING_DEPLOY');
      must(same(current.crons,conf.crons),'CRON_CHANGED_DURING_DEPLOY');
      confirmed=true;break;
    }
   }catch(e){if(i===11)throw e;}
   await delay(5000);
  }
  must(confirmed,'NEW_WORKER_SOURCE_HASH_NOT_CONFIRMED');
  console.log('IRYS_V17_CLOUDFLARE_CODE_DEPLOY_VERIFIED',JSON.stringify({
    worker,new_source_sha256:candidateSha,cron_preserved:true,
    bindings_preserved:true,real_direction_accuracy_verified:false,
    next_scheduled_cron_run_not_yet_verified:true,
    actual_telegram_delivery_not_yet_verified:true}));
 }catch(err){
  if(triedPut){
   try{
    const latest=await getScript();
    if(latest.sha256===candidateSha){
     await upload(original.data);
     const restored=await getScript();
     must(restored.sha256===beforeSha,'ROLLBACK_BYTE_MISMATCH');
     const s=await configSnapshot();
     must(same(s.binds,conf.binds)&&same(s.crons,conf.crons),'ROLLBACK_CONFIG_MISMATCH');
     console.error('IRYS_V17_FAIL_ROLLBACK_VERIFIED');
    }else if(latest.sha256===beforeSha){
     console.error('IRYS_V17_FAIL_OLD_SOURCE_STILL_ACTIVE');
    }else console.error('IRYS_V17_FAIL_SOURCE_RACE_NO_UNSAFE_ROLLBACK');
   }catch(ex){console.error('IRYS_V17_ROLLBACK_UNVERIFIED',String(ex?.message||ex).slice(0,110));}
  }
  throw err;
 }
}
main().catch(err=>{console.error('IRYS_V17_DEPLOY_FAILED',String(err?.message||err).slice(0,170));process.exitCode=2;});
