/** Passive production V23 real-Cron verification; NO market orders, KV writes or Bot sends. */
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CLOUDFLARE_CREDS_UNAVAILABLE');
const worker='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const healthUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={authorization:'Bearer '+token,accept:'application/json'};
const VERSION='IRYS-V23-DIRECT-FIRST-SCOUT-AND-LEGACY-PRESERVED-20261101';
const EXPECTED_HASH='f53ced30287544784d92bf74bb644177add46379781cdb7e3874a9ec1ee2c182';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function read(url,authorized=true){
 const res=await fetch(url,{headers:authorized?auth:{accept:'application/json'},
   signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error('CF_READ_HTTP_'+res.status+' '+new URL(url).pathname);
 return res;
}
const [src,cfg,cron]=await Promise.all([
 read(worker),read(worker+'/settings'),read(worker+'/schedules')]);
let bytes;
if((src.headers.get('content-type')||'').toLowerCase().startsWith('multipart/form-data')){
 const form=await src.formData();
 const raw=form.get('metadata'),meta=raw?JSON.parse(typeof raw==='string'?raw:await raw.text()):{};
 const part=form.get(meta.main_module||meta.body_part||'worker.js');
 if(!part)throw Error('LIVE_SOURCE_MAIN_MISSING');
 bytes=Buffer.from(typeof part==='string'?part:await part.arrayBuffer());
}else bytes=Buffer.from(await src.arrayBuffer());
const digest=createHash('sha256').update(bytes).digest('hex');
if(digest!==EXPECTED_HASH)throw Error('V23_LIVE_CODE_HASH_MISMATCH');
const config=await cfg.json(),schedule=await cron.json();
const groups=(config.result?.bindings||[]).map(x=>x.name+':'+x.type);
for(const k of ['AI:ai','IRYS_KV:kv_namespace','GITHUB_DISPATCH_TOKEN:secret_text',
   'TELEGRAM_BOT_TOKEN:secret_text','TELEGRAM_CHAT_ID:plain_text'])
 if(!groups.includes(k))throw Error('ORIGINAL_BINDING_NOT_PRESERVED_'+k);
const crons=(Array.isArray(schedule.result?.schedules)?schedule.result.schedules:
 Array.isArray(schedule.result)?schedule.result:[]).map(x=>x.cron);
if(crons.length!==1||crons[0]!=='*/5 * * * *')throw Error('ORIGINAL_5MIN_CRON_CHANGED');
const started=Date.now();
let observedInitial=false,observedComparable=false,observations=[];
const deadline=started+13*60000;
do{
 const body=await (await read(healthUrl,false)).json();
 const last=body.last||{},scout=last.v23DirectFastScout||{};
 if(last.codeVersion===VERSION&&last.status==='PASS'){
   observedInitial=true;
   const item={tick_kst:last.time||null,status:scout.status||null,
     market_status:scout.market_status||null,elapsed_min:scout.elapsed_min??null,
     direct_provider_errors:scout.read_errors||[],candidates:scout.candidate_count??null,
     actual_sent:scout.sent??null,
     recent_taker_sample:scout.actual_taker||null,
     send_error:scout.send_error||null,
     original_github_dispatch:last.githubDispatchStatus||null,
     original_v21_direction: last.v21ForecastDelivery?.status||null,
     original_v19_wrong_direction_stopped:
       last.v20UnverifiedDirectionalSuppressionActive===true,
     bot_api_ack_this_tick:last.telegramApiAckedThisRun??null,
     total_prior_and_new_bot_acks:last.telegramApiAcknowledgementsTotal??null,
     last_accepted_bot_channel:last.telegramLastApiReceipt?.channel||null,
     last_accepted_bot_message_id:last.telegramLastApiReceipt?.telegram_message_id||null};
   if(!observations.some(x=>x.tick_kst===item.tick_kst)){
     observations.push(item);
     console.log('V23_NATURAL_TICK_OBSERVED',JSON.stringify(item));
   }
   if(scout.status==='TELEGRAM_SEND_NOT_VERIFIED'||scout.send_error)
     throw Error('V23_ACTUAL_TELEGRAM_TRANSPORT_FAILURE');
   if(last.githubDispatchStatus!=='ACCEPTED')throw Error('LEGACY_DISPATCH_NOT_ACCEPTED');
   if(last.v20UnverifiedDirectionalSuppressionActive!==true)
     throw Error('LEGACY_V19_REACTIVE_SPAM_REENABLED');
   if(scout.market_status==='MARKET_COMPARISON_PASS'&&
       !scout.read_errors?.length&&scout.observed>0){
     observedComparable=true;
     if(scout.sent>0&&last.telegramApiAckedThisRun<scout.sent)
        throw Error('V23_TELEGRAM_ACK_NOT_IN_TOTAL');
     break;
   }
 }
 await pause(20000);
}while(Date.now()<deadline);
const summary={verification_checked_at:new Date().toISOString(),
  source_hash:digest,version:VERSION,
  worker_natural_5m_tick_seen:observedInitial,
  actual_current_exchange_comparison_seen:observedComparable,
  natural_ticks_observed:observations,
  cloudflare_cron_and_bindings_preserved:true,
  no_manual_telegram_or_order_sent:true,
  prediction_direction_accuracy_increase_not_verified:true};
console.log('V23_PRODUCTION_NATURAL_VERIFICATION',JSON.stringify(summary));
if(!observedInitial)throw Error('V23_NATURAL_WORKER_TICK_NOT_OBSERVED');
if(!observedComparable)throw Error('V23_FRESH_DIRECT_PUBLIC_MARKET_COMPARISON_NOT_VERIFIED');
