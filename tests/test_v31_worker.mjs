import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {item,T} from './fixtures/v30_pair.mjs';
import * as current from '../deployment/IRYS_V31_TIMELY_WORKER.mjs';
import * as original from '../deployment/IRYS_V30_SELECTIVE_DIRECTION_WORKER.mjs';
test('exact historical AKE proof passes original gate but is no longer sent after entry-price overrun',()=>{
 const x=JSON.parse(readFileSync(new URL('./fixtures/v31_ake_case.json',import.meta.url),'utf8')).items[0];
 const at=1793774204546;assert.equal(original.v30Qualify(x,at).allowed,true);const r=current.v30Qualify(x,at);assert.equal(r.allowed,false);assert.equal(r.reason,'ENTRY_OUTSIDE_OBSERVED_PRICE_BUDGET');
});
test('new compiled Worker still sends an eligible positive-control hypothesis once, not a global shutdown',async()=>{
 const store=new Map(),state={},env={GITHUB_DISPATCH_TOKEN:'TEST_ONLY',TELEGRAM_BOT_TOKEN:'TEST_BOT',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>store.get(k)||null,put:async(k,v)=>store.set(k,v)}};
 const oldFetch=globalThis.fetch,oldClock=Date.now;let posts=0;Date.now=()=>T;
 globalThis.fetch=async u=>{assert(String(u).startsWith('https://api.telegram.org/botTEST_BOT/'));posts++;return new Response(JSON.stringify({ok:true,result:{message_id:99,chat:{id:123456789},date:T/1000|0}}),{headers:{'content-type':'application/json'}})};
 const packet={version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:current.V30_PRODUCER_DIGEST,at_ms:T,started_at_ms:T-30000,items:[item()],orders_sent:false,telegram_sent:false};
 try{const r=await current.v30WorkerReview(env,state,T,{read:async()=>packet,clock:()=>T,maxWaitMs:0});assert.equal(r.sent,1);assert.equal(posts,1);assert.equal(state.deliveryReceiptsV12.at(-1).telegram_message_id,99)}finally{globalThis.fetch=oldFetch;Date.now=oldClock;}
});
test('delivery-source wait begins before unrelated discovery; final join occurs only once',()=>{
 const s=readFileSync(new URL('../deployment/IRYS_V31_TIMELY_WORKER.mjs',import.meta.url),'utf8');
 assert(s.indexOf('const v31DeliveryTask=')<s.indexOf('const v23Fast=await v23ScoutTick'));
 assert(s.indexOf('v30Run=await v31DeliveryTask')>s.indexOf('const v23Fast=await v23ScoutTick'));
 assert.equal((s.match(/const v31DeliveryTask=/g)||[]).length,1);
 const old=readFileSync(new URL('../deployment/IRYS_V30_SELECTIVE_DIRECTION_WORKER.mjs',import.meta.url),'utf8');
 assert.equal(s.split('  async scheduled(_controller,env){')[1].split('\nexport {V30_PRODUCER_DIGEST')[0],old.split('  async scheduled(_controller,env){')[1].split('\nexport {V30_PRODUCER_DIGEST')[0]);
});
