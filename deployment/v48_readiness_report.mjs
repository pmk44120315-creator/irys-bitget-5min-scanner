/** Versioned public audit, not a trading signal or a claim of model superiority. */
import {V48_MEASUREMENT_VERSION,V48_HORIZONS,v48ValidIdentity,v48ValidEvent,v48Measured,v48SpacedEvents} from './v48_measurement.mjs';
const MIN=60000,CUTOFF=Date.parse('2026-11-06T00:00:00Z');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const median=x=>{const a=x.filter(finite).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null};
function dedupe(rows){const by=new Map(),bad=new Set();let duplicates=0;for(const r of Array.isArray(rows)?rows:[]){if(typeof r?.id!=='string'||!r.id)continue;if(by.has(r.id)){duplicates++;if(stable(by.get(r.id))!==stable(r))bad.add(r.id);}else by.set(r.id,r);}return {rows:[...by.values()].filter(x=>!bad.has(x.id)),duplicates,conflicts:bad.size};}
function eligible(e,now){return v48ValidIdentity(e)&&v48ValidEvent(e,now)&&e.time_basis==='ACTUAL_EVALUATOR_DECISION_CLOCK'&&e.issued_at_ms>=CUTOFF&&Number.isSafeInteger(e.source_observed_at_ms)&&e.source_observed_at_ms<=e.issued_at_ms&&e.source_observed_at_ms>=0;}
function horizons(events,now,field){return Object.fromEntries(V48_HORIZONS.map(h=>{
 const measured=events.filter(e=>v48Measured(e,h,field)),due=events.filter(e=>Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN<=now),positive=measured.filter(e=>e[field][h].direction_positive),complete=measured.filter(e=>e[field][h].path_complete===true&&finite(e[field][h].max_adverse_pct));
 const missing=due.filter(e=>!v48Measured(e,h,field));
 return [h,{candidates:events.length,measured:measured.length,direction_positive:positive.length,direction_positive_rate:measured.length?positive.length/measured.length:null,
  flat:measured.filter(e=>(e[field][h].signed_pct??e[field][h].signed_direction_pct)===0).length,pending:events.length-due.length,missing_due:missing.length,
  missing_older_than_65m:missing.filter(e=>now-e.issued_at_ms>65*MIN).length,legacy_records_excluded:events.filter(e=>e.direction_measurement_version!==V48_MEASUREMENT_VERSION&&e[field]?.[h]||e.legacy_outcomes_v37?.[h]||e.legacy_direction_outcomes_v36?.[h]).length,
  complete_minute_paths:complete.length,worst_observed_max_adverse_pct:complete.length?Math.min(...complete.map(e=>e[field][h].max_adverse_pct)):null,
  median_observed_max_adverse_pct:median(complete.map(e=>e[field][h].max_adverse_pct)),measurements_are_not_fills:true}];}));}
