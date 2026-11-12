import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../../deployment/v37_runner.mjs';
import * as r from '../../deployment/v36_runner.mjs';
import * as labels from '../../deployment/v36_paths.mjs';
// Execute complete production modules, not extracted function bodies.
const MIN=60000,NOW=Date.parse('2026-11-11T00:00:00Z');
const measured=()=>Object.fromEntries([5,15,30,60].map(h=>[h,{status:'MEASURED_DIRECTION',direction_positive:false}]));
function event(age=70,extra={}){
 const issued=NOW-age*MIN;
 return {id:'event-'+age,venue:'bitget',symbol:'AAAUSDT',direction:'LONG',time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',
 issued_at_ms:issued,source_observed_at_ms:issued-1000,first_complete_start_ms:issued,
 entry_price:100,outcomes:{},...extra};
}

test('retry an unmeasured event after the former 65-minute expiry',()=>{
 const out=p.v37PendingMarkets([event(66)],NOW);
 assert.equal(out.length,1);
 assert.equal(out[0].history_end_ms,NOW-6*MIN);
});
test('recover an eight-hour-old event without reissuing its timestamp',()=>{
 const e=event(480),before=structuredClone(e),out=p.v37PendingMarkets([e],NOW);
 assert.equal(out.length,1);assert.equal(out[0].issued_at_ms,NOW-480*MIN);
 assert.equal(out[0].history_end_ms,NOW-420*MIN);assert.deepEqual(e,before);
});
test('new event for the same market cannot overwrite its older due episode',()=>{
 const out=p.v37PendingMarkets([event(55),event(30,{symbol:'BBBUSDT'}),event(6)],NOW,1);
 assert.equal(out[0]?.symbol,'AAAUSDT');assert.equal(out[0].issued_at_ms,NOW-55*MIN);
});
test('do not spend history budget before the first result can mature',()=>{
 assert.deepEqual(p.v37PendingMarkets([event(2)],NOW),[]);
});
test('completed events do not cause repeated network reads',()=>{
 assert.deepEqual(p.v37PendingMarkets([event(70,{outcomes:measured()})],NOW),[]);
});
test('exclude legacy clocks and observation times later than decision time',()=>{
 assert.deepEqual(p.v37PendingMarkets([event(20,{time_basis:'LEGACY'}),event(20,{source_observed_at_ms:NOW})],NOW),[]);
});
test('reject future issue times and malformed market identity',()=>{
 assert.deepEqual(p.v37PendingMarkets([event(-1),event(20,{venue:'other'}),event(20,{symbol:'../BTC'})],NOW),[]);
});
test('negative or non-integer query budget cannot select accidental markets',()=>{
 const events=[event(30),event(25,{symbol:'BBBUSDT'})];
 for(const max of [-1,0,1.5,NaN])assert.deepEqual(p.v37PendingMarkets(events,NOW,max),[]);
});
test('invalid clock and non-array events are handled without scheduling work',()=>{
 assert.deepEqual(p.v37PendingMarkets(null,NOW),[]);
 assert.deepEqual(p.v37PendingMarkets([event()],NaN),[]);
});
test('already attempted unavailable market does not starve another market',()=>{
 const out=p.v37PendingMarkets([event(70,{native_history_last_attempt_at_ms:NOW-MIN}),event(60,{symbol:'BBBUSDT'})],NOW,1);
 assert.equal(out[0]?.symbol,'BBBUSDT');
});
test('another episode of the same market gets its turn after an older failed episode',()=>{
 const out=p.v37PendingMarkets([event(80,{native_history_last_attempt_at_ms:NOW-MIN}),event(20)],NOW,1);
 assert.equal(out[0]?.issued_at_ms,NOW-20*MIN);
});
test('record history attempts only for the selected immutable episode',()=>{
 assert.equal(typeof p.v37RecordHistoryAttempts,'function');
 const old={events:[event(80),event(20)],futuresHistory:{AAAUSDT:[[NOW,100,1]]}},snapshot=structuredClone(old);
 const selected=p.v37PendingMarkets(old.events,NOW,1);
 const out=p.v37RecordHistoryAttempts(old,selected,NOW);
 assert.deepEqual(old,snapshot);
 assert.equal(out.events[0].native_history_last_attempt_at_ms,NOW);
 assert.equal(out.events[1].native_history_last_attempt_at_ms,undefined);
 assert.equal(out.events[0].issued_at_ms,snapshot.events[0].issued_at_ms);
 assert.deepEqual(out.futuresHistory,snapshot.futuresHistory);
});
test('failed requests are rotated while remaining eligible on a subsequent cycle',()=>{
 assert.equal(typeof p.v37RecordHistoryAttempts,'function');
 let state={events:[event(80),event(70,{symbol:'BBBUSDT'})]};
 const first=p.v37PendingMarkets(state.events,NOW,1);
 state=p.v37RecordHistoryAttempts(state,first,NOW);
 const second=p.v37PendingMarkets(state.events,NOW+MIN,1);
 assert.equal(second[0].symbol,'BBBUSDT');
 state=p.v37RecordHistoryAttempts(state,second,NOW+MIN);
 const third=p.v37PendingMarkets(state.events,NOW+2*MIN,1);
 assert.equal(third[0].symbol,'AAAUSDT');
});

