import test from 'node:test';
import assert from 'node:assert/strict';
import {audit,observation,referenceReturn,summarize,policies} from '../research/v39_direction_outcome_audit.mjs';
const T=1794021639000;
function ev(id='a',{venue='bitget',side='LONG',close=101,shift=0,sourceAge=11000}={}){
 const at=T+shift,symbol=venue==='bitget'?'AAAUSDT':'KRW-AAA',bid=100,ask=100.1;
 return {id,venue,symbol,direction:side,issued_at_ms:at,source_observed_at_ms:at-sourceAge,
  time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',entry_price:side==='SHORT'?bid:ask,original_bid:bid,original_ask:ask,
  observed_hypothesis:{status:'OBSERVED'},
  direction_response:{version:'IRYS_DIRECTION_RESPONSE_RESEARCH_V1',decided_at_ms:at,
   source_observed_at_ms:at-sourceAge,venue,symbol,baseline_direction:side,trade_permission:false,
   hypotheses:{price_response:'SHORT',flow_follow:'LONG',agreement:null,absorption:'SHORT'}},
  direction_outcomes:{'5':{status:'MEASURED_DIRECTION',horizon_minutes:5,target_ms:at+300000,
   close_at_ms:Math.floor((at+300000)/60000)*60000,target_close:close,
   entry_quote_reference:side==='SHORT'?bid:ask,actual_execution_verified:false}}};
}
test('only actual evaluator time and original frozen bid/ask are valid',()=>{
 const a=ev(),b=ev('b');b.source_observed_at_ms=b.issued_at_ms+1;
 const c=ev('c');c.entry_price=99;
 const r=audit([a,b,c],T+2*3600000);
 assert.equal(r.records_total,3);assert.equal(r.records_eligible,1);assert.equal(r.invalid.provenance,2);
});
test('5 minute label cannot be read earlier than due time',()=>{
 const e=ev();assert.equal(observation(e,5,T+200000).status,'PENDING');
 assert.equal(observation(e,5,T+2*3600000).status,'MEASURED');
});
test('long and short use respective original quote sides, not shared fictional entry',()=>{
 const e=ev();assert(referenceReturn(e,101,'LONG')>0);
 assert(referenceReturn(e,101,'SHORT')<0);
});
test('baseline/inverse/price-response count identical measured future event with distinct results',()=>{
 const e=ev();
 const a=summarize([e],5,T+2*3600000,policies.baseline);
 const b=summarize([e],5,T+2*3600000,policies.opposite_futures);
 const c=summarize([e],5,T+2*3600000,policies.price_response);
 assert.equal(a.measured,1);assert.equal(a.correct,1);
 assert.equal(b.measured,1);assert.equal(b.wrong,1);
 assert.equal(c.measured,1);assert.equal(c.wrong,1);
 assert.equal(c.baseline_same_cases_correct,1);
});
test('spot no-buy alternative is abstention, never fabricated spot short return',()=>{
 const e=ev('spot',{venue:'bithumb',side:'BUY'});
 e.direction_response.hypotheses.price_response='NO_BUY';
 const a=summarize([e],5,T+2*3600000,policies.price_response);
 assert.equal(a.abstained,1);assert.equal(a.measured,0);assert.equal(a.unmeasured,0);
});
test('no future outcome means missing not loss or gain',()=>{
 const e=ev();delete e.direction_outcomes['5'];
 const a=summarize([e],5,T+2*3600000,policies.baseline);
 assert.equal(a.unmeasured,1);assert.equal(a.correct,0);assert.equal(a.wrong,0);
});
test('post-decision direction hypothesis is invalid for all alternative methods',()=>{
 const e=ev();e.direction_response.decided_at_ms+=1;
 const a=summarize([e],5,T+2*3600000,policies.price_response);
 assert.equal(a.abstained,1);assert.equal(a.measured,0);
});
test('mismatched future close time rejected before using label',()=>{
 const e=ev();e.direction_outcomes['5'].close_at_ms+=60000;
 assert.equal(observation(e,5,T+2*3600000).status,'INVALID_CLOSE');
});
test('conflicting duplicate ID is never allowed to cherry-pick winning copy',()=>{
 const a=ev(),b=ev();b.original_ask=101;b.entry_price=101;
 const r=audit([a,b],T+2*3600000);
 assert.equal(r.records_eligible,0);assert.equal(r.invalid.conflicting_duplicate,2);
});
test('identical ID is counted once to avoid overstating confidence',()=>{
 const a=ev(),b=structuredClone(a);
 const r=audit([a,b],T+2*3600000);assert.equal(r.records_eligible,1);
 assert.equal(r.invalid.duplicate,1);
});
test('validation and holdout windows never touch time-contaminated training records',()=>{
 const a=Array.from({length:50},(_,i)=>ev(String(i),{shift:i*30*60000,close:101}));
 const r=audit(a,T+200*3600000),p=r.reports['5'].baseline;
 assert(r.cut_holdout_at_ms>r.cut_train_at_ms);
 assert(p.training.eligible>0);assert(p.holdout.eligible>0);
 assert(p.training.eligible+p.validation.eligible+p.holdout.eligible<=r.records_eligible);
 assert.equal(r.embargo_minutes,60);
});
test('price-response evidence absent stays silent but baseline remains comparable',()=>{
 const e=ev();e.direction_response.hypotheses.price_response=null;
 const r=audit([e],T+2*3600000);
 assert.equal(r.reports['5'].baseline.all.measured,1);
 assert.equal(r.reports['5'].price_response.all.abstained,1);
});
test('research never claims Telegram accuracy or executable edge',()=>{
 const r=audit([ev()],T+2*3600000);
 assert.equal(r.telegram_sent,false);assert.equal(r.orders_sent,false);
 assert.equal(r.live_model_changed,false);assert.equal(r.auto_promote,false);
 assert.equal(r.statistical_significance_proven,false);assert.equal(r.actual_fills_verified,false);
});
test('gross price direction may be right but simple extra-cost scenario negative',()=>{
 const e=ev('tiny',{close:100.12});
 const r=summarize([e],5,T+2*3600000,policies.baseline);
 assert.equal(r.correct,1);assert(r.illustrative_cost_net_mean_pct<0);
});
test('no mutation to source records',()=>{
 const a=[ev()],snapshot=JSON.stringify(a);audit(a,T+2*3600000);
 assert.equal(JSON.stringify(a),snapshot);
});
