/** Code-only V31 release. No private state export, forced scan or test message. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const OLD='c1b8722e5231d85aacbda04497128926817dcc38508a1249b2d637e3f145c89a';
const NEW='20c730063705ffa9fdbafa000621bbd8db94a71e3e926fa915c88fa56db44a3a';
const MODEL='0f5b9a9f4fff19d148901583c52d1b77b8f1b04be0512f778f4ee5c2f15526ec';
const VERSION='IRYS-V31-TIMELY-ENTRY-AND-OUTCOMES-20261104';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function release(io,candidate){
 assert.equal(hash(candidate),NEW,'EXACT_TESTED_SOURCE_REQUIRED');
 const original=await io.source();assert.equal(hash(original),OLD,'LIVE_SOURCE_LEASE_CHANGED');
 const settings=await io.config(),cron=settings.schedules?.schedules||settings.schedules;
 assert(Array.isArray(cron));assert.deepEqual(cron.map(x=>x.cron).sort(),['*/5 * * * *']);
 for(const n of ['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'])assert(settings.bindings.some(x=>x.name===n),'ORIGINAL_BINDING_MISSING');
 const h=await io.health();assert.equal(h.last?.status,'PASS','ORIGINAL_RUNTIME_NOT_PASS');
 const doc=await io.feed(),now=io.clock();assert.equal(doc.version,'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1');assert.equal(doc.model_digest,MODEL,'PRODUCER_MODEL_MISMATCH');
 assert(doc.at_ms<=now&&now-doc.at_ms<=6*60000,'NO_RECENT_PRODUCER');
 assert(doc.summary?.listed_spot>=100&&doc.summary?.listed_futures>=100,'REAL_PROVIDER_COVERAGE_MISSING');
 assert(doc.summary.evaluated===doc.summary.selected&&doc.summary.unreviewed===0,'SHORTLIST_NOT_FULLY_CHECKED');
 assert(doc.orders_sent===false&&doc.telegram_sent===false,'PRODUCER_SIDE_EFFECT_CONTRACT');
 assert(doc.timing?.barrier_removed===true&&Array.isArray(doc.outcome_candles),'V31_SOURCE_FEATURES_UNVERIFIED');
 io.save('preflight.json',{at_utc:new Date(now).toISOString(),source_sha256:OLD,candidate_sha256:NEW,model_digest:MODEL,producer_at_ms:doc.at_ms,summary:doc.summary,no_manual_messages:true});
 assert.equal(hash(await io.source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
 try{
  await io.upload(candidate);assert.equal(hash(await io.source()),NEW,'DEPLOYED_HASH_MISMATCH');assert.deepEqual(await io.config(),settings,'ORIGINAL_CONFIG_CHANGED');
  const after=await io.health();assert(after.kvConfigured&&after.telegramSecretConfigured&&after.githubDispatchConfigured&&after.workersAIConfigured,'BINDINGS_NOT_READY');
  const proof={at_utc:new Date(io.clock()).toISOString(),version:VERSION,source_sha256:NEW,previous_sha256:OLD,producer_model_digest:MODEL,exact_code_readback_verified:true,cron_and_bindings_preserved:true,natural_tick_verified:false,future_accuracy_proven:false,manual_scans_or_test_messages:false,orders_sent:false};
  io.save('deployment.json',proof);return proof;
 }catch(e){
  const current=await io.source();if(hash(current)===NEW)await io.upload(original);else assert.equal(hash(current),OLD,'EXTERNAL_SOURCE_CHANGE_NO_OVERWRITE');
  assert.equal(hash(await io.source()),OLD,'ROLLBACK_UNVERIFIED');assert.deepEqual(await io.config(),settings,'ROLLBACK_CONFIG_UNVERIFIED');
  io.save('rollback.json',{restored:true,source_sha256:OLD});throw e;
 }
}
async function main(){
 assert.equal(process.env.GITHUB_REF,'refs/heads/fix/irys-v31-latency-quality-20261104','RELEASE_BRANCH_MISMATCH');
 const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;assert(/^[a-f0-9]{32}$/.test(account)&&typeof token==='string'&&token.length>20,'AUTHORIZED_ACCESS_MISSING');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor',headers={authorization:'Bearer '+token};
 mkdirSync('v31_release',{recursive:true});const req=(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(35000)});
 const io={clock:Date.now,save:(name,obj)=>writeFileSync('v31_release/'+name,JSON.stringify(obj,null,2)),
  source:async()=>{const r=await req(base,{headers});assert(r.ok,'SOURCE_HTTP_'+r.status);if((r.headers.get('content-type')||'').startsWith('multipart/')){const f=await r.formData(),m=f.get('metadata');const j=m?JSON.parse(typeof m==='string'?m:await m.text()):{},p=f.get(j.main_module||j.body_part||'worker.js');assert(p);return Buffer.from(typeof p==='string'?p:await p.arrayBuffer())}return Buffer.from(await r.arrayBuffer())},
  config:async()=>{const x=await Promise.all(['/settings','/schedules'].map(async path=>{const r=await req(base+path,{headers});assert(r.ok,'CONFIG_HTTP_'+r.status);const j=await r.json();assert(j.success);return j.result}));return {bindings:x[0].bindings,schedules:x[1]}},
  health:async()=>{const r=await req('https://irys-surge-monitor.vhehwpfl.workers.dev/?v31release='+Date.now());assert(r.ok,'PUBLIC_HEALTH_'+r.status);return r.json()},
  feed:async()=>{const r=await req('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v30_direction_latest.json?preflight='+Date.now());assert(r.ok,'PUBLIC_PRODUCER_MISSING');return r.json()},
  upload:async bytes=>{const f=new FormData();f.set('metadata',JSON.stringify({main_module:'worker.js'}));f.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');const r=await req(base+'/content',{method:'PUT',headers,body:f});const j=await r.json();assert(r.ok&&j.success,'CODE_ONLY_UPLOAD_'+r.status)}};
 console.log('V31_EXACT_DEPLOYMENT',JSON.stringify(await release(io,readFileSync('deployment/IRYS_V31_TIMELY_WORKER.mjs'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V31_RELEASE_FAILED',String(e.message||e));process.exitCode=1});
export {release,OLD,NEW,MODEL,VERSION};
