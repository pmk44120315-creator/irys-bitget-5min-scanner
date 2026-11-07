import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {v36Observe,v36Advance,v36Summary} from '../deployment/v36_shadow.mjs';
const T=1794000000000;
async function module(){assert(existsSync(new URL('../deployment/v36_response.mjs',import.meta.url)),'response challenger module is missing');return import('../deployment/v36_response.mjs');}
function item({down=false,aggression='BUY',venue='bitget'}={}){
 const symbol=venue==='bitget'?'AAAUSDT':'KRW-AAA',move=down?-1:1;
 const trades=[0,1,2,3,4].map(i=>({id:String(i),at_ms:T-30000+i*6000,price:100+move*i*.15,size:10,side:aggression}));
 return {candidate:{venue,symbol,direction:venue==='bithumb'?'BUY':'LONG'},
 first:{venue,symbol,observed_at_ms:T-15000,quote:{bid:99.99,ask:100.01,at_ms:T-15000},trades:trades.filter(t=>t.at_ms<=T-15000)},
 second:{venue,symbol,observed_at_ms:T-1000,quote:{bid:100+move*.6-.01,ask:100+move*.6+.01,at_ms:T-1000},trades},
 final:{venue,symbol,observed_at_ms:T,quote:{bid:100+move*.6-.01,ask:100+move*.6+.01,at_ms:T}}};
}
function packet(x){return {version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:'exact',started_at_ms:T-40000,at_ms:T,checks:[],items:[x],orders_sent:false,telegram_sent:false};}
test('response chooses SHORT despite original LONG when actual quote and tape both fall',async()=>{
 const {v36Response}=await module();const x=v36Response(item({down:true}),T+500);
 assert.equal(x.status,'OBSERVED');assert.equal(x.direction,'SHORT');assert.equal(x.pressure_context,'PRICE_RESISTS_OPPOSITE_AGGRESSION');
 assert.equal(x.entry_price,x.original_bid);assert.equal(x.probability,null);assert.equal(x.trade_permit,false);
});
test('aggressive sellers with rising price are not automatically converted into a short',async()=>{
 const {v36Response}=await module();const x=v36Response(item({aggression:'SELL'}),T);
 assert.equal(x.direction,'LONG');assert.equal(x.pressure_context,'PRICE_RESISTS_OPPOSITE_AGGRESSION');assert.equal(x.absorption_proven,false);
});
test('actual evaluator timestamp, not historical source quote time, starts challenger clock',async()=>{
 const {v36Response}=await module();const x=v36Response(item(),T+8000);
 assert.equal(x.issued_at_ms,T+8000);assert.equal(x.source_observed_at_ms,T);assert.equal(x.source_to_decision_latency_ms,8000);
});
test('spot falling quote and tape yields no short permission',async()=>{
 const {v36Response}=await module();const x=v36Response(item({down:true,venue:'bithumb'}),T);
 assert.equal(x.status,'SPOT_DOWNSIDE_OBSERVATION');assert.equal(x.direction,'UNCONFIRMED');assert.equal(x.trade_permit,false);
});
test('quote and tape disagreement remains unresolved instead of forcing a prediction',async()=>{
 const {v36Response}=await module();const x=item();for(const r of x.second.trades)r.price=200-r.price;
 assert.equal(v36Response(x,T).status,'UNRESOLVED');
});
test('future or stale quote rejected; no invented fresh source',async()=>{
 const {v36Response}=await module();assert.equal(v36Response(item(),T+60000).status,'INVALID_SOURCE');
 const x=item();x.final.observed_at_ms=T+1;assert.equal(v36Response(x,T).status,'INVALID_SOURCE');
});
test('same print repeated across snapshots counts once while distinct IDs retain legitimate identical prints',async()=>{
 const {v36Response}=await module();const x=item({venue:'bithumb'});const a=v36Response(x,T);
 x.second.trades.push({...x.second.trades[0],id:'different-legitimate-id'});
 const b=v36Response(x,T);assert.equal(b.evidence.trade_count,a.evidence.trade_count+1);
 x.second.trades.push({...x.second.trades[0]});assert.equal(v36Response(x,T).evidence.trade_count,b.evidence.trade_count);
});
test('conflicting trade identity is a source error, not additional directional pressure',async()=>{
 const {v36Response}=await module();const x=item();x.second.trades.push({...x.second.trades[0],price:77});
 assert.equal(v36Response(x,T).status,'INVALID_SOURCE');
});
test('new research challenger ledger survives advance and never changes original baseline direction',()=>{
 const result=v36Observe({},{packet:packet(item({down:true})),now:T+1000,baselineDigest:'exact'});
 assert.equal(result.state.events[0].direction,'LONG');assert.equal(result.state.response_events.length,1);
 assert.equal(result.state.response_events[0].direction,'SHORT');
 const preserved=v36Advance(result.state,[],T+2000);assert.equal(preserved.response_events.length,1);
 assert.equal(v36Observe(preserved,{packet:packet(item({down:true})),now:T+3000,baselineDigest:'exact'}).state.response_events.length,1);
});
test('prospective challenger close label uses its own opposite bid entry and actual decision clock',()=>{
 const result=v36Observe({},{packet:packet(item({down:true})),now:T+1000,baselineDigest:'exact'});
 assert.equal(result.state.response_events?.length,1);
 const e=result.state.response_events[0],bar={start_ms:T+4*60000,open:98,high:98,low:98,close:98};
 const page={venue:e.venue,symbol:e.symbol,source:'OFFICIAL_NATIVE_1M',fetched_at_ms:T+6*60000,bars:[bar]};
 const advanced=v36Advance(result.state,[page],T+6*60000),v=advanced.response_events[0].direction_outcomes[5];
 assert.equal(v.status,'MEASURED_DIRECTION');assert(v.signed_direction_pct>0);
 assert.equal(v.entry_quote_reference,e.original_bid);assert.equal(v.actual_execution_verified,false);
 assert.equal(v36Summary(advanced).response_challenger.future_accuracy_proven,false);
});
