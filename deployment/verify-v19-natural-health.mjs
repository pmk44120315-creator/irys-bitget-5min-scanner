/** Passive V19 production verification after NATURAL Cloudflare 5m Cron.
 * No manual scheduled invocation, worker edit, KV write or bot message.
 */
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('READONLY_SCOPED_CREDENTIALS_UNAVAILABLE');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const url='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={Authorization:'Bearer '+token,Accept:'application/json'};
const sha='bb96c3ad13ea8e47253c610d9e3c9927e949ac762859010cdf5f786b227d70ec';
const version='IRYS-V19-INDEPENDENT-EARLY-FLOW-DELIVERY-20261030';
const deployed=Date.parse('2026-10-30T13:03:23Z');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const get=async(u,h)=>{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('LIVE_READ_HTTP_'+r.status+' '+new URL(u).pathname);return r;};
const [script,settings,schedule]=await Promise.all([
 get(root,headers),get(root+'/settings',headers),get(root+'/schedules',headers)]);
const src=await extractWorkerSource(script);
if(src.sha256!==sha||src.selectedPart!=='worker.js')throw Error('LIVE_SOURCE_HASH_NOT_EXPECTED_V19');
const cfg=await settings.json(),cron=await schedule.json();
const binding=(cfg.result?.bindings||[]).map(x=>x.name+':'+x.type);
for(const needed of ['IRYS_KV:kv_namespace','AI:ai','TELEGRAM_BOT_TOKEN:secret_text',
 'TELEGRAM_CHAT_ID:plain_text','GITHUB_DISPATCH_TOKEN:secret_text'])
 if(!binding.includes(needed))throw Error('MISSING_BINDING_'+needed);
const times=(Array.isArray(cron.result?.schedules)?cron.result.schedules:cron.result||[]).map(x=>x.cron);
if(times.length!==1||times[0]!=='*/5 * * * *')throw Error('CRON_CHANGED');
let current=null,verified=false,checks=0;
const until=Date.now()+8*60000;
do{
 checks++;
 const r=await get(url,{Accept:'application/json'});
 current=(await r.json()).last||{};
 const time=Date.parse(String(current.time||'').replace(' KST','+09:00').replace(' ','T'));
 if(current.codeVersion===version&&Number.isFinite(time)&&time>deployed){
   verified=true;break;
 }
 await wait(15000);
}while(Date.now()<until);
const fast=current.aiFastDelivery||current.aiJudgment?.fastEarly||{};
const brief={expected_worker_source_sha256:sha,code_verified:true,
  cron_preserved:true,bindings_preserved:true,
  runtime_version:current.codeVersion||null,
  last_tick_kst:current.time||null,
  last_status:current.status||null,
  github_dispatch:current.githubDispatchStatus||null,
  market_data_utc:current.githubBitgetFinishedUtc||null,
  ai_status:current.aiJudgment?.status||null,
  fast_status:fast.status||null,
  fast_evidence_source:fast.source_status||null,
  fast_evidence_error:fast.source_error||null,
  fast_futures_candidates:fast.futures_candidates??null,
  fast_spot_candidates:fast.spot_candidates??null,
  fast_verified_futures:fast.verified_futures??null,
  fast_reversals:fast.reversal_candidates??null,
  fast_spot_sent:fast.spot_sent??null,
  fast_futures_sent:fast.futures_sent??null,
  fast_directional_sent:fast.direction_sent??null,
  fast_neutral_watch_sent:fast.watch_sent??null,
  fast_alerts_sent:fast.sent??null,
  fast_send_error:fast.send_error||null,
  fast_skipped_cooldown:fast.skipped_cooldown??null,
  fast_skipped_rate:fast.skipped_rate??null,
  last_telegram_ack_count:current.telegramApiAckedThisRun??null,
  last_receipt_channel:current.telegramLastApiReceipt?.channel||null,
  last_receipt_message_id:current.telegramLastApiReceipt?.telegram_message_id||null,
  last_receipt_venue_symbol:current.telegramLastApiReceipt?.symbol||null,
  natural_scheduled_tick_verified:verified,
  actual_device_received_unverified:true,direction_accuracy_unverified:true,checks};
console.log('V19_NATURAL_CRON_AND_TELEGRAM_REPORT',JSON.stringify(brief));
if(!verified)throw Error('V19_NATURAL_TICK_NOT_VERIFIED');
if(current.status!=='PASS')throw Error('V19_NATURAL_TICK_MARKET_NOT_PASS');
if(!current.aiFastDelivery)throw Error('V19_FAST_EARLY_PIPELINE_NOT_REPORTED');
if(fast.send_error)throw Error('V19_FAST_TELEGRAM_SEND_FAILED');
if(fast.sent>0){
 if((current.telegramApiAckedThisRun||0)<fast.sent)throw Error('TELEGRAM_ACK_COUNT_MISMATCH');
 const rc=current.telegramLastApiReceipt||{};
 if(!rc.channel?.startsWith('V19_')||!Number.isSafeInteger(rc.telegram_message_id))
  throw Error('V19_NO_MATCHING_TELEGRAM_API_RECEIPT');
 console.log('V19_PRODUCTION_TELEGRAM_API_ACK_VERIFIED',JSON.stringify({
   sent:fast.sent,message_id:rc.telegram_message_id,channel:rc.channel,
   device_receipt_not_verified:true}));
}else{
 console.log('V19_PRODUCTION_CRON_PASS_BUT_NO_NEW_ALERT',JSON.stringify({
  reason:fast.status,verified_futures:fast.verified_futures,
  fut:fast.futures_candidates,spot:fast.spot_candidates,
  skipped_cooldown:fast.skipped_cooldown,skipped_rate:fast.skipped_rate}));
}
