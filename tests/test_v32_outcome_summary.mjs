import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../deployment/v32_outcome_summary.mjs',import.meta.url);
const NOW=1793854880198;
async function module(){assert(existsSync(url),'V32 honest outcome summary is not implemented');return import(url);}
const record=(issued)=>({issued_at_ms:issued,minute_outcomes:{}});
test('an elapsed target with no price is overdue unmeasured, never still pending',async()=>{
 const m=await module(),r=m.summarizeOutcomes([record(NOW-3600000)],NOW);
 assert.equal(r.horizons[5].overdue_unmeasured,1);assert.equal(r.horizons[5].pending,0);assert.equal(r.horizons[5].measured,0);
});
test('future and unclosed minute remain pending without pretending to have a loss',async()=>{
 const m=await module(),r=m.summarizeOutcomes([record(NOW-60000),record(NOW-5*60000+1)],NOW);
 assert.equal(r.horizons[5].pending,2);assert.equal(r.horizons[5].overdue_unmeasured,0);
});
test('missing native candle remains unavailable, not success or direction error',async()=>{
 const m=await module(),x=record(NOW-3600000);x.minute_outcomes['5']={status:'TARGET_MINUTE_UNAVAILABLE'};
 const r=m.summarizeOutcomes([x],NOW);assert.equal(r.horizons[5].target_unavailable,1);assert.equal(r.horizons[5].measured,0);
});
test('measured prices retain their value while every event belongs to exactly one accounting bucket',async()=>{
 const m=await module(),x=record(NOW-3600000);x.minute_outcomes['5']={status:'MEASURED_MINUTE_CLOSE_PROXY',gross_reference_pct:-2,net_cost_scenario_pct:-2.2,close_at_ms:NOW-1800000};
 const r=m.summarizeOutcomes([x,record(NOW-3600000),record(NOW-60000)],NOW);
 const h=r.horizons[5];assert.equal(h.measured,1);assert.equal(h.mean_gross_reference_pct,-2);assert.equal(h.partition_total,3);assert.equal(h.directional_positive,0);
});
test('invalid clock and false future measured outcome are excluded as invalid',async()=>{
 const m=await module(),x=record(NOW-3600000);x.minute_outcomes['5']={status:'MEASURED_MINUTE_CLOSE_PROXY',gross_reference_pct:5,close_at_ms:NOW+1000};
 const h=m.summarizeOutcomes([x,record(NaN)],NOW).horizons[5];assert.equal(h.invalid,2);assert.equal(h.measured,0);
});
test('actual ACK scope is never inferred from a candidate record',async()=>{
 const m=await module();const r=m.summarizeOutcomes([record(NOW-3600000)],NOW);
 assert.equal(r.scope,'PUBLIC_CANDIDATE_RECORDS_NOT_TELEGRAM_ACKS');assert.equal(r.forecast_accuracy_proven,false);assert.equal(r.actual_execution_verified,false);
});
test('historical statistics are deterministic and do not modify original records',async()=>{
 const m=await module(),rows=[record(NOW-3600000)],before=JSON.stringify(rows);
 assert.deepEqual(m.summarizeOutcomes(rows,NOW),m.summarizeOutcomes(rows,NOW));assert.equal(JSON.stringify(rows),before);
});
