import test from 'node:test';
import assert from 'node:assert/strict';
import * as paths from '../../deployment/v36_paths.mjs';
import * as runner from '../../deployment/v36_runner.mjs';
import {v36Advance} from '../../deployment/v36_shadow.mjs';
import {v37BuildEvents,v37LabelEvents} from '../../deployment/v37_early.mjs';
import {v37PendingMarkets,v37Stats} from '../../deployment/v37_runner.mjs';
import {v37CompareToReady} from '../../deployment/v37_compare.mjs';
const M=60000,T=Date.parse('2026-11-12T00:00:00Z'),V='V48_CLOSED_MINUTE_AT_OR_AFTER_TARGET_V1';
function event(issued=T+30000,extra={}) { return {id:'e:'+issued,venue:'bitget',symbol:'AAAUSDT',direction:'LONG',issued_at_ms:issued,
 source_observed_at_ms:issued-1000,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',first_complete_start_ms:Math.ceil(issued/M)*M,
 entry_price:100,source_label:'PUBLIC_PRIOR_OBSERVATIONS_ONLY',trade_permit:false,outcomes:{},...extra}; }
const bar=(start,close=101)=>({start_ms:start,open:100,high:Math.max(103,close),low:Math.min(98,close),close});
function page(bars,extra={}) {return {venue:'bitget',symbol:'AAAUSDT',source:'OFFICIAL_NATIVE_1M',fetched_at_ms:T+100*M,bars,...extra};}
function selected(now,extra={}) {return {status:'OBSERVED',phase:'EARLY_FLOW_LEAD',trade_permit:false,venue:'bitget',symbol:'AAAUSDT',direction:'LONG',observed_at_ms:now,current_price:100,first_recorded_price:99,pre_observation_move_pct:1,early_score:2,flow_source:'BITGET_ROLLING_24H_QUOTE_DIFFERENCE_PROXY',flow_acceleration:2,last_move_pct:.1,extension_ratio:.2,relative_to_market_pct:.05,...extra};}
test('subminute 5m target uses first CLOSED minute at or after exact target, not previous close',()=>{
 const r=paths.v36LabelClose(event(),[bar(T+4*M,90),bar(T+5*M,101)],T+7*M,5);
 assert.equal(r.close_at_ms,T+6*M);assert.equal(r.target_close,101);assert.equal(r.measurement_offset_ms,30000);assert.equal(r.measurement_version,V);
 assert.equal(r.horizon_reference,'FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET');
});
test('target that has elapsed but whose selected close is not closed stays pending',()=>{
 assert.equal(paths.v36LabelClose(event(),[bar(T+4*M,90),bar(T+5*M,101)],T+5*M+45000,5).status,'PENDING');
});
test('missing exact target close cannot be replaced by preceding or following candles',()=>{
 assert.equal(paths.v36LabelClose(event(),[bar(T+4*M,90),bar(T+6*M,102)],T+8*M,5).status,'UNMEASURED_TARGET');
});
test('exact-minute target keeps zero timing error',()=>{
 const r=paths.v36LabelClose(event(T),[bar(T+4*M)],T+5*M,5);assert.equal(r.close_at_ms,T+5*M);assert.equal(r.measurement_offset_ms,0);
});
test('identical duplicates do not fabricate conflict, contradictory duplicates do',()=>{
 assert.equal(paths.v36LabelClose(event(),[bar(T+5*M),bar(T+5*M)],T+7*M,5).status,'MEASURED_DIRECTION');
 assert.equal(paths.v36LabelClose(event(),[bar(T+5*M),bar(T+5*M,102)],T+7*M,5).status,'CONFLICTING_CANDLES');
});
test('complete postissue minute path reports observed MAE/MFE without claiming ticks or fills',()=>{
 const r=paths.v36LabelClose(event(),Array.from({length:5},(_,i)=>bar(T+(i+1)*M)),T+7*M,5);
 assert.equal(r.path_minutes_expected,5);assert.equal(r.path_minutes_observed,5);assert.equal(r.path_complete,true);
 assert.ok(Math.abs(r.max_adverse_pct+2)<1e-9);assert.ok(Math.abs(r.max_favorable_pct-3)<1e-9);
 assert.equal(r.entry_minute_partial_omitted,true);assert.equal(r.intraminute_order_known,false);assert.equal(r.actual_execution_verified,false);
});
test('missing middle minute does not turn partial extrema into complete maximum drawdown',()=>{
 const r=paths.v36LabelClose(event(),[bar(T+M),bar(T+5*M)],T+7*M,5);
 assert.equal(r.status,'MEASURED_DIRECTION');assert.equal(r.path_complete,false);assert.equal(r.max_adverse_pct,null);
 assert.equal(r.path_minutes_observed,2);assert.ok(r.observed_max_adverse_pct<0);
});
test('spot SHORT is not a valid spot directional outcome',()=>{
 assert.equal(paths.v36LabelClose(event(T,{venue:'bithumb',symbol:'KRW-AAA',direction:'SHORT'}),[bar(T+4*M)],T+10*M,5).status,'INVALID_INPUT');
});
test('SHORT full path extrema reverse the correct high and low signs',()=>{
 const r=paths.v36LabelClose(event(T,{direction:'SHORT'}),Array.from({length:5},(_,i)=>bar(T+i*M,99)),T+6*M,5);
 assert.ok(Math.abs(r.max_adverse_pct+3)<1e-9);assert.ok(Math.abs(r.max_favorable_pct-2)<1e-9);
});
test('barrier labels reject malformed directions and missing frozen risk before touching candles',()=>{
 const e={...event(T),version:paths.V36_PATH_VERSION,barriers_locked:true,risk_price:1,target_price:101.5,stop_price:99};
 for(const patch of [{direction:'WAIT'},{entry_price:0},{risk_price:null},{target_price:NaN},{stop_price:105}])
  assert.equal(paths.v36Label({...e,...patch},[bar(T)],T+10*M,5).status,'INVALID_INPUT');
});
test('same-minute target and stop remains ambiguous after corrected clock upgrade',()=>{
 const e={...event(T),version:paths.V36_PATH_VERSION,barriers_locked:true,risk_price:1,target_price:101.5,stop_price:99};
 assert.equal(paths.v36Label(e,[bar(T)],T+10*M,5).status,'AMBIGUOUS_BOTH');
});
test('a conflict outside barrier evaluation interval cannot change a frozen valid first touch',()=>{
 const e={...event(T),version:paths.V36_PATH_VERSION,barriers_locked:true,risk_price:1,target_price:102,stop_price:98};
 const safe={start_ms:T,open:100,high:103,low:99,close:102};
 assert.equal(paths.v36Label(e,[safe,bar(T+20*M),bar(T+20*M,104)],T+30*M,5).status,'TARGET_FIRST');
});
test('two historical windows of one market remain separate native requests',async()=>{
 const urls=[];const r=await runner.v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT',history_end_ms:T+5*M},{venue:'bitget',symbol:'AAAUSDT',history_end_ms:T+65*M}],async u=>{urls.push(new URL(u));return {code:'00000',data:[]};},T+100*M);
 assert.equal(urls.length,2);assert.equal(r.pages.length,2);assert.deepEqual(urls.map(u=>Number(u.searchParams.get('endTime'))).sort((a,b)=>a-b),[T+5*M,T+65*M]);
 assert.notEqual(r.pages[0].request_key,r.pages[1].request_key);
});
test('boolean prices are not valid exchange numbers',()=>{
 const r=runner.parsedBars({code:'00000',data:[[T,true,2,.5,true,1]]},'bitget','AAAUSDT',T+M);assert.equal(r.bars.length,0);
});
test('V36 still retries old quote-only direction measurements after 61 minutes',()=>{
 const e=event(T,{barriers_locked:false,direction_outcomes:{}});
 assert.equal(runner.pendingMarkets({events:[e]},T+120*M,40).length,1);
});
test('V36 fully evaluated direction AND barrier records no longer consume history requests',()=>{
 const direction=Object.fromEntries([5,15,30,60].map(h=>[h,{status:'MEASURED_DIRECTION'}]));
 assert.equal(runner.pendingMarkets({events:[event(T,{barriers_locked:false,direction_outcomes:direction})]},T+120*M,40).length,0);
});
test('history request budget never selects a subminute target before its close',()=>{
 assert.equal(v37PendingMarkets([event()],T+5*M+45000).length,0);
});
test('historical recovery window includes the corrected final 60-minute close',()=>{
 const r=v37PendingMarkets([event()],T+120*M);assert.equal(r[0].history_end_ms,T+61*M);
});
test('V37 migration preserves exact legacy results and immutable candidate facts',()=>{
 const e=event();e.outcomes['5']={status:'MEASURED_DIRECTION',at_ms:T+5*M,close_price:90,signed_pct:-10,direction_positive:false,actual_execution_verified:false};
 const before=structuredClone(e);const r=v37LabelEvents({events:[e]},[page([bar(T+4*M,90),bar(T+5*M,101)])],T+100*M).events[0];
 assert.deepEqual(e,before);assert.deepEqual(r.legacy_outcomes_v37,before.outcomes);assert.equal(r.outcomes[5].at_ms,T+6*M);assert.equal(r.outcomes[5].measurement_version,V);
 for(const k of ['id','issued_at_ms','source_observed_at_ms','entry_price','direction'])assert.equal(r[k],before[k]);
});
test('migration without available official pages is explicit unmeasured, never legacy counted as corrected',()=>{
 const e=event();e.outcomes[5]={status:'MEASURED_DIRECTION',direction_positive:true};
 const r=v37LabelEvents({events:[e]},[],T+100*M);assert.deepEqual(r.events[0].legacy_outcomes_v37,e.outcomes);
 assert.equal(v37Stats(r.events).measured[5],0);assert.equal(v37Stats(r.events).measurement_version,V);
});
test('repeated labeling preserves already measured corrected values and original legacy archive',()=>{
 const old=event();old.outcomes[5]={status:'MEASURED_DIRECTION',direction_positive:false};
 const a=v37LabelEvents({events:[old]},[page([bar(T+5*M,101)])],T+100*M);
 const b=v37LabelEvents(a,[page([bar(T+5*M,105)])],T+101*M);
 assert.deepEqual(b.events[0].legacy_outcomes_v37,a.events[0].legacy_outcomes_v37);assert.deepEqual(b.events[0].outcomes[5],a.events[0].outcomes[5]);
});
test('same-market multiple native pages are merged without discarding earlier episodes',()=>{
 const a=event(T),b=event(T+60*M);const r=v37LabelEvents({events:[a,b]},[page([bar(T+4*M)]),page([bar(T+64*M)])],T+100*M);
 assert.equal(r.events[0].outcomes[5].status,'MEASURED_DIRECTION');assert.equal(r.events[1].outcomes[5].status,'MEASURED_DIRECTION');
});
test('native pages from the future cannot leak into retrospective labels',()=>{
 const r=v37LabelEvents({events:[event(T)]},[page([bar(T+4*M)],{fetched_at_ms:T+101*M})],T+100*M);
 assert.notEqual(r.events[0].outcomes[5]?.status,'MEASURED_DIRECTION');
});
test('V36 migration keeps legacy direction outcomes separate and uses the same target clock',()=>{
 const e=event();e.direction_outcomes={5:{status:'MEASURED_DIRECTION',close_at_ms:T+5*M}};e.barriers_locked=false;
 const r=v36Advance({events:[e]},[page([bar(T+5*M)])],T+100*M).events[0];
 assert.deepEqual(r.legacy_direction_outcomes_v36,e.direction_outcomes);assert.equal(r.direction_outcomes[5].close_at_ms,T+6*M);
});
test('rolling 30-minute separation is enforced across a fixed half-hour boundary',()=>{
 const start=Math.floor(T/(30*M))*30*M+30*M-1000;
 const a=v37BuildEvents({},[selected(start)],start);
 const b=v37BuildEvents(a.state,[selected(start+2000)],start+2000);assert.equal(b.added.length,0);
 const c=v37BuildEvents(a.state,[selected(start+30*M)],start+30*M);assert.equal(c.added.length,1);
});
test('opposite valid futures direction remains a separate episode, not silently suppressed',()=>{
 const a=v37BuildEvents({},[selected(T)],T);const b=v37BuildEvents(a.state,[selected(T+1000,{direction:'SHORT'})],T+1000);assert.equal(b.added.length,1);
});
test('expired source observation cannot be reissued as a new current early signal',()=>{
 const r=v37BuildEvents({},[selected(T)],T+31*M);assert.equal(r.added.length,0);
});
test('invalid candidate price never becomes a recorded opportunity',()=>{
 for(const price of [0,NaN,Infinity,-1])assert.equal(v37BuildEvents({},[selected(T,{current_price:price})],T).added.length,0);
});
test('earliest causal features are frozen for later honest out-of-sample analysis',()=>{
 const r=v37BuildEvents({},[selected(T)],T).added[0];assert.equal(r.causal_features.last_move_pct,.1);assert.equal(r.causal_features.extension_ratio,.2);assert.equal(r.causal_features.asof_ms,T);
});
test('retention eviction is returned for durable archival rather than silently discarded',()=>{
 const events=Array.from({length:3000},(_,i)=>event(T-(4000-i)*M,{id:'old:'+i,symbol:'BBBUSDT'}));
 const r=v37BuildEvents({events},[selected(T)],T);assert.equal(r.state.events.length,3000);assert.equal(r.evicted.length,1);assert.equal(r.evicted[0].id,'old:0');
});
test('one READY event cannot be counted as two independent early comparisons',()=>{
 const a=event(T,{id:'a'}),b=event(T+5*M,{id:'b'});
 const ready={venue:'bitget',symbol:'AAAUSDT',direction:'LONG',issued_at_ms:T+10*M,model:'V31_PAIRED_TIMELY_ENTRY_V1',evidence_status:'READY_CURRENT_EVIDENCE',entry_quote:{bid:100,ask:100.1}};
 const r=v37CompareToReady([a,b],[ready,ready]);assert.equal(r.matched,1);assert.equal(r.matches[0].id,'a');assert.equal(r.comparison_unit,'ONE_TO_ONE_SIGNAL_EPISODE');
});
