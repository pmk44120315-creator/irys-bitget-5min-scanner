/** Code-only exact-source release, current source lease, config preservation and rollback. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const OLD='e3fa2f1da6151ceb419fe5f21bf5fae8afd3db5a2d8068425f0986e64692c19d';
const NEW='932845cb6cf1949e453e52bbf6c75387820c6981fdb91ebc45b2e086a6fe176d';
const VERSION='IRYS-V28.1-MARKET-RELATIVE-BUILDUP-20261102';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function guardedRelease(io,candidate){
 assert.equal(hash(candidate),NEW,'NOT_EXACT_TESTED_V28');
 const original=await io.source();assert.equal(hash(original),OLD,'LIVE_SOURCE_LEASE_CHANGED');
 const settings=await io.config(),cron=settings.schedules?.schedules||settings.schedules;
 assert(Array.isArray(cron),'SCHEDULE_SCHEMA');assert.deepEqual(cron.map(x=>x.cron).sort(),['*/5 * * * *']);
 for(const name of ['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'])assert(settings.bindings.some(x=>x.name===name),'BINDING_MISSING_'+name);
 const before=await io.health();assert.equal(before.last?.status,'PASS','ORIGINAL_RUNTIME_NOT_PASS');
 io.save('preflight.json',{old_sha256:OLD,new_sha256:NEW,previous_tick:before.last.time,previous_version:before.last.codeVersion,bindings_present:true,cron:['*/5 * * * *']});
 assert.equal(hash(await io.source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
 try{
  await io.upload(candidate);assert.equal(hash(await io.source()),NEW,'DEPLOYED_HASH_MISMATCH');
  assert.deepEqual(await io.config(),settings,'CONFIG_CHANGED');
  const after=await io.health();assert(after.kvConfigured&&after.telegramSecretConfigured&&after.githubDispatchConfigured&&after.workersAIConfigured,'LIVE_BINDINGS_NOT_READY');
  const proof={at_utc:new Date(io.clock()).toISOString(),version:VERSION,source_sha256:NEW,previous_source_sha256:OLD,exact_source_readback_verified:true,bindings_and_cron_preserved:true,natural_tick_verified:false,future_accuracy_improvement_proven:false,manual_scans_or_test_messages:false,orders_sent:false};
  io.save('deployment.json',proof);return proof;
 }catch(error){
  const current=await io.source();
  if(hash(current)===NEW)await io.upload(original);
  else assert.equal(hash(current),OLD,'CONCURRENT_EXTERNAL_CHANGE_NO_OVERWRITE');
  assert.equal(hash(await io.source()),OLD,'ROLLBACK_UNVERIFIED');assert.deepEqual(await io.config(),settings,'ROLLBACK_CONFIG_UNVERIFIED');
  io.save('rollback.json',{restored:true,sha256:OLD,reason:'POST_UPLOAD_VERIFICATION_FAILURE'});throw error;
 }
}
async function main(){
 assert.equal(process.env.GITHUB_REF,'refs/heads/deploy/irys-v28-buildup-20261102','RELEASE_REF_MISMATCH');
 const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;
 assert(/^[a-f0-9]{32}$/.test(account)&&typeof token==='string'&&token.length>20,'AUTHORIZED_ACCESS_MISSING');
 const url='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
 const auth={authorization:'Bearer '+token};mkdirSync('v28_release',{recursive:true});
 const req=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(35000)});
 const io={clock:Date.now,save:(name,obj)=>writeFileSync('v28_release/'+name,JSON.stringify(obj,null,2)),
 source:async()=>{const r=await req(url,{headers:auth});assert(r.ok,'SOURCE_HTTP_'+r.status);
  if((r.headers.get('content-type')||'').startsWith('multipart/')){const f=await r.formData(),m=f.get('metadata');const j=m?JSON.parse(typeof m==='string'?m:await m.text()):{};const p=f.get(j.main_module||j.body_part||'worker.js');assert(p,'SOURCE_PART_MISSING');return Buffer.from(typeof p==='string'?p:await p.arrayBuffer())}return Buffer.from(await r.arrayBuffer());},
 config:async()=>{const list=await Promise.all(['/settings','/schedules'].map(async p=>{const r=await req(url+p,{headers:auth});assert(r.ok,'CONFIG_HTTP_'+r.status);const j=await r.json();assert(j.success,'CONFIG_FAILURE');return j.result}));return {bindings:list[0].bindings,schedules:list[1]};},
 health:async()=>{const r=await req('https://irys-surge-monitor.vhehwpfl.workers.dev/?v28release='+Date.now());assert(r.ok,'HEALTH_HTTP_'+r.status);return r.json();},
 upload:async bytes=>{const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.js'}));form.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');const r=await req(url+'/content',{method:'PUT',headers:auth,body:form});const j=await r.json();assert(r.ok&&j.success,'UPLOAD_HTTP_'+r.status);}};
 const result=await guardedRelease(io,readFileSync('deployment/IRYS_V28_BUILDUP_WORKER.mjs'));
 console.log('V28_GUARDED_DEPLOYMENT',JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V28_RELEASE_FAILED',String(e.message||e));process.exitCode=1});
export {guardedRelease,OLD,NEW,VERSION};
