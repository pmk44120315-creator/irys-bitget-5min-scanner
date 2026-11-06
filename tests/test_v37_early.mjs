import test from 'node:test';
import assert from 'node:assert/strict';
import {v37AssessSnapshot,v37SelectEarly,v37BuildEvents,v37LabelEvents} from '../deployment/v37_early.mjs';
const T=1793952300000, GAP=300000;
const point=(i,p,turn)=>[T-(3-i)*GAP,p,turn];
const early=[point(0,100,1000000),point(1,100.02,1200000),point(2,100.03,1700000),point(3,100.05,3000000)];
const late=[point(0,100,1000000),point(1,103,1300000),point(2,107,1800000),point(3,113,3000000)];
const falling=[point(0,100,1000000),point(1,99.98,1200000),point(2,99.97,1700000),point(3,99.94,3100000)];
const row=(p,venue='bithumb',symbol='KRW-TEST')=>({venue,symbol,points:p,observed_at_ms:T,market_reference_pct:0,eligible:true,flow_kind:'BITHUMB_DAILY_CUMULATIVE_QUOTE'});
test('large trade-value growth before price expansion is visible as early hypothesis, not LONG trade permit',()=>{
 const a=v37AssessSnapshot(row(early),T);
 assert.equal(a.status,'OBSERVED');assert.equal(a.phase,'EARLY_FLOW_LEAD');assert.equal(a.direction,'BUY');
 assert.equal(a.trade_permit,false);assert.equal(a.probability,null);assert(a.flow_acceleration>1);
});
test('already extended chart cannot be called early entry opportunity just for high turnover',()=>{
 const a=v37AssessSnapshot(row(late),T);
 assert.equal(a.phase,'EXTENDED_MOVE');assert.equal(a.entry_ready,false);
 assert(a.pre_observation_move_pct>5);
});
test('early bearish setup is only research, not SHORT order',()=>{
 const x=v37AssessSnapshot(row(falling,'bitget','XYZUSDT'),T);
 assert.equal(x.status,'OBSERVED');assert.equal(x.direction,'SHORT');assert.equal(x.phase,'EARLY_FLOW_LEAD');
 assert.equal(x.trade_permit,false);
});
test('without trustworthy volume baseline, price-only evidence cannot imply early flow support',()=>{
 const x=v37AssessSnapshot(row(early.map(([t,p])=>[t,p,null]),'bitget','XYZUSDT'),T);
 assert.equal(x.status,'PRICE_ONLY');assert.equal(x.direction,'UNCONFIRMED');
 assert.equal(x.phase,'INSUFFICIENT_FLOW');
});
test('cumulative volume resets cannot become fabricated inflow',()=>{
 const x=v37AssessSnapshot(row([point(0,100,1e6),point(1,100.02,1.2e6),point(2,100.03,3000),point(3,100.04,5000)]),T);
 assert.equal(x.status,'INCOMPLETE');assert.equal(x.flow_acceleration,null);
});
test('a source timestamp later than evaluation is never accepted',()=>{
 const x=v37AssessSnapshot({...row(early),observed_at_ms:T+100},T);
 assert.equal(x.status,'INVALID_SOURCE');
});
test('the same 30-minute opportunity never counts as two independent wins',()=>{
 const samples=[row(early),row(early)];const selected=v37SelectEarly(samples,T,12);
 const out=v37BuildEvents({},selected,T);
 assert.equal(out.added.length,1);assert.equal(v37BuildEvents(out.state,selected,T+30000).added.length,0);
});
test('market score ranking cannot reward already fully extended prices by accident',()=>{
 const x=v37SelectEarly([row(late,'bithumb','KRW-LATE'),row(early,'bithumb','KRW-EARLY')],T,1);
 assert.equal(x.length,1);assert.equal(x[0].symbol,'KRW-EARLY');
});
test('outcome uses future native candle, no same-bar success if future range unknown',()=>{
 const x=v37BuildEvents({},v37SelectEarly([row(early)],T,1),T).state;
 assert.equal(x.events.length,1);const before=x.events[0];assert.equal(before.outcomes?.['5'],undefined);
 const minute=Math.ceil(T/60000)*60000;
 const bars=[{start_ms:minute+4*60000,open:100.05,high:101.25,low:99.9,close:100.65}];
 const z=v37LabelEvents(x,[{venue:'bithumb',symbol:'KRW-TEST',bars,source:'OFFICIAL_NATIVE_1M',fetched_at_ms:T+6*60000}],T+6*60000);
 assert.equal(z.events[0].outcomes['5'].status,'MEASURED_DIRECTION');
 assert(z.events[0].outcomes['5'].signed_pct>0);assert.equal(z.events[0].outcomes['5'].actual_execution_verified,false);
});
test('unavailable official candles remain unknown rather than losses or successes',()=>{
 const x=v37BuildEvents({},v37SelectEarly([row(early)],T,1),T).state;
 const z=v37LabelEvents(x,[],T+60*60000);
 assert.equal(z.events[0].outcomes?.['5'],undefined);
});
