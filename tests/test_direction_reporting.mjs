import test from 'node:test';
import assert from 'node:assert/strict';
import {v36Process} from '../deployment/v36_runner.mjs';
const T=1794000000000;
const venue='bitget',symbol='AAAUSDT';
const packet={version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:'fixture',started_at_ms:T-40000,at_ms:T,checks:[],orders_sent:false,telegram_sent:false,items:[{candidate:{venue,symbol,direction:'LONG'},first:{venue,symbol,observed_at_ms:T-20000,quote:{bid:100,ask:100.01,at_ms:T-20000},trades:[0,1,2].map(i=>({id:'a'+i,at_ms:T-40000+i*5000,price:100+i*.01,size:10,side:'BUY'}))},second:{venue,symbol,observed_at_ms:T-1000,quote:{bid:100.08,ask:100.09,at_ms:T-1000},trades:[0,1,2].map(i=>({id:'b'+i,at_ms:T-15000+i*5000,price:100.04+i*.02,size:10,side:'BUY'}))},final:{venue,symbol,observed_at_ms:T,quote:{bid:100.1,ask:100.11,at_ms:T}}}]};
test('V36 public output includes side-by-side as-of research report without enabling market alerts',async()=>{
 const {state,public_output:r}=await v36Process({old:{},packet,now:T+1000,baselineDigest:'fixture',readHistory:async()=>{throw Error('mock-unavailable')}});
 assert.equal(state.events.length,1);
 assert.equal(r.direction_response_comparisons['5'].valid_decisions,1);
 assert.equal(r.direction_response_comparisons['5'].measured_records,0);
 assert.equal(r.direction_response_comparisons['5'].prediction_accuracy_proven,false);
 assert.equal(r.direction_response_comparisons['5'].auto_promote,false);
 assert.equal(r.telegram_sent,false);assert.equal(r.orders_sent,false);assert.equal(r.auto_promotion,false);
});
test('V36 research report keeps legacy pre-repair records outside the verified denominator',async()=>{
 const {public_output:r}=await v36Process({old:{events:[{id:'legacy',venue:'bitget',symbol:'OLDUSDT',direction:'LONG',issued_at_ms:T-300000,entry_price:100,direction_outcomes:{},outcomes:{}}]},packet,now:T+1000,baselineDigest:'fixture',readHistory:async()=>{throw Error('mock-unavailable')}});
 assert.equal(r.summary.legacy_unverified_clock,1);
 assert.equal(r.direction_response_comparisons['5'].valid_decisions,1);
 assert.equal(r.direction_response_comparisons['5'].excluded.unverified_clock,1);
});
