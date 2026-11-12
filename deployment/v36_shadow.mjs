import {V48_MEASUREMENT_VERSION,v48MigrateEvent,v48MergeNativePages,v48Measured} from './v48_measurement.mjs';
/** Immutable prospective shadow. Never sends market alerts or orders. */
import {v36Evidence} from './v36_hypotheses.mjs';
import {directionResponseHypotheses} from './direction_response_research.mjs';
import {v36Freeze,v36FreezeQuoteOnly,v36Label,v36LabelClose} from './v36_paths.mjs';
const V36_VERSION='V36_CONTRA_PROSPECTIVE_SHADOW_V1',MAX_EVENTS=3000,EPISODE_MS=1800000;
const key=e=>`${e.venue}:${e.symbol}:${e.direction}:${Math.floor(e.issued_at_ms/EPISODE_MS)}`;
function validPacket(p,now,digest){
 return Number.isSafeInteger(now)&&p?.version==='IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1'&&p?.source==='OFFICIAL_PUBLIC_RUNNER'&&p.model_digest===digest&&
 p.orders_sent===false&&p.telegram_sent===false&&Array.isArray(p.items)&&Number.isSafeInteger(p.at_ms)&&p.at_ms<=now&&now-p.at_ms<=90000&&
 Number.isSafeInteger(p.started_at_ms)&&p.started_at_ms<=p.at_ms;
}
function v36Observe(old={}, {packet,now,baselineDigest,benchmark=null}={}){
 const state={version:V36_VERSION,events:Array.isArray(old.events)?structuredClone(old.events):[],last_asof_ms:old.last_asof_ms||0};
 if(!validPacket(packet,now,baselineDigest))return {status:'SOURCE_NOT_ELIGIBLE',events:[],state,source_asof_ms:packet?.at_ms??null};
 if(packet.at_ms<=state.last_asof_ms)return {status:'SOURCE_ALREADY_OBSERVED',events:[],state,source_asof_ms:packet.at_ms};
 const ids=new Set(state.events.map(e=>e.id)),added=[];
 for(const item of packet.items){
  const frozen=v36Freeze(item,now)||v36FreezeQuoteOnly(item,now);if(!frozen)continue;
  const evidence=v36Evidence(item,now,benchmark||{});
  const id=key(frozen);if(ids.has(id))continue;ids.add(id);
  const rec={...frozen,id,observed_hypothesis:evidence,direction_response:directionResponseHypotheses({...evidence,venue:frozen.venue,symbol:frozen.symbol,direction:frozen.direction},now),baseline_model_digest:packet.model_digest,
   time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',source_observed_at_ms:packet.at_ms,
   source_to_decision_latency_ms:now-packet.at_ms,source_quote_at_ms:item.final.quote.at_ms,
   entry_reference_is_live_executable:false,
   baseline_ready:packet.checks?.some(x=>x.venue===frozen.venue&&x.symbol===frozen.symbol&&x.direction===frozen.direction&&x.allowed===true)||false,
   outcomes:{},direction_outcomes:{},created_from_public_packet_at_ms:packet.at_ms};
  added.push(rec);state.events.push(rec);
 }
 const evicted=state.events.slice(0,Math.max(0,state.events.length-MAX_EVENTS));state.events=state.events.slice(-MAX_EVENTS);state.last_asof_ms=Math.max(state.last_asof_ms,packet.at_ms);
 return {status:'OBSERVED',events:added,state,source_asof_ms:packet.at_ms,evicted};
}
function v36Advance(old={},pages=[],now){
 const state={...structuredClone(old),version:V36_VERSION,events:structuredClone(old.events||[]),last_asof_ms:old.last_asof_ms||0,direction_measurement_version:V48_MEASUREMENT_VERSION};
 const by=v48MergeNativePages(pages,now);
 for(const e of state.events){v48MigrateEvent(e,'v36');const p=by.get(`${e.venue}:${e.symbol}`);if(!p)continue;e.outcomes??={};e.direction_outcomes??={};
  for(const h of [5,15,30,60]){
   if(e.direction_outcomes[h]?.status==='MEASURED_DIRECTION'&&!v48Measured(e,h,'direction_outcomes'))throw Error('V48_PERSISTED_OUTCOME_INVALID');
   if(e.direction_outcomes[h]?.status!=='MEASURED_DIRECTION'){
    const d=v36LabelClose(e,p.bars,Math.min(now,p.fetched_at_ms),h);
    if(d.status!=='PENDING')e.direction_outcomes[h]=d;
   }
   if(!e.barriers_locked||e.outcomes[h]&&['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT'].includes(e.outcomes[h].status))continue;
   const result=v36Label(e,p.bars,Math.min(now,p.fetched_at_ms),h);
   if(!['PENDING','PENDING_MISSING_CANDLE'].includes(result.status))e.outcomes[h]=result;
  }
 }
 return state;
}
function v36Gate({pairs=0,correct=0,total=0,baselineCorrect=0,coverage=0}={}){
 const enough=Number.isInteger(pairs)&&pairs>=300&&Number.isInteger(total)&&total>=300&&coverage>=.85;
 const lift=enough&&correct>=baselineCorrect+Math.ceil(total*.05);
 return {promote:false,eligible_for_review:!!lift,reason:!enough?'INSUFFICIENT_PROSPECTIVE_MATCHED_COVERAGE':!lift?'NO_ROBUST_SUPERIORITY':'INDEPENDENT_REVIEW_REQUIRED',
 required_manual_rollout:true};
}
function v36Summary(state){
 const events=state?.events||[],out={version:V36_VERSION,events:events.length,actual_alerts:0,signals_sent:0,orders_sent:false,auto_promote:false,directions:{}};
 const verified=events.filter(e=>e.time_basis==='ACTUAL_EVALUATOR_DECISION_CLOCK'&&Number.isSafeInteger(e.issued_at_ms)&&Number.isSafeInteger(e.source_observed_at_ms)&&e.source_observed_at_ms<=e.issued_at_ms);
 out.measurement_version=V48_MEASUREMENT_VERSION;out.legacy_outcomes_excluded=true;out.clock_verified=verified.length;out.legacy_unverified_clock=events.length-verified.length;
 out.raw_candidate_statistics_not_alert_accuracy=true;out.retained_records_only=true;
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){
  const rows=verified.filter(r=>r.venue===venue&&r.direction===direction),s={issued:rows.length,baseline_ready:rows.filter(r=>r.baseline_ready).length,horizons:{}};
  for(const h of [5,15,30,60]){
   const labels=rows.map(r=>r.outcomes?.[h]?.status),dc=rows.map(r=>r.direction_outcomes?.[h]);
   s.horizons[h]={direction_measured:rows.filter(e=>v48Measured(e,h,'direction_outcomes')).length,direction_positive:rows.filter(e=>v48Measured(e,h,'direction_outcomes')&&e.direction_outcomes[h].direction_positive).length,target_first:labels.filter(x=>x==='TARGET_FIRST').length,stop_first:labels.filter(x=>x==='STOP_FIRST').length,
    ambiguous:labels.filter(x=>x==='AMBIGUOUS_BOTH').length,no_touch:labels.filter(x=>x==='NO_TOUCH_TIMEOUT').length,
    missing:labels.filter(x=>x?.startsWith('UNMEASURED')||x==='CONFLICTING_CANDLES').length,
    pending:labels.filter(x=>!x||x==='PENDING').length};
  }
  out.directions[`${venue}:${direction}`]=s;
 }return out;
}
export {V36_VERSION,v36Observe,v36Advance,v36Gate,v36Summary};
