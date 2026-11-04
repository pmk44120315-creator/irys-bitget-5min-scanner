/** V31 execution quality, not a claim of improved future profitability. */
import {v29Trades} from './v29_direction_gate.mjs';
function v31EntryBudget(item){
 const c=item?.candidate||{},a=item?.first,q=item?.final?.quote,long=c.direction!=='SHORT';
 const fail=reason=>({allowed:false,reason,forecast_accuracy_proven:false});
 const rows=v29Trades(a?.trades,c.venue,(a?.observed_at_ms||0)-60000,a?.observed_at_ms||0);
 if(rows.conflict||rows.rows.length<3)return fail('ENTRY_RANGE_UNMEASURED');
 const prices=rows.rows.map(r=>r.price),lo=Math.min(...prices),hi=Math.max(...prices),spread=Number(a?.quote?.ask)-Number(a?.quote?.bid);
 const reference=Number.isFinite(c.discovery_price)&&c.discovery_price>0?c.discovery_price:long?a?.quote?.ask:a?.quote?.bid;
 const entry=long?q?.ask:q?.bid;
 if(!(Number.isFinite(reference)&&reference>0&&Number.isFinite(entry)&&entry>0&&spread>=0))return fail('ENTRY_REFERENCE_UNVERIFIED');
 // No universal percent threshold. Respect the original observed one-minute
 // price range plus its executable spread. Strong real trends may be missed;
 // the purpose is to avoid chasing a different entry after lengthy checking.
 const budget=hi-lo+spread,drift=Math.max(0,long?entry-reference:reference-entry);
 const allowed=budget>0&&drift<=budget+Math.max(1e-12,Math.abs(reference)*1e-12);
 return {allowed,reason:allowed?null:'ENTRY_OUTSIDE_OBSERVED_PRICE_BUDGET',reference_price:reference,
  entry_reference:entry,range_low:lo,range_high:hi,spread_price:spread,budget_price:budget,
  directional_drift:drift,drift_pct:100*drift/reference,policy:'ONE_OBSERVED_RANGE_PLUS_SPREAD',forecast_accuracy_proven:false};
}
function v31ShouldRecord(recent,quality,now){
 if(!recent)return true;
 if(recent.model&&quality.model&&recent.model!==quality.model)return true;
 if(quality.status==='READY_CURRENT_EVIDENCE'&&recent.evidence_status!=='READY_CURRENT_EVIDENCE')return true;
 return now-recent.issued_at_ms>=15*60000;
}
async function v31ReadPairs(candidates,snapshot,clock,sleep){
 return Promise.all(candidates.map(async candidate=>{
  let first,second;
  try{first=await snapshot(candidate)}catch{return {first:{error:'PUBLIC_SOURCE_UNAVAILABLE'},second:{error:'FIRST_SAMPLE_UNAVAILABLE'}}}
  await sleep(Math.max(0,first.observed_at_ms+8500-clock()));
  try{second=await snapshot(candidate)}catch{second={error:'PUBLIC_SOURCE_UNAVAILABLE'}}
  return {first,second};
 }));
}
export {v31EntryBudget,v31ShouldRecord,v31ReadPairs};
