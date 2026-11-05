/** Production V10 Cloudflare GET-only audit. No secret output, mutations, or alerts. */
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const token=process.env.IRYS_V7_CF_API_TOKEN||'',account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const expected='5c5c2f045fe2140c2ae245f15c7f02f9320f30533cf1c6ba75777dc604c7f1b1';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('MISSING_SCOPED_CREDENTIAL');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
async function get(url,headers={}){
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('LIVE_GET_FAILED_HTTP_'+r.status);
 return r;
}
const headers={Authorization:'Bearer '+token,Accept:'application/json'};
const [live,sets,times,health]=await Promise.all([
  get(root,headers),
  get(root+'/settings',headers),
  get(root+'/schedules',headers),
  get('https://irys-surge-monitor.vhehwpfl.workers.dev/',{Accept:'application/json'})
]);
const deployed=await extractWorkerSource(live);
const settings=await sets.json(),schedules=await times.json(),status=await health.json();
const bindings=(settings.result?.bindings||[]).map(x=>({name:x.name,type:x.type}));
const cron=(schedules.result?.schedules||schedules.result||[]).map?.(x=>x.cron)||[];
const must=[['IRYS_KV','kv_namespace'],['AI','ai'],['GITHUB_DISPATCH_TOKEN','secret_text'],
 ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']];
const missing=must.filter(([n,t])=>!bindings.some(b=>b.name===n&&b.type===t)).map(x=>x[0]);
const last=status.last||{};
const result={
  worker:'irys-surge-monitor',deployed_source_sha256:deployed.sha256,
  source_exact_match:deployed.sha256===expected,
  cron,required_bindings_missing:missing,
  runtime_code_version:last.codeVersion||null,
  runtime_v10_seen:last.codeVersion==='IRYS-V10-SPOT-BITGET-VERIFIED-20261028',
  last_run_status:last.status||null,last_run_kst:last.time||null,
  github_dispatch:last.githubDispatchStatus||null,
  futures_direction:last.futuresDirection||null,
  spot_signals:last.spotEarlyAlerts??null,
  spot_sent:last.sent??null,
  telegram_configured:status.telegramSecretConfigured,
  last_telegram_send_error:last.sendError||null,
  public_http_ok:true,no_mutations:true
};
console.log('IRYS_V10_PUBLIC_READONLY_HEALTH',JSON.stringify(result));
if(!result.source_exact_match||cron.length!==1||cron[0]!=='*/5 * * * *'||missing.length||
   !status.kvConfigured||!status.telegramSecretConfigured||!status.githubDispatchConfigured||
   !status.workersAIConfigured)throw Error('V10_RUNTIME_INTEGRITY_BLOCKED');
if(result.runtime_v10_seen&&(!last.futuresDirection||last.githubDispatchStatus!=='ACCEPTED'))
  throw Error('V10_MARKET_OR_FUTURES_ROUTE_NOT_READY');
if(!result.runtime_v10_seen)console.log('IRYS_V10_AWAITING_FIRST_SCHEDULED_RUN_NO_FALSE_SUCCESS');
