/** GET-only Cloudflare V15.1 temporary one-time Telegram transport proof. */
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CF_CREDENTIAL_UNAVAILABLE');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const url='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={Authorization:'Bearer '+token,Accept:'application/json'};
async function read(url,headers){
  const r=await fetch(url,{headers,signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error('CLOUDFLARE_GET_FAILED_HTTP_'+r.status);
  return r;
}
const [s,settings,schedules,health]=await Promise.all([
  read(root,auth),read(root+'/settings',auth),read(root+'/schedules',auth),
  read(url,{Accept:'application/json'})
]);
const live=await extractWorkerSource(s);
const body=await health.json(),set=await settings.json(),sched=await schedules.json();
const bindings=(set.result?.bindings||[]).map(x=>({name:x.name,type:x.type}));
const cron=(sched.result?.schedules||sched.result||[]).map?.(x=>x.cron)||[];
const needed=[['IRYS_KV','kv_namespace'],['AI','ai'],
 ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text'],
 ['GITHUB_DISPATCH_TOKEN','secret_text']];
const missing=needed.filter(([name,type])=>!bindings.some(x=>x.name===name&&x.type===type)).map(x=>x[0]);
const proof=body.telegramTransportProofV15||{};
const last=body.last||{};
const report={
  deployed_source_sha256:live.sha256,
  source_match:live.sha256==='ee166d49a0107d78fc747ca1f1b564e6af28b729ae3a0a5e716a89c9a2e2c52a',
  runtime_version:last.codeVersion||null,
  cron,required_bindings_missing:missing,
  latest_cron_kst:last.time||null,
  latest_market_scan_status:last.status||null,
  github_dispatch:last.githubDispatchStatus||null,
  spot_direction:last.spotDirectional&&{status:last.spotDirectional.status,
    reviewed:last.spotDirectional.reviewed,confirmed:last.spotDirectional.proof_passed,
    sent:last.spotDirectional.sent},
  futures_direction:last.futuresDirection&&{status:last.futuresDirection.status,
    confirmed:last.futuresDirection.confirmed,sent:last.futuresDirection.sent,
    reasons:last.futuresDirection.reasons},
  last_market_telegram_ack:last.telegramLastApiReceipt||null,
  previous_market_ack_total:last.telegramApiAcknowledgementsTotal??null,
  diagnostic_transport:{
    status:proof.status||'NOT_RUN',
    telegram_api_message_id:proof.message_id??null,
    at_kst:proof.at||null,
    error:proof.error||null
  },
  no_market_order_or_synthetic_direction:true
};
console.log('IRYS_V15_TELEGRAM_ONE_TIME_LIVE_HEALTH',JSON.stringify(report));
if(!report.source_match||missing.length||cron.length!==1||cron[0]!=='*/5 * * * *')
  throw Error('CLOUDFLARE_TRANSPORT_PROOF_SOURCE_OR_SETTINGS_MISMATCH');
if(report.diagnostic_transport.status==='TELEGRAM_API_ACK')
  console.log('IRYS_TELEGRAM_API_ACK_VERIFIED_NO_MARKET_SIGNAL',JSON.stringify({
    message_id:report.diagnostic_transport.telegram_api_message_id,
    at_kst:report.diagnostic_transport.at_kst,
    device_receipt_unverified:true
  }));
else if(report.diagnostic_transport.status==='SEND_FAILED')
  throw Error('TELEGRAM_REAL_TRANSPORT_FAILED_'+String(proof.error||'UNKNOWN').slice(0,100));
else
  console.log('IRYS_TELEGRAM_ONE_TIME_TEST_PENDING_OR_UNVERIFIED',
    JSON.stringify(report.diagnostic_transport));
