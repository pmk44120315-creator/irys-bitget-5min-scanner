/** Sparse authorized delivery. Only revalidated raw paired evidence can create a
 * one-use in-process transport capability; legacy senders never obtain one.
 */
import {V30_VERSION,v30Qualify,v30ValidatePacket,v30Settle,v30OutcomeSummary} from './v30_core.mjs';
import {v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';
import {v35Reconcile} from './v35_lifecycle.mjs';
const V30_FEED='https://api.github.com/repos/pmk44120315-creator/irys-bitget-5min-scanner/contents/data/v30_direction_latest.json';
const V30_SEND_CAP=2,V30_SYMBOL_COOLDOWN_MS=90*60000;
const v30Permits=new WeakSet();
function v30ConsumePermit(p,now=Date.now()){
 if(!p||typeof p!=='object'||!v30Permits.has(p))return false;
 v30Permits.delete(p);if(p.item?.dispatch_snapshot?.version==='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'&&(!Number.isSafeInteger(p.item?.final?.quote?.at_ms)||now-p.item.final.quote.at_ms>15000))return false;return v30Qualify(p.item,now).allowed===true;
}
function v30FormatSignal(p,now){
 const f=x=>Number(x).toLocaleString('ko-KR',{maximumFractionDigits:10}),q=p.final_quote;
 const kst=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ')+' KST';
 const dir=p.direction==='BUY'?'BUY · 현물 상승':p.direction==='LONG'?'LONG · 상승':'SHORT · 하락';
 return `🔎 [V35 방향 근거·후속 상태 확인]\n${p.venue==='bithumb'?'빗썸':'비트겟'} ${p.symbol} | ${dir}\n`+
  `근거 시각 ${kst(p.observed_at_ms)}\n최우선 매수/매도호가 ${f(q.bid)} / ${f(q.ask)}\n`+
  `독립 신규 체결·호가 2회 확인 + 최종 호가 재확인\n`+
  `근거 이탈 참고선 ${f(p.invalidation_reference)} · 유효 ${kst(p.expires_at_ms)}까지\n`+
  `5·15분 방향 가설이며 적중·수익을 보장하지 않습니다. 5분 주기로 최대15분간 기준 이탈을 재확인하고, 확인되면 이 메시지를 무효 표시합니다. 유효시각이 지난 신호를 추격하지 마세요.`;
}
async function v30ReadPacket(env,requestedAt,options){
 const clock=options.clock||Date.now,sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
 if(typeof env?.GITHUB_DISPATCH_TOKEN!=='string'||!env.GITHUB_DISPATCH_TOKEN)return {ok:false,reason:'GITHUB_CONTENT_READ_NOT_CONFIGURED',reads:0};
 const start=clock(),deadline=start+(options.maxWaitMs??105000);let reason='NO_CURRENT_PACKET',reads=0;
 do{
  try{
   const doc=await options.read(V30_FEED+'?ref=main&generation='+clock(),{headers:{authorization:'Bearer '+env.GITHUB_DISPATCH_TOKEN,accept:'application/vnd.github.raw+json','User-Agent':'IRYS-public-market-evidence','cache-control':'no-cache'},cf:{cacheTtl:0}},12000);
   reads++;const check=v30ValidatePacket(doc,clock(),options.expectedDigest);
   if(check.ok)return {ok:true,doc,reads,wait_ms:clock()-start};reason=check.reason;
  }catch(_e){reads++;reason='CURRENT_EVIDENCE_SOURCE_UNAVAILABLE';}
  const remaining=deadline-clock();if(remaining<=0)break;await sleep(Math.min(5000,remaining));
 }while(clock()<=deadline);
 return {ok:false,reason,reads,wait_ms:clock()-start};
}
async function v30ReviewAndDeliver(env,state,requestedAt,options){
 const clock=options.clock||Date.now;
 const output={version:V30_VERSION,status:'CHECKING_CURRENT_EVIDENCE',market_notifications_enabled:true,policy:'QUALIFIED_CURRENT_DIRECTION_ONLY',sent:0,ready:0,evaluated:0,forecast_accuracy_proven:false,trading_permit:false};
 let doc=null;
 try{
 const got=await v30ReadPacket(env,requestedAt,options);output.feed={ok:got.ok,reason:got.reason||null,reads:got.reads,wait_ms:got.wait_ms||0};
 if(!got.ok){output.status='EVIDENCE_SOURCE_NOT_READY';return output;}
 doc=got.doc;output.source_at_ms=doc.at_ms;output.source_summary=doc.summary||{};output.forward=doc.forward||{};
 // New signal validation and send must not await historical or old-message work.
 const approved=[],rejected={};
 for(const item of doc.items){const q=v30Qualify(item,clock());output.evaluated++;
  if(q.allowed)approved.push({item,proof:q});else rejected[q.reason]=(rejected[q.reason]||0)+1;
 }
 output.ready=approved.length;output.rejection_reasons=rejected;
 state.v30LatestSummary={at_ms:clock(),source_at_ms:doc.at_ms,ready:approved.length,rejection_reasons:rejected};
 if(!approved.length){output.status='NO_CONFIRMED_DIRECTION';return output;}
 if(!env?.IRYS_KV?.get||!env?.IRYS_KV?.put){output.status='DELIVERY_STATE_UNAVAILABLE';return output;}
 const now=clock(),hour=Math.floor(now/3600000),hourKey='irys:v30:delivery-hour:'+hour;
 let hourly={hour,attempts:0,sent:0};
 const inherited=state.v30Hourly?.hour===hour?state.v30Hourly:state.v23ScoutHourly?.hour===hour?{hour,attempts:state.v23ScoutHourly.count,sent:state.v23ScoutHourly.count}:null;
 if(inherited)hourly={...hourly,...inherited};
 try{const stored=await env.IRYS_KV.get(hourKey);if(stored){const parsed=JSON.parse(stored);if(parsed.hour!==hour||!Number.isSafeInteger(parsed.attempts)||parsed.attempts<0)throw Error('INVALID_HOUR_STATE');hourly.attempts=Math.max(hourly.attempts,parsed.attempts);hourly.sent=Math.max(hourly.sent,parsed.sent||0);}}
 catch(_e){output.status='DELIVERY_STATE_UNVERIFIED';return output;}
 if(hourly.attempts>=V30_SEND_CAP){output.status='RATE_PACED';output.hourly={...hourly};return output;}
 approved.sort((a,b)=>b.proof.priority-a.proof.priority||b.proof.observed_at_ms-a.proof.observed_at_ms||a.proof.symbol.localeCompare(b.proof.symbol));
 let chosen=null;
 try{
  for(const r of approved){const key=r.proof.venue+':'+r.proof.symbol;
   const last=Math.max(state.v30Sent?.[key]||0,state.v23ScoutNotices?.[key]||0);
   if(last&&now-last<V30_SYMBOL_COOLDOWN_MS)continue;
   const durable=await env.IRYS_KV.get('irys:v30:last-symbol:'+key);
   if(durable){const d=JSON.parse(durable);if(!Number.isSafeInteger(d.at_ms))throw Error('INVALID_SYMBOL_STATE');if(now-d.at_ms<V30_SYMBOL_COOLDOWN_MS)continue;}
   if(await env.IRYS_KV.get('irys:v30:outbox:'+r.proof.evidence_id))continue;
   let current=r;
   if(typeof options.refreshFinalQuote==='function'){
    let liveItem;
    try{liveItem=await options.refreshFinalQuote(r.item,doc);}
    catch{output.dispatch_rejected=(output.dispatch_rejected||0)+1;if(options.onDispatchRecheck)options.onDispatchRecheck(false,'DISPATCH_QUOTE_UNAVAILABLE_OR_INVALID');continue;}
    const liveProof=v30Qualify(liveItem,clock());
    if(options.onDispatchRecheck)options.onDispatchRecheck(liveProof.allowed,liveProof.reason);
    if(!liveProof.allowed){output.dispatch_rejected=(output.dispatch_rejected||0)+1;continue;}
    current={item:liveItem,proof:liveProof};
   }
   chosen=current;break;
  }
 }catch(_e){output.status='DELIVERY_STATE_UNVERIFIED';return output;}
 if(!chosen){output.status=output.dispatch_rejected?'DISPATCH_EVIDENCE_NO_LONGER_VALID':'DUPLICATE_OR_SYMBOL_COOLDOWN';return output;}
 const {item}=chosen;let proof=v30Qualify(item,clock());
 if(!proof.allowed){output.status='EVIDENCE_EXPIRED_BEFORE_SEND';return output;}
 const outboxKey='irys:v30:outbox:'+proof.evidence_id,symbolKey=proof.venue+':'+proof.symbol;
 try{
  await env.IRYS_KV.put(outboxKey,JSON.stringify({status:'ATTEMPT_RESERVED',at_ms:clock(),symbol:proof.symbol,direction:proof.direction}),{expirationTtl:7200});
  hourly.attempts++;await env.IRYS_KV.put(hourKey,JSON.stringify(hourly),{expirationTtl:7200});state.v30Hourly={...hourly};
 }catch(_e){output.status='DELIVERY_RESERVATION_FAILED';return output;}
 proof=v30Qualify(item,clock());if(!proof.allowed){output.status='EVIDENCE_EXPIRED_DURING_RESERVATION';return output;}
 if(item.dispatch_snapshot?.version==='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'&&clock()-item.final.quote.at_ms>15000){output.status='DISPATCH_QUOTE_EXPIRED_DURING_RESERVATION';return output;}
 const permit={item};v30Permits.add(permit);let ack;
 try{ack=await options.send((options.formatSignal||v30FormatSignal)(proof,clock()),permit);}
 catch(_e){
  v30Permits.delete(permit);output.status='DELIVERY_UNCERTAIN';
  // Telegram has no caller-supplied idempotency key. An uncertain POST is not
  // retried as though it had certainly failed; disclose the unknown outcome.
  try{await env.IRYS_KV.put('irys:v30:last-symbol:'+symbolKey,JSON.stringify({at_ms:clock(),status:'DELIVERY_UNCERTAIN'}),{expirationTtl:7200})}catch{}
  return output;
 }
 if(!Number.isSafeInteger(ack?.message_id)||ack.message_id<=0){v30Permits.delete(permit);output.status='TELEGRAM_ACK_NOT_VERIFIED';return output;}
 output.sent=1;output.status='TELEGRAM_API_ACK';output.sent_symbol=proof.symbol;output.direction=proof.direction;output.message_id=ack.message_id;
 hourly.sent++;state.v30Hourly={...hourly};state.v30Sent??={};state.v30Sent[symbolKey]=clock();
 // The reservation and ACK use DIFFERENT KV keys. Cloudflare permits only
 // one write per second per key; never rewrite the hour or outbox reservation.
 const writes=await Promise.allSettled([
  env.IRYS_KV.put('irys:v30:ack:'+proof.evidence_id,JSON.stringify({status:'ACK',at_ms:clock(),message_id:ack.message_id}),{expirationTtl:7200}),
  env.IRYS_KV.put('irys:v30:last-symbol:'+symbolKey,JSON.stringify({at_ms:clock(),status:'ACK',direction:proof.direction}),{expirationTtl:7200})]);
 let persistence=writes.every(x=>x.status==='fulfilled');
 try{if(options.onAck)await options.onAck(item,proof,ack,clock(),doc);}catch(_e){persistence=false;}
 if(!persistence)output.status='ACK_RECEIPT_PERSISTENCE_PARTIAL';
 output.receipt_persistence_verified=persistence;output.device_receipt_verified=false;output.hourly={...hourly};return output;
 }finally{
  const decidedAt=clock();output.delivery_phase_completed_at_ms=decidedAt;
  // Post-decision work also runs on source failure. Only time-based expiry is
  // allowed without a valid current packet; no new directional breach is invented.
  try{
   state.v30ActualForecasts=v30Settle(state.v30ActualForecasts||[],Array.isArray(doc?.outcome_quotes)?doc.outcome_quotes:[],clock());
   state.v30ActualForecasts=v31SettleMinute(state.v30ActualForecasts,Array.isArray(doc?.outcome_candles)?doc.outcome_candles:[],clock());
   output.actual_alert_outcomes={...v30OutcomeSummary(state.v30ActualForecasts),minute_close_proxies:v31MinuteSummary(state.v30ActualForecasts)};
   output.signal_lifecycle=await v35Reconcile(state,doc||{followups:[]},{clock,edit:options.editStatus});
   output.post_delivery_audit_status='COMPLETED';
  }catch(_e){output.post_delivery_audit_status='FAILED';}
  output.status_updates_after_delivery_decision=true;
  output.post_delivery_housekeeping_ms=clock()-decidedAt;
 }
}
export {v30ReadPacket,v30ReviewAndDeliver,v30ConsumePermit,v30FormatSignal};
