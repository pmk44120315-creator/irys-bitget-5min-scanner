/** V42 dispatch-time evidence integrity, NOT a new promise of future accuracy.
 * Public exchange GET only. Existing V30 directional, risk and pacing policies
 * remain authoritative; no stale cached fallback and no extra waiting streak.
 */
import {v29Quote} from './v29_direction_gate.mjs';
import {v30ReviewAndDeliver,v30FormatSignal} from './v30_delivery.mjs';
const V42_VERSION='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1';
const v42Clock=x=>Number.isSafeInteger(x)&&x>=0;
const v42Num=x=>typeof x==='number'&&Number.isFinite(x);
function v42Identity(venue,symbol,direction){return typeof symbol==='string'&&(venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(symbol)&&['LONG','SHORT'].includes(direction):venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(symbol)&&direction==='BUY');}
async function v42ReadFinalQuote(item,{read,clock=Date.now}={}){
 const c=item?.candidate,old=item?.final;
 if(!v42Identity(c?.venue,c?.symbol,c?.direction)||typeof read!=='function'||!v42Clock(old?.quote?.at_ms))throw Error('DISPATCH_IDENTITY_OR_READER_INVALID');
 const started=clock();let q;
 const options={headers:{accept:'application/json','cache-control':'no-cache'},cf:{cacheTtl:0}};
 if(c.venue==='bitget'){
  const r=await read('https://api.bitget.com/api/v2/mix/market/ticker?symbol='+encodeURIComponent(c.symbol)+'&productType=USDT-FUTURES',options,12000);
  const found=r?.code==='00000'&&Array.isArray(r.data)?r.data.filter(x=>x?.symbol===c.symbol):[];
  if(found.length!==1)throw Error('DISPATCH_OFFICIAL_QUOTE_IDENTITY');
  const x=found[0];q={bid:Number(x.bidPr),ask:Number(x.askPr),at_ms:Number(x.ts)};
 }else{
  const rows=await read('https://api.bithumb.com/v1/orderbook?markets='+encodeURIComponent(c.symbol),options,12000);
  const found=Array.isArray(rows)?rows.filter(x=>x?.market===c.symbol):[];
  if(found.length!==1||!found[0].orderbook_units?.[0])throw Error('DISPATCH_OFFICIAL_QUOTE_IDENTITY');
  const x=found[0],u=x.orderbook_units[0];q={bid:Number(u.bid_price),ask:Number(u.ask_price),at_ms:Number(x.timestamp)};
 }
 const finished=clock(),checked=v29Quote(q,finished,15000);
 if(!v42Clock(started)||!v42Clock(finished)||finished<started||!checked||q.at_ms<=old.quote.at_ms)throw Error('DISPATCH_OFFICIAL_QUOTE_CLOCK');
 return {...item,final:{venue:c.venue,symbol:c.symbol,observed_at_ms:finished,quote:checked},dispatch_snapshot:{version:V42_VERSION,
  provider:c.venue==='bitget'?'BITGET_OFFICIAL_BEST_QUOTE':'BITHUMB_OFFICIAL_ORDERBOOK',read_started_at_ms:started,read_completed_at_ms:finished,
  prior_quote_at_ms:old.quote.at_ms,provider_quote_at_ms:q.at_ms,prior_quote_age_ms:started-old.quote.at_ms,
  uses_new_official_quote:true,no_account_or_order_api:true}};
}
function v42SafeQuote(q){if(!q||!v42Clock(q.at_ms)||!v42Num(q.bid)||!v42Num(q.ask)||q.bid<=0||q.ask<q.bid)return null;return {bid:q.bid,ask:q.ask,at_ms:q.at_ms};}
function v42SafeOutcome(o){
 if(!o||typeof o!=='object')return null;
 const statuses=['MEASURED_PUBLIC_QUOTE','UNMEASURED_TARGET_QUOTE','MEASURED_MINUTE_CLOSE_PROXY','UNMEASURED_OFFICIAL_MINUTE','PENDING_HORIZON'];
 const out={status:statuses.includes(o.status)?o.status:'UNVERIFIED',actual_execution_verified:false};
 for(const k of ['horizon_minutes','horizon_min','target_ms','close_at_ms','closed_at_ms','target_close','entry_quote_reference','gross_reference_pct','net_cost_scenario_pct','gross_quote_pct','net_scenario_pct','at_ms','delay_ms','cost_assumption_pct','cost_scenario_pct'])if(v42Num(o[k]))out[k]=o[k];
 const q=v42SafeQuote(o.exit_quote);if(q)out.exit_quote=q;
 return out;
}
function v42PublicAckHistory(rows,now){
 const records=[],seen=new Set();let excluded=0;
 for(const r of Array.isArray(rows)?rows:[]){
  const q=v42SafeQuote(r?.entry_quote);
  if(!/^ACK:[1-9][0-9]*$/.test(r?.id||'')||!v42Identity(r?.venue,r?.symbol,r?.direction)||!v42Clock(r?.issued_at_ms)||r.issued_at_ms>now||!q||q.at_ms>r.issued_at_ms){excluded++;continue;}
  const key=[r.venue,r.symbol,r.issued_at_ms].join(':');if(seen.has(key)){excluded++;continue;}seen.add(key);
  const x={venue:r.venue,symbol:r.symbol,direction:r.direction,issued_at_ms:r.issued_at_ms,entry_quote:q,
   api_ack_recorded:true,actual_execution_verified:false,outcomes:{},minute_outcomes:{}};
  if(v42Clock(r.source_packet_at_ms))x.source_packet_at_ms=r.source_packet_at_ms;
  if(v42Num(r.invalidation_reference))x.invalidation_reference=r.invalidation_reference;
  if(r.dispatch_snapshot?.version===V42_VERSION){const d=r.dispatch_snapshot;x.dispatch_snapshot={version:V42_VERSION};for(const k of ['read_started_at_ms','read_completed_at_ms','prior_quote_at_ms','provider_quote_at_ms','prior_quote_age_ms'])if(v42Clock(d[k]))x.dispatch_snapshot[k]=d[k];}
  for(const h of [5,15,30,60]){const a=v42SafeOutcome(r.outcomes?.[h]),b=v42SafeOutcome(r.minute_outcomes?.[h]);if(a)x.outcomes[h]=a;if(b)x.minute_outcomes[h]=b;}
  records.push(x);
 }
 return {version:V42_VERSION,scope:'ALL_RETAINED_SERVER_ACK_RECORDS_NOT_ACCOUNT_TRADES',asof_ms:now,retained_ack_records:records.length,excluded,
  all_time_history_complete:false,private_messages_exported:false,device_delivery_verified:false,actual_execution_verified:false,records};
}
async function v42ReviewAndDeliver(env,state,requestedAt,options={}){
 const clock=options.clock||Date.now,stats={version:V42_VERSION,attempted:0,verified:0,rejected:0,errors:0,reason_counts:{}};
 const output=await v30ReviewAndDeliver(env,state,requestedAt,{...options,
  refreshFinalQuote:async item=>{stats.attempted++;try{return await v42ReadFinalQuote(item,{read:options.read,clock})}catch(e){stats.errors++;throw e;}},
  onDispatchRecheck:(allowed,reason)=>{stats[allowed?'verified':'rejected']++;if(reason)stats.reason_counts[reason]=(stats.reason_counts[reason]||0)+1;},
  formatSignal:(proof,now)=>v30FormatSignal(proof,now).replace('[V35 방향 근거·후속 상태 확인]','[V42 발송 직전 방향 근거 확인]').replace('독립 신규 체결·호가 2회 확인 + 최종 호가 재확인','독립 체결·호가 2회 확인 + 발송 직전 거래소 호가 재확인')});
 output.dispatch_revalidation=stats;output.public_ack_history=v42PublicAckHistory(state.v30ActualForecasts||[],clock());
 output.forecast_accuracy_proven=false;return output;
}
export {V42_VERSION,v42ReadFinalQuote,v42PublicAckHistory,v42ReviewAndDeliver};
