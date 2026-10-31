/** Owner diagnostic: GET-only Cloudflare live Worker/KV, no secrets logged.
 * Reads *only* selected runtime aggregate fields, no Telegram API calls/sends.
 */
import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('READ_CLOUDFLARE_CREDS_MISSING');
const api='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const headers={Authorization:'Bearer '+token,Accept:'application/json'};
async function read(url,auth=true){
 const r=await fetch(url,{headers:auth?headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(17000)});
 return r;
}
async function requireJson(resp,name){
 if(!resp.ok)throw Error(name+'_HTTP_'+resp.status);
 return resp.json();
}
const [sr,settingsResp,cronResp,publicResp]=await Promise.all([
 read(api),read(api+'/settings'),read(api+'/schedules'),
 read('https://irys-surge-monitor.vhehwpfl.workers.dev/',false)]);
const settings=await requireJson(settingsResp,'SETTINGS'),cron=await requireJson(cronResp,'CRON');
const health=await requireJson(publicResp,'PUBLIC_HEALTH');
let sourceHash=null,sourceVersion=null;
if(sr.ok){
 const contentType=(sr.headers.get('content-type')||'').toLowerCase();
 let body=null;
 if(contentType.startsWith('multipart/form-data')){
   const form=await sr.formData();
   const meta=JSON.parse(String(form.get('metadata')||'{}'));
   const name=meta.main_module||meta.body_part||'worker.js';
   const part=form.get(name);
   if(part)body=Buffer.from(typeof part==='string'?part:await part.arrayBuffer());
 }else body=Buffer.from(await sr.arrayBuffer());
 if(body){
   sourceHash=createHash('sha256').update(body).digest('hex');
   sourceVersion=body.toString('utf8').match(/const VERSION='([^']+)'/)?.[1]||null;
 }
}
const bindings=settings.result?.bindings||[];
const crons=(Array.isArray(cron.result?.schedules)?cron.result.schedules:cron.result||[]).map(x=>x.cron);
const status=health.last||{};
const ai=status.aiJudgment||{};
const fut=status.futuresDirection||{};
const spot=status.spotDirectional||{};
const stateSummary={
  worker_source_sha256:sourceHash,worker_source_version:sourceVersion,
  runtime_version:status.codeVersion||null,runtime_tick:status.time||null,
  runtime_status:status.status||null,dispatch_status:status.githubDispatchStatus||null,
  dispatch_error:status.githubDispatchError||null,market_source_error:status.bgError||null,
  github_feed_at:status.githubBitgetFinishedUtc||null,
  crypto_market_count:status.cryptoVerifiedCount??null,
  bithumb_count:status.marketB??null,
  ai_status:ai.status||null,ai_model_decisions:ai.model_decisions??null,
  v19FastDelivery:status.aiFastDelivery||ai.fastEarly||null,
  v19AiFastSent:ai.fastAlertsSent??null,
  totalBotAcks:status.telegramApiAcknowledgementsTotal??null,
  ai_spot_preselected:ai.spot_preselected??null,
  ai_spot_evaluated:ai.spot_evaluated??null,
  ai_futures_preselected:ai.futures_preselected??null,
  ai_futures_evaluated:ai.futures_evaluated??null,
  ai_contrary_suppressed:ai.contrary_suppressed??null,
  ai_watch_sent:ai.watch_sent??null,
  ai_directional_sent:ai.directional_sent??null,
  ai_alerts_sent:ai.alerts_sent??null,ai_error:ai.error||null,
  spot_direction_status:spot.status||null,spot_proof_passed:spot.proof_passed??null,
  spot_direction_sent:spot.sent??null,
  spot_direction_error:spot.send_error||null,
  future_status:fut.status||null,future_inspected:fut.inspected??null,
  future_qualified:fut.qualified??null,future_sent:fut.sent??null,
  future_reasons:fut.reasons||{},
  regular_spot_sent:status.sent??null,
  telegram_ack_this_run:status.telegramApiAckedThisRun??null,
  telegram_ack_total:status.telegramApiAcknowledgementsTotal??null,
  telegram_last_ack_channel:status.telegramLastApiReceipt?.channel||null,
  telegram_last_ack_time:status.telegramLastApiReceipt?.accepted_at||null,
  telegram_last_ack_symbol:status.telegramLastApiReceipt?.symbol||null,
  ai_outcome:status.aiOutcomeAudit?{tracked:status.aiOutcomeAudit.tracked,pending:status.aiOutcomeAudit.pending}:null,
  settings:{cron:crons,
    bindings:bindings.map(x=>x.name+':'+x.type).sort(),
    telegramConfigured:health.telegramSecretConfigured??null,
    workersAIConfigured:health.workersAIConfigured??null,
    kvConfigured:health.kvConfigured??null,
    githubDispatchConfigured:health.githubDispatchConfigured??null,
    telegramTransportProofV15:health.telegramTransportProofV15||null
  }
};
console.log('IRYS_REAL_LIVE_DIAGNOSTIC',JSON.stringify(stateSummary));
const binding=bindings.find(x=>x.name==='IRYS_KV'&&x.type==='kv_namespace');
if(binding?.namespace_id){
 const key=encodeURIComponent('irys:fast:state:v1');
 const kvApi='https://api.cloudflare.com/client/v4/accounts/'+account+
   '/storage/kv/namespaces/'+binding.namespace_id+'/values/'+key;
 const kr=await read(kvApi);
 if(kr.ok){
  const state=await kr.json(),all=state.deliveryReceiptsV12||[],
    aiRecords=state.aiV16Outcomes||[],since=Date.now()-6*3600000;
  const age=(v)=>typeof v==='number'&&Number.isFinite(v)?Math.round((Date.now()-v)/60000):null;
  console.log('IRYS_CLOUDFLARE_STATE_READONLY',JSON.stringify({
   kv_read:'PASS',state_run:state.run??null,ai_quota_backoff_minutes_remaining:
      typeof state.aiQuotaBackoffUntil==='number'?
      Math.max(0,Math.round((state.aiQuotaBackoffUntil-Date.now())/60000)):null,
   ai_quota_backoff_until_utc:typeof state.aiQuotaBackoffUntil==='number'?
      new Date(state.aiQuotaBackoffUntil).toISOString():null,
   recent_telegram_receipts_6h:all.filter(x=>{
     const at=Date.parse(x.accepted_at||x.at||'');
     return Number.isFinite(at)&&at>=since;
   }).length,
   receipts_all:all.length,
   receipts_tail:all.slice(-8).map(x=>({
      channel:x.channel,symbol:x.symbol,at:x.accepted_at||x.at||null,
      id:typeof x.telegram_message_id==='number'?x.telegram_message_id:null})),
   ai_v16_outcomes:aiRecords.length,
   ai_last_alert_keys:Object.keys(state.lastAlert||{}).length,
   ai_spot_tape_last_minutes:age(state.aiSpotTape?.at),
   recent_spot_outcome_pending:(state.spotOutcomesV13||[]).filter(x=>!x?.results?.['60m']).length,
   recent_future_outcome_pending:(state.futuresOutcomesV13||[]).filter(x=>!x?.results?.['60m']).length,
   protected_readonly:true,no_telegram_sent:true
  }));
 }else console.log('IRYS_CLOUDFLARE_STATE_READONLY',JSON.stringify({
    kv_read:'UNAVAILABLE',status_code:kr.status,no_assumptions:true}));
}else console.log('IRYS_CLOUDFLARE_STATE_READONLY',JSON.stringify({kv_read:'BINDING_NOT_LISTED'}));
