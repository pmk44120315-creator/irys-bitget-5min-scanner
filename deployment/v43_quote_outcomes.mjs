/** Real public quote outcomes for server-acknowledged signals. Not account PnL.
 * A late quote stays late/missing; no minute close is relabeled as bid/ask.
 */
export const QUOTE_VERSION='V43_ACTUAL_ACK_STREAM_QUOTES_V1';
export const HORIZONS=[5,15,30,60];
const finite=x=>typeof x==='number'&&Number.isFinite(x),clock=x=>Number.isSafeInteger(x)&&x>=0;
const id=e=>[e.venue,e.symbol,e.issued_at_ms].join(':');
function valid(e){return e?.api_ack_recorded===true&&e.actual_execution_verified===false&&clock(e.issued_at_ms)&&
 (e.venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(e.symbol)&&['LONG','SHORT'].includes(e.direction):e.venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(e.symbol)&&e.direction==='BUY')&&
 finite(e.entry_quote?.bid)&&finite(e.entry_quote?.ask)&&e.entry_quote.bid>0&&e.entry_quote.ask>=e.entry_quote.bid&&clock(e.entry_quote.at_ms)&&e.entry_quote.at_ms<=e.issued_at_ms;}
const fingerprint=e=>JSON.stringify([e.venue,e.symbol,e.direction,e.issued_at_ms,e.entry_quote]);
export class QuoteOutcomeTracker{
 constructor(old=null,{target_tolerance_ms=5000}={}){
  if(!clock(target_tolerance_ms)||target_tolerance_ms>60000)throw Error('TARGET_TOLERANCE');
  this.tolerance=target_tolerance_ms;this.events=new Map();this.latestQuotes=new Map();
  if(old!==null){if(old.version!==QUOTE_VERSION||!Array.isArray(old.events)||old.target_tolerance_ms!==target_tolerance_ms)throw Error('EXISTING_QUOTE_SCHEMA');
   for(const e of old.events){if(!valid(e)||!e.quote_outcomes||!e.observed_path||this.events.has(id(e)))throw Error('EXISTING_ACK_SCHEMA');
    for(const [h,v] of Object.entries(e.quote_outcomes))if(v.status==='MEASURED_WS_QUOTE'){
     const target=e.issued_at_ms+Number(h)*60000;
     if(!HORIZONS.includes(Number(h))||v.target_ms!==target||!clock(v.provider_at_ms)||v.provider_at_ms<target||v.provider_at_ms-target>target_tolerance_ms||
      !clock(v.received_at_ms)||v.received_at_ms<v.provider_at_ms||v.actual_execution_verified!==false||
      !finite(v.signed_quote_return_pct)||!finite(v.exit_quote?.bid)||!finite(v.exit_quote?.ask))throw Error('PERSISTED_MEASUREMENT_SCHEMA');
    }
    this.events.set(id(e),structuredClone(e));}}
 }
 addHistory(history,now){
  if(history?.version!=='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'||history.private_messages_exported!==false||!Array.isArray(history.records)||!clock(now))throw Error('ACK_HISTORY_SCHEMA');
  for(const r of history.records){
   if(!valid(r)||r.issued_at_ms>now)throw Error('INVALID_ACTUAL_ACK');
   const clean={venue:r.venue,symbol:r.symbol,direction:r.direction,issued_at_ms:r.issued_at_ms,
    entry_quote:{bid:r.entry_quote.bid,ask:r.entry_quote.ask,at_ms:r.entry_quote.at_ms},api_ack_recorded:true,actual_execution_verified:false};
   const old=this.events.get(id(r));if(old){if(fingerprint(old)!==fingerprint(clean))throw Error('CONFLICTING_ACK_ENTRY');continue;}
   if(finite(r.invalidation_reference)&&r.invalidation_reference>0)clean.invalidation_reference=r.invalidation_reference;
   clean.id=id(clean);clean.quote_outcomes={};clean.observed_path={quote_observations:0,first_quote_ms:null,last_quote_ms:null,
    coverage_start_delay_ms:null,max_observed_quote_gap_ms:0,segments:[],max_favorable_pct:null,max_adverse_pct:null,
    first_observed_touch:null,complete_tick_path_verified:false};
   this.events.set(clean.id,clean);
  }
 }
 observe(q,now){
  if(q?.kind!=='book'||!clock(q.at_ms)||!clock(q.at_us)||!clock(q.received_at_ms)||!clock(now)||q.at_ms>q.received_at_ms||q.received_at_ms>now)throw Error('QUOTE_CLOCK');
  if(!finite(q.bid)||!finite(q.ask)||q.bid<=0||q.ask<q.bid)throw Error('QUOTE_VALUE');
  const key=q.venue+':'+q.symbol,last=this.latestQuotes.get(key);
  if(last&&q.at_us<last.at_us)return;
  if(last&&q.at_us===last.at_us){
   const ordered=q.sequence!=null&&last.sequence!=null&&/^\d+$/.test(String(q.sequence))&&/^\d+$/.test(String(last.sequence));
   if(ordered&&BigInt(q.sequence)<BigInt(last.sequence))return;
   if(!ordered||BigInt(q.sequence)===BigInt(last.sequence)){if(q.bid===last.bid&&q.ask===last.ask)return;throw Error('QUOTE_SOURCE_CONFLICT');}
  }
  this.latestQuotes.set(key,{at_us:q.at_us,bid:q.bid,ask:q.ask,sequence:q.sequence??null});
  for(const e of this.events.values()){
   if(e.venue!==q.venue||e.symbol!==q.symbol||q.at_ms<e.issued_at_ms||q.at_ms>e.issued_at_ms+60*60000+this.tolerance)continue;
   const short=e.direction==='SHORT',entry=short?e.entry_quote.bid:e.entry_quote.ask,exit=short?q.ask:q.bid;
   const ret=short?100*(entry-exit)/entry:100*(exit/entry-1),p=e.observed_path;
   if(p.first_quote_ms===null){p.first_quote_ms=q.at_ms;p.coverage_start_delay_ms=q.at_ms-e.issued_at_ms;}
   if(p.last_quote_ms!==null)p.max_observed_quote_gap_ms=Math.max(p.max_observed_quote_gap_ms,q.at_ms-p.last_quote_ms);
   p.last_quote_ms=q.at_ms;p.quote_observations++;if(!p.segments.includes(q.segment??'UNSPECIFIED'))p.segments.push(q.segment??'UNSPECIFIED');
   p.max_favorable_pct=p.max_favorable_pct===null?ret:Math.max(p.max_favorable_pct,ret);
   p.max_adverse_pct=p.max_adverse_pct===null?ret:Math.min(p.max_adverse_pct,ret);
   const inv=e.invalidation_reference,validRef=finite(inv)&&(short?inv>entry:inv<entry);
   if(validRef&&p.first_observed_touch===null){
    const risk=Math.abs(inv-entry),broken=short?exit>=inv:exit<=inv,reached=short?exit<=entry-risk:exit>=entry+risk;
    if(broken||reached)p.first_observed_touch={kind:broken?'REFERENCE_BREAK':'FAVORABLE_EQUAL_REFERENCE_DISTANCE',at_ms:q.at_ms,exit_quote:exit,
      observed_only:true,full_path_order_verified:false,coverage_start_delay_ms:p.coverage_start_delay_ms,segment:q.segment??'UNSPECIFIED'};
   }
   for(const h of HORIZONS){
    if(e.quote_outcomes[h]?.status==='MEASURED_WS_QUOTE')continue;
    const target=e.issued_at_ms+h*60000,delay=q.at_ms-target;
    if(delay<0)continue;
    if(delay>this.tolerance){if(!e.quote_outcomes[h]?.first_late_quote)e.quote_outcomes[h]={status:'UNMEASURED_TARGET_GAP',target_ms:target,
      first_late_quote:{at_ms:q.at_ms,delay_ms:delay,bid:q.bid,ask:q.ask},actual_execution_verified:false};continue;}
    e.quote_outcomes[h]={status:'MEASURED_WS_QUOTE',target_ms:target,target_delay_ms:delay,
     provider_at_ms:q.at_ms,received_at_ms:q.received_at_ms,source_segment:q.segment??'UNSPECIFIED',
     entry_reference:entry,exit_quote:{bid:q.bid,ask:q.ask,at_ms:q.at_ms,at_us:q.at_us},signed_quote_return_pct:ret,
     signed_mid_change_pct:(short?-1:1)*100*((q.bid+q.ask)/(e.entry_quote.bid+e.entry_quote.ask)-1),
     after_assumed_0_20pct_cost:ret-.2,fee_schedule_verified:false,actual_execution_verified:false,
     liquidity_size_and_fills_verified:false};
   }
  }
 }
 export(now){
  if(!clock(now))throw Error('ASOF_CLOCK');
  const events=[...this.events.values()].map(e=>{const r=structuredClone(e);for(const h of HORIZONS){
   if(!r.quote_outcomes[h]||r.quote_outcomes[h].status==='PENDING_HORIZON')r.quote_outcomes[h]={status:now>r.issued_at_ms+h*60000+this.tolerance?'UNMEASURED_TARGET_GAP':'PENDING_HORIZON',target_ms:r.issued_at_ms+h*60000,actual_execution_verified:false};
  }return r;}).sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id));
  const horizons={};for(const h of HORIZONS){const measured=events.filter(e=>e.quote_outcomes[h]?.status==='MEASURED_WS_QUOTE');horizons[h]={measured:measured.length,
    quote_positive:measured.filter(e=>e.quote_outcomes[h].signed_quote_return_pct>0).length,
    missing:events.filter(e=>e.quote_outcomes[h]?.status==='UNMEASURED_TARGET_GAP').length,
    pending:events.filter(e=>e.quote_outcomes[h]?.status==='PENDING_HORIZON').length};}
  return {version:QUOTE_VERSION,asof_ms:now,target_tolerance_ms:this.tolerance,events,summary:{actual_ack_records:events.length,horizons},
    actual_execution_verified:false,all_history_covered:false,orders_sent:false,telegram_sent:false};
 }
}
