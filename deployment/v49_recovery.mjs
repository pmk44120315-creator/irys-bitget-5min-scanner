/** Public measurement recovery, not a trading filter. Unknown prices remain unknown.
 * A successful response missing a minute is not proof that no trade occurred.
 */
import {createHash} from 'node:crypto';
import {V48_MEASUREMENT_VERSION,V48_HORIZONS,v48ValidEvent,v48ValidIdentity,v48Measured,v48PendingMarkets} from './v48_measurement.mjs';
import {v48RecoveryPlan} from './v48_backfill.mjs';
const M=60000,VERSION='V49_BOUNDED_HISTORY_RECOVERY_V1';
const terminal=new Set(['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT']);
const clock=x=>Number.isSafeInteger(x)&&x>=0;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function valid(e,now){return v48ValidIdentity(e)&&v48ValidEvent(e,now)&&e.time_basis==='ACTUAL_EVALUATOR_DECISION_CLOCK'&&clock(e.source_observed_at_ms)&&e.source_observed_at_ms<=e.issued_at_ms;}
const closeAt=(e,h)=>Math.ceil((e.issued_at_ms+h*M)/M)*M;
function needs(e,h,now){return {direction:closeAt(e,h)<=now&&!v48Measured(e,h,'direction_outcomes'),
 barrier:e.barriers_locked===true&&e.first_complete_start_ms+M<=now&&!terminal.has(e.outcomes?.[h]?.status)};}
export function v49RecoveryPlan(old,state,now,max=40){
 if(!clock(now)||!Array.isArray(state?.events)||!Number.isInteger(max)||max<0)throw Error('V49_RECOVERY_INPUT');
 if(!max)return [];
 if(old?.direction_measurement_version!==V48_MEASUREMENT_VERSION)return v48RecoveryPlan(old,state,now,max,'v36');
 const eligible=state.events.filter(e=>valid(e,now)&&V48_HORIZONS.some(h=>{
  const n=needs(e,h,now),d=e.history_recovery?.horizons?.[h];
  return (n.direction||n.barrier)&&(!clock(d?.next_retry_at_ms)||d.next_retry_at_ms<=now);
 }));
 const rows=v48PendingMarkets(eligible,now,Math.max(1,eligible.length),'v36');
 const fresh=rows.filter(r=>now-r.issued_at_ms<=120*M),backlog=rows.filter(r=>now-r.issued_at_ms>120*M),out=[];
 // Three current windows and one old window, rotating the starting slot for tiny budgets.
 // Unused capacity is borrowed immediately. No missing event is removed or made terminal.
 let slot=Math.floor(now/(5*M))%4;
 while(out.length<max&&(fresh.length||backlog.length)){
  const preferred=slot%4===3?backlog:fresh,other=preferred===fresh?backlog:fresh;
  out.push((preferred.length?preferred:other).shift());slot++;
 }
 return out;
}
export function v49RecordHistoryDiagnostics(old,pages=[],errors=[],now){
 if(!clock(now)||!Array.isArray(old?.events)||!Array.isArray(pages)||!Array.isArray(errors))throw Error('V49_HISTORY_DIAGNOSTICS_INPUT');
 const state=structuredClone(old);
 for(const e of state.events){
  if(!valid(e,now))continue;
  const matching=pages.filter(p=>p?.venue===e.venue&&p?.symbol===e.symbol&&p.source==='OFFICIAL_NATIVE_1M'&&clock(p.fetched_at_ms)&&p.fetched_at_ms<=now&&Array.isArray(p.bars));
  const failed=errors.some(x=>x?.venue===e.venue&&x?.symbol===e.symbol);
  if(!matching.length&&!failed)continue;
  for(const h of V48_HORIZONS){
   const target=closeAt(e,h);if(target>now)continue;
   const n=needs(e,h,now),prior=e.history_recovery?.horizons?.[h];
   if(!n.direction&&!n.barrier){
    if(prior&&prior.reason!=='RECOVERED')e.history_recovery.horizons[h]={...prior,reason:'RECOVERED',resolved_at_ms:now,next_retry_at_ms:null};
    continue;
   }
   const candidates=matching.filter(p=>clock(p.history_end_ms)&&p.history_end_ms>=target);
   const p=(candidates.length?candidates:matching).slice().sort((a,b)=>(b.history_end_ms||0)-(a.history_end_ms||0))[0];
   const bars=p?.bars.filter(b=>clock(b?.start_ms)&&b.start_ms%M===0&&b.start_ms+M<=p.fetched_at_ms)||[];
   const first=bars.length?Math.min(...bars.map(b=>b.start_ms)):null;
   const targetPresent=bars.some(b=>b.start_ms===target-M);
   let reason;
   if(!p)reason='SOURCE_UNAVAILABLE';
   else if(!bars.length)reason='EMPTY_OFFICIAL_RESPONSE';
   else if(!clock(p.history_end_ms)||p.history_end_ms<target||first>e.first_complete_start_ms)reason='HISTORY_WINDOW_DOES_NOT_COVER_TARGET';
   else if(n.direction&&!targetPresent)reason='TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW';
   else if(e.direction_outcomes?.[h]?.status==='CONFLICTING_CANDLES'||e.outcomes?.[h]?.status==='CONFLICTING_CANDLES')reason='CONFLICTING_CANDLES';
   else if(n.barrier)reason='PATH_GAP_IN_OFFICIAL_WINDOW';
   else reason='TARGET_NOT_ACCEPTED_BY_VALIDATOR';
   const response=p?hash({venue:p.venue,symbol:p.symbol,end:p.history_end_ms,bars}):null;
   const unchanged=prior?.reason===reason&&response!==null&&prior.response_sha256===response?(prior.unchanged_responses||0)+1:1;
   const persistentGap=['TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW','PATH_GAP_IN_OFFICIAL_WINDOW'].includes(reason);
   const delay=persistentGap?Math.min(6*60*M,5*M*2**Math.min(12,unchanged-1)):5*M;
   e.history_recovery??={version:VERSION,horizons:{}};
   e.history_recovery.horizons[h]={reason,attempts:(prior?.attempts||0)+1,unchanged_responses:unchanged,
    first_observed_at_ms:prior?.first_observed_at_ms??now,last_attempt_at_ms:now,next_retry_at_ms:now+delay,
    expected_close_at_ms:target,response_start_ms:first,response_end_ms:p?.history_end_ms??null,
    returned_valid_candles:bars.length,response_sha256:response,no_trade_confirmed:false,
    synthetic_candles_created:false,direction_missing:n.direction,barrier_missing:n.barrier};
  }
 }
 return state;
}
export function v49RecoverySummary(state,now){
 const out={version:VERSION,direction_missing_due:0,barrier_missing_due:0,eligible_retry:0,deferred_retry:0,reasons:{},
  missing_results_excluded_from_success:true,synthetic_candles_created:false,no_trade_inference_used:false};
 for(const e of state?.events||[]){if(!valid(e,now))continue;
  for(const h of V48_HORIZONS){if(closeAt(e,h)>now)continue;const n=needs(e,h,now);if(!n.direction&&!n.barrier)continue;
   if(n.direction)out.direction_missing_due++;if(n.barrier)out.barrier_missing_due++;
   const d=e.history_recovery?.horizons?.[h],reason=d?.reason||'NOT_YET_DIAGNOSED';out.reasons[reason]=(out.reasons[reason]||0)+1;
   if(clock(d?.next_retry_at_ms)&&d.next_retry_at_ms>now)out.deferred_retry++;else out.eligible_retry++;
  }
 }
 return out;
}
