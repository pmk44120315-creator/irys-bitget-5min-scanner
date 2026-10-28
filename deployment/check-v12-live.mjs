/** Production V12 Cloudflare GET-only audit. No secret output, mutations, or alerts. */
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const token=process.env.IRYS_V7_CF_API_TOKEN||'',account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const expected='65172792cca7103a53fe0f62c74961cd5c39b65f99a5559104a3cb69a4f84fec';
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
  runtime_v12_seen:last.codeVersion==='IRYS-V12-DELIVERY-CONSISTENCY-20261028',
  last_run_status:last.status||null,last_run_kst:last.time||null,
  github_dispatch:last.githubDispatchStatus||null,
  futures_direction:last.futuresDirection||null,
  early_market_watch:last.earlyMarketWatch||null,
  spot_signals:last.spotEarlyAlerts??null,
  spot_sent:last.sent??null,
  telegram_configured:status.telegramSecretConfigured,
  last_telegram_send_error:last.sendError||null,
  telegram_api_acked_this_run:last.telegramApiAckedThisRun??null,
  telegram_api_acknowledgements_total:last.telegramApiAcknowledgementsTotal??null,
  telegram_last_api_receipt:last.telegramLastApiReceipt??null,
  telegram_device_receipt_verified:last.telegramDeviceReceiptVerified??null,
  public_http_ok:true,no_mutations:true
};
console.log('IRYS_V12_PUBLIC_READONLY_HEALTH',JSON.stringify(result));
if(!result.source_exact_match||cron.length!==1||cron[0]!=='*/5 * * * *'||missing.length||
   !status.kvConfigured||!status.telegramSecretConfigured||!status.githubDispatchConfigured||
   !status.workersAIConfigured)throw Error('V12_RUNTIME_INTEGRITY_BLOCKED');
if(!result.runtime_v12_seen)throw Error('V12_FIRST_SCHEDULED_RUN_NOT_OBSERVED');
const stamp=Date.parse(String(last.time||'').replace(' KST','+09:00').replace(' ','T'));
if(!Number.isFinite(stamp)||Date.now()-stamp>20*60000||stamp>Date.now()+60000)
  throw Error('V12_LAST_SCHEDULE_STALE_OR_INVALID');
if(!last.futuresDirection||!last.earlyMarketWatch||last.githubDispatchStatus!=='ACCEPTED')
  throw Error('V12_MARKET_OR_FUTURES_ROUTE_NOT_READY');
if(last.status!=='PASS'||!Number.isInteger(result.telegram_api_acknowledgements_total)||
   result.telegram_device_receipt_verified!==false)
  throw Error('V12_RUNTIME_NOT_PASS_OR_DELIVERY_AUDIT_MISSING');
console.log('IRYS_V12_FIRST_REAL_CRON_PASS_WITH_API_RECEIPT_AUDIT',JSON.stringify({
    time:last.time,source_sha256:deployed.sha256,
    telegram_api_acknowledgements_total:result.telegram_api_acknowledgements_total,
    telegram_device_receipt_verified:false}));
