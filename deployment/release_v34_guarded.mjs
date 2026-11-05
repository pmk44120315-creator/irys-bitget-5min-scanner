/** Ordinary code-only upgrade. No private export, forced scan or test Telegram. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const OLD='20c730063705ffa9fdbafa000621bbd8db94a71e3e926fa915c88fa56db44a3a';
const NEW='728b2d14d3543b79040d810cbfe290dbb14c6edb3987ee5b2db4d96b0d9de881';
const MODEL='f1a41dd4f64ee0efb37356e25c393d2066366b99d6570f35e64cbb8fe4ffcab6';
const VERSION='IRYS-V34-CROSS-VENUE-CRASH-WARNING-20261106';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function release(io,candidate){
 assert.equal(hash(candidate),NEW,'EXACT_REVIEWED_CODE_REQUIRED');
 const original=await io.source();assert.equal(hash(original),OLD,'CURRENT_SOURCE_LEASE_CHANGED');
 const settings=await io.config(),cron=settings.schedules?.schedules||settings.schedules;
 assert(Array.isArray(cron));assert.deepEqual(cron.map(x=>x.cron).sort(),['*/5 * * * *']);
 for(const name of ['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'])assert(settings.bindings.some(x=>x.name===name),'ORIGINAL_BINDING_MISSING');
 const before=await io.health();assert.equal(before.last?.status,'PASS','ORIGINAL_RUNTIME_NOT_PASS');
 const doc=await io.feed(),now=io.clock();
 assert.equal(doc.version,'IRYS_V34_CROSS_VENUE_DROP_V1');assert.equal(doc.model_digest,MODEL,'PRODUCER_MODEL_MISMATCH');
 assert(Number.isSafeInteger(doc.at_ms)&&doc.at_ms<=now&&now-doc.at_ms<=6*60000,'PRODUCER_NOT_RECENT');
 assert(doc.orders_sent===false&&doc.telegram_sent===false&&Array.isArray(doc.items)&&doc.items.length===6,'REAL_PROVIDER_COVERAGE_MISSING');
 assert(Array.isArray(doc.provider_errors)&&doc.provider_errors.length===0,'REAL_PROVIDER_ERRORS');
 assert(['OBSERVED_DROP','VERIFIED_QUIET'].includes(doc.summary?.status)&&doc.summary.missing_assets?.length===0,'PRODUCER_NATIVE_EVIDENCE_INCOMPLETE');
 io.save('preflight.json',{at_utc:new Date(now).toISOString(),old_sha256:OLD,new_sha256:NEW,risk_model_digest:MODEL,producer_at_ms:doc.at_ms,producer_status:doc.summary.status,provider_items:doc.items.length,
  note:'Deployment readiness is not per-message freshness; runtime rechecks 45s quotes.',no_test_messages:true});
 assert.equal(hash(await io.source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
 try{
  await io.upload(candidate);assert.equal(hash(await io.source()),NEW,'DEPLOYED_SOURCE_HASH_MISMATCH');assert.deepEqual(await io.config(),settings,'ORIGINAL_CONFIG_CHANGED');
  const after=await io.health();assert(after.kvConfigured&&after.telegramSecretConfigured&&after.githubDispatchConfigured&&after.workersAIConfigured,'BINDINGS_NOT_READY');
  const proof={at_utc:new Date(io.clock()).toISOString(),version:VERSION,source_sha256:NEW,previous_sha256:OLD,risk_model_digest:MODEL,
   exact_source_readback_verified:true,cron_and_bindings_preserved:true,natural_tick_verified:false,forecast_accuracy_proven:false,
   original_entry_model_unchanged:true,risk_is_not_short_entry:true,no_manual_scan_or_test_messages:true,orders_sent:false};
  io.save('deployment.json',proof);return proof;
 }catch(error){
  const current=await io.source();if(hash(current)===NEW)await io.upload(original);else assert.equal(hash(current),OLD,'EXTERNAL_CHANGE_NOT_OVERWRITTEN');
  assert.equal(hash(await io.source()),OLD,'ROLLBACK_UNVERIFIED');assert.deepEqual(await io.config(),settings,'ROLLBACK_CONFIG_UNVERIFIED');
  io.save('rollback.json',{restored:true,source_sha256:OLD});throw error;
 }
}
async function main(){
 assert.equal(process.env.GITHUB_REF,'refs/heads/fix/irys-v34-crash-alert-20261106','RELEASE_BRANCH_MISMATCH');
 const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;
 assert(/^[a-f0-9]{32}$/.test(account)&&typeof token==='string'&&token.length>20,'AUTHORIZED_ACCESS_MISSING');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor',headers={authorization:'Bearer '+token};
 mkdirSync('v34_release',{recursive:true});const req=(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(35000)});
 const io={clock:Date.now,save:(n,x)=>writeFileSync('v34_release/'+n,JSON.stringify(x,null,2)),
  source:async()=>{const r=await req(base,{headers});assert(r.ok,'SOURCE_HTTP_'+r.status);if((r.headers.get('content-type')||'').startsWith('multipart/')){const f=await r.formData(),m=f.get('metadata'),j=m?JSON.parse(typeof m==='string'?m:await m.text()):{},p=f.get(j.main_module||j.body_part||'worker.js');assert(p);return Buffer.from(typeof p==='string'?p:await p.arrayBuffer())}return Buffer.from(await r.arrayBuffer())},
  config:async()=>{const x=await Promise.all(['/settings','/schedules'].map(async path=>{const r=await req(base+path,{headers});assert(r.ok,'CONFIG_HTTP_'+r.status);const j=await r.json();assert(j.success);return j.result}));return {bindings:x[0].bindings,schedules:x[1]}},
  health:async()=>{const r=await req('https://irys-surge-monitor.vhehwpfl.workers.dev/?v34release='+Date.now());assert(r.ok,'HEALTH_HTTP_'+r.status);return r.json()},
  feed:async()=>{const r=await req('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v34_crash_latest.json?preflight='+Date.now());assert(r.ok,'PUBLIC_PRODUCER_UNAVAILABLE');return r.json()},
  upload:async bytes=>{const f=new FormData();f.set('metadata',JSON.stringify({main_module:'worker.js'}));f.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');const r=await req(base+'/content',{method:'PUT',headers,body:f});const j=await r.json();assert(r.ok&&j.success,'CODE_ONLY_UPLOAD_'+r.status)}};
 console.log('V34_EXACT_DEPLOYMENT',JSON.stringify(await release(io,readFileSync('deployment/IRYS_V34_CRASH_WARNING_WORKER.mjs'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V34_RELEASE_FAILED',String(e.message||e));process.exitCode=1});
export {release,OLD,NEW,MODEL,VERSION};
