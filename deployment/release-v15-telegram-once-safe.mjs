/** Code-only V14 delivery-consistency release; one Worker, one authorized GitHub marker. No orders or secret output. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const worker='irys-surge-monitor';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'',token=process.env.IRYS_V7_CF_API_TOKEN||'';
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker;
const publicUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={authorization:'Bearer '+token,accept:'application/json'};
const originalHash='fd354584917b332c2091ca5c026fd348a1ba852bf1ed42064b02a58bc5d83e9f';
const candidate=readFileSync(new URL('./IRYS_V15_TELEGRAM_TRANSPORT_PROOF_WORKER.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getScript(){
  const r=await fetch(root,{headers,signal:AbortSignal.timeout(16000)});
  return extractWorkerSource(r);
}
async function getJson(path){
  const r=await fetch(root+path,{headers,signal:AbortSignal.timeout(16000)});
  if(!r.ok)throw Error('CF_READ_HTTP_'+r.status+' '+path);
  return r.json();
}
async function getHealth(){
  const r=await fetch(publicUrl,{signal:AbortSignal.timeout(16000),headers:{accept:'application/json'}});
  check(r.ok,'EXISTING_PUBLIC_HEALTH_HTTP_'+r.status);
  return r.json();
}
function bindingIdentity(settings){
  return (settings?.result?.bindings||[]).map(b=>[
    b.name,b.type,b.type==='kv_namespace'?b.namespace_id:null,
    b.type==='plain_text'?b.text:null
  ]).sort((a,b)=>a[0].localeCompare(b[0]));
}
function cronIdentity(schedule){
  const s=Array.isArray(schedule?.result?.schedules)?schedule.result.schedules:
    Array.isArray(schedule?.result)?schedule.result:[];
  return s.map(x=>x.cron).filter(Boolean).sort();
}
async function configCheck(before){
  const [settings,schedule,health]=await Promise.all([
    getJson('/settings'),getJson('/schedules'),getHealth()]);
  const binding=bindingIdentity(settings),cron=cronIdentity(schedule);
  for(const [name,type] of [
    ['AI','ai'],['IRYS_KV','kv_namespace'],['GITHUB_DISPATCH_TOKEN','secret_text'],
    ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']
  ])check(binding.some(b=>b[0]===name&&b[1]===type),'MISSING_BINDING_'+name);
  check(cron.length===1&&cron[0]==='*/5 * * * *','CRON_CHANGED_OR_MISSING');
  check(health.kvConfigured&&health.workersAIConfigured&&
    health.telegramSecretConfigured&&health.githubDispatchConfigured,
    'PUBLIC_HEALTH_BINDINGS_MISSING');
  if(before){
    check(JSON.stringify(binding)===JSON.stringify(before.binding),'BINDING_CONFIG_CHANGED');
    check(JSON.stringify(cron)===JSON.stringify(before.cron),'CRON_CONFIG_CHANGED');
  }
  return {binding,cron,health};
}
async function replaceWorkerSource(bytes){
  const form=new FormData();
  form.set('metadata',JSON.stringify({main_module:'worker.js'}));
  form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');
  const response=await fetch(root+'/content',{method:'PUT',
    headers:{authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('CONTENT_UPDATE_HTTP_'+response.status);
  const result=await response.json();
  check(result?.success===true,'CONTENT_UPDATE_NOT_ACKNOWLEDGED');
}
async function main(){
  check(/^[a-f0-9]{32}$/.test(account),'ACCOUNT_ID_INVALID');
  check(token.length>=20,'WORKER_EDITOR_TOKEN_MISSING');
  check(process.env.IRYS_V14_RELEASE_ONCE==='AUTHORIZED_FROM_REVIEWED_MARKER','RELEASE_MARKER_MISSING');
  check(process.env.GITHUB_REF==='refs/heads/fix/irys-v15-telegram-closure-20261030','WRONG_GITHUB_BRANCH');
  const source=candidate.toString('utf8');
  check(source.includes("const VERSION='IRYS-V15-TELEGRAM-TRANSPORT-PROOF-20261030'")&&
    source.includes('async function telegramTransportProofOnce(')&&
    source.includes('TRANSPORT_PROOF_KEY')&&
    source.includes('/bot[REDACTED]/sendMessage'),'V15_TELEGRAM_DIAGNOSTIC_MARKER_MISSING');
  check(source.includes('const AI_ALERT_TRANSPORT_ENABLED=false;'),'AI_TELEGRAM_MUST_BE_DISABLED');
  check(source.includes('function futuresSnapshotProof(')&&source.includes('function evaluateFutures(')&&source.includes('ALIGNED_REAL_OFFICIAL_1M_CONTEXT')&&source.includes('PRICE_FILL_INTERVAL_NOT_ALIGNED'),
      'V14_VERIFIED_FUTURES_CONTRACT_MISSING');
  check(source.includes('function validDirectionalProof(')&&
    source.includes('async function sendSpotDirectional(')&&
    source.includes('async function officialDirectionalRiskCheck(')&&
    source.includes('BITHUMB_OFFICIAL_COMPLETED_NATIVE_5M_AND_TRADE_1M')&&
    source.includes('missing_1m_not_zero_filled')&&
    source.includes('async function updateSpotOutcomes(')&&
    source.includes('async function updateFuturesOutcomes(')&&
    source.includes('function validFuturesBookProof(')&&
    source.includes("PRICE_TURNOVER_ONLY_INTERNAL_WATCH_NOT_TELEGRAM")&&
    source.includes('function recordReceipt(')&&
    source.includes('SKIPPED_DUPLICATE_TICK'),
    'V14_NATIVE_SOURCE_OR_DELIVERY_CONTRACT_MISSING');
  const v14Hash=sha(candidate);
  check(v14Hash===process.env.IRYS_V14_EXPECTED_SHA256,'UNREVIEWED_V14_BINARY_HASH');
  const live=await getScript();
  check(live.sha256===originalHash,'PREDEPLOY_SOURCE_MISMATCH');
  check(live.selectedPart==='worker.js','PREDEPLOY_MAIN_MODULE_CHANGED');
  const config=await configCheck();
  check(config.health?.last?.codeVersion==='IRYS-V15-CAUSAL-PRICE-FLOW-ALIGNMENT-20261030',
    'LIVE_RUNTIME_VERSION_MISMATCH');
  console.log('V15_TELEGRAM_RELEASE_PREFLIGHT_PASS',JSON.stringify({
    original_sha256:live.sha256,proposed_sha256:v14Hash,
    cron:config.cron,required_bindings_present:config.binding.length>=5}));
  // Just-in-time lease: never replace an intervening deployment.
  check((await getScript()).sha256===originalHash,'SOURCE_CHANGED_DURING_PREFLIGHT');
  if(process.env.IRYS_V14_RELEASE_DRY_RUN==='1'){
    console.log('V15_TELEGRAM_DRY_RUN_PASS_NO_DEPLOYMENT',JSON.stringify({
      original_sha256:live.sha256,proposed_sha256:v14Hash,
      bindings_preserved:true,cron_preserved:true,worker}));
    return;
  }
  let wrote=false;
  try{
    wrote=true;
    await replaceWorkerSource(candidate);
    let success=false,reason='NOT_READY';
    for(let i=0;i<12;i++){
      try{
        const now=await getScript();
        reason='OBSERVED_'+now.sha256.slice(0,12);
        if(now.sha256===v14Hash){await configCheck(config);success=true;break;}
      }catch(e){reason=String(e?.message||e).slice(0,80);}
      await delay(5000);
    }
    check(success,'POSTDEPLOY_INTEGRITY_UNVERIFIED_'+reason);
    console.log('V15_TELEGRAM_CODE_ONLY_DEPLOY_PASS',JSON.stringify({
      worker,sha256:v14Hash,bindings_preserved:true,cron_preserved:true,
      first_live_scheduled_v14_run_verified:false,telegram_receipt_verified:false,
      direction_accuracy_verified:false}));
  }catch(e){
    if(wrote){
      try{
        const latest=await getScript();
        if(latest.sha256===v14Hash){
          await replaceWorkerSource(live.data);
          check((await getScript()).sha256===originalHash,'ROLLBACK_SOURCE_MISMATCH');
          await configCheck(config);
          console.error('V14_DEPLOY_FAILED_AUTO_ROLLBACK_TO_V13_PASS');
        }else if(latest.sha256===originalHash){
          console.error('V14_DEPLOY_FAILED_V13_STILL_ACTIVE');
        }else console.error('V14_DEPLOY_FAILED_SOURCE_RACE_NO_OVERWRITE');
      }catch(rollbackErr){
        console.error('V14_ROLLBACK_FAILED_OR_UNVERIFIED',String(rollbackErr?.message||rollbackErr).slice(0,120));
      }
    }
    throw Error('V14_DEPLOY_BLOCKED_'+String(e?.message||e).slice(0,120));
  }
}
main().catch(e=>{console.error(String(e?.message||e).slice(0,200));process.exitCode=2;});
