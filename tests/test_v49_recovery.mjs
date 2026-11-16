import test from 'node:test';import assert from 'node:assert/strict';
import {v36Observe,v36Advance} from '../deployment/v36_shadow.mjs';
import {V48_MEASUREMENT_VERSION} from '../deployment/v48_measurement.mjs';import {packet,item,T,M} from './v49_fixture.mjs';
const api=await import('../deployment/v49_recovery.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function event(symbol='KRW-TEST',at=T){const x=item('BUY',symbol,at);x.first.trades=[];x.second.trades=[];return v36Observe({},{packet:packet([x],at),now:at,baselineDigest:'exact'}).events[0];}
function state(e=event()){return {events:[e],direction_measurement_version:V48_MEASUREMENT_VERSION};}
const bar=(t)=>({start_ms:t,open:100,high:100.2,low:99.9,close:100.1});
function page(e,now,bars=[bar(e.first_complete_start_ms)],end=now){return {venue:e.venue,symbol:e.symbol,source:'OFFICIAL_NATIVE_1M',fetched_at_ms:now,history_end_ms:end,bars};}
function record(s,pages,errors,now){assert.equal(typeof api.v49RecordHistoryDiagnostics,'function');return api.v49RecordHistoryDiagnostics(s,pages,errors,now);}
function plan(s,now,max=40){assert.equal(typeof api.v49RecoveryPlan,'function');return api.v49RecoveryPlan(s,s,now,max);}
test('bounded response without target minute is explicit unknown, not transport failure or invented candle',()=>{
 const e=event(),now=T+6*M,p=page(e,now),advanced=v36Advance(state(e),[p],now),s=record(advanced,[p],[],now);
 const d=s.events[0].history_recovery.horizons['5'];assert.equal(d.reason,'TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW');assert.equal(d.no_trade_confirmed,false);
 assert.equal(s.events[0].direction_outcomes['5'].status,'UNMEASURED_TARGET');assert.equal(s.events[0].entry_price,e.entry_price);assert.equal(d.next_retry_at_ms,now+5*M);
});
test('unchanged bounded gaps back off but remain measured-missing and retryable',()=>{
 const e=event(),now=T+6*M,p=page(e,now),a=record(v36Advance(state(e),[p],now),[p],[],now);
 assert.equal(plan(a,now+M).length,0);
 const later=now+5*M,b=record(a,[{...p,fetched_at_ms:later}],[],later),d=b.events[0].history_recovery.horizons['5'];
 assert.equal(d.unchanged_responses,2);assert.equal(d.next_retry_at_ms,later+10*M);
 assert.equal(plan(b,later+11*M).length,1);
});
test('a newly due horizon bypasses an old missing horizon cooldown',()=>{
 const e=event(),s=state(e);s.events[0].history_recovery={horizons:{'5':{next_retry_at_ms:T+100*M}}};
 assert.equal(plan(s,T+16*M).length,1);
});
test('provider errors are not classified as absent official target candles',()=>{
 const e=event(),now=T+6*M,s=record(state(e),[],[{venue:e.venue,symbol:e.symbol,reason:'PUBLIC_OFFICIAL_SOURCE_UNAVAILABLE'}],now);
 assert.equal(s.events[0].history_recovery.horizons['5'].reason,'SOURCE_UNAVAILABLE');
 assert.equal(s.events[0].history_recovery.horizons['5'].next_retry_at_ms,now+5*M);
});
test('inadequate window is a recoverable request gap rather than an absent-candle claim',()=>{
 const e=event(),now=T+6*M,s=record(state(e),[page(e,now,[bar(T)],T+4*M)],[],now);
 assert.equal(s.events[0].history_recovery.horizons['5'].reason,'HISTORY_WINDOW_DOES_NOT_COVER_TARGET');
});
test('later real target candle repairs only the outcome, never the frozen event',()=>{
 const e=event(),now=T+6*M,p=page(e,now),a=record(v36Advance(state(e),[p],now),[p],[],now);
 const b=page(e,now+5*M,Array.from({length:5},(_,i)=>bar(T+i*M)),now+5*M),advanced=v36Advance(a,[b],now+5*M),s=record(advanced,[b],[],now+5*M);
 assert.equal(s.events[0].direction_outcomes['5'].status,'MEASURED_DIRECTION');assert.equal(s.events[0].history_recovery.horizons['5'].reason,'RECOVERED');
 for(const k of ['id','issued_at_ms','entry_price','source_quote_at_ms','target_price','stop_price'])assert.equal(s.events[0][k],e[k]);
});
test('fresh due records and old backlog share bounded request capacity without starving either',()=>{
 const now=T+8*60*M,s={direction_measurement_version:V48_MEASUREMENT_VERSION,events:[...Array.from({length:8},(_,i)=>event('KRW-OLD'+i,T)),...Array.from({length:8},(_,i)=>event('KRW-NEW'+i,now-10*M))]};
 const q=plan(s,now,4);assert.equal(q.length,4);assert.equal(q.filter(x=>x.symbol.startsWith('KRW-NEW')).length,3);assert.equal(q.filter(x=>x.symbol.startsWith('KRW-OLD')).length,1);
 assert.equal(new Set(q.map(x=>x.venue+':'+x.symbol)).size,q.length);
});
test('diagnostic summary keeps cooldown missing records visible in the denominator',()=>{
 const e=event(),now=T+6*M,p=page(e,now),s=record(v36Advance(state(e),[p],now),[p],[],now);
 assert.equal(typeof api.v49RecoverySummary,'function');const x=api.v49RecoverySummary(s,now+M);
 assert.equal(x.direction_missing_due,1);assert.equal(x.deferred_retry,1);assert.equal(x.reasons.TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW,1);
});
