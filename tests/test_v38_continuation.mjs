test('first bullish stabilization after a large red pullback is early WATCH before full previous-high reclaim',()=>{
 const partial=[...closes.slice(0,-1),117.8];
 const r=v38Detect(input(partial));
 assert.equal(r.status,'EARLY_TURN_WATCH',JSON.stringify(r));
 assert(r.close_reference<r.previous_impulse_high);
 assert.equal(r.trade_permit,false);
 assert.equal(r.entry_ready,false);
 assert.equal(r.confirmation_after_low_not_exact_bottom,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {v38Detect,v38ParseBitgetCandles,V38_VERSION} from '../deployment/v38_continuation.mjs';
const STEP=300000,START=1793940000000;
const closes=[...Array.from({length:36},(_,i)=>100+i*.55),121.2,123,125,126,123.2,120.6,118,116,118.8];
function barsFrom(values,at=START){
 return values.map((close,i)=>{const open=i===0?values[0]:values[i-1];
 return {start_ms:at+i*STEP,open,high:Math.max(open,close)+.32,low:Math.min(open,close)-.32,close,turnover_quote:1000+(i>=35?6000:100)}});
}
function input(values=closes,now=START+values.length*STEP,direction='LONG',venue='bitget'){
 return {venue,symbol:venue==='bitget'?'ONEUSDT':'KRW-ONE',direction,bars:barsFrom(values),now};
}
test('ONE-like 5m first sharp pullback rebound is an early hypothesis, before prior impulse high breakout',()=>{
 const r=v38Detect(input());
 assert.equal(r.version,V38_VERSION);
 assert.equal(r.status,'EARLY_RECLAIM',JSON.stringify(r));
 assert.equal(r.direction,'LONG');assert(r.close_reference<r.previous_impulse_high);
 assert(r.stop_reference<r.close_reference);
 assert(r.prior_high_reward_risk>0.8);
 assert.equal(r.trade_permit,false);assert.equal(r.future_accuracy_proven,false);
});
test('symmetrical relief rally then resumption can make a SHORT hypothesis, not a forced long',()=>{
 const values=closes.map(x=>300-x);
 const r=v38Detect(input(values,START+values.length*STEP,'SHORT'));
 assert.equal(r.status,'EARLY_RECLAIM',JSON.stringify(r));
 assert.equal(r.direction,'SHORT');assert(r.stop_reference>r.close_reference);
});
test('pre-pullback impulse peak and trough exist only in completed candles, not later rally',()=>{
 const old=v38Detect(input());
 const future=[...closes,135,145,160];
 const same=v38Detect(input(future,START+closes.length*STEP));
 assert.equal(same.status,old.status);
 assert.equal(same.previous_impulse_high,old.previous_impulse_high);
 assert.equal(same.close_reference,old.close_reference);
});
test('current still-open 5-minute bar cannot be treated as a fully confirmed rebound',()=>{
 const now=START+closes.length*STEP-3000;
 const r=v38Detect(input(closes,now));
 assert.notEqual(r.status,'EARLY_RECLAIM');
});
test('already-extended chase beyond previous impulse top is not an early reclaim',()=>{
 const extended=[...closes.slice(0,-1),130];
 const r=v38Detect(input(extended));
 assert.notEqual(r.status,'EARLY_RECLAIM');
 assert.equal(r.trade_permit,false);
});
test('sideways price with a green bounce is not called trend continuation',()=>{
 const xs=[...Array.from({length:36},(_,i)=>100+(i%3)*.02),101,101.3,101,101.1,100.8,100.4,100.1,100,100.7];
 const r=v38Detect(input(xs));assert.notEqual(r.status,'EARLY_RECLAIM');
});
test('noncryptocurrency identity and Bithumb SHORT are rejected',()=>{
 for(const bad of [{...input(),venue:'bitget',symbol:'AAPL'},{...input(),venue:'bithumb',symbol:'KRW-ONE',direction:'SHORT'}]){
 const r=v38Detect(bad);assert.equal(r.status,'INVALID_SOURCE');}
});
test('duplicated native 5m bars do not create a false winning pattern',()=>{
 const xs=barsFrom(closes);xs.push({...xs.at(-1)});
 const r=v38Detect({venue:'bitget',symbol:'ONEUSDT',direction:'LONG',bars:xs,now:START+closes.length*STEP});
 assert.equal(r.status,'INVALID_SOURCE');
});
test('fake future prices and malformed candles cannot be counted as past observations',()=>{
 const malformed=barsFrom(closes);malformed[22].low=malformed[22].high+1;
 const a=v38Detect({...input(),bars:malformed});
 assert.equal(a.status,'INVALID_SOURCE');
});
test('Bitget official candle quote turnover is preserved as a measured feature, never called CVD',()=>{
 const t=START,raw={code:'00000',data:[[String(t),'100','101','99','100.2','250','25000'],[String(t+STEP),'100.2','102','100','101','300','30000']]};
 const r=v38ParseBitgetCandles(raw,t+2*STEP);
 assert.equal(r.status,'OBSERVED');assert.equal(r.bars.length,2);
 assert.equal(r.bars[0].turnover_quote,25000);
 assert.equal(r.full_taker_cvd_verified,false);
});
test('when a provider returns an invalid schema, do not silently claim there are no candidates',()=>{
 const r=v38ParseBitgetCandles({code:'ERROR',data:[]},START+STEP);
 assert.equal(r.status,'SOURCE_UNAVAILABLE');
});
