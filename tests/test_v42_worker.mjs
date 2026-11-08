import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as m from '../deployment/IRYS_V42_DISPATCH_WORKER.mjs';
import {item,T} from './fixtures/v30_pair.mjs';
async function simulate(retreat=false){
 const kv=new Map(),env={GITHUB_DISPATCH_TOKEN:'TEST_GITHUB_ONLY',TELEGRAM_BOT_TOKEN:'MOCK',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
 const state={};const oldFetch=globalThis.fetch,oldClock=Date.now;let now=T+1000;const sends=[];Date.now=()=>now;
 const original=item();const doc={version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:m.V30_PRODUCER_DIGEST,started_at_ms:T-30000,at_ms:T,items:[original],orders_sent:false,telegram_sent:false};
 globalThis.fetch=async(url,opts)=>{assert(url.endsWith('/sendMessage'));sends.push({url,body:JSON.parse(opts.body),at:now});return new Response(JSON.stringify({ok:true,result:{message_id:42,chat:{id:123456789},date:Math.floor(now/1000)}}),{headers:{'content-type':'application/json'}})};
 const read=async(url,opts)=>{
  if(url.startsWith('https://api.bitget.com/api/v2/mix/market/ticker?')){assert(!opts.headers.Authorization&&!opts.headers.authorization);now+=100;return {code:'00000',data:[{symbol:original.candidate.symbol,bidPr:retreat?'99':'100.75',askPr:retreat?'99.1':'100.85',ts:String(now)}]};}
  return doc;
 };
 try{return {out:await m.v30WorkerReview(env,state,now,{read,clock:()=>now,maxWaitMs:0}),state,sends,original,kv};}finally{Date.now=oldClock;globalThis.fetch=oldFetch;}
}
test('compiled production adapter dispatches and persists only freshly read public entry reference',async()=>{
 const r=await simulate();assert.equal(r.out.sent,1);assert.equal(r.sends.length,1);
 const event=r.state.v30ActualForecasts[0];assert.equal(event.entry_quote.ask,100.85);assert.equal(event.entry_quote.at_ms,T+1100);
 assert.equal(event.source_packet_at_ms,T);assert.equal(event.dispatch_snapshot.version,'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1');
 assert.match(r.sends[0].body.text,/V42/);assert.equal(r.out.public_ack_history.records.length,1);
 assert.equal(r.out.public_ack_history.records[0].entry_quote.ask,100.85);
 assert(!JSON.stringify(r.out.public_ack_history).includes('original_text'));assert(!JSON.stringify(r.out.public_ack_history).includes('message_id'));
 assert.equal(r.original.final.quote.at_ms,T-800);assert.equal(r.out.forecast_accuracy_proven,false);
});
test('compiled adapter does not send when live quote contradicts the previously approved paired direction',async()=>{
 const r=await simulate(true);assert.equal(r.out.sent,0);assert.equal(r.sends.length,0);assert.equal(r.out.dispatch_revalidation.rejected,1);assert.equal(r.state.v30ActualForecasts?.length||0,0);
});
test('compiled V42 preserves original direction, entry-budget, risk and Cron bytes',()=>{
 const a=readFileSync(new URL('../deployment/IRYS_V351_DELIVERY_FIRST_WORKER.mjs',import.meta.url),'utf8'),b=readFileSync(new URL('../deployment/IRYS_V42_DISPATCH_WORKER.mjs',import.meta.url),'utf8');
 for(const [s,e] of [['function v30Qualify(','function v30FuturesCandidates('],['function v29CheckPair(','function v29DeliveryPolicy('],['function v31EntryBudget(','function v31ShouldRecord('],['async function v34WorkerReview(','const V30_PRODUCER_DIGEST=']])assert.equal(a.slice(a.indexOf(s),a.indexOf(e)),b.slice(b.indexOf(s),b.indexOf(e)));
 assert.equal(a.split('  async scheduled(_controller,env){')[1],b.split('  async scheduled(_controller,env){')[1].split('\nexport {v42ReadFinalQuote')[0]);
 assert.equal(m.V30_PRODUCER_DIGEST,'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9');
});
test('public health states real upgrade while keeping forecasting accuracy unproven',async()=>{
 const h=await(await m.default.fetch(new Request('https://test/'),{})).json();
 assert.equal(h.dispatchQuoteRevalidationEnabled,true);assert.equal(h.completeAckEvidenceEnabled,true);
 assert.equal(h.marketNotificationsEnabled,true);assert.equal(h.marketRiskWarningsEnabled,true);
 assert.equal(h.directionalQualityStatus,'CURRENT_EVIDENCE_ONLY_FORECAST_ACCURACY_UNPROVEN');
});
