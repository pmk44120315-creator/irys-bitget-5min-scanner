import test from 'node:test';import assert from 'node:assert/strict';
import {v36Evidence} from '../deployment/v36_hypotheses.mjs';
import {v36Freeze,v36Label} from '../deployment/v36_paths.mjs';
import {v36Observe,v36Advance,v36Gate} from '../deployment/v36_shadow.mjs';
import {v36Process,v36NativeHistory} from '../deployment/v36_runner.mjs';
const T=1794000000000;
function mk(dir='LONG',symbol='AAAUSDT'){
 const short=dir==='SHORT',side=short?'SELL':'BUY',step=short?-1:1;
 return {candidate:{venue:'bitget',symbol,direction:dir,anchor_price:short?102:98,discovery_price:100},
 first:{venue:'bitget',symbol,observed_at_ms:T-15000,quote:{bid:99.9,ask:100,at_ms:T-15100},
 trades:[0,1,2].map(i=>({id:'f'+i,at_ms:T-22000+i*2000,price:99.8+step*i*.05,size:10,side}))},
 second:{venue:'bitget',symbol,observed_at_ms:T-3000,quote:{bid:100+step*.5,ask:100.1+step*.5,at_ms:T-3500},
 trades:[0,1,2].map(i=>({id:'s'+i,at_ms:T-9500+i*2500,price:100+step*i*.1,size:10,side}))},
 final:{venue:'bitget',symbol,observed_at_ms:T-200,quote:{bid:100+step*.6,ask:100.1+step*.6,at_ms:T-500}}};
}
function pkt(items=[mk()],at=T){return {version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:'exact',started_at_ms:at-30000,at_ms:at,checks:[],items,orders_sent:false,telegram_sent:false};}
test('two-sided evidence is not a calibrated probability or authorization',()=>{
 const x=v36Evidence(mk(),T);assert.equal(x.status,'OBSERVED');assert(x.support>0);assert.equal(x.probability,null);assert.equal(x.trade_permission,false);
});
test('a new opposing sell tape increases counter-hypothesis weight',()=>{
 const a=v36Evidence(mk(),T),bad=mk();bad.second.trades.forEach(x=>x.side='SELL');
 const b=v36Evidence(bad,T);assert(b.counter>a.counter);assert(b.support<a.support);
});
test('historical quote judged at its own time, future evidence rejected',()=>{
 const x=mk();x.first.observed_at_ms=T-57000;x.first.quote.at_ms=T-57100;
 x.first.trades=x.first.trades.map((r,i)=>({...r,at_ms:T-65000+i*1000}));
 assert.equal(v36Evidence(x,T).status,'OBSERVED');
 x.final.observed_at_ms=T+1;assert.equal(v36Evidence(x,T).status,'INVALID_TIME');
});
test('prior trade range and spread freeze targets before future data arrives',()=>{
 const e=v36Freeze(mk(),T);assert(e);assert.equal(e.label_source,'FROZEN_PRIOR_MARKET');assert(e.target_price>e.entry_price);assert(e.stop_price<e.entry_price);
});
test('future path target first, then stop, cannot rewrite the already first target',()=>{
 const e=v36Freeze(mk(),T),s=e.first_complete_start_ms;
 const b=[{start_ms:s,open:e.entry_price,high:e.target_price+1,low:e.entry_price-.01,close:e.target_price},
 {start_ms:s+60000,open:e.entry_price,high:e.target_price,low:e.stop_price-1,close:e.stop_price}];
 assert.equal(v36Label(e,b,s+120000,5).status,'TARGET_FIRST');
});
test('both levels hit in one minute means ambiguous, not 100% accuracy',()=>{
 const e=v36Freeze(mk(),T),s=e.first_complete_start_ms;
 assert.equal(v36Label(e,[{start_ms:s,open:e.entry_price,high:e.target_price+1,low:e.stop_price-1,close:e.entry_price}],s+60000,5).status,'AMBIGUOUS_BOTH');
});
test('missing complete minute remains missing, never forward fills',()=>{
 const e=v36Freeze(mk(),T),s=e.first_complete_start_ms;
 const b=[{start_ms:s,open:e.entry_price,high:e.entry_price,low:e.entry_price,close:e.entry_price},
 {start_ms:s+120000,open:e.entry_price,high:e.target_price+1,low:e.entry_price,close:e.target_price}];
 assert.equal(v36Label(e,b,s+300000,5).status,'UNMEASURED_GAP');
});
test('replay cannot relabel same 30min episode as a new independent hit',()=>{
 const a=v36Observe({},{packet:pkt(),now:T,baselineDigest:'exact'});
 const b=v36Observe(a.state,{packet:pkt(),now:T,baselineDigest:'exact'});
 assert.equal(a.events.length,1);assert.equal(b.events.length,0);assert.equal(b.state.events.length,1);
});
test('stale, wrong digest and fake side-effect packet rejected',()=>{
 for(const x of [{...pkt(),model_digest:'bad'},{...pkt(),at_ms:T-200000},{...pkt(),telegram_sent:true}]){
 assert.equal(v36Observe({},{packet:x,now:T,baselineDigest:'exact'}).status,'SOURCE_NOT_ELIGIBLE');}
});
test('futures official 1m response can be parsed, no imaginary fills',async()=>{
 const r=await v36NativeHistory([{venue:'bitget',symbol:'AAAUSDT'}],async()=>({code:'00000',data:[[T,100,101,99,100,0,0]]}),T+60000);
 assert.equal(r.pages.length,1);assert.equal(r.pages[0].source,'OFFICIAL_NATIVE_1M');assert.equal(r.errors.length,0);
});
test('provider outage retains observations and never sends Telegram',async()=>{
 const r=await v36Process({old:{},packet:pkt(),baselineDigest:'exact',now:T,readHistory:async()=>{throw Error('no network')}});
 assert.equal(r.state.events.length,1);assert.equal(r.public_output.shadow_only,true);
 assert.equal(r.public_output.orders_sent,false);assert.equal(r.public_output.telegram_sent,false);
});
test('underpowered sample cannot activate a new live direction filter',()=>{
 assert.equal(v36Gate({pairs:8,correct:8,total:8,baselineCorrect:3,coverage:1}).promote,false);
 assert.equal(v36Gate({pairs:500,correct:400,total:500,baselineCorrect:410,coverage:.8}).promote,false);
});

