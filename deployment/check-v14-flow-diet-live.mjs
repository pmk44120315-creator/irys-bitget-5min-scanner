/** Production V14 Cloudflare GET-only audit. No secret output, mutations, or alerts. */
import {createHash} from 'node:crypto';
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const token=process.env.IRYS_V7_CF_API_TOKEN||'',account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const expected='e05ad48dfbc155719fd475eac01cd452a4c33075f7cb1d24da014ef72820efe3';
const deployedAfterMs=Date.parse('2026-10-29T13:23:18Z');
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
  runtime_v14_seen:last.codeVersion==='IRYS-V14-NATIVE-MARKET-EVIDENCE-20261029',
  last_run_status:last.status||null,last_run_kst:last.time||null,
  github_dispatch:last.githubDispatchStatus||null,
  futures_direction:last.futuresDirection||null,
  early_market_watch:last.earlyMarketWatch||null,
  spot_directional:last.spotDirectional||null,
  spot_outcome_audit:last.spotOutcomeAudit||null,
  futures_outcome_audit:last.futuresOutcomeAudit||null,
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
console.log('IRYS_V14_FLOW_DIET_PUBLIC_READONLY_HEALTH',JSON.stringify(result));
if(!result.source_exact_match||cron.length!==1||cron[0]!=='*/5 * * * *'||missing.length||
   !status.kvConfigured||!status.telegramSecretConfigured||!status.githubDispatchConfigured||
   !status.workersAIConfigured)throw Error('V14_RUNTIME_INTEGRITY_BLOCKED');
if(!result.runtime_v14_seen)throw Error('V14_FIRST_SCHEDULED_RUN_NOT_OBSERVED');
const stamp=Date.parse(String(last.time||'').replace(' KST','+09:00').replace(' ','T'));
if(!Number.isFinite(stamp)||stamp<=deployedAfterMs||Date.now()-stamp>20*60000||stamp>Date.now()+60000)
  throw Error('V14_FLOW_DIET_FIRST_NEW_CRON_MISSING_OR_STALE');
if(!last.futuresDirection||!last.earlyMarketWatch||!last.spotDirectional||
   !last.spotOutcomeAudit||!last.futuresOutcomeAudit||
   last.earlyMarketWatch.status!=='PRICE_TURNOVER_ONLY_INTERNAL_WATCH_NOT_TELEGRAM'||
   last.earlyMarketWatch.sent!==0||last.githubDispatchStatus!=='ACCEPTED'||
   !['NO_QUALIFIED_DIRECTION','WAIT_SEND_RISK_CHECK','DIRECTIONAL_PROOF_ALERT_SENT',
      'DIRECTION_DUPLICATE_OR_CAP','DIRECTION_OFFICIAL_RISK_BLOCKED'].includes(
          last.spotDirectional.status))
  throw Error('V14_DIRECTION_OR_OUTCOME_ROUTE_NOT_READY');
if(last.status!=='PASS'||!Number.isInteger(result.telegram_api_acknowledgements_total)||
   result.telegram_device_receipt_verified!==false)
  throw Error('V14_RUNTIME_NOT_PASS_OR_DELIVERY_AUDIT_MISSING');
console.log('IRYS_V14_FLOW_DIET_FIRST_NEW_REAL_CRON_DIRECTION_AND_OUTCOME_PASS',JSON.stringify({
    time:last.time,source_sha256:deployed.sha256,
    telegram_api_acknowledgements_total:result.telegram_api_acknowledgements_total,
    telegram_device_receipt_verified:false}));
