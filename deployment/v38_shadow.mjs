/** V38 independent prospectively frozen hypotheses. Never sends orders or Telegram. */
const V38_LEDGER_VERSION='V38_EARLY_REACCEL_PROSPECTIVE_LEDGER_V1';
const STEP=300000,LIMIT=2000;
const num=x=>typeof x==='number'&&Number.isFinite(x);
const good=x=>num(x)&&x>0;
function v38Enroll(old={},observations=[],now){
 const state={version:V38_LEDGER_VERSION,events:structuredClone(Array.isArray(old.events)?old.events:[]),asof_ms:now};
 const added=[],seen=new Set(state.events.map(x=>x.id));
 if(!Number.isSafeInteger(now)||!Array.isArray(observations))return {status:'SOURCE_INVALID',state,added};
 for(const x of observations){
  if(!x||!['EARLY_TURN_WATCH','EARLY_RECLAIM'].includes(x.status)||
    x.version!=='V38_EARLY_PULLBACK_CONTINUATION_SHADOW_V1'||x.source!=='ONLY_CLOSED_5M_PUBLIC_CANDLES'||
    x.trade_permit!==false||!['bitget','bithumb'].includes(x.venue)||typeof x.symbol!=='string'||
    !['LONG','SHORT','BUY'].includes(x.direction)||x.venue==='bithumb'&&x.direction!=='BUY'||
    !Number.isSafeInteger(x.signal_closed_at_ms)||!Number.isSafeInteger(x.evaluated_at_ms)||
    x.evaluated_at_ms>now||x.signal_closed_at_ms>x.evaluated_at_ms||
    now-x.signal_closed_at_ms>STEP+90000||
    !good(x.close_reference)||!good(x.previous_impulse_high)||!good(x.stop_reference)||
    !Number.isSafeInteger(x.impulse_peak_at_ms)||x.impulse_peak_at_ms>=x.signal_closed_at_ms)continue;
  const id=['V38',x.venue,x.symbol,x.direction,x.impulse_peak_at_ms].join(':');
  if(seen.has(id))continue;seen.add(id);
  const record={id,version:V38_LEDGER_VERSION,venue:x.venue,symbol:x.symbol,direction:x.direction,
   phase:x.status,issued_at_ms:now,source_closed_at_ms:x.signal_closed_at_ms,
   source_to_selection_delay_ms:now-x.signal_closed_at_ms,time_basis:'ACTUAL_GITHUB_EVALUATOR_TIME',
   entry_reference_is_executable:false,entry_close_proxy:x.close_reference,
   prior_peak_reference:x.previous_impulse_high,stop_proxy:x.stop_reference,
   prior_high_reward_risk_proxy:x.prior_high_reward_risk,
   turnover_ratio:x.turnover_ratio,turnover_is_not_cvd:true,source:'PUBLIC_CLOSED_5M_BITGET_RESEARCH',
   trade_permit:false,telegram_sent:false,actual_execution_verified:false,
   future_accuracy_proven:false,outcomes:{}};
  state.events.push(record);added.push(record);
 }
 state.events=state.events.slice(-LIMIT);
 return {status:'OBSERVED',state,added};
}
function v38Settle(old={},pages=[],now){
 const state={version:V38_LEDGER_VERSION,events:structuredClone(Array.isArray(old.events)?old.events:[]),asof_ms:now};
 if(!Number.isSafeInteger(now))return state;
 const by=new Map();
 for(const p of Array.isArray(pages)?pages:[]){
  if(p?.source!=='OFFICIAL_NATIVE_5M'||!Number.isSafeInteger(p.fetched_at_ms)||p.fetched_at_ms>now||!Array.isArray(p.bars))continue;
  by.set(p.venue+':'+p.symbol,p);
 }
 for(const e of state.events){
  if(e.time_basis!=='ACTUAL_GITHUB_EVALUATOR_TIME'||!Number.isSafeInteger(e.issued_at_ms)||e.issued_at_ms>now)continue;
  const page=by.get(e.venue+':'+e.symbol);e.outcomes??={};
  const eligible=page?.bars?.filter(b=>Number.isSafeInteger(b.start_ms)&&b.start_ms%STEP===0&&
    b.start_ms>=Math.ceil(e.issued_at_ms/STEP)*STEP&&b.start_ms+STEP<=now&&
    [b.open,b.high,b.low,b.close].every(good)&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close))||[];
  for(const h of [5,15,30,60]){
   const key=String(h);if(e.outcomes[key]?.status==='MEASURED_CLOSE_PROXY')continue;
   const target=e.issued_at_ms+h*60000;
   if(now<target)continue;
   const rows=eligible.filter(b=>b.start_ms+STEP>=target&&b.start_ms+STEP<=target+STEP).sort((a,b)=>a.start_ms-b.start_ms);
   const first=rows[0];const conflicting=first&&rows.filter(b=>b.start_ms===first.start_ms).length>1;
   if(first&&!conflicting){
    const b=first,sign=e.direction==='SHORT'?-1:1,change=sign*100*(b.close/e.entry_close_proxy-1);
    const relevant=eligible.filter(z=>z.start_ms+STEP<=b.start_ms+STEP);
    const maxFav=relevant.length?sign===1?Math.max(...relevant.map(z=>z.high)):Math.min(...relevant.map(z=>z.low)):null;
    const maxAdv=relevant.length?sign===1?Math.min(...relevant.map(z=>z.low)):Math.max(...relevant.map(z=>z.high)):null;
    e.outcomes[key]={status:'MEASURED_CLOSE_PROXY',horizon_minutes:h,measured_close_at_ms:b.start_ms+STEP,
     signed_direction_pct:change,future_price_direction_positive:change>0,
     max_favorable_pct:maxFav===null?null:sign*100*(maxFav/e.entry_close_proxy-1),
     max_adverse_pct:maxAdv===null?null:sign*100*(maxAdv/e.entry_close_proxy-1),
     cost_included:false,actual_execution_verified:false,ambiguous_within_candle:true};
   }else if(now>target+STEP)e.outcomes[key]={status:conflicting?'AMBIGUOUS_DUPLICATE':'UNMEASURED_NO_CANDLE',actual_execution_verified:false};
  }
 }
 return state;
}
function v38Summary(state={}){
 const records=Array.isArray(state.events)?state.events:[],out={version:V38_LEDGER_VERSION,events:records.length,
  watches:records.filter(x=>x.phase==='EARLY_TURN_WATCH').length,reclaims:records.filter(x=>x.phase==='EARLY_RECLAIM').length,
  actual_telegram_messages:0,orders_sent:false,promote:false,future_accuracy_proven:false,comparison_to_v35_proven:false,horizons:{},directions:{}};
 for(const h of [5,15,30,60]){
  const results=records.map(x=>x.outcomes?.[h]),measured=results.filter(x=>x?.status==='MEASURED_CLOSE_PROXY');
  out.horizons[String(h)]={measured:measured.length,direction_positive:measured.filter(x=>x.future_price_direction_positive).length,
    missing:results.filter(x=>x?.status==='UNMEASURED_NO_CANDLE'||x?.status==='AMBIGUOUS_DUPLICATE').length,
    pending:results.filter(x=>!x).length};
 }
 for(const dir of ['LONG','SHORT','BUY']){
  const xs=records.filter(x=>x.direction===dir),z=xs.map(x=>x.outcomes?.['5']).filter(x=>x?.status==='MEASURED_CLOSE_PROXY');
  out.directions[dir]={observations:xs.length,measured5:z.length,positive5:z.filter(x=>x.future_price_direction_positive).length};
 }
 return out;
}
export {V38_LEDGER_VERSION,v38Enroll,v38Settle,v38Summary};
