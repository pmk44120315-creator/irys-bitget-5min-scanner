/** Frozen-cohort research re-evaluation only: no publication to main, Worker or Telegram. */
import {V48_MEASUREMENT_VERSION,v48ValidEvent,v48ValidIdentity,v48PendingMarkets} from './v48_measurement.mjs';
import {v37LabelEvents} from './v37_early.mjs';
const M=60000;
export function v48PlanHistory(events,now){
 if(!Array.isArray(events)||!Number.isSafeInteger(now))throw Error('V48_BACKFILL_INPUT');
 const groups=new Map();
 for(const e of events){if(!v48ValidIdentity(e)||!v48ValidEvent(e,now)||e.time_basis!=='ACTUAL_EVALUATOR_DECISION_CLOCK'||!Number.isSafeInteger(e.source_observed_at_ms)||e.source_observed_at_ms>e.issued_at_ms)continue;
  const end=Math.min(Math.floor(now/M)*M,Math.ceil((e.issued_at_ms+60*M)/M)*M);
  if(end<Math.ceil((e.issued_at_ms+5*M)/M)*M)continue;
  const key=e.venue+':'+e.symbol,a=groups.get(key)||[];a.push({venue:e.venue,symbol:e.symbol,start:e.first_complete_start_ms,end});groups.set(key,a);
 }
 const plan=[];for(const rows of groups.values()){rows.sort((a,b)=>a.start-b.start);let active=null;
  for(const r of rows){if(!active||Math.max(active.end,r.end)-active.start>200*M){if(active)plan.push({venue:active.venue,symbol:active.symbol,history_end_ms:active.end});active={...r};}else active.end=Math.max(active.end,r.end);}
  if(active)plan.push({venue:active.venue,symbol:active.symbol,history_end_ms:active.end});
 }return plan.sort((a,b)=>a.venue.localeCompare(b.venue)||a.symbol.localeCompare(b.symbol)||a.history_end_ms-b.history_end_ms);
}
export function v48RepairFrozen(state,pages,now){
 const next=v37LabelEvents(state,pages,now);
 if(next.events.length!==state.events.length)throw Error('V48_BACKFILL_CHANGED_COHORT');
 for(let i=0;i<next.events.length;i++)for(const k of ['id','venue','symbol','direction','issued_at_ms','source_observed_at_ms','entry_price'])if(next.events[i][k]!==state.events[i][k])throw Error('V48_BACKFILL_CHANGED_FROZEN_FACT');
 return next;
}

export function v48RecoveryPlan(old,state,now,max=40,kind='v37'){
 return old?.direction_measurement_version!==V48_MEASUREMENT_VERSION?v48PlanHistory(state.events,now):v48PendingMarkets(state.events,now,max,kind);
}
