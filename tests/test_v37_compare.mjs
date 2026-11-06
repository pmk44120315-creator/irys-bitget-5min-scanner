import test from 'node:test';import assert from 'node:assert/strict';
import {v37CompareToReady} from '../deployment/v37_compare.mjs';
const T=1793952300000;
const early=(symbol,dir,price)=>({id:'v37:'+symbol,venue:'bitget',symbol,direction:dir,issued_at_ms:T,source_observed_at_ms:T-1000,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',entry_price:price,source_label:'PUBLIC_PRIOR_OBSERVATIONS_ONLY',trade_permit:false,outcomes:{}});
const base=(symbol,dir,price,delta=5*60000)=>({venue:'bitget',symbol,direction:dir,issued_at_ms:T+delta,entry_quote:{bid:price-.01,ask:price+.01,at_ms:T+delta},model:'V31_PAIRED_TIMELY_ENTRY_V1',evidence_status:'READY_CURRENT_EVIDENCE'});
test('earlier BUY/long observation and later comparable V30 READY show lead and price progress, not a profit claim',()=>{
 const x=v37CompareToReady([early('AAAUSDT','LONG',100)],[base('AAAUSDT','LONG',101)]);
 assert.equal(x.matched,1);assert.equal(x.matches[0].lead_ms,300000);assert(x.matches[0].signed_price_progress_pct>0);
 assert.equal(x.actual_telegram_ack_matches_verified,false);
});
test('earlier short opportunity before price fall has positive signed lead, never an actual entry price',()=>{
 const x=v37CompareToReady([early('AAAUSDT','SHORT',100)],[base('AAAUSDT','SHORT',95)]);
 assert(x.matches[0].signed_price_progress_pct>0);assert.equal(x.matched,1);
});
test('old baseline before early watch or different direction cannot imply V37 was early',()=>{
 const a=v37CompareToReady([early('AAAUSDT','LONG',100)],[base('AAAUSDT','LONG',101,-60000),base('AAAUSDT','SHORT',99)]);
 assert.equal(a.matched,0);assert.equal(a.unmatched,1);
});
test('baseline NOT_READY and stale historical candidate are not actual confirmed performance',()=>{
 const x=v37CompareToReady([early('AAAUSDT','LONG',100)],[{...base('AAAUSDT','LONG',105),evidence_status:'NOT_READY'},base('AAAUSDT','LONG',105,65*60000)]);
 assert.equal(x.matched,0);assert.equal(x.accuracy_proven,false);
});

test('old observation time mislabeled as a first signal is not counted as an early timing win',()=>{
 const legacy={...early('AAAUSDT','LONG',100),time_basis:undefined,source_observed_at_ms:undefined};
 const x=v37CompareToReady([legacy],[base('AAAUSDT','LONG',101)]);
 assert.equal(x.matched,0);assert.equal(x.legacy_unverified_clock,1);
 assert.equal(x.accuracy_proven,false);
});
