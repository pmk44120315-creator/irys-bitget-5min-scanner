import test from 'node:test';import assert from 'node:assert/strict';
import {v27EffortResponse} from '../deployment/v27_response.mjs';
const T=1793586300000;
function rows(){return [
 {timestamp:T-60000,sequential_id:'17935862400000000',trade_price:100,trade_volume:5,ask_bid:'BID'},
 {timestamp:T-60000,sequential_id:'17935862400000000',trade_price:101,trade_volume:2,ask_bid:'BID'},
 {timestamp:T-20000,sequential_id:'17935862800000000',trade_price:103,trade_volume:2,ask_bid:'BID'},
 {timestamp:T-10000,sequential_id:'17935862900000000',trade_price:104,trade_volume:3,ask_bid:'ASK'}];}
test('real Bithumb same ID different prints remain qualified partial rows, not claimed unique fills',()=>{
 const x=v27EffortResponse(rows(),'bithumb',T,.01,'KRW-BTC');
 assert.equal(x.status,'SAMPLED_RESPONSE');assert.equal(x.sample_trades,4);
 assert.equal(x.exact_execution_count_verified,false);assert.equal(x.same_millisecond_buckets,3);
 assert.equal(x.provider_id_conflict_observed,true);assert.equal(x.full_cvd_verified,false);
});
test('unknown within-millisecond order cannot change equal-notional response',()=>{
 const a=v27EffortResponse(rows(),'bithumb',T,.01,'KRW-BTC');
 const b=v27EffortResponse([...rows()].reverse(),'bithumb',T,.01,'KRW-BTC');
 assert.equal(a.status,'SAMPLED_RESPONSE');assert.deepEqual(a,b);
});
test('duplicate identical Bithumb print cannot inflate sample notional',()=>{
 const a=v27EffortResponse(rows(),'bithumb',T,.01,'KRW-BTC');
 const b=v27EffortResponse([...rows(),rows()[0]],'bithumb',T,.01,'KRW-BTC');
 assert.equal(a.status,'SAMPLED_RESPONSE');assert.deepEqual(a,b);
});
