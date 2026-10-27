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
test('Cloudflare global fetch invocation preserves its required receiver',async()=>{
  const original=globalThis.fetch;
  try{
    let count=0;
    globalThis.fetch=function(url){
      assert.equal(this,globalThis,'global fetch receiver must be globalThis');
      count++;
      return Promise.resolve(new Response(JSON.stringify([{market:'KRW-WLD'}]),{status:200}));
    };
    const o=new RealtimeEvidenceDO(state(),{}, {now:()=>1793121000000});
    const r=await o.fetch(req('/diagnostics/feeds'));
    assert.equal(r.status,200);
    const v=await r.json();
    assert.equal(v.checks.length,2);
    assert.ok(v.checks.every(x=>x.http_status===200&&x.array_ok));
    assert.equal(count,2);
  } finally {globalThis.fetch=original;}
});
test('persisted session diagnostic is read-only and never starts or orders',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const result=await o.fetch(req('/diagnostics/sessions'));assert.equal(result.status,200);const body=await result.json();assert.equal(body.read_only,true);assert.deepEqual(body.sessions,[]);assert.equal(d.sends,0);});
test('feed diagnostics are read only and never start WebSocket or expose secrets',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const r=await o.fetch(req('/diagnostics/feeds'));assert.equal(r.status,200);const b=await r.json();assert.equal(b.read_only,true);assert.equal(b.checks.length,2);assert.equal(b.checks[0].source,'MARKET_LIST');assert.equal(d.sends,0);assert.equal(JSON.stringify(b).includes(TOKEN),false);});

test('runtime frame ingestion failure is disclosed rather than incorrectly marked as CVD success',async()=>{
  const d=deps(),handlers={};
  const ws={readyState:1,accept(){},send(){},addEventListener(name,fn){handlers[name]=fn;},close(){this.readyState=3;}};
  const realtime={...d,fetch:async url=>String(url).includes('websocket')?{webSocket:ws}:new Response(JSON.stringify([{market:'KRW-WLD'}]))};
  const o=new RealtimeEvidenceDO(state(),{},realtime);
  const started=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));
  assert.equal(started.status,200);
  o.db.ingest=()=>{throw Error('FORCED_TEST_DB_WRITE_FAILURE');};
  handlers.message({data:JSON.stringify({type:'trade',code:'KRW-WLD',timestamp:1793121000000,trade_price:100,trade_volume:1,ask_bid:'BID',sequential_id:'17931210000000000'})});
  await new Promise(resolve=>setTimeout(resolve,0));
  const status=await (await o.fetch(req('/status'))).json();
  assert.equal(status.frame_stats.received,1);
  assert.equal(status.frame_stats.ingested,0);
  assert.equal(status.frame_stats.errors,1);
  assert.ok(status.frame_stats.last_error.detail.includes('FORCED_TEST_DB_WRITE_FAILURE'));
  await o.fetch(req('/control/stop','POST'));
});
test('Cloudflare Blob message is decoded and ingested without a spurious frame error',async()=>{
  const d=deps(),handlers={};
  const ws={readyState:1,accept(){},send(){},addEventListener(n,fn){handlers[n]=fn;},close(){this.readyState=3;}};
  const o=new RealtimeEvidenceDO(state(),{}, {...d,fetch:async url=>String(url).includes('websocket')?{webSocket:ws}:new Response(JSON.stringify([{market:'KRW-WLD'}]))});
  const start=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));
  assert.equal(start.status,200);
  const msg=JSON.stringify({type:'orderbook',code:'KRW-WLD',timestamp:1793121000000,
    orderbook_units:[{bid_price:100,bid_size:5,ask_price:101,ask_size:5}]});
  handlers.message({data:new Blob([msg],{type:'application/json'})});
  await new Promise(resolve=>setTimeout(resolve,10));
  const st=await (await o.fetch(req('/status'))).json();
  assert.equal(st.frame_stats.received,1);
  assert.equal(st.frame_stats.ingested,1);
  assert.equal(st.frame_stats.errors,0);
  await o.fetch(req('/control/stop','POST'));
});
test('standalone DO initializes stopped; status read does not connect',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const r=await o.fetch(req('/status'));assert.equal(r.status,200);assert.equal((await r.json()).enabled,false);assert.equal(d.sends,0);});
test('start validates listed KRW markets then subscribes both channels',async()=>{const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);const r=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD']}));assert.equal(r.status,200);assert.equal(d.sends,1);const b=await (await o.fetch(req('/status'))).json();assert.equal(b.enabled,true);assert.equal(b.live_trade_alerts_enabled,false);});
test('temporary live SHADOW session expires and persists auto-stop after CI runner disappears',async()=>{
  const st=state(),d=deps();let ms=1793121000000;
  const o=new RealtimeEvidenceDO(st,{}, {...d,now:()=>ms});
  const started=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD'],proof_seconds:60}));
  assert.equal(started.status,200);
  assert.equal((await started.json()).proof_expires_ms,ms+60000);
  assert.equal((await (await o.fetch(req('/status'))).json()).enabled,true);
  ms+=61000;
  const after=await (await o.fetch(req('/status'))).json();
  assert.equal(after.enabled,false);
  assert.equal(after.connection.status,'PROOF_LEASE_EXPIRED');
  const reloaded=new RealtimeEvidenceDO(st,{}, {...d,now:()=>ms});
  assert.equal((await (await reloaded.fetch(req('/status'))).json()).enabled,false);
});
test('authenticated completed-candle reconciliation is unavailable while stopped and never sends alerts',async()=>{
  const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);
  assert.equal((await o.fetch(req('/control/reconcile','POST'))).status,409);
  const started=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD'],proof_seconds:80}));
  assert.equal(started.status,200);
  const refreshed=await o.fetch(req('/control/reconcile','POST'));
  assert.equal(refreshed.status,200);
  const j=await refreshed.json();
  assert.equal(j.send_allowed,false);
  assert.equal(j.mode,'SHADOW_ONLY');
  assert.equal(j.markets[0],'KRW-WLD');
  assert.equal(d.sends,1);
  await o.fetch(req('/control/stop','POST'));
});
test('invalid proof lease blocks starting WebSocket and protects persisted state',async()=>{
  const d=deps(),o=new RealtimeEvidenceDO(state(),{},d);
  const bad=await o.fetch(req('/control/start','POST',{markets:['KRW-WLD'],proof_seconds:10000}));
  assert.equal(bad.status,400);
  assert.equal(d.sends,0);
  assert.equal((await (await o.fetch(req('/status'))).json()).enabled,false);
});
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
