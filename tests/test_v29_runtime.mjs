import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../deployment/v29_runtime.mjs',import.meta.url);async function m(){assert(existsSync(url),'V29 runtime missing');return import(url)}
const T=1793704800000;
test('public sample validates returned instrument and normalizes source trades',async()=>{const g=await m();let t=T;
 const c={venue:'bithumb',symbol:'KRW-X'};
 const read=async u=>u.includes('orderbook')?[{market:'KRW-X',timestamp:T-500,orderbook_units:[{bid_price:100,ask_price:100.1}]}]:[{market:'KRW-X',sequential_id:1,timestamp:T-1000,trade_price:100,trade_volume:1,ask_bid:'BID'}];
 const s=await g.v29ReadSnapshot(c,read,()=>t);assert.equal(s.symbol,'KRW-X');assert.equal(s.trades[0].side,'BUY');assert.equal(s.trades[0].at_ms,T-1000);
});
test('wrong-market response cannot masquerade as requested symbol',async()=>{const g=await m();await assert.rejects(g.v29ReadSnapshot({venue:'bithumb',symbol:'KRW-X'},async u=>u.includes('orderbook')?[{market:'KRW-Y',timestamp:T,orderbook_units:[{bid_price:100,ask_price:101}]}]:[],()=>T),/QUOTE_IDENTITY/)});
test('read failures do not send, invent evidence, or discard existing prospective records',async()=>{const g=await m();let t=T;const state={v29DiscoveryInput:{at_ms:T,items:[{venue:'bithumb',symbol:'KRW-X',price:100,baseline_price:99,identity_verified:true,warning_checked:true,risks:[]}]}};
 const r=await g.v29Review(state,[],{clock:()=>t,sleep:async ms=>{t+=ms},read:async()=>{throw Error('HTTP_503')}});
 assert.equal(r.telegram_enabled,false);assert.equal(r.sent,0);assert.equal(r.double_checked,0);assert.equal(r.results[0].reason,'RISK_IDENTITY_SOURCE_UNAVAILABLE');
});
test('no candidates still reports no delivery and measures expired outcomes honestly',async()=>{const g=await m();const state={};const r=await g.v29Review(state,[],{clock:()=>T,sleep:async()=>{},read:async()=>[]});assert.equal(r.sent,0);assert.equal(r.status,'RESEARCH_ONLY_NO_VALIDATED_FORECAST');assert.equal(r.forward.stored_forecasts,0)});