export function v48Audit(events,now,kind='v37'){
 if(!Number.isSafeInteger(now)||!['v36','v37'].includes(kind)||!Array.isArray(events))throw Error('V48_AUDIT_INPUT');
 const field=kind==='v36'?'direction_outcomes':'outcomes',d=dedupe(events),valid=d.rows.filter(e=>eligible(e,now)),spaced=v48SpacedEvents(valid),delays=valid.map(e=>e.issued_at_ms-e.source_observed_at_ms);
 const groups={};for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){const rows=valid.filter(e=>e.venue===venue&&e.direction===direction);groups[venue+':'+direction]={candidates:rows.length,rolling_30m_candidates:v48SpacedEvents(rows).length,horizons:horizons(rows,now,field)};}
 return {version:'V48_CAUSAL_EVIDENCE_READINESS_V1',measurement_version:V48_MEASUREMENT_VERSION,asof_ms:now,kind,retained_records:events.length,
  unique_nonconflicting_ids:d.rows.length,duplicate_ids:d.duplicates,conflicting_ids:d.conflicts,clock_verified:valid.length,excluded_records:events.length-valid.length,
  rolling_30m_candidates:spaced.length,statistical_independence_proven:false,market_dates_utc:[...new Set(valid.map(e=>new Date(e.issued_at_ms).toISOString().slice(0,10)))].sort(),
  first_retained_candidate_ms:valid.length?Math.min(...valid.map(e=>e.issued_at_ms)):null,last_retained_candidate_ms:valid.length?Math.max(...valid.map(e=>e.issued_at_ms)):null,
  horizons:horizons(valid,now,field),spaced_horizons:horizons(spaced,now,field),directions:groups,
  source_to_decision_latency_ms:{median:median(delays),max:delays.length?Math.max(...delays):null},price_move_onset_latency_ms:null,
  entry_orderbook_freshness_verified:false,minute_path_excludes_partial_entry_minute:true,intraminute_touch_order_known:false,
  actual_execution_verified:false,model_superiority_proven:false,live_engine_promotion_approved:false,trade_permit:false};
}
function validAck(a,now){return v48ValidIdentity(a)&&a.api_ack_recorded===true&&Number.isSafeInteger(a.issued_at_ms)&&a.issued_at_ms<=now&&a.issued_at_ms>=0&&finite(a.direction==='SHORT'?a.entry_quote?.bid:a.entry_quote?.ask)&&(a.direction==='SHORT'?a.entry_quote.bid:a.entry_quote.ask)>0;}
export function v48MatchAcks(events,acks,{now,maxLeadMs=60*MIN}={}){
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(maxLeadMs)||maxLeadMs<0)throw Error('V48_ACK_COMPARISON_CLOCK');
 const e=dedupe(events),a=dedupe(acks),candidates=e.rows.filter(x=>eligible(x,now)).sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id));
 const valid=a.rows.filter(x=>validAck(x,now)).sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id)),used=new Set(),matches=[];
 for(const ack of valid){const candidate=candidates.find(c=>!used.has(c.id)&&c.venue===ack.venue&&c.symbol===ack.symbol&&c.direction===ack.direction&&c.issued_at_ms<=ack.issued_at_ms&&ack.issued_at_ms-c.issued_at_ms<=maxLeadMs);if(!candidate)continue;used.add(candidate.id);
  const entry=ack.direction==='SHORT'?ack.entry_quote.bid:ack.entry_quote.ask,sign=ack.direction==='SHORT'?-1:1;
  matches.push({candidate_id:candidate.id,ack_id:ack.id,venue:ack.venue,symbol:ack.symbol,direction:ack.direction,
   candidate_at_ms:candidate.issued_at_ms,ack_at_ms:ack.issued_at_ms,lead_ms:ack.issued_at_ms-candidate.issued_at_ms,
   candidate_price_proxy:candidate.entry_price,ack_entry_quote_reference:entry,signed_price_progress_pct:sign*100*(entry/candidate.entry_price-1),
   api_ack_recorded:true,dispatch_revalidated:ack.dispatch_revalidated===true,ack_reference_quote_age_ms:finite(ack.reference_quote_age_ms)?ack.reference_quote_age_ms:null,
   same_decision_clock:candidate.issued_at_ms===ack.issued_at_ms,same_entry_reference:candidate.entry_price===entry,
   price_progress_is_not_profit:true,actual_execution_verified:false});
 }
 return {version:'V48_ONE_TO_ONE_ACTUAL_ACK_TIMING_V1',asof_ms:now,max_lead_ms:maxLeadMs,valid_candidates:candidates.length,valid_ack_events:valid.length,
  candidate_conflicting_ids:e.conflicts,ack_conflicting_ids:a.conflicts,ack_duplicate_ids:a.duplicates,matched_ack_events:matches.length,unmatched_ack_events:valid.length-matches.length,
  matches,matched_under_30m:matches.filter(x=>x.lead_ms<=30*MIN).length,median_lead_ms:median(matches.map(x=>x.lead_ms)),
  exact_clock_and_reference_pairs:matches.filter(x=>x.same_decision_clock&&x.same_entry_reference).length,
  models_compared_fairly:false,equal_opportunity_set_verified:false,all_historical_acks_complete:false,actual_execution_verified:false,performance_superiority_proven:false};
}