const oldEnd=NOW-420*MIN;
function bitgetBar(t,close='101'){return [String(t),'100','102','99',close,'1000','100000'];}
test('request Bitget candles around the event horizon, not around the current time',async()=>{
 let seen;
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:oldEnd}],async url=>{seen=new URL(url);return {code:'00000',data:[bitgetBar(oldEnd-MIN)]};},NOW);
 assert.equal(seen.hostname,'api.bitget.com');assert.equal(seen.searchParams.get('endTime'),String(oldEnd));
 assert.equal(out.pages[0].bars.length,1);
});
test('request Bithumb event-window end in the officially required KST format',async()=>{
 let seen;
 await r.v36NativeHistory([{venue:'bithumb',symbol:'KRW-AAA',history_end_ms:oldEnd}],async url=>{seen=new URL(url);return [];},NOW);
 assert.equal(seen.hostname,'api.bithumb.com');
 assert.equal(seen.searchParams.get('to'),'2026-11-11T02:00:00');
});
test('a response candle after the requested historical horizon is excluded',async()=>{
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:oldEnd}],async()=>({code:'00000',data:[bitgetBar(oldEnd-MIN),bitgetBar(oldEnd)]}),NOW);
 assert.equal(out.pages[0].bars.length,1);assert.equal(out.pages[0].bars[0].start_ms,oldEnd-MIN);
});
test('invalid or future historical bounds never reach the network',async()=>{
 let calls=0;
 for(const bound of [NOW+MIN,-1,NaN,'123',null]){
  const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:bound}],async()=>{calls++;return {code:'00000',data:[]};},NOW);
  assert.equal(out.pages.length,0);assert.equal(out.errors[0]?.reason,'INVALID_HISTORY_END_MS');
 }assert.equal(calls,0);
});
test('existing callers without a historical bound retain current-window behavior',async()=>{
 let seen;
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT'}],async url=>{seen=new URL(url);return {code:'00000',data:[bitgetBar(NOW-MIN)]};},NOW);
 assert.equal(seen.searchParams.get('endTime'),String(NOW));assert.equal(out.pages[0].bars.length,1);
});
test('official history failure stays an error rather than an invented price',async()=>{
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:oldEnd}],async()=>{throw Error('provider failure')},NOW);
 assert.equal(out.pages.length,0);assert.equal(out.errors.length,1);
});
test('empty history does not create a candle',async()=>{
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:oldEnd}],async()=>({code:'00000',data:[]}),NOW);
 assert.deepEqual(out.pages[0].bars,[]);
});
test('conflicting official candles remain rejected',async()=>{
 const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT'}],async()=>({code:'00000',data:[bitgetBar(NOW-MIN,'100'),bitgetBar(NOW-MIN,'101')]}),NOW);
 assert.equal(out.pages.length,0);assert.equal(out.errors[0].reason,'CONFLICTING_NATIVE_CANDLES');
});

