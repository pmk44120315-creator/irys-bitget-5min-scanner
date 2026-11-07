import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../deployment/direction_response_research.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const T=1794000000000;
function ev({share=.8,quote=.4,tape=.3,spread=.02,venue='bitget',direction='LONG',status='OBSERVED',at=T}={}){
 const sign=direction==='SHORT'?-1:1;
 return {status,venue,symbol:venue==='bitget'?'AAAUSDT':'KRW-AAA',direction,observed_at_ms:at,
 evidence:{new_buy_share:share,signed_quote_move_pct:quote*sign,new_response_pct:tape*sign,spread_pct:spread,sampled_taker_not_full_cvd:true,
 market_baseline_available:false,relative_to_market_pct:null}};
}
const classify=(e,now=T)=>{assert.equal(typeof mod.directionResponseHypotheses,'function');return mod.directionResponseHypotheses(e,now)};
const compare=(events,now=T+600000)=>{assert.equal(typeof mod.compareDirectionHypotheses,'function');return mod.compareDirectionHypotheses(events,{now,horizon:5})};
function record(id,{raw=.5,share=.8,quote=.4,tape=.3,direction='LONG',venue='bitget',missing=false}={}){
 const input=ev({share,quote,tape,direction,venue}),dir=direction==='SHORT'?-1:1;
 return {id,venue,symbol:input.symbol,direction,issued_at_ms:T,source_observed_at_ms:T,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',entry_price:100,
 direction_response:classify(input),direction_outcomes:missing?{}:{5:{status:'MEASURED_DIRECTION',horizon_minutes:5,target_ms:T+300000,close_at_ms:T+300000,
 entry_quote_reference:100,target_close:100*(1+raw/100),signed_direction_pct:raw*dir,actual_execution_verified:false}}};
}
test('opposing sell pressure with rising observable prices is buy absorption candidate, not automatic SHORT',()=>{
 const r=classify(ev({share:.1}));assert.equal(r.pattern,'SELL_PRESSURE_PRICE_UP_ABSORPTION_CANDIDATE');
 assert.equal(r.hypotheses.price_response,'LONG');assert.equal(r.hypotheses.flow_follow,'SHORT');assert.equal(r.hypotheses.absorption,'LONG');
 assert.equal(r.hypotheses.agreement,null);assert.equal(r.trade_permission,false);assert.equal(r.prediction_accuracy_proven,false);assert.equal(r.probability,null);
});
test('dominant buy tape with falling prices cannot confirm a LONG',()=>{
 const r=classify(ev({share:.9,quote:-.4,tape:-.3}));assert.equal(r.pattern,'BUY_PRESSURE_PRICE_DOWN_ABSORPTION_CANDIDATE');
 assert.equal(r.hypotheses.price_response,'SHORT');assert.equal(r.hypotheses.agreement,null);assert.equal(r.hypotheses.absorption,'SHORT');
});
test('aligned buy pressure and price response form a distinct continuation hypothesis',()=>{
 const r=classify(ev());assert.equal(r.pattern,'BUY_PRESSURE_PRICE_UP');assert.equal(r.hypotheses.agreement,'LONG');assert.equal(r.hypotheses.absorption,null);
});
test('quote and tape moving in opposite directions must stay unresolved',()=>{
 const r=classify(ev({quote:.4,tape:-.3}));assert.equal(r.pattern,'PRICE_RESPONSE_DISAGREEMENT');assert.equal(r.hypotheses.price_response,null);
});
test('price changes inside the spread are not a direction confirmation',()=>{
 const r=classify(ev({quote:.01,tape:.01,spread:.02}));assert.equal(r.pattern,'WITHIN_SPREAD_UNRESOLVED');assert.equal(r.hypotheses.agreement,null);
});
test('the same market evidence is invariant to baseline LONG versus SHORT encoding',()=>{
 const a=classify(ev({share:.1,direction:'LONG'})),b=classify(ev({share:.1,direction:'SHORT'}));
 assert.deepEqual(a.hypotheses,b.hypotheses);assert.equal(a.pattern,b.pattern);
});
test('Bithumb decline is NO_BUY, not an invented spot SHORT order',()=>{
 const r=classify(ev({venue:'bithumb',direction:'BUY',quote:-.4,tape:-.3}));assert.equal(r.hypotheses.price_response,'NO_BUY');assert.equal(r.trade_permission,false);
});
test('missing or sparse tape does not create flow evidence',()=>{
 const r=classify(ev({status:'INSUFFICIENT_EVIDENCE'}));assert.equal(r.status,'UNCONFIRMED');assert.deepEqual(r.hypotheses,{});
});
test('future input timestamp cannot become present evidence',()=>{
 const r=classify(ev({at:T+1}));assert.equal(r.status,'UNCONFIRMED');assert.deepEqual(r.hypotheses,{});
});
test('24h gross volume is not a substitute for sampled buy/sell evidence',()=>{
 const e=ev();e.evidence.sampled_taker_not_full_cvd=false;e.evidence.flow_acceleration=999;
 assert.equal(classify(e).status,'UNCONFIRMED');
});
test('invalid ratios, infinity and negative spread are rejected',()=>{
 for(const options of [{share:1.1},{share:-.1},{quote:Infinity},{tape:NaN},{spread:-.1}])assert.equal(classify(ev(options)).status,'UNCONFIRMED');
});
test('relative-strength hypothesis is absent for unaligned market windows',()=>{
 const e=ev();e.evidence.relative_to_market_pct=5;e.evidence.market_baseline_available=true;
 assert.equal(classify(e).hypotheses.market_relative,null);
});
test('valid aligned relative strength remains separately observable',()=>{
 const e=ev();Object.assign(e.evidence,{relative_to_market_pct:-.5,market_baseline_available:true,market_baseline_alignment:'MATCHED_QUOTE_INTERVAL'});
 assert.equal(classify(e).hypotheses.market_relative,'SHORT');
});
test('comparisons use the same measured records for the alternative and its baseline',()=>{
 const r=compare([record('a',{share:.1,raw:.5}),record('b',{share:.9,raw:-.5,quote:-.4,tape:-.3})]);
 assert.equal(r.strategies.price_response.matched,2);assert.equal(r.strategies.price_response.alternative.positive,2);
 assert.equal(r.strategies.price_response.baseline.positive,1);assert.equal(r.strategies.price_response.baseline.negative,1);
 assert.equal(r.prediction_accuracy_proven,false);assert.equal(r.auto_promote,false);assert.equal(r.costs_included,false);
});
test('missing future outcomes are not invented as losses and reduce coverage',()=>{
 const r=compare([record('a'),record('b',{missing:true})]);
 assert.equal(r.valid_decisions,2);assert.equal(r.measured_records,1);assert.equal(r.strategies.price_response.coverage,.5);
});
test('duplicate IDs cannot double the apparent number of winning records',()=>{
 const a=record('a'),r=compare([a,structuredClone(a)]);assert.equal(r.measured_records,1);assert.equal(r.excluded.duplicate_id,1);
});
test('legacy clocks and post-hoc hypotheses are excluded from forward comparisons',()=>{
 const a=record('a'),b=record('b');delete a.time_basis;b.direction_response.decided_at_ms=T+1;
 const r=compare([a,b]);assert.equal(r.valid_decisions,0);assert.equal(r.excluded.unverified_clock,1);assert.equal(r.excluded.hypothesis_clock,1);
});
test('not-yet-matured outcomes cannot leak into the report',()=>{
 const r=compare([record('a')],T+100000);assert.equal(r.measured_records,0);assert.equal(r.excluded.pending_horizon,1);
});
test('flat prices remain flat, not a fabricated correct or wrong prediction',()=>{
 const r=compare([record('flat',{raw:0})]);assert.equal(r.strategies.price_response.alternative.flat,1);assert.equal(r.strategies.price_response.alternative.positive,0);
});
test('mismatched entry reference and impossible future closes are excluded',()=>{
 const a=record('a');a.direction_outcomes[5].entry_quote_reference=90;const b=record('b');b.direction_outcomes[5].close_at_ms=T+700000;
 const r=compare([a,b]);assert.equal(r.measured_records,0);assert.equal(r.excluded.invalid_label,2);
});
test('input events remain immutable under comparison',()=>{
 const e=[record('a')],before=JSON.stringify(e);compare(e);assert.equal(JSON.stringify(e),before);
});
test('compared records are explicitly not claimed as independent market samples or Telegram fills',()=>{
 const r=compare([record('a')]);assert.equal(r.independent_samples_verified,false);assert.equal(r.actual_telegram_ack_verified,false);
});
test('unconfirmed evidence stays in the coverage denominator rather than vanishing',()=>{
 const a=record('a'),b=record('b');b.direction_response=classify(ev({status:'INSUFFICIENT_EVIDENCE'}));
 const r=compare([a,b]);assert.equal(r.valid_decisions,2);assert.equal(r.strategies.price_response.coverage,.5);
});
test('conflicting duplicate records are excluded rather than accepting the favorable first copy',()=>{
 const a=record('same',{raw:.5}),b=record('same',{raw:-.5});
 const r=compare([a,b]);assert.equal(r.measured_records,0);assert.equal(r.valid_decisions,0);
});
