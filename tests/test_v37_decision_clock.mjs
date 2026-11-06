import test from 'node:test';
import assert from 'node:assert/strict';
import {v37BuildEvents} from '../deployment/v37_early.mjs';
import {v37Stats} from '../deployment/v37_runner.mjs';
const SOURCE_MS=1793952300000,DECISION_MS=SOURCE_MS+45000;
const selected=[{status:'OBSERVED',phase:'EARLY_FLOW_LEAD',trade_permit:false,venue:'bithumb',symbol:'KRW-CLOCK',direction:'BUY',
 observed_at_ms:SOURCE_MS,current_price:100,first_recorded_price:99.99,pre_observation_move_pct:0.01,early_score:2,
 flow_source:'BITHUMB_DAILY_CUMULATIVE_QUOTE',flow_acceleration:2}];
test('new V37 episode starts at actual evaluator decision time, not stale public ticker observation',()=>{
 const r=v37BuildEvents({},selected,DECISION_MS);
 assert.equal(r.added.length,1);
 const e=r.added[0];
 assert.equal(e.issued_at_ms,DECISION_MS);
 assert.equal(e.source_observed_at_ms,SOURCE_MS);
 assert.equal(e.source_to_decision_latency_ms,45000);
 assert.equal(e.first_complete_start_ms,Math.ceil(DECISION_MS/60000)*60000);
 assert.equal(e.time_basis,'ACTUAL_EVALUATOR_DECISION_CLOCK');
 assert.equal(e.entry_reference_is_live_executable,false);
});
test('legacy episodes without independently verified evaluation clock are excluded from promotional accuracy',()=>{
 const r=v37BuildEvents({},selected,SOURCE_MS),old=r.added[0];
 const legacy={...old,issued_at_ms:SOURCE_MS,first_complete_start_ms:SOURCE_MS,source_observed_at_ms:undefined,
  time_basis:undefined,entry_reference_is_live_executable:undefined,
  outcomes:{'5':{status:'MEASURED_DIRECTION',direction_positive:true}}};
 const stats=v37Stats([legacy]);
 assert.equal(stats.events,1);
 assert.equal(stats.legacy_unverified_clock,1);
 assert.equal(stats.measured['5'],0);
 assert.equal(stats.positive['5'],0);
});
test('event IDs and comparison window follow actual decision clock without retroactive early advantage',()=>{
 const old=v37BuildEvents({},selected,SOURCE_MS+10000);
 const next=v37BuildEvents(old.state,selected,SOURCE_MS+10000);
 assert.equal(next.added.length,0);
 const late=v37BuildEvents({},selected,SOURCE_MS+30000);
 const record=late.added[0];assert.equal(record.issued_at_ms,SOURCE_MS+30000);
 assert.equal(record.source_to_decision_latency_ms,30000);
});