const issued=NOW-10*MIN;
const closeEvent={issued_at_ms:issued,first_complete_start_ms:issued,entry_price:100,direction:'LONG'};
const closeBar={start_ms:NOW-6*MIN,open:100,high:102,low:99,close:101};
for(const [name,value] of [['zero',0],['negative',-10],['missing',undefined],['NaN',NaN],['infinite',Infinity]]){
 test(`invalid ${name} entry price cannot produce a measured direction`,()=>{
  assert.equal(labels.v36LabelClose({...closeEvent,entry_price:value},[closeBar],NOW,5).status,'INVALID_INPUT');
 });
}
test('unsupported direction cannot be silently evaluated as LONG',()=>{
 assert.equal(labels.v36LabelClose({...closeEvent,direction:'WAIT'},[closeBar],NOW,5).status,'INVALID_INPUT');
});
test('malformed issue and complete-candle clocks cannot be measured',()=>{
 for(const extra of [{issued_at_ms:'10'},{issued_at_ms:NOW+MIN},{first_complete_start_ms:NaN},{first_complete_start_ms:issued-1}])
  assert.equal(labels.v36LabelClose({...closeEvent,...extra},[closeBar],NOW,5).status,'INVALID_INPUT');
});
test('valid LONG and SHORT signed outcomes remain opposite',()=>{
 const a=labels.v36LabelClose(closeEvent,[closeBar],NOW,5);
 const b=labels.v36LabelClose({...closeEvent,direction:'SHORT'},[closeBar],NOW,5);
 assert.equal(a.status,'MEASURED_DIRECTION');assert.equal(a.direction_positive,true);
 assert.equal(b.status,'MEASURED_DIRECTION');assert.equal(b.direction_positive,false);
 assert.ok(Math.abs(a.signed_direction_pct-1)<1e-9);assert.ok(Math.abs(b.signed_direction_pct+1)<1e-9);
});
test('flat price is measured but not direction-positive',()=>{
 const out=labels.v36LabelClose(closeEvent,[{...closeBar,close:100}],NOW,5);
 assert.equal(out.status,'MEASURED_DIRECTION');assert.equal(out.direction_positive,false);
});
test('absent target candle remains unmeasured',()=>{
 assert.equal(labels.v36LabelClose(closeEvent,[],NOW,5).status,'UNMEASURED_TARGET');
});
test('future target close remains pending',()=>{
 assert.equal(labels.v36LabelClose(closeEvent,[closeBar],NOW-6*MIN,5).status,'PENDING');
});
test('same-minute target and stop touches stay ambiguous',()=>{
 const e={...closeEvent,version:'V36_FROZEN_BARRIERS_V1',target_price:101,stop_price:99};
 const bar={start_ms:issued,open:100,high:102,low:98,close:100};
 const out=labels.v36Label(e,[bar],NOW,5);
 assert.equal(out.status,'AMBIGUOUS_BOTH');assert.equal(out.actual_execution_verified,false);
});
test('extremely small positive entry cannot overflow into a measured result',()=>{
 const out=labels.v36LabelClose({...closeEvent,entry_price:Number.MIN_VALUE},[closeBar],NOW,5);
 assert.equal(out.status,'INVALID_INPUT');
});

test('invalid evaluation clock must not allow native-history network access',async()=>{
 let calls=0;
 for(const clock of [NaN,Infinity,-1,'123']){
  const out=await r.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:oldEnd}],async()=>{calls++;return {code:'00000',data:[]};},clock);
  assert.equal(out.pages.length,0);assert.equal(out.errors[0]?.reason,'INVALID_READER_OR_MARKETS');
 }assert.equal(calls,0);
});
test('delayed episode flows from scheduling to all four closed-candle outcomes',async()=>{
 const e=event(480),before=structuredClone(e),selected=p.v37PendingMarkets([e],NOW);
 assert.equal(selected.length,1);
 const fetched=await r.v36NativeHistory(selected,async url=>{
  const end=Number(new URL(url).searchParams.get('endTime'));
  assert.equal(end,NOW-420*MIN);
  return {code:'00000',data:Array.from({length:120},(_,i)=>bitgetBar(end-(i+1)*MIN))};
 },NOW);
 assert.equal(fetched.errors.length,0);
 for(const h of [5,15,30,60]){
  const out=labels.v36LabelClose(e,fetched.pages[0].bars,NOW,h);
  assert.equal(out.status,'MEASURED_DIRECTION');assert.equal(out.actual_execution_verified,false);
  assert.equal(out.close_at_ms,e.issued_at_ms+h*MIN);assert.equal(out.direction_positive,true);
 }
 assert.deepEqual(e,before);
});
test('failed delayed history cannot turn into successful price measurement',async()=>{
 const e=event(480),selected=p.v37PendingMarkets([e],NOW);
 assert.equal(selected.length,1);
 const fetched=await r.v36NativeHistory(selected,async()=>{throw Error('official unavailable')},NOW);
 assert.equal(fetched.pages.length,0);assert.equal(fetched.errors.length,1);
 for(const h of [5,15,30,60])assert.equal(labels.v36LabelClose(e,[],NOW,h).status,'UNMEASURED_TARGET');
});
test('already measured horizons do not consume requests for still-future horizons',()=>{
 const e=event(20,{outcomes:{5:{status:'MEASURED_DIRECTION'},15:{status:'MEASURED_DIRECTION'}}});
 assert.deepEqual(p.v37PendingMarkets([e],NOW),[]);
});
