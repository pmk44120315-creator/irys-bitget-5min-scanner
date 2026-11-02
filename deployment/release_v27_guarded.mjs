/** Guarded exact-source V27 release. No manual scan, messages, or orders. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {v27Quote,v27EffortResponse,V27_URL} from './v27_response.mjs';
const OLD='081baf77fd14b62594dd41bc0df7caa026bcaf9ffd128d6a2f61e49c5173fbc5';
const NEW='f9213445d95a1c52e4d72eb47961e8d63188d3d99ed7876894d69907b3e00b1f';
const VERSION='IRYS-V27.2-EXECUTABLE-RESPONSE-AUTHFRESH-20261102';
const sha=x=>createHash('sha256').update(x).digest('hex');
const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;
assert(/^[a-f0-9]{32}$/.test(account)&&token.length>20,'AUTHORIZED_RELEASE_ACCESS_MISSING');
assert.equal(process.env.GITHUB_REF,'refs/heads/deploy/irys-v27-reviewed-worker-20261102','RELEASE_REF_MISMATCH');
const api='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const publicURL='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={authorization:'Bearer '+token};
const candidate=readFileSync('deployment/IRYS_V27_RESPONSE_WORKER.mjs');
assert.equal(sha(candidate),NEW,'NOT_EXACT_TESTED_SOURCE');
mkdirSync('v27_deployment_receipt',{recursive:true});
const save=(name,x)=>writeFileSync('v27_deployment_receipt/'+name,JSON.stringify(x,null,2));
async function req(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(35000)});}
async function source(){
 const r=await req(api,{headers:auth});assert(r.ok,'SOURCE_HTTP_'+r.status);
 if((r.headers.get('content-type')||'').startsWith('multipart/')){
  const f=await r.formData(),m=f.get('metadata');const meta=m?JSON.parse(typeof m==='string'?m:await m.text()):{};
  const p=f.get(meta.main_module||meta.body_part||'worker.js');assert(p,'SOURCE_PART_MISSING');
  return Buffer.from(typeof p==='string'?p:await p.arrayBuffer());
 }
 return Buffer.from(await r.arrayBuffer());
}
async function config(){
 const result=await Promise.all(['/settings','/schedules'].map(async path=>{
  const r=await req(api+path,{headers:auth});assert(r.ok,'CONFIG_HTTP_'+r.status);const j=await r.json();assert(j.success,'CONFIG_READ_FAILURE');return j.result;
 }));return {bindings:result[0].bindings,schedules:result[1]};
}
async function upload(bytes){
 const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');
 const r=await req(api+'/content',{method:'PUT',headers:auth,body:form});const j=await r.json();assert(r.ok&&j.success,'CODE_ONLY_UPLOAD_'+r.status);
}
const original=await source();assert.equal(sha(original),OLD,'PRODUCTION_LEASE_CHANGED_NO_OVERWRITE');
const settings=await config();
const schedules=settings.schedules?.schedules||settings.schedules;
assert(Array.isArray(schedules),'CRON_SCHEMA');assert.deepEqual(schedules.map(x=>x.cron).sort(),['*/5 * * * *']);
for(const name of ['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'])assert(settings.bindings.some(b=>b.name===name),'BINDING_MISSING_'+name);
const oldHealth=await (await req(publicURL)).json();assert.equal(oldHealth.last?.status,'PASS','ORIGINAL_RUNTIME_NOT_PASS');
const feedResp=await req(V27_URL+'?release='+Date.now());assert(feedResp.ok,'V27_MAIN_FEED_UNAVAILABLE');
const feed=await feedResp.json(),now=Date.now();
assert.equal(feed.version,'IRYS_V27_EXECUTABLE_RESPONSE_V1');
assert(feed.at_ms<=now+1000&&now-feed.at_ms<=6*60000,'V27_MAIN_FEED_NOT_RECENT');
assert(feed.parent_at_ms===feed.source?.at_ms&&feed.at_ms>=feed.parent_at_ms,'V27_FEED_LINEAGE');
assert(feed.orders_sent===false&&feed.telegram_sent===false&&Object.keys(feed.quotes||{}).length>=100,'V27_FEED_INVALID');
assert(feed.source.candidates.every(c=>Number.isFinite(c.baseline_price)&&c.baseline_price>0),'EXACT_BASELINE_NOT_IN_PRODUCTION_SOURCE');
const br=await req('https://api.bithumb.com/v1/orderbook?markets=KRW-BTC,KRW-ETH');assert(br.ok,'BITHUMB_BOOK_READ_'+br.status);
const books=await br.json();assert(Array.isArray(books)&&books.length===2,'BITHUMB_BOOK_SCHEMA');
const spot=[];
for(const b of books){const u=b.orderbook_units?.[0],q=v27Quote({bid:u?.bid_price,ask:u?.ask_price,at_ms:Number(b.timestamp)},Date.now());assert(q,'BITHUMB_BOOK_CLOCK_OR_PRICE_INVALID');spot.push({symbol:b.market,age_ms:Date.now()-q.at_ms,spread_pct:q.spread_pct});}
const tr=await req('https://api.bithumb.com/v1/trades/ticks?market=KRW-BTC&count=500');assert(tr.ok,'BITHUMB_TAPE_READ_'+tr.status);
const tape=await tr.json();assert(Array.isArray(tape),'BITHUMB_TAPE_SCHEMA');
const effort=v27EffortResponse(tape,'bithumb',Date.now(),spot.find(x=>x.symbol==='KRW-BTC').spread_pct,'KRW-BTC');
assert(effort.future_direction_proven===false);
assert(effort.status==='SAMPLED_RESPONSE','BITHUMB_RECENT_RESPONSE_UNVERIFIED');
const preflight={at_utc:new Date().toISOString(),old_sha256:OLD,candidate_sha256:NEW,main_response_at_ms:feed.at_ms,main_response_quotes:Object.keys(feed.quotes).length,main_response_samples:Object.keys(feed.responses).length,source_candidates:feed.source.candidates.length,source_baselines_exact:true,bithumb_quotes:spot,bithumb_sample_status:effort.status,bithumb_sample_trades:effort.sample_trades||0,original_tick:oldHealth.last.time,original_status:oldHealth.last.status,cron_preserved:['*/5 * * * *'],original_bindings_present:true,no_test_messages_or_orders:true};
save('preflight.json',preflight);console.log('V27_LIVE_PREFLIGHT',JSON.stringify(preflight));
assert.equal(sha(await source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
let attempted=false;
try{
 attempted=true;await upload(candidate);
 assert.equal(sha(await source()),NEW,'DEPLOYED_HASH_MISMATCH');
 assert.deepEqual(await config(),settings,'BINDINGS_OR_CRON_CHANGED');
 const h=await (await req(publicURL)).json();assert(h.kvConfigured&&h.telegramSecretConfigured&&h.githubDispatchConfigured&&h.workersAIConfigured,'LIVE_BINDINGS_NOT_CONFIGURED');
 const receipt={deployed_at_utc:new Date().toISOString(),source_sha256:NEW,worker_version:VERSION,source_retrieved_and_hash_verified:true,bindings_and_cron_preserved:true,previous_code_sha256:OLD,old_natural_tick:h.last?.time,last_natural_tick_version:h.last?.codeVersion,artificial_telegram_messages_sent:false,orders_sent:false,predictive_accuracy_improvement_proven:false,natural_v27_tick_verified:h.last?.codeVersion===VERSION};
 save('deployment.json',receipt);console.log('V27_CODE_ONLY_DEPLOY_VERIFIED',JSON.stringify(receipt));
}catch(error){
 if(attempted){const active=await source();if(sha(active)===NEW){await upload(original);assert.equal(sha(await source()),OLD,'ROLLBACK_NOT_VERIFIED');assert.deepEqual(await config(),settings);console.error('V27_DEPLOY_FAILED_PREVIOUS_ROLLBACK_VERIFIED');}else assert.equal(sha(active),OLD,'EXTERNAL_SOURCE_CHANGE_NOT_OVERWRITTEN');}
 throw error;
}
