import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const path=new URL('../deployment/IRYS_V28_BUILDUP_WORKER.mjs',import.meta.url);
async function engine(){assert.ok(existsSync(path),'V28 production build missing');return import(path);}
const T=1793610000000,STEP=300000;
function market(now,up=false){const d=new Date(now-1000).toISOString();return {markets:Array.from({length:105},(_,i)=>({market:'KRW-C'+i,market_warning:'NONE'})),ticks:Array.from({length:105},(_,i)=>({market:'KRW-C'+i,trade_price:up&&i<3?100.3+i*.1:100,acc_trade_price:up?1010000+i*100:1000000,signed_change_rate:i===0?.3:0,trade_date:d.slice(0,10).replaceAll('-',''),trade_time:d.slice(11,19).replaceAll(':','')}))};}
function read(now){const m=market(now,true);return async url=>{
 if(url.includes('/v1/market/all'))return m.markets;if(url.includes('virtual_asset_warning'))return [];
 if(url.includes('/v1/ticker'))return m.ticks;
 if(url.includes('/v1/orderbook'))return [0,1,2].map(i=>({market:'KRW-C'+i,timestamp:now,orderbook_units:[{bid_price:100.2+i*.1,ask_price:100.3+i*.1}]}));
 if(url.includes('/v1/trades/ticks'))return Array.from({length:4},(_,i)=>({timestamp:now-6000+i*1000,trade_price:100+i*.1,trade_volume:10,ask_bid:'BID',sequential_id:i}));
 throw Error('HTTP_403');
};}
function state(){return {v23ScoutTape:{spot_at_ms:T-STEP,spot_kst_day:'2026-11-02',spot:Object.fromEntries(Array.from({length:105},(_,i)=>['KRW-C'+i,[100,1000000,100,0]]))}};}
test('compiled Worker sends one acknowledged multi-candidate message for sub-.70 observed buildup',async()=>{
 const {v23ScoutTick}=await engine();const s=state();let messages=[];
 const r=await v23ScoutTick({},s,T,{read:read(T),clock:()=>T,maxWaitMs:0,send:async(e,m)=>{messages.push(m);return {message_id:800,message_text:m,ack_received_at_ms:T+100}},persistReceipt:async()=>true});
 assert.equal(r.status,'TELEGRAM_API_ACK',JSON.stringify(r));assert.equal(messages.length,1);assert.equal(r.sent,1);assert.equal(r.sent_symbols.length,3);assert.equal(s.v23ScoutHourly.count,1);
 const receipt=s.deliveryReceiptsV12.at(-1);assert.equal(receipt.market_snapshot.bundle.length,3);assert.equal(new Set(receipt.market_snapshot.bundle.map(x=>x.symbol)).size,3);
 assert.ok(receipt.market_snapshot.bundle.every(x=>x.forecast_direction===null));assert.ok(Object.keys(s.v23ScoutNotices).length===3);assert.ok(messages[0].length<4096);
});
test('exhausted message quota must not stop buildup, peak and dayleader tracking',async()=>{
 const {v23ScoutTick}=await engine();const s=state();s.v23ScoutHourly={hour:Math.floor(T/3600000),count:2};
 const r=await v23ScoutTick({},s,T,{read:read(T),clock:()=>T,maxWaitMs:0,send:async()=>{throw Error('NO_QUOTA')}});
 assert.equal(r.status,'DELIVERY_RATE_PACED');assert.equal(r.sent,0);assert.equal(Object.keys(s.v28Ledger.assets).length,105);assert.ok(r.v28Discovery.day_leaders.some(x=>x.symbol==='KRW-C0'));assert.ok(s.v28CoverageRows.length===105);
});
test('failure of actual Bot ACK creates no successful bundle dedupe or receipt',async()=>{
 const {v23ScoutTick}=await engine();const s=state();const r=await v23ScoutTick({},s,T,{read:read(T),clock:()=>T,maxWaitMs:0,send:async()=>({}),persistReceipt:async()=>true});
 assert.equal(r.sent,0);assert.equal(s.v23ScoutHourly.count,0);assert.equal(s.v23ScoutNotices,undefined);assert.equal(s.deliveryReceiptsV12,undefined);
});
test('successful bundle is deduped per symbol, never just its first symbol',async()=>{
 const {v23ScoutTick}=await engine();const s=state();s.v23ScoutNotices={'bithumb:KRW-C0':T-1000,'bithumb:KRW-C1':T-1000,'bithumb:KRW-C2':T-1000};
 const r=await v23ScoutTick({},s,T,{read:read(T),clock:()=>T,maxWaitMs:0,send:async()=>{throw Error('DUPLICATE')}});
 assert.equal(r.sent,0);assert.equal(r.status,'DUPLICATE_EPISODE_PACED');
});
test('all original directional proofs, schedule and maximum message count unchanged',async()=>{
 await engine();const original=readFileSync(process.env.V28_BASE_WORKER||'/mnt/data/v28_evidence_initial/live_v27_2.mjs','utf8');const s=readFileSync(path,'utf8');
 for(const [a,b] of [['function futuresSnapshotProof(','function evaluateFutures('],['function validDirectionalProof(','async function officialDirectionalRiskCheck(']])assert.equal(s.slice(s.indexOf(a),s.indexOf(b)),original.slice(original.indexOf(a),original.indexOf(b)));
 assert.equal(s.split('  async scheduled(_controller,env){')[1].split('\nexport {v28Discover')[0],original.split('  async scheduled(_controller,env){')[1]);
 assert.ok(s.includes('const V23_MAX_HOURLY_NOTICES=2;'));assert.ok(s.includes('const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;'));
});
