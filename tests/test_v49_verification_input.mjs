import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../research/v49_verification_input.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const T=1794846219766;
function select(previous,now=T){assert.equal(typeof api.v49VerifyPriorState,'function');return api.v49VerifyPriorState(previous,now);}
test('live verification must reject stale branch data before testing candidate recovery',()=>{
 assert.throws(()=>select({market:{futures:{at_ms:T-2506638,prices:{BTCUSDT:100}}},v28:{at_ms:T-2506638}}),/STALE/);
});
test('genuine recent snapshot is inspected without modifying source times or prices',()=>{
 const p={market:{futures:{at_ms:T-300000,prices:{BTCUSDT:100}}},v28:{at_ms:T-300000}},before=structuredClone(p);
 const r=select(p);assert.equal(r.futures_gap_ms,300000);assert.equal(r.spot_gap_ms,300000);assert.deepEqual(p,before);
});
test('too-recent and future baselines cannot fake a five-minute comparison',()=>{
 for(const age of [0,1000,167999,-1])assert.throws(()=>select({market:{futures:{at_ms:T-age,prices:{BTCUSDT:100}}},v28:{at_ms:T-age}}),/INTERVAL/);
});
