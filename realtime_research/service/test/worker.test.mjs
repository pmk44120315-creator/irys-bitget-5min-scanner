import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import worker,{RealtimeEvidenceDO} from '../worker.mjs';
const TOKEN='0123456789abcdef0123456789abcdef';
const req=(path,method='GET',data,auth=true)=>new Request('https://test.invalid'+path,{method,headers:{...(auth?{authorization:'Bearer '+TOKEN}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
function state(){const db=new DatabaseSync(':memory:'),kv=new Map();return {waitUntil(){},blockConcurrencyWhile:fn=>fn(),storage:{sql:{exec(q,...a){return {toArray:()=>db.prepare(q).all(...a)};}},get:async k=>structuredClone(kv.get(k)),put:async(k,v)=>{kv.set(k,structuredClone(v));},setAlarm:async()=>{},deleteAlarm:async()=>{},transaction:async fn=>fn(this)}};}
function deps(){let sends=0;const ws={readyState:1,accept(){},send(){sends++;},addEventListener(){},close(){this.readyState=3;}};return {ws,get sends(){return sends;},fetch:async u=>String(u).includes('websocket')?{webSocket:ws}:new Response(JSON.stringify([{market:'KRW-WLD',market_warning:'NONE'}])),now:()=>1793121000000};}
test('unauthenticated write blocked before DO access',async()=>{let called=0;const env={IRYS_RT_ADMIN_TOKEN:TOKEN,IRYS_RT:{idFromName(){called++;},get(){throw Error('must not route');}}};assert.equal((await worker.fetch(req('/control/start','POST',{markets:['KRW-WLD']},false),env)).status,401);assert.equal(called,0);});
test('public health cannot start streams, send or disclose credentials',async()=>{const r=await worker.fetch(req('/health','GET',undefined,false),{IRYS_RT_ADMIN_TOKEN:TOKEN});assert.equal(r.status,200);const b=await r.text();assert.equal(b.includes(TOKEN),false);assert.ok(b.includes('SHADOW'));});
test('weak or missing administrative token disables control',async()=>{const r=await worker.fetch(req('/control/start','POST',{markets:['KRW-WLD']}),{IRYS_RT_ADMIN_TOKEN:'short'});assert.equal(r.status,503);});
test('unknown route never forwards or triggers collection',async()=>{assert.equal((await worker.fetch(req('/send','GET'),{IRYS_RT_ADMIN_TOKEN:TOKEN})).status,404);});
test('standalone DO initializes stopped; status read does not connect',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const r=await o.fetch(req('/status'));assert.equal(r.status,200);assert.equal((await r.json()).enabled,false);assert.equal(d.sends,0);});
test('start validates listed KRW markets then subscribes both channels',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const r=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));assert.equal(r.status,200);assert.equal(d.sends,1);const b=await (await o.fetch(req('/status'))).json();assert.equal(b.enabled,true);assert.equal(b.live_trade_alerts_enabled,false);});
test('unlisted market cannot start; existing V7 binding never used',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{IRYS_KV:{get(){throw Error('old worker storage used');}}},d);const r=await o.fetch(req('/control/start','POST',{markets:['KRW-FAKE']}));assert.equal(r.status,400);assert.equal(d.sends,0);});
test('stop persists disabled state and prevents restart on status request',async()=>{const s=state(),d=deps(),o=new RealtimeEvidenceDO(s,{},d);await o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));await o.fetch(req('/control/stop','POST',{}));const again=new RealtimeEvidenceDO(s,{},d);assert.equal((await (await again.fetch(req('/status'))).json()).enabled,false);assert.equal(d.sends,1);});
test('stop cancels an in-flight upgrade without re-enabling the socket',async()=>{
  const s=state(),d=deps();let resolveUpgrade,started;const hit=new Promise(r=>started=r);
  const o=new RealtimeEvidenceDO(s,{}, {...d,fetch:async u=>{if(String(u).includes('websocket')){started();return new Promise(r=>resolveUpgrade=r);}return d.fetch(u);}});
  const starting=o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));await hit;
  await o.fetch(req('/control/stop','POST',{}));resolveUpgrade({webSocket:d.ws});await starting;
  assert.equal(o.socket,null);assert.equal(d.sends,0);assert.equal(d.ws.readyState,3);
  assert.equal((await (await o.fetch(req('/status'))).json()).enabled,false);
});
test('stop invalidates a pending listing check before it can start',async()=>{
  const s=state(),d=deps();let release,entered;const hit=new Promise(r=>entered=r);
  const o=new RealtimeEvidenceDO(s,{}, {...d,fetch:async u=>{if(String(u).includes('market/all')){entered();return new Promise(r=>release=r);}return d.fetch(u);}});
  const starting=o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));await hit;
  await o.fetch(req('/control/stop','POST',{}));release(new Response(JSON.stringify([{market:'KRW-WLD'}])));await starting;
  assert.equal(d.sends,0);assert.equal((await (await o.fetch(req('/status'))).json()).enabled,false);
});
