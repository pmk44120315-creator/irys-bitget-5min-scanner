import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as m from '../deployment/IRYS_V351_DELIVERY_FIRST_WORKER.mjs';
import {item,T} from './fixtures/v30_pair.mjs';
test('compiled real adapter sends current signal before slow old status edit, retaining genuine ACK',async()=>{
 const kv=new Map(),env={GITHUB_DISPATCH_TOKEN:'TEST_ONLY',TELEGRAM_BOT_TOKEN:'MOCK',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
 const state={v30ActualForecasts:[{id:'ACK:1',message_id:1,venue:'bitget',symbol:'OLDUSDT',direction:'LONG',issued_at_ms:T-1000000,entry_quote:{bid:1,ask:1.01,at_ms:T-1000000},invalidation_reference:.9,original_text:'Own original',lifecycle:{status:'ACTIVE'},outcomes:{}}]};
 const oldFetch=globalThis.fetch,oldClock=Date.now;let now=T;const calls=[];Date.now=()=>now;
 globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,at:now});const isEdit=url.endsWith('editMessageText');if(isEdit)now+=50000;return new Response(JSON.stringify({ok:true,result:{message_id:isEdit?1:12,chat:{id:123456789},date:Math.floor(now/1000)}}),{headers:{'content-type':'application/json'}})};
 const doc={version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:m.V30_PRODUCER_DIGEST,started_at_ms:T-30000,at_ms:T,items:[item()],orders_sent:false,telegram_sent:false};
 try{const r=await m.v30WorkerReview(env,state,T,{read:async()=>doc,clock:()=>now,maxWaitMs:0});assert.equal(r.sent,1);assert(calls[0].url.endsWith('sendMessage'));assert.equal(calls[0].at,T);assert(calls[1].url.endsWith('editMessageText'));assert.equal(r.signal_lifecycle.edits_verified,1);assert.equal(r.status_updates_after_delivery_decision,true);assert.equal(r.post_delivery_audit_status,'COMPLETED')}finally{Date.now=oldClock;globalThis.fetch=oldFetch}
});
test('deployed rule bytes and Cron unchanged; only timing and source-failure expiry revised',()=>{
 const a=readFileSync(new URL('../deployment/IRYS_V35_LIFECYCLE_WORKER.mjs',import.meta.url),'utf8'),b=readFileSync(new URL('../deployment/IRYS_V351_DELIVERY_FIRST_WORKER.mjs',import.meta.url),'utf8');
 for(const [s,e] of [['function v30Qualify(','function v30FuturesCandidates('],['function v29CheckPair(','function v29DeliveryPolicy('],['async function v34WorkerReview(','const V30_PRODUCER_DIGEST=']])assert.equal(a.slice(a.indexOf(s),a.indexOf(e)),b.slice(b.indexOf(s),b.indexOf(e)));
 assert.equal(a.split('  async scheduled(_controller,env){')[1],b.split('  async scheduled(_controller,env){')[1]);
});
test('public health distinguishes repaired sequencing from any prediction accuracy claim',async()=>{const h=await(await m.default.fetch(new Request('https://test/'),{})).json();assert.equal(h.deliveryFirstLifecycleEnabled,true);assert.equal(h.marketNotificationsEnabled,true);assert.equal(h.marketRiskWarningsEnabled,true);assert.equal(h.directionalQualityStatus,'CURRENT_EVIDENCE_ONLY_FORECAST_ACCURACY_UNPROVEN')});
