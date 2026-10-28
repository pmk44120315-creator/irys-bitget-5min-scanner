/**
 * Cloudflare V7 deployment preflight, READ ONLY. No writes, secrets disclosure,
 * schedules updates, Telegram calls, or order routes.
 *
 * Requires scoped Individual Workers Editor token for irys-surge-monitor.
 */
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
const name='irys-surge-monitor';
const legacyHash='0cb5bdf7b909cb0c5f2e301dbb0226034e0a5e81f96a5efc4eeaa467d45bcc5f';
if(!token){console.error('V7_SCOPED_TOKEN_MISSING: preflight BLOCKED, no deployment performed');process.exit(2);}
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20){console.error('V7_PREFLIGHT_FAILED: invalid account ID or token presence');process.exit(2);}
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+name;
async function call(url){
  const r=await fetch(url,{headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(16000)});
  if(!r.ok)throw Error('CF_PREFLIGHT_HTTP_'+r.status);
  return r;
}
try{
  const [settingsResponse,scriptResponse,schedulesResponse,publicResponse]=await Promise.all([
    call(root+'/settings'),
    call(root),
    call(root+'/schedules'),
    fetch('https://irys-surge-monitor.vhehwpfl.workers.dev/',{signal:AbortSignal.timeout(16000)})
  ]);
  if(!publicResponse.ok)throw Error('V7_PUBLIC_HEALTH_'+publicResponse.status);
  const settings=await settingsResponse.json(),schedules=await schedulesResponse.json();
  const deployed=await scriptResponse.arrayBuffer();
  const currentHash=createHash('sha256').update(Buffer.from(deployed)).digest('hex');
  const ct=scriptResponse.headers.get('content-type')||'';
  const raw=Buffer.from(deployed).toString('utf8');
  const live=await publicResponse.json(),version=live.last?.codeVersion;
  const bindings=(settings.result?.bindings??[]).map(b=>({name:b.name,type:b.type}));
  const required={
    IRYS_KV:['kv_namespace'],
    AI:['ai'],
    GITHUB_DISPATCH_TOKEN:['secret_text'],
    TELEGRAM_BOT_TOKEN:['secret_text'],
    TELEGRAM_CHAT_ID:['secret_text','plain_text']
  };
  const missing=Object.entries(required).filter(([name,types])=>
    !bindings.some(b=>b.name===name&&types.includes(b.type))).map(x=>x[0]);
  const sched=Array.isArray(schedules.result?.schedules)?schedules.result.schedules:
              (Array.isArray(schedules.result)?schedules.result:[]);
  const cron=sched.map(x=>x.cron).filter(Boolean);
  const checks={
    deployed_health_version:version,
    script_mime:ct.split(';')[0],
    source_match:currentHash===legacyHash,
    source_has_v7_marker:raw.includes('IRYS-MORNING-AI-V7-CF-20261027'),
    worker_bindings:bindings,
    missing_required_bindings:missing,
    preserved_cron:cron,
    telegram_configured:live.telegramSecretConfigured,
    github_dispatch_configured:live.githubDispatchConfigured,
    workers_ai_configured:live.workersAIConfigured,
    kv_configured:live.kvConfigured,
    probe_only:true,
    no_changes:true
  };
  console.log('CLOUDFLARE_V7_PREFLIGHT',JSON.stringify(checks));
  if(version!=='IRYS-MORNING-AI-V7-CF-20261027'||missing.length||
     cron.length!==1||cron[0]!=='*/5 * * * *'||
     live.kvConfigured!==true||live.telegramSecretConfigured!==true||
     live.githubDispatchConfigured!==true||live.workersAIConfigured!==true||
     !checks.source_has_v7_marker){
    throw Error('V7_PREDEPLOY_IDENTITY_OR_BINDINGS_UNVERIFIED');
  }
  if(currentHash!==legacyHash) {
    console.log('V7_SOURCE_HASH_DIFFERS_FROM_LIBRARY: manual diff required BEFORE any update');
    throw Error('SOURCE_HASH_MISMATCH_NO_UPDATE');
  }
  console.log('V7_READ_ONLY_PREFLIGHT_PASS: exact source hash and required secret/AI/KV/cron bindings verified');
}catch(e){
  console.error('V7_PREFLIGHT_BLOCKED: '+String(e?.message||'unknown').slice(0,170));
  process.exitCode=2;
}
