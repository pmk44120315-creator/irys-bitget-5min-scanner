import test from 'node:test';
import assert from 'node:assert/strict';
import {v37BuildEvents,v37LabelEvents,v37AssessSnapshot} from '../deployment/v37_early.mjs';
import {v36Observe,v36Summary} from '../deployment/v36_shadow.mjs';
import {v36Evidence} from '../deployment/v36_hypotheses.mjs';
const T=1794000000000;
function item(){
 const venue='bitget',symbol='AAAUSDT';
 return {candidate:{venue,symbol,direction:'LONG'},
 first:{venue,symbol,observed_at_ms:T-20000,quote:{bid:100,ask:100.01,at_ms:T-20000},trades:[0,1,2].map(i=>({id:'a'+i,at_ms:T-50000+i*10000,price:100+i*.01,size:10,side:'BUY'}))},
 second:{venue,symbol,observed_at_ms:T-1000,quote:{bid:100.08,ask:100.09,at_ms:T-1000},trades:[0,1,2].map(i=>({id:'b'+i,at_ms:T-15000+i*5000,price:100.04+i*.02,size:10,side:'BUY'}))},
 final:{venue,symbol,observed_at_ms:T,quote:{bid:100.1,ask:100.11,at_ms:T}}};
}
function packet(){return {version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:'fixture',started_at_ms:T-60000,at_ms:T+1000,items:[item()],checks:[],orders_sent:false,telegram_sent:false}}
const history={AAAUSDT:[[T-900000,100,1000000],[T-600000,100.02,1200000],[T-300000,100.03,1700000],[T,100.05,3000000]]};
test('V37: label step must retain futures history across serialization/restart',()=>{
 const saved=v37LabelEvents({events:[],futuresHistory:history,last_source_at_ms:T},[],T+1000);
 const restarted=JSON.parse(JSON.stringify(saved));
 assert.deepEqual(restarted.futuresHistory,history);
 assert.equal(restarted.last_source_at_ms,T);
});
test('V37: build step preserves independent futures history without aliasing',()=>{
 const saved=v37BuildEvents({events:[],futuresHistory:history,last_source_at_ms:T},[],T).state;
 assert.deepEqual(saved.futuresHistory,history);
 saved.futuresHistory.AAAUSDT[0][1]=999;
 assert.equal(history.AAAUSDT[0][1],100);
});
test('V37: repeated runner-like persistence accumulates enough actual prior observations',()=>{
 let old={events:[]};
 for(const point of history.AAAUSDT){
  const built=v37BuildEvents(old,[],point[0]).state;
  built.futuresHistory={AAAUSDT:[...(old.futuresHistory?.AAAUSDT||[]),point]};
  built.last_source_at_ms=point[0];
  old=JSON.parse(JSON.stringify(v37LabelEvents(built,[],point[0])));
 }
 assert.equal(old.futuresHistory?.AAAUSDT.length,4);
 assert.equal(v37AssessSnapshot({venue:'bitget',symbol:'AAAUSDT',points:old.futuresHistory.AAAUSDT,observed_at_ms:T,flow_kind:'BITGET_ROLLING_24H_QUOTE_DIFFERENCE_PROXY'},T).status,'OBSERVED');
});
test('V36: enrollment timestamp is decision time, never older source-publication time',()=>{
 const e=v36Observe({},{packet:packet(),now:T+21000,baselineDigest:'fixture'}).events[0];
 assert.ok(e);assert.equal(e.issued_at_ms,T+21000);
 assert.equal(e.time_basis,'ACTUAL_EVALUATOR_DECISION_CLOCK');
 assert.equal(e.source_observed_at_ms,T+1000);
 assert.equal(e.source_to_decision_latency_ms,20000);
 assert.equal(e.entry_reference_is_live_executable,false);
});
test('V36: a quote stale at real decision cannot pass through a fresh packet clock',()=>{
 const out=v36Observe({},{packet:packet(),now:T+60000,baselineDigest:'fixture'});
 assert.equal(out.events.length,0);
});
test('V36: missing benchmark time window cannot be treated as relative-strength evidence',()=>{
 const e=v36Evidence(item(),T,{market_move_pct:-2,source_at_ms:T});
 assert.equal(e.status,'OBSERVED');
 assert.equal(e.evidence.market_baseline_available,false);
 assert.equal(e.evidence.relative_to_market_pct,null);
});
test('V36: 20-second asset move must not subtract 5-minute BTC move',()=>{
 const e=v36Evidence(item(),T,{market_move_pct:-2,source_at_ms:T,window_start_ms:T-300000,window_end_ms:T});
 assert.equal(e.evidence.market_baseline_available,false);
});
test('V36: truly aligned benchmark remains usable',()=>{
 const e=v36Evidence(item(),T,{market_move_pct:.01,source_at_ms:T,window_start_ms:T-20000,window_end_ms:T});
 assert.equal(e.evidence.market_baseline_available,true);
 assert.ok(Number.isFinite(e.evidence.relative_to_market_pct));
});
test('V36: legacy records are not upgraded to verified clock records',()=>{
 const out=v36Observe({events:[{id:'legacy',venue:'bitget',symbol:'OLDUSDT',direction:'LONG',issued_at_ms:T-300000,outcomes:{},direction_outcomes:{}}]},
 {packet:packet(),now:T+21000,baselineDigest:'fixture'});
 assert.equal(out.state.events[0].time_basis,undefined);
 const sum=v36Summary(out.state);
 assert.equal(sum.clock_verified,1);assert.equal(sum.legacy_unverified_clock,1);
 assert.equal(sum.raw_candidate_statistics_not_alert_accuracy,true);
});
test('V36: malformed noninteger decision time cannot produce a labeled opportunity',()=>{
 const p=packet();assert.equal(v36Observe({},{packet:p,now:T+1000.5,baselineDigest:'fixture'}).events.length,0);
});
test('V36: competing price-response hypotheses are frozen at enrollment, before outcomes',()=>{
 const e=v36Observe({},{packet:packet(),now:T+21000,baselineDigest:'fixture'}).events[0];
 assert.ok(e.direction_response);
 assert.equal(e.direction_response.decided_at_ms,e.issued_at_ms);
 assert.equal(e.direction_response.hypotheses.agreement,'LONG');
 assert.equal(e.direction_response.trade_permission,false);
 assert.deepEqual(e.direction_outcomes,{});
});
test('V36: the same source packet cannot become a new opportunity across a decision-time episode boundary',()=>{
 const p=packet(),boundary=Math.ceil(p.at_ms/1800000)*1800000,shift=boundary-10000-p.at_ms;
 p.at_ms+=shift;p.started_at_ms+=shift;
 for(const x of [p.items[0].first,p.items[0].second,p.items[0].final]){
  x.observed_at_ms+=shift;x.quote.at_ms+=shift;for(const t of x.trades||[])t.at_ms+=shift;
 }
 const first=v36Observe({},{packet:p,now:boundary-5000,baselineDigest:'fixture'});
 const second=v36Observe(first.state,{packet:p,now:boundary+5000,baselineDigest:'fixture'});
 assert.equal(first.events.length,1);assert.equal(second.events.length,0);assert.equal(second.state.events.length,1);
});
