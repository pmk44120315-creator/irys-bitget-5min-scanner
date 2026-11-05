/** Code-only original-source lease and rollback. No private export or test messages. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const OLD='728b2d14d3543b79040d810cbfe290dbb14c6edb3987ee5b2db4d96b0d9de881';
const NEW='949cc9b7392e7f6bbf7ce710509b804ce734cf6b123294b1a2c530cfdc2669aa';
const MODEL='baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9';
const VERSION='IRYS-V35-SIGNAL-LIFECYCLE-20261106';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function release(io,candidate){
 assert.equal(hash(candidate),NEW,'EXACT_REVIEWED_CODE_REQUIRED');
 const original=await io.source();assert.equal(hash(original),OLD,'LIVE_SOURCE_LEASE_CHANGED');
 const settings=await io.config(),cron=settings.schedules?.schedules||settings.schedules;
 assert(Array.isArray(cron));assert.deepEqual(cron.map(x=>x.cron).sort(),['*/5 * * * *']);
 for(const n of ['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'])assert(settings.bindings.some(x=>x.name===n),'ORIGINAL_BINDING_MISSING');
 const h=await io.health();assert.equal(h.last?.status,'PASS','ORIGINAL_RUNTIME_NOT_PASS');
 const d=await io.feed(),now=io.clock();assert.equal(d.version,'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1');assert.equal(d.model_digest,MODEL,'PRODUCER_MODEL_MISMATCH');
 assert(Number.isSafeInteger(d.at_ms)&&d.at_ms<=now&&now-d.at_ms<=360000,'CURRENT_PRODUCER_NOT_READY');
 assert(d.summary?.listed_spot>=100&&d.summary?.listed_futures>=100&&d.summary.selected===d.summary.evaluated&&d.summary.unreviewed===0,'OFFICIAL_EVIDENCE_INCOMPLETE');
 assert(d.orders_sent===false&&d.telegram_sent===false,'PRODUCER_SIDE_EFFECT_CONTRACT');
 assert(d.timing?.history_reads_in_live_path===false&&Array.isArray(d.followups),'V35_FEATURES_NOT_READY');
 io.save('preflight.json',{at_utc:new Date(now).toISOString(),old_sha256:OLD,new_sha256:NEW,model_digest:MODEL,source_at_ms:d.at_ms,source_summary:d.summary,no_manual_messages:true});
 assert.equal(hash(await io.source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
 try{
  await io.upload(candidate);assert.equal(hash(await io.source()),NEW,'DEPLOYED_HASH_MISMATCH');assert.deepEqual(await io.config(),settings,'ORIGINAL_CONFIG_CHANGED');
  const a=await io.health();assert(a.kvConfigured&&a.telegramSecretConfigured&&a.githubDispatchConfigured&&a.workersAIConfigured,'LIVE_BINDINGS_NOT_READY');
  const proof={at_utc:new Date(io.clock()).toISOString(),version:VERSION,source_sha256:NEW,previous_sha256:OLD,producer_digest:MODEL,exact_source_readback_verified:true,cron_and_bindings_preserved:true,risk_lane_unchanged:true,entry_qualification_unchanged:true,natural_tick_verified:false,live_message_edit_verified:false,forecast_accuracy_proven:false,manual_scans_or_test_messages:false,orders_sent:false};
  io.save('deployment.json',proof);return proof;
 }catch(e){
  const live=await io.source();if(hash(live)===NEW)await io.upload(original);else assert.equal(hash(live),OLD,'EXTERNAL_CHANGE_NOT_OVERWRITTEN');
  assert.equal(hash(await io.source()),OLD,'ROLLBACK_UNVERIFIED');assert.deepEqual(await io.config(),settings,'ROLLBACK_CONFIG_UNVERIFIED');io.save('rollback.json',{restored:true,source_sha256:OLD});throw e;
 }
}
async function main(){
 assert.equal(process.env.GITHUB_REF,'refs/heads/fix/irys-v35-thesis-lifecycle-20261106','RELEASE_BRANCH_MISMATCH');
 const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;assert(/^[a-f0-9]{32}$/.test(account)&&typeof token==='string'&&token.length>20,'AUTHORIZED_ACCESS_MISSING');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor',headers={authorization:'Bearer '+token};
 mkdirSync('v35_release',{recursive:true});const req=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(35000)});
 const io={clock:Date.now,save:(n,o)=>writeFileSync('v35_release/'+n,JSON.stringify(o,null,2)),
 source:async()=>{const r=await req(base,{headers});assert(r.ok,'SOURCE_HTTP_'+r.status);if((r.headers.get('content-type')||'').startsWith('multipart/')){const f=await r.formData(),m=f.get('metadata'),j=m?JSON.parse(typeof m==='string'?m:await m.text()):{},p=f.get(j.main_module||j.body_part||'worker.js');assert(p);return Buffer.from(typeof p==='string'?p:await p.arrayBuffer())}return Buffer.from(await r.arrayBuffer())},
 config:async()=>{const r=await Promise.all(['/settings','/schedules'].map(async p=>{const a=await req(base+p,{headers});assert(a.ok,'CONFIG_HTTP_'+a.status);const j=await a.json();assert(j.success);return j.result}));return {bindings:r[0].bindings,schedules:r[1]}},
 health:async()=>{const r=await req('https://irys-surge-monitor.vhehwpfl.workers.dev/?v35release='+Date.now());assert(r.ok,'HEALTH_HTTP_'+r.status);return r.json()},
 feed:async()=>{const r=await req('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v30_direction_latest.json?preflight='+Date.now());assert(r.ok,'PUBLIC_PRODUCER_UNAVAILABLE');return r.json()},
 upload:async bytes=>{const f=new FormData();f.set('metadata',JSON.stringify({main_module:'worker.js'}));f.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');const r=await req(base+'/content',{method:'PUT',headers,body:f});const j=await r.json();assert(r.ok&&j.success,'CODE_ONLY_UPLOAD_'+r.status)}};
 console.log('V35_EXACT_DEPLOYMENT',JSON.stringify(await release(io,readFileSync('deployment/IRYS_V35_LIFECYCLE_WORKER.mjs'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V35_RELEASE_FAILED',String(e.message||e));process.exitCode=1});
export {release,OLD,NEW,MODEL,VERSION};
