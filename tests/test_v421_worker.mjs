import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
import {item,T} from './fixtures/v30_pair.mjs';
const path=new URL('../deployment/IRYS_V421_DISPATCH_WORKER.mjs',import.meta.url);
async function simulate(retreat=false){
 assert(existsSync(path),'V42.1 compiled production worker is required');const m=await import(path);const kv=new Map(),state={};let now=T+1000;const calls=[],sends=[];
 const env={GITHUB_DISPATCH_TOKEN:'PRIVATE_ONLY_GITHUB',TELEGRAM_BOT_TOKEN:'MOCK',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)}};
 const original=item();const doc={version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:m.V30_PRODUCER_DIGEST,started_at_ms:T-30000,at_ms:T,items:[original],orders_sent:false,telegram_sent:false};
 const oldFetch=globalThis.fetch,oldClock=Date.now;Date.now=()=>now;
 globalThis.fetch=async(url,opts)=>{assert(url.endsWith('/sendMessage'));sends.push(JSON.parse(opts.body));return new Response(JSON.stringify({ok:true,result:{message_id:43,chat:{id:123456789},date:Math.floor(now/1000)}}),{headers:{'content-type':'application/json'}})};
 const read=async(url,opts)=>{calls.push(url);assert(!url.startsWith('https://api.bitget.com'),'known unsupported CF->Bitget path must not be called');
  if(url.includes('v421_dispatch_quotes.json')){assert.equal(opts.headers.authorization,'Bearer PRIVATE_ONLY_GITHUB');now+=100;return {version:'V421_OFFICIAL_POST_PUBLICATION_QUOTES_V1',source:'OFFICIAL_PUBLIC_RUNNER_POST_PUBLICATION',source_packet_at_ms:T,source_model_digest:m.V30_PRODUCER_DIGEST,published_source_commit:'a'.repeat(40),sampled_at_ms:now,orders_sent:false,telegram_sent:false,quotes:[{venue:'bitget',symbol:original.candidate.symbol,prior_quote_at_ms:original.final.quote.at_ms,paired_at_ms:original.second.observed_at_ms,bid:retreat?99:100.75,ask:retreat?99.1:100.85,at_ms:now}]};}
  return doc;
 };
 try{return {out:await m.v30WorkerReview(env,state,now,{read,clock:()=>now,maxWaitMs:0}),state,sends,calls,original,m};}finally{Date.now=oldClock;globalThis.fetch=oldFetch;}
}
test('compiled V42.1 sends valid matched new runner quote without unsupported direct exchange call',async()=>{
 const x=await simulate();assert.equal(x.out.sent,1);assert.equal(x.sends.length,1);assert.match(x.sends[0].text,/V42\.1/);
 assert.equal(x.state.v30ActualForecasts[0].entry_quote.at_ms,T+1100);assert.equal(x.state.v30ActualForecasts[0].dispatch_snapshot.transport,'GITHUB_RUNNER_POST_PUBLICATION');
 assert.equal(x.out.dispatch_revalidation.verified,1);assert.equal(x.out.dispatch_revalidation.errors,0);assert.equal(x.out.public_ack_history.records.length,1);
});
test('compiled V42.1 still blocks changed direction after fresh runner quote',async()=>{const x=await simulate(true);assert.equal(x.out.sent,0);assert.equal(x.sends.length,0);assert.equal(x.out.dispatch_revalidation.errors,0);assert.equal(x.out.dispatch_revalidation.rejected,1)});
test('V42.1 public health advertises trusted transport but never forecast accuracy',async()=>{
 assert(existsSync(path));const m=await import(path);const h=await(await m.default.fetch(new Request('https://test/'),{})).json();
 assert.equal(h.trustedRunnerDispatchQuoteEnabled,true);assert.equal(h.dispatchQuoteRevalidationEnabled,true);assert.equal(h.completeAckEvidenceEnabled,true);
 assert.equal(h.marketNotificationsEnabled,true);assert.equal(h.marketRiskWarningsEnabled,true);
});
test('V42.1 keeps original direction qualification, anti-duplicate and risk functions identical',()=>{
 assert(existsSync(path));const a=readFileSync(new URL('../deployment/IRYS_V42_DISPATCH_WORKER.mjs',import.meta.url),'utf8'),b=readFileSync(path,'utf8');
 for(const [s,e] of [['function v30Qualify(','function v30FuturesCandidates('],['function v29CheckPair(','function v29DeliveryPolicy('],['function v31EntryBudget(','function v31ShouldRecord('],['async function v34WorkerReview(','const V30_PRODUCER_DIGEST=']])assert.equal(a.slice(a.indexOf(s),a.indexOf(e)),b.slice(b.indexOf(s),b.indexOf(e)));
});
