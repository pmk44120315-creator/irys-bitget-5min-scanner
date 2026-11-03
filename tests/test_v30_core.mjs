import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../deployment/v30_core.mjs',import.meta.url);
import {item,T} from './fixtures/v30_pair.mjs';
async function load(){assert(existsSync(url),'V30 per-signal proof and bidirectional selection are missing');return import(url)}
test('positive real-evidence fixture can authorize a direction message without declaring future certainty',async()=>{
 const m=await load(),r=m.v30Qualify(item(),T);assert.equal(r.status,'READY_CURRENT_EVIDENCE',JSON.stringify(r));assert.equal(r.allowed,true);assert.equal(r.future_accuracy_proven,false);assert.equal(r.trading_permit,false);
});
test('SHORT is genuinely symmetric and spot BUY is supported',async()=>{
 const m=await load();for(const [d,v] of [['SHORT','bitget'],['LONG','bithumb']])assert.equal(m.v30Qualify(item(d,v),T).allowed,true);
});
test('no missing or same cached trade observations accepted',async()=>{
 const m=await load();for(const transform of [x=>x.second.trades=[],x=>x.second.trades=x.first.trades,x=>x.second=x.first]){const x=item();transform(x);assert.equal(m.v30Qualify(x,T).allowed,false);}
});
test('opposing price response and conflicting trade ID fail despite old quote rise',async()=>{
 const m=await load();for(const change of [x=>x.second.trades.forEach((r,i)=>r.price=104-i*.5),x=>x.second.trades.push({...x.second.trades[0],price:800})]){const x=item();change(x);assert.equal(m.v30Qualify(x,T).allowed,false);}
});
test('final quote must preserve progress, not reuse an earlier favorable quote',async()=>{
 const m=await load(),x=item();x.final.quote.bid=100.5;assert.equal(m.v30Qualify(x,T).reason,'FINAL_QUOTE_RETREAT');
 const y=item();y.final.quote.at_ms=y.first.quote.at_ms;assert.equal(m.v30Qualify(y,T).allowed,false);
});
test('risk and exact market identity are rechecked from native records, not a trusted ready flag',async()=>{
 const m=await load();for(const change of [x=>x.risk.contract.symbolStatus='suspend',x=>x.risk.instrument.instrumentType='stock',x=>x.risk.contract.symbol='OTHERUSDT',x=>x.final.symbol='OTHERUSDT',x=>x.risk.at_ms=T+1000]){const x=item();change(x);assert.equal(m.v30Qualify(x,T).allowed,false);}
 const x=item('LONG','bithumb');x.risk.warnings=[{market:'KRW-TEST',warning_type:'PRICE_SUDDEN_FLUCTUATION'}];assert.equal(m.v30Qualify(x,T).allowed,false);
});
test('old evidence and future source clocks never count as current',async()=>{
 const m=await load();assert.equal(m.v30Qualify(item(),T+90000).allowed,false);const x=item();x.final.observed_at_ms=T+500;assert.equal(m.v30Qualify(x,T).allowed,false);
});
test('exact large numeric trade IDs survive JSON decoding',async()=>{
 const m=await load(),x=m.v30ParsePublicJSON('{"sequential_id":17937290000000001,"other":2,"tradeId":17937290000000003}');
 assert.equal(x.sequential_id,'17937290000000001');assert.equal(x.tradeId,'17937290000000003');assert.equal(x.other,2);
});
test('two source records reused cannot become independent by changing received time',async()=>{
 const m=await load(),x=item();x.second.quote={...x.first.quote};assert.equal(m.v30Qualify(x,T).allowed,false);
});
test('candidate negative return is shortlisted as SHORT, not lost to upward-only discovery',async()=>{
 const m=await load(),rows=[{symbol:'UPUSDT',price:101,at_ms:T,quote_volume:1000},{symbol:'DOWNUSDT',price:99,at_ms:T,quote_volume:1000},{symbol:'OLDUSDT',price:120,at_ms:T-500000,quote_volume:1000}],old={at_ms:T-300000,prices:{UPUSDT:100,DOWNUSDT:100,OLDUSDT:100}};
 const r=m.v30FuturesCandidates(rows,old,T,new Set(['UPUSDT','DOWNUSDT','OLDUSDT']));
 assert(r.some(x=>x.symbol==='DOWNUSDT'&&x.direction==='SHORT'));assert(r.some(x=>x.symbol==='UPUSDT'&&x.direction==='LONG'));assert(!r.some(x=>x.symbol==='OLDUSDT'));
});
test('zero/gap/identity invalid baseline cannot manufacture directional candidates',async()=>{
 const m=await load();for(const old of [{at_ms:T-1000000,prices:{UPUSDT:100}},{at_ms:T+1000,prices:{UPUSDT:100}},{at_ms:T-300000,prices:{UPUSDT:0}}])assert.equal(m.v30FuturesCandidates([{symbol:'UPUSDT',price:101,at_ms:T}],old,T,new Set(['UPUSDT'])).length,0);
});
test('published packet must match pinned model digest and have current immutable dates',async()=>{
 const m=await load(),doc={version:m.V30_VERSION,model_digest:'abc',started_at_ms:T-30000,at_ms:T,items:[item()],source:'OFFICIAL_PUBLIC_RUNNER',orders_sent:false,telegram_sent:false};
 assert.equal(m.v30ValidatePacket(doc,T,'abc').ok,true);assert.equal(m.v30ValidatePacket(doc,T,'other').ok,false);
 assert.equal(m.v30ValidatePacket({...doc,at_ms:T+100},T,'abc').ok,false);assert.equal(m.v30ValidatePacket(doc,T+150000,'abc').ok,false);
 assert.equal(m.v30ValidatePacket({...doc,telegram_sent:true},T,'abc').ok,false);
});
test('final payload preserves raw proof, does not mutate it, and forbids spot SHORT',async()=>{
 const m=await load(),x=item(),before=JSON.stringify(x);m.v30Qualify(x,T);assert.equal(JSON.stringify(x),before);
 const y=item('LONG','bithumb');y.candidate.direction='SHORT';assert.equal(m.v30Qualify(y,T).allowed,false);
});

