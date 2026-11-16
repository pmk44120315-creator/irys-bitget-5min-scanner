import test from 'node:test';import assert from 'node:assert/strict';
import {v36Observe} from '../deployment/v36_shadow.mjs';
import {item,packet,T} from './v49_fixture.mjs';
test('expired original quotes are separately counted, not an unexplained zero enrollment',()=>{
 const r=v36Observe({}, {packet:packet(),now:T+55000,baselineDigest:'exact'});
 assert.equal(r.events.length,0);assert.equal(r.admission?.rejection_reasons?.QUOTE_EXPIRED,1);
 assert.equal(r.admission?.health,'BLOCKED_QUOTE_FRESHNESS');assert.equal(r.admission?.accepted,0);
});
test('45s quote boundary remains strict; future quote is not refreshed by its receipt time',()=>{
 for(const [age,expected] of [[45000,1],[45001,0],[-1,0]]){
  const p=packet();p.items[0].final.quote.at_ms=T-age;
  const r=v36Observe({}, {packet:p,now:T,baselineDigest:'exact'});
  assert.equal(r.events.length,expected);assert.equal(r.admission?.evaluated,1);
 }
});
test('duplicate episode has its own reason and is not an admission outage',()=>{
 const first=v36Observe({}, {packet:packet(),now:T,baselineDigest:'exact'});
 const p=packet([item('LONG','AAAUSDT',T+1000)],T+1000);
 const r=v36Observe(first.state,{packet:p,now:T+1000,baselineDigest:'exact'});
 assert.equal(r.events.length,0);assert.equal(r.admission?.duplicate_episodes,1);
 assert.equal(r.admission?.health,'NO_NEW_EPISODE');
});
test('admission does not discard delayed-capture ingestion bookkeeping',()=>{
 const old={events:[],v49_capture_ingestion:{processed_ids:['receipt-a']}};
 const r=v36Observe(old,{packet:packet(),now:T,baselineDigest:'exact'});
 assert.deepEqual(r.state.v49_capture_ingestion,old.v49_capture_ingestion);
 assert.notStrictEqual(r.state.v49_capture_ingestion,old.v49_capture_ingestion);
});
test('invalid or wrong-digest packet is distinct from all quotes being expired',()=>{
 const r=v36Observe({}, {packet:{...packet(),model_digest:'changed'},now:T,baselineDigest:'exact'});
 assert.equal(r.status,'SOURCE_NOT_ELIGIBLE');assert.equal(r.admission?.health,'SOURCE_NOT_ELIGIBLE');assert.equal(r.admission?.evaluated,0);
});
