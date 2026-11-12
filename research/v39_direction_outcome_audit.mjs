import {researchClose,cohortConvention} from '../deployment/v48_downstream_clock.mjs';
/** V39. Pure, read-only causal audit of already frozen public V36 direction cases.
 * Does not generate live entries, orders, Telegram messages, or deployment permission.
 * A quote->later candle comparison is not an executable trade or net profitability.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const H=[5,15,30,60],DAY=86400000,HOUR=3600000,MINUTE=60000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const directions=(v,d)=>v==='bitget'?['LONG','SHORT'].includes(d):v==='bithumb'&&d==='BUY';
const other=(venue,d)=>venue==='bitget'?(d==='LONG'?'SHORT':'LONG'):null;
const frozenAlternative=(e,name)=>{
 const r=e.direction_response;
 return r?.version==='IRYS_DIRECTION_RESPONSE_RESEARCH_V1' &&
 r.decided_at_ms===e.issued_at_ms && r.source_observed_at_ms<=e.issued_at_ms &&
 r.venue===e.venue && r.symbol===e.symbol &&
 r.baseline_direction===e.direction && r.trade_permission===false ?
 r.hypotheses?.[name]??null:null;
};
const preDecisionFlow=e=>{
 const h=e.observed_hypothesis,f=h?.evidence;
 if(h?.status!=='OBSERVED'||!Number.isSafeInteger(h.observed_at_ms)||h.observed_at_ms>e.issued_at_ms||
 !finite(f?.first_buy_share)||!finite(f?.new_buy_share)||
 f.first_buy_share<0||f.first_buy_share>1||f.new_buy_share<0||f.new_buy_share>1)return null;
 return f;
};
const flowShift=e=>{
 const f=preDecisionFlow(e);if(!f||f.new_buy_share===f.first_buy_share)return null;
 return e.venue==='bitget'?(f.new_buy_share>f.first_buy_share?'LONG':'SHORT'):(f.new_buy_share>f.first_buy_share?'BUY':null);
};
const impactDecay=e=>{
 const f=preDecisionFlow(e);
 if(!f||!finite(f.first_response_pct)||!finite(f.new_response_pct)||
 !finite(f.spread_pct)||f.spread_pct<0||f.new_response_pct===f.first_response_pct)return null;
 // Existing evidence responses are already signed in the candidate's direction.
 // A weakening signed price reaction is a research reversal hypothesis, not a live signal.
 return f.new_response_pct<f.first_response_pct?other(e.venue,e.direction):e.direction;
};
const policies={
 baseline:e=>e.direction,
 opposite_futures:e=>other(e.venue,e.direction),
 price_response:e=>frozenAlternative(e,'price_response'),
 flow_follow:e=>frozenAlternative(e,'flow_follow'),
 agreement:e=>frozenAlternative(e,'agreement'),
 absorption:e=>frozenAlternative(e,'absorption'),
 pressure_shift:flowShift,
 impact_decay:impactDecay
};
function frozenValid(e,now){
 if(!e||typeof e.id!=='string'||!e.id||!directions(e.venue,e.direction)||typeof e.symbol!=='string'||
 !Number.isSafeInteger(e.issued_at_ms)||e.issued_at_ms>now||!Number.isSafeInteger(e.source_observed_at_ms)||
 e.source_observed_at_ms>e.issued_at_ms||e.time_basis!=='ACTUAL_EVALUATOR_DECISION_CLOCK')return false;
 const bid=e.original_bid,ask=e.original_ask;
 if(!finite(bid)||!finite(ask)||bid<=0||ask<bid||!finite(e.entry_price)||e.entry_price<=0)return false;
 const original=e.direction==='SHORT'?bid:ask;
 if(Math.abs(e.entry_price-original)>Math.max(1e-12,original*1e-8))return false;
 return true;
}
function observation(e,h,asof){
 if(!frozenValid(e,asof))return {status:'INVALID_PROVENANCE'};
 const target=e.issued_at_ms+h*MINUTE;
 if(asof<target)return {status:'PENDING'};
 const label=e.direction_outcomes?.[String(h)];
 if(!label||label.status!=='MEASURED_DIRECTION')return {status:'NO_MEASURED_CLOSE'};
 const closeAt=researchClose(e,label,target);
 if(label.target_ms!==target||label.close_at_ms!==closeAt||label.close_at_ms>asof||
 label.close_at_ms<=e.issued_at_ms||label.horizon_minutes!==h||label.actual_execution_verified!==false||
 label.entry_quote_reference!==e.entry_price||!finite(label.target_close)||label.target_close<=0)return {status:'INVALID_CLOSE'};
 return {status:'MEASURED',target_ms:target,close_at_ms:closeAt,close:label.target_close};
}
function referenceReturn(e,close,direction){
 const entry=direction==='SHORT'?e.original_bid:e.original_ask;
 return direction==='SHORT'?100*(entry-close)/entry:100*(close/entry-1);
}
function summarize(events,h,asof,policy,extra=()=>true){
 const x={eligible:0,measured:0,unmeasured:0,abstained:0,pending:0,invalid:0,coverage:0,correct:0,wrong:0,flat:0,
 gross_mean_pct:null,illustrative_cost_net_mean_pct:null,baseline_same_cases_correct:0,baseline_same_cases_wrong:0,
 baseline_same_cases_gross_mean_pct:null,directional_hit_rate:null,distinct_symbols:0,distinct_hour_buckets:0,distinct_days:0,
 no_private_orders:true,illustrative_extra_cost_pct:0.20,independent_samples_proven:false};
 let gross=0,baseGross=0;const syms=new Set(),hours=new Set(),days=new Set();
 for(const e of events){
  if(!frozenValid(e,asof)||!extra(e))continue;
  x.eligible++;
  const label=observation(e,h,asof);
  if(label.status==='PENDING'){x.pending++;continue;}
  if(label.status==='NO_MEASURED_CLOSE'){x.unmeasured++;continue;}
  if(label.status!=='MEASURED'){x.invalid++;continue;}
  const d=policy(e);
  if(!directions(e.venue,d)){x.abstained++;continue;}
  const g=referenceReturn(e,label.close,d),b=referenceReturn(e,label.close,e.direction);
  if(!finite(g)||!finite(b)){x.invalid++;continue;}
  x.measured++;gross+=g;baseGross+=b;
  x[g>0?'correct':g<0?'wrong':'flat']++;x[b>0?'baseline_same_cases_correct':'baseline_same_cases_wrong']+=b!==0?1:0;
  syms.add(e.venue+':'+e.symbol);hours.add(Math.floor(e.issued_at_ms/HOUR));days.add(Math.floor(e.issued_at_ms/DAY));
 }
 x.coverage=x.eligible?x.measured/x.eligible:0;
 x.directional_hit_rate=x.correct+x.wrong?x.correct/(x.correct+x.wrong):null;
 x.gross_mean_pct=x.measured?gross/x.measured:null;
 x.illustrative_cost_net_mean_pct=x.measured?(gross/x.measured-.20):null;
 x.baseline_same_cases_gross_mean_pct=x.measured?baseGross/x.measured:null;
 x.distinct_symbols=syms.size;x.distinct_hour_buckets=hours.size;x.distinct_days=days.size;
 return x;
}
function audit(events,asof){
 if(!Array.isArray(events)||!Number.isSafeInteger(asof))throw new TypeError('INVALID_AUDIT_INPUT');
 const horizon_reference=cohortConvention(events);
 const ids=new Set(),conflicts=new Set(),seen=new Map();
 for(const e of events){if(typeof e?.id!=='string'||!e.id)continue;
  const sig=[e.venue,e.symbol,e.direction,e.issued_at_ms,e.entry_price,e.source_observed_at_ms].join('|');
  if(seen.has(e.id)&&seen.get(e.id)!==sig)conflicts.add(e.id);else seen.set(e.id,sig);
 }
 const filtered=[],invalid={provenance:0,duplicate:0,conflicting_duplicate:0};
 for(const e of events){if(!frozenValid(e,asof)){invalid.provenance++;continue;}
  if(conflicts.has(e.id)){invalid.conflicting_duplicate++;continue;}
  if(ids.has(e.id)){invalid.duplicate++;continue;}ids.add(e.id);filtered.push(e);
 }
 const sorted=[...filtered].sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id));
 const min=sorted.at(0)?.issued_at_ms??null,max=sorted.at(-1)?.issued_at_ms??null;
 // Chronological split; 60-minute embargo before each evaluation boundary.
 const cutA=sorted[Math.floor(sorted.length*.60)]?.issued_at_ms??0;
 const cutB=sorted[Math.floor(sorted.length*.80)]?.issued_at_ms??0;
 const parts={
  training:e=>e.issued_at_ms<=cutA-HOUR,
  validation:e=>e.issued_at_ms>=cutA&&e.issued_at_ms<=cutB-HOUR,
  holdout:e=>e.issued_at_ms>=cutB
 };
 const reports={};
 for(const h of H){
  const perPolicy={};
  for(const [name,fn] of Object.entries(policies)){
   perPolicy[name]={all:summarize(sorted,h,asof,fn),
    ...Object.fromEntries(Object.entries(parts).map(([split,match])=>[split,summarize(sorted,h,asof,fn,match)]))};
  }
  reports[String(h)]=perPolicy;
 }
 const breakdown={};
 for(const v of ['bithumb','bitget'])for(const d of v==='bithumb'?['BUY']:['LONG','SHORT']){
  const subset=sorted.filter(e=>e.venue===v&&e.direction===d);
  breakdown[v+':'+d]={cases:subset.length,
   evidence_observed:subset.filter(e=>e.observed_hypothesis?.status==='OBSERVED').length,
   evidence_unconfirmed:subset.filter(e=>e.observed_hypothesis?.status!=='OBSERVED').length,
   original_5m:summarize(subset,5,asof,policies.baseline),
   inverse_5m:summarize(subset,5,asof,policies.opposite_futures),
   price_response_5m:summarize(subset,5,asof,policies.price_response)};
 }
 const count=method=>sorted.filter(e=>directions(e.venue,policies[method](e))).length;
 return {
  version:'IRYS_V39_FROZEN_DIRECTION_CAUSAL_AUDIT_V1',horizon_reference,asof_ms:asof,strict_input_before_outcome:true,
  research_only:true,telegram_sent:false,orders_sent:false,live_model_changed:false,auto_promote:false,
  actual_fills_verified:false,fee_schedule_verified:false,statistical_significance_proven:false,
  invalid,records_total:events.length,records_eligible:sorted.length,first_issued_at_ms:min,last_issued_at_ms:max,
  cut_train_at_ms:cutA,cut_holdout_at_ms:cutB,embargo_minutes:60,
  available_frozen_predictions:Object.fromEntries(Object.keys(policies).map(k=>[k,count(k)])),
  class_breakdown:breakdown,reports,scope:'ROLLING_3000_V36_RECORDS_ONLY_NOT_V35_TELEGRAM_ACCURACY',
  warning:'Quote-to-1m-close proxy, no fills; exploration not model selection; same-symbol and neighboring events are dependent'};
}
function main(){
 const state=JSON.parse(readFileSync('data/v36_shadow_state.json','utf8'));
 const now=Date.now();const out=audit(state.events||[],now);
 mkdirSync('v39_direction_audit',{recursive:true});
 writeFileSync('v39_direction_audit/result.json',JSON.stringify(out,null,2));
 const abr=Object.fromEntries(Object.entries(out.reports['5']).map(([k,v])=>[k,{all:v.all,holdout:v.holdout}]));
 const byHorizon=Object.fromEntries(Object.entries(out.reports).map(([h,methods])=>[h,
   Object.fromEntries(Object.entries(methods).map(([name,p])=>[name,{
     all:{measured:p.all.measured,correct:p.all.correct,wrong:p.all.wrong,mean_ref_pct:p.all.gross_mean_pct,illustrative_net_pct:p.all.illustrative_cost_net_mean_pct},
     holdout:{measured:p.holdout.measured,correct:p.holdout.correct,wrong:p.holdout.wrong,mean_ref_pct:p.holdout.gross_mean_pct,illustrative_net_pct:p.holdout.illustrative_cost_net_mean_pct}
   }]))]));
 console.log('V39_HORIZON_MATRIX',JSON.stringify(byHorizon));
 console.log('V39_DIRECTION_AUDIT',JSON.stringify({at_ms:now,records:out.records_total,eligible:out.records_eligible,
   invalid:out.invalid,frozen:out.available_frozen_predictions,class_breakdown:out.class_breakdown,five_minute:abr}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
export {audit,observation,referenceReturn,summarize,policies};
