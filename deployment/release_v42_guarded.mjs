/** Exact code-only lease, natural-tick proof and rollback. No test notifications. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const OLD='6356cf5919e5dd05808d9b84bf92378393cc0b9a9da31e964d93566cc86c0d13';
const NEW='cc1414e1883546c1eb1fe53ea449e81b721de3089c1689fc636b65fa0470459e';
const MODEL='baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9';
const VERSION='IRYS-V42-DISPATCH-REVALIDATED-ACK-FEEDBACK-20261108';
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
 assert(d.timing?.history_reads_in_live_path===false&&Array.isArray(d.followups),'EXISTING_SOURCE_CONTRACT_NOT_READY');
 io.save('preflight.json',{at_utc:new Date(now).toISOString(),old_sha256:OLD,new_sha256:NEW,model_digest:MODEL,source_at_ms:d.at_ms,source_summary:d.summary,no_manual_messages:true});
 assert.equal(hash(await io.source()),OLD,'SOURCE_CHANGED_DURING_PREFLIGHT');
 try{
  await io.upload(candidate);assert.equal(hash(await io.source()),NEW,'DEPLOYED_HASH_MISMATCH');assert.deepEqual(await io.config(),settings,'ORIGINAL_CONFIG_CHANGED');
  const a=await io.health();assert(a.kvConfigured&&a.telegramSecretConfigured&&a.githubDispatchConfigured&&a.workersAIConfigured,'LIVE_BINDINGS_NOT_READY');
  assert(a.dispatchQuoteRevalidationEnabled===true&&a.completeAckEvidenceEnabled===true,'V42_PUBLIC_FLAGS_MISSING');
  assert(a.marketNotificationsEnabled===true&&a.marketRiskWarningsEnabled===true,'EXISTING_ALERT_LANES_DISABLED');
  assert.equal(typeof io.natural,'function','NATURAL_TICK_VERIFIER_REQUIRED');
  const natural=await io.natural();assert.equal(natural.code_version,VERSION);assert.equal(natural.status,'PASS');
  assert.equal(natural.dispatch_version,'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1');
  assert.equal(hash(await io.source()),NEW,'SOURCE_CHANGED_AFTER_NATURAL_TICK');assert.deepEqual(await io.config(),settings,'CONFIG_CHANGED_AFTER_NATURAL_TICK');
  const proof={at_utc:new Date(io.clock()).toISOString(),version:VERSION,source_sha256:NEW,previous_sha256:OLD,producer_digest:MODEL,
   exact_source_readback_verified:true,cron_and_bindings_preserved:true,risk_lane_unchanged:true,entry_qualification_unchanged:true,
   dispatch_now_revalidates_new_official_quote:true,public_ack_history_sanitized:true,natural_tick_verified:true,
   forecast_accuracy_proven:false,manual_scans_or_test_messages:false,orders_sent:false,natural};
  io.save('deployment.json',proof);return proof;
 }catch(e){
  const live=await io.source();if(hash(live)===NEW)await io.upload(original);else assert.equal(hash(live),OLD,'EXTERNAL_CHANGE_NOT_OVERWRITTEN');
  assert.equal(hash(await io.source()),OLD,'ROLLBACK_UNVERIFIED');assert.deepEqual(await io.config(),settings,'ROLLBACK_CONFIG_UNVERIFIED');
  io.save('rollback.json',{restored:true,source_sha256:OLD,reason:String(e.message).slice(0,160)});throw e;
 }
}
async function main(){
 assert.equal(process.env.GITHUB_REF,'refs/heads/fix/irys-v42-ack-direction-review-20261108','RELEASE_BRANCH_MISMATCH');
 const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;assert(/^[a-f0-9]{32}$/.test(account)&&typeof token==='string'&&token.length>20,'AUTHORIZED_ACCESS_MISSING');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor',headers={authorization:'Bearer '+token};
 mkdirSync('v42_release',{recursive:true});const req=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(35000)});
 const io={clock:Date.now,save:(n,o)=>writeFileSync('v42_release/'+n,JSON.stringify(o,null,2)),
  source:async()=>{const r=await req(base,{headers});assert(r.ok,'SOURCE_HTTP_'+r.status);if((r.headers.get('content-type')||'').startsWith('multipart/')){const f=await r.formData(),m=f.get('metadata'),j=m?JSON.parse(typeof m==='string'?m:await m.text()):{},p=f.get(j.main_module||j.body_part||'worker.js');assert(p);return Buffer.from(typeof p==='string'?p:await p.arrayBuffer())}return Buffer.from(await r.arrayBuffer())},
  config:async()=>{const r=await Promise.all(['/settings','/schedules'].map(async p=>{const a=await req(base+p,{headers});assert(a.ok,'CONFIG_HTTP_'+a.status);const j=await a.json();assert(j.success);return j.result}));return {bindings:r[0].bindings,schedules:r[1]}},
  health:async()=>{const r=await req('https://irys-surge-monitor.vhehwpfl.workers.dev/?v42readonly='+Date.now());assert(r.ok,'HEALTH_HTTP_'+r.status);return r.json()},
  feed:async()=>{const r=await req('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v30_direction_latest.json?preflight='+Date.now());assert(r.ok,'PUBLIC_PRODUCER_UNAVAILABLE');return r.json()},
  upload:async bytes=>{const f=new FormData();f.set('metadata',JSON.stringify({main_module:'worker.js'}));f.set('worker.js',new Blob([bytes],{type:'application/javascript+module'}),'worker.js');const r=await req(base+'/content',{method:'PUT',headers,body:f});const j=await r.json();assert(r.ok&&j.success,'CODE_ONLY_UPLOAD_'+r.status)},
  natural:async()=>{
   // Allow the next existing 5-minute Cron plus its normal evidence wait. No new Cron or forced scan.
   const deadline=(Math.floor(Date.now()/300000)+1)*300000+240000;
   while(Date.now()<=deadline){
    const h=await io.health(),last=h.last||{},d=last.v30DirectionalDelivery||{};
    if(last.codeVersion===VERSION){
     const proof={checked_at_utc:new Date().toISOString(),code_version:last.codeVersion,time:last.time,status:last.status,
      delivery_status:d.status,dispatch_version:d.dispatch_revalidation?.version,dispatch_revalidation:d.dispatch_revalidation,
      retained_ack_records:d.public_ack_history?.retained_ack_records,source_feed_ok:d.feed?.ok,
      risk_status:last.v34MarketRisk?.status,risk_feed_ok:last.v34MarketRisk?.feed?.ok,no_manual_scans:true};
     io.save('natural_proof.json',proof);assert.equal(last.status,'PASS','NATURAL_RUNTIME_NOT_PASS');
     assert.equal(d.dispatch_revalidation?.version,'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1','NEW_DISPATCH_PATH_NOT_OBSERVED');
     assert.equal(d.public_ack_history?.version,'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1','FULL_ACK_HISTORY_NOT_OBSERVED');
     assert(!['DELIVERY_STATE_UNVERIFIED','ACK_RECEIPT_PERSISTENCE_PARTIAL','DELIVERY_UNCERTAIN'].includes(d.status),'NATURAL_DELIVERY_STATE_ERROR');
     io.save('public_ack_history.json',d.public_ack_history);return proof;
    }
    await new Promise(r=>setTimeout(r,10000));
   }
   throw Error('NATURAL_TICK_NOT_VERIFIED');
  }};
 console.log('V42_EXACT_DEPLOYMENT',JSON.stringify(await release(io,readFileSync('deployment/IRYS_V42_DISPATCH_WORKER.mjs'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V42_RELEASE_FAILED',String(e.message||e));process.exitCode=1});
export {release,OLD,NEW,MODEL,VERSION};