test('a thin Bithumb trade tape remains visible as unconfirmed candidate and cannot be promoted to an invented trade',()=>{
 const c=mk('LONG','KRW-TEST');c.candidate.venue='bithumb';c.candidate.direction='BUY';
 for(const x of [c.first,c.second,c.final])x.venue='bithumb';
 c.first.trades=[];c.second.trades=[];
 const r=v36Observe({},{packet:pkt([c]),now:T,baselineDigest:'exact'});
 assert.equal(r.events.length,1);
 assert.equal(r.events[0].observed_hypothesis.status,'INSUFFICIENT_EVIDENCE');
 assert.equal(r.events[0].barriers_locked,false);
 assert.equal(r.events[0].target_price,null);
 assert.equal(r.events[0].observed_hypothesis.trade_permission,false);
});
test('quote-only candidate labels a postissue close separately but invents no target-first outcome',()=>{
 const x=mk();x.first.trades=[];x.second.trades=[];
 const e=v36Observe({},{packet:pkt([x]),now:T,baselineDigest:'exact'}).events[0];assert(e);
 const s=e.first_complete_start_ms;
 const bars=[{start_ms:s+240000,open:e.entry_price,high:e.entry_price+.5,low:e.entry_price-.3,close:e.entry_price+.2}];
 const p={source:'OFFICIAL_NATIVE_1M',venue:e.venue,symbol:e.symbol,fetched_at_ms:T+6*60000,bars};
 const z=v36Advance({events:[e]},[p],T+6*60000).events[0];
 assert.equal(z.direction_outcomes['5'].status,'MEASURED_DIRECTION');
 assert.equal(z.direction_outcomes['5'].direction_positive,true);
 assert.equal(z.outcomes['5'],undefined);
 assert.equal(z.direction_outcomes['5'].actual_execution_verified,false);
});
