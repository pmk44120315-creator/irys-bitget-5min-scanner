/** Actual server-ACK outcomes, complete retained cohort, immutable future labels.
 * No private Telegram reads or orders. OHLC paths exclude the partial ACK minute.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseBars} from './v39_latest_ack_replay.mjs';
const VERSION='V42_COMPLETE_ACTUAL_ACK_OUTCOMES_V1',H=[5,15,30,60],MIN=60000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clock=x=>Number.isSafeInteger(x)&&x>=0;
function valid(r,now){return r?.api_ack_recorded===true&&r.actual_execution_verified===false&&clock(r.issued_at_ms)&&r.issued_at_ms<=now&&
 typeof r.symbol==='string'&&(r.venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(r.symbol)&&['LONG','SHORT'].includes(r.direction):r.venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(r.symbol)&&r.direction==='BUY')&&
 finite(r.entry_quote?.bid)&&finite(r.entry_quote?.ask)&&r.entry_quote.bid>0&&r.entry_quote.ask>=r.entry_quote.bid&&clock(r.entry_quote.at_ms)&&r.entry_quote.at_ms<=r.issued_at_ms;}
function identity(r){return [r.venue,r.symbol,r.issued_at_ms].join(':');}
function fingerprint(r){return JSON.stringify([r.venue,r.symbol,r.direction,r.issued_at_ms,r.entry_quote.bid,r.entry_quote.ask,r.entry_quote.at_ms]);}
async function publicRead(url){const u=new URL(url);if(u.protocol!=='https:'||!['api.bitget.com','api.bithumb.com'].includes(u.hostname))throw Error('UNAPPROVED_PUBLIC_HOST');
 const r=await fetch(u,{headers:{accept:'application/json','User-Agent':'IRYS-V42-actual-ACK-evaluation'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('PUBLIC_HTTP_'+r.status);return r.json();}
function summary(events,now){const horizons={};for(const h of H){const all=events.map(e=>e.outcomes?.[h]);const m=all.filter(o=>o?.status==='MEASURED_MINUTE_CLOSE_PROXY');
 horizons[h]={measured:m.length,directional_positive:m.filter(o=>o.signed_price_pct>0).length,flat:m.filter(o=>o.signed_price_pct===0).length,
 pending:events.filter(e=>now<Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN).length,missing:events.filter(e=>now>=Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN&&e.outcomes?.[h]?.status!=='MEASURED_MINUTE_CLOSE_PROXY').length,
 mean_signed_price_pct:m.length?m.reduce((a,b)=>a+b.signed_price_pct,0)/m.length:null};}
 return {actual_ack_records:events.length,horizons,all_time_capture_complete:false,actual_execution_verified:false,
 new_dispatch_revalidated:events.filter(e=>e.dispatch_revalidated===true).length,legacy_quote_basis:events.filter(e=>!e.dispatch_revalidated).length};}
async function evaluateAckHistory({history,old=null,now=Date.now(),read=publicRead}={}){
 if(!clock(now)||history?.version!=='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'||history.scope!=='ALL_RETAINED_SERVER_ACK_RECORDS_NOT_ACCOUNT_TRADES'||history.private_messages_exported!==false||!Array.isArray(history.records)||!clock(history.asof_ms)||history.asof_ms>now)throw Error('INVALID_PUBLIC_ACK_HISTORY');
 if(old!==null&&(old.version!==VERSION||!Array.isArray(old.events)))throw Error('EXISTING_EVIDENCE_SCHEMA_INVALID');
 const diagnostics={invalid:0,conflicts:0,provider_errors:0,new_events:0,labels_added:0},seen=new Map(),conflicts=new Set(),map=new Map();
 for(const r of history.records){if(!valid(r,now)){diagnostics.invalid++;continue;}const key=identity(r),fp=fingerprint(r);if(seen.has(key)&&seen.get(key)!==fp)conflicts.add(key);else seen.set(key,fp);}
 for(const e of old?.events||[]){if(!valid(e,now))throw Error('INVALID_PERSISTED_ACK_RECORD');map.set(identity(e),structuredClone(e));}
 for(const r of history.records){if(!valid(r,now))continue;const id=identity(r);if(conflicts.has(id)){diagnostics.conflicts++;continue;}
  const existing=map.get(id);if(existing&&fingerprint(existing)!==fingerprint(r)){diagnostics.conflicts++;continue;}
  if(!existing){const e={id,venue:r.venue,symbol:r.symbol,direction:r.direction,issued_at_ms:r.issued_at_ms,
    entry_quote:{bid:r.entry_quote.bid,ask:r.entry_quote.ask,at_ms:r.entry_quote.at_ms},api_ack_recorded:true,actual_execution_verified:false,
    dispatch_revalidated:r.dispatch_snapshot?.version==='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1',reference_quote_age_ms:r.issued_at_ms-r.entry_quote.at_ms,
    outcomes:{}};if(finite(r.invalidation_reference)&&r.invalidation_reference>0)e.invalidation_reference=r.invalidation_reference;
   map.set(id,e);diagnostics.new_events++;}
 }
 for(const e of map.values()){
  const missing=H.filter(h=>now>=Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN&&e.outcomes[h]?.status!=='MEASURED_MINUTE_CLOSE_PROXY');
  for(const h of H)if(!e.outcomes[h]&&now<Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN)e.outcomes[h]={status:'PENDING_HORIZON'};
  if(!missing.length)continue;
  const end=Math.min(Math.floor(now/MIN)*MIN,e.issued_at_ms+62*MIN);let url;
  if(e.venue==='bitget')url='https://api.bitget.com/api/v2/mix/market/history-candles?'+new URLSearchParams({symbol:e.symbol,productType:'USDT-FUTURES',granularity:'1m',endTime:String(end),limit:'160'});
  else url='https://api.bithumb.com/v1/candles/minutes/1?'+new URLSearchParams({market:e.symbol,to:new Date(end+9*3600000).toISOString().slice(0,19),count:'160'});
  try{
   const raw=await read(url);if(e.venue==='bithumb'&&Array.isArray(raw)&&raw.some(x=>x.market&&x.market!==e.symbol))throw Error('CANDLE_IDENTITY_MISMATCH');
   const parsed=parseBars(raw,e.venue,now);if(parsed.status!=='OBSERVED')throw Error('OFFICIAL_HISTORY_UNVERIFIED');
   const by=new Map(parsed.bars.map(b=>[b.start_ms,b]));
   const entry=e.direction==='SHORT'?e.entry_quote.bid:e.entry_quote.ask,sign=e.direction==='SHORT'?-1:1;
   for(const h of missing){
    const target=e.issued_at_ms+h*MIN,closeAt=Math.ceil(target/MIN)*MIN,b=by.get(closeAt-MIN);
    if(!b){e.outcomes[h]={status:'MISSING_OFFICIAL_CLOSED_MINUTE',target_ms:target};continue;}
    const signed=sign*100*(b.close/entry-1);
    const o={status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:target,closed_at_ms:closeAt,target_offset_ms:closeAt-target,
     horizon_reference:'FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET',direction:e.direction,reference_entry_bid_or_ask:entry,
     target_close:b.close,signed_price_pct:signed,positive_direction:signed>0,scenario_after_0_20pct_cost:signed-.20,
     actual_execution_verified:false};
    const full=parsed.bars.filter(b=>b.start_ms>=Math.ceil(e.issued_at_ms/MIN)*MIN&&b.start_ms<o.closed_at_ms);
    const extrema=full.flatMap(b=>[sign*100*(b.high/entry-1),sign*100*(b.low/entry-1)]);
    const invalid=finite(e.invalidation_reference)?full.find(b=>e.direction==='SHORT'?b.close>e.invalidation_reference:b.close<e.invalidation_reference):null;
    e.outcomes[h]={...o,path_minutes_observed:full.length,path_minutes_expected:Math.max(0,(o.closed_at_ms-Math.ceil(e.issued_at_ms/MIN)*MIN)/MIN),max_favorable_pct:extrema.length?Math.max(...extrema):null,max_adverse_pct:extrema.length?Math.min(...extrema):null,
     first_reference_break_close_ms:invalid?invalid.start_ms+MIN:null,path_scope:'FULL_POST_ACK_MINUTES_ONLY',intraminute_order_known:false,
     observed_extrema_are_bounds_not_complete_tick_path:true};diagnostics.labels_added++;
   }
  }catch{diagnostics.provider_errors++;for(const h of missing)e.outcomes[h]={status:'OFFICIAL_HISTORY_UNAVAILABLE',target_ms:e.issued_at_ms+h*MIN};}
 }
 const events=[...map.values()].sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id));
 return {version:VERSION,asof_ms:now,source:'PUBLIC_WORKER_RETAINED_ACTUAL_ACK_RECORDS_AND_OFFICIAL_NATIVE_CANDLES',events,diagnostics,summary:summary(events,now),
  telegram_sent:false,orders_sent:false,live_direction_accuracy_improvement_proven:false,actual_execution_verified:false};
}
async function main(){const load=p=>{try{return JSON.parse(readFileSync(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const r=await fetch('https://irys-surge-monitor.vhehwpfl.workers.dev/?v42audit='+Date.now(),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('WORKER_HEALTH_HTTP_'+r.status);
 const health=await r.json(),history=health.last?.v30DirectionalDelivery?.public_ack_history;
 const out=await evaluateAckHistory({history,old:load('data/v42_actual_ack_evaluation.json'),now:Date.now()});
 mkdirSync('v39_direction_audit',{recursive:true});writeFileSync('v39_direction_audit/v42_actual_ack_evaluation_next.json',JSON.stringify(out,null,2)+'\n');
 console.log('V42_COMPLETE_ACTUAL_ACK_EVALUATION',JSON.stringify({version:VERSION,diagnostics:out.diagnostics,summary:out.summary,
  recent:out.events.slice(-12).map(e=>({symbol:e.symbol,venue:e.venue,direction:e.direction,issued_at_ms:e.issued_at_ms,outcomes:e.outcomes}))}));
 if(out.diagnostics.conflicts)throw Error('ACTUAL_ACK_EVIDENCE_CONFLICTS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V42_ACTUAL_ACK_FAILED',String(e.message||e));process.exitCode=1;});
export {evaluateAckHistory};
