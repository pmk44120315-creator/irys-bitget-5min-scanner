import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as m from '../deployment/IRYS_V35_LIFECYCLE_WORKER.mjs';
import {item,T} from './fixtures/v30_pair.mjs';
function env(){const kv=new Map();return {GITHUB_DISPATCH_TOKEN:'MOCK_SOURCE',TELEGRAM_BOT_TOKEN:'MOCK_BOT',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}}}
const packet=(now,items=[],followups=[])=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:m.V30_PRODUCER_DIGEST,started_at_ms:now-30000,at_ms:now,items,followups,orders_sent:false,telegram_sent:false});
test('real adapter preserves original ACK evidence and later edits only that message after confirmed breach',async()=>{
 const e=env(),s={},oldFetch=globalThis.fetch,oldClock=Date.now;let now=T;const calls=[];
 Date.now=()=>now;globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body});return new Response(JSON.stringify({ok:true,result:{message_id:99,chat:{id:123456789},date:Math.floor(now/1000)}}),{headers:{'content-type':'application/json'}})};
 try{
  let r=await m.v30WorkerReview(e,s,T,{read:async()=>packet(T,[item()]),clock:()=>now,maxWaitMs:0});assert.equal(r.sent,1);
  const row=s.v30ActualForecasts[0];assert.equal(row.message_id,99);assert(row.original_text);assert.equal(row.invalidation_reference,99.8);
  now=T+300000;const f={venue:'bitget',symbol:'TESTUSDT'};
  for(const [key,delay] of [['first',14000],['second',4000],['final',1000]])f[key]={venue:f.venue,symbol:f.symbol,observed_at_ms:now-delay,quote:{bid:98,ask:98.1,at_ms:now-delay-100}};
  const d=packet(now,[],[f]);r=await m.v30WorkerReview(e,s,now,{read:async()=>d,clock:()=>now,maxWaitMs:0});
  assert.equal(r.sent,0);assert.equal(r.signal_lifecycle.edits_verified,1);assert.equal(s.v30ActualForecasts[0].lifecycle.status,'INVALIDATED');
  assert.equal(calls.length,2);assert(calls[0].url.endsWith('/sendMessage'));assert(calls[1].url.endsWith('/editMessageText'));assert.equal(calls[1].body.message_id,99);assert.match(calls[1].body.text,/무효/);
  await m.v30WorkerReview(e,s,now,{read:async()=>d,clock:()=>now,maxWaitMs:0});assert.equal(calls.length,2);
 }finally{globalThis.fetch=oldFetch;Date.now=oldClock}
});
test('arbitrary edit or old unknown legacy record cannot call Telegram',async()=>{let called=0;await assert.rejects(m.v35EditOwnSignal(env(),{message_id:99,text:'fake'},async()=>{called++;}),/PERMIT_REQUIRED/);assert.equal(called,0)});
test('risk lane, entry qualification and scheduling remain byte-for-byte unchanged',()=>{
 const a=readFileSync(process.env.V35_BASE_WORKER||'deployment/IRYS_V34_CRASH_WARNING_WORKER.mjs','utf8'),b=readFileSync(new URL('../deployment/IRYS_V35_LIFECYCLE_WORKER.mjs',import.meta.url),'utf8');
 for(const [start,end] of [['function v30Qualify(','function v30FuturesCandidates('],['function v29CheckPair(','function v29DeliveryPolicy('],['async function v34WorkerReview(','const V30_PRODUCER_DIGEST=']])assert.equal(b.slice(b.indexOf(start),b.indexOf(end)),a.slice(a.indexOf(start),a.indexOf(end)));
 assert.equal(b.split('  async scheduled(_controller,env){')[1].split('\nexport {v35ReviewSignal')[0],a.split('  async scheduled(_controller,env){')[1]);
});
test('health does not claim prediction accuracy or hidden live private records',async()=>{const r=await m.default.fetch(new Request('https://test/'),env());const h=await r.json();assert.equal(h.signalLifecycleEnabled,true);assert.equal(h.marketRiskWarningsEnabled,true);assert.equal(h.marketNotificationsEnabled,true);assert.equal(h.directionalQualityStatus,'CURRENT_EVIDENCE_ONLY_FORECAST_ACCURACY_UNPROVEN')});
