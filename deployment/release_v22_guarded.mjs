/** Owner-approved performance upgrade. Source-only CF change, never credentials/Cron. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'',token=process.env.IRYS_V7_CF_API_TOKEN||'';
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const healthUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={authorization:'Bearer '+token,accept:'application/json'};
const oldHash='d05577405be21f4a2c72f076ac5dd3b334b62c4cc52886eb4d69fb7e01ef016d';
const expectedNew='95c5bf30744287e55ceddfac77deb6575cad66a65e34731e97e320651ff83f93';
const expectedPolicy='01042875de40410f803968c22f1fcda3279ad5d706188816424d3136ba9ae29a';
const newVersion='IRYS-V22-ADAPTIVE-EXPECTED-RETURN-20261101';
const bytes=readFileSync(new URL('./IRYS_V22_ADAPTIVE_WORKER.mjs',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message)};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,authorized=true){
 const r=await fetch(url,{headers:authorized?auth:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 need(r.ok,'READ_HTTP_'+r.status);return r;
}
async function readSource(){
 const r=await get(root);let data,part='worker.js';
 if((r.headers.get('content-type')||'').toLowerCase().startsWith('multipart/form-data')){
  const form=await r.formData(),raw=form.get('metadata');
  const metadata=raw?JSON.parse(typeof raw==='string'?raw:await raw.text()):{};
  part=metadata.main_module||metadata.body_part||r.headers.get('cf-worker-main-module-part')||'worker.js';
  const entry=form.get(part);need(entry!==null,'WORKER_PART_MISSING');
  data=Buffer.from(typeof entry==='string'?entry:await entry.arrayBuffer());
 }else data=Buffer.from(await r.arrayBuffer());
 need(data.length>0&&part==='worker.js','UNKNOWN_MODULE');return {data,sha:digest(data)};
}
async function config(){
 const [sr,cr,hr]=await Promise.all([get(root+'/settings'),get(root+'/schedules'),get(healthUrl,false)]);
 const settings=await sr.json(),schedule=await cr.json(),health=await hr.json();
 const bindings=(settings.result?.bindings||[]).map(x=>[x.name,x.type,x.type==='kv_namespace'?x.namespace_id:null,x.type==='plain_text'?x.text:null]).sort((a,b)=>a[0].localeCompare(b[0]));
 const rows=Array.isArray(schedule.result?.schedules)?schedule.result.schedules:schedule.result;
 need(Array.isArray(rows),'CRON_SCHEMA');const crons=rows.map(r=>r.cron).sort();
 for(const [name,type] of [['AI','ai'],['IRYS_KV','kv_namespace'],['GITHUB_DISPATCH_TOKEN','secret_text'],['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']])
  need(bindings.some(x=>x[0]===name&&x[1]===type),'REQUIRED_BINDING_MISSING_'+name);
 need(JSON.stringify(crons)==='["*/5 * * * *"]','EXISTING_CRON_CHANGED');
 need(health.telegramSecretConfigured===true&&health.kvConfigured===true&&health.githubDispatchConfigured===true,'SERVICE_CONFIGURATION_INVALID');
 return {bindings,crons,health};
}
const same=(a,b)=>JSON.stringify(a.bindings)===JSON.stringify(b.bindings)&&JSON.stringify(a.crons)===JSON.stringify(b.crons);
async function upload(content){
 const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([content],{type:'application/javascript+module'}),'worker.js');
 const r=await fetch(root+'/content',{method:'PUT',headers:{authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(30000)});
 const d=await r.json().catch(()=>({success:false}));need(r.ok&&d.success===true,'SOURCE_UPLOAD_NOT_ACKED_'+r.status);
}
async function confirm(sha,before){
 const deadline=Date.now()+60000;
 do{if((await readSource()).sha===sha){need(same(await config(),before),'CONFIG_CHANGED');return;}await pause(2000);}while(Date.now()<deadline);
 throw Error('SOURCE_READBACK_NOT_CONFIRMED');
}
async function main(){
 need(/^[a-f0-9]{32}$/.test(account)&&token.length>20,'SCOPED_RELEASE_CREDENTIALS_MISSING');
 need(process.env.V22_RELEASE_INTENT==='USER_APPROVED_PERFORMANCE_UPGRADE','RELEASE_INTENT_MISSING');
 need(process.env.GITHUB_REF==='refs/heads/upgrade/irys-v22-performance-20261101','WRONG_RELEASE_BRANCH');
 need(digest(bytes)===expectedNew,'CANDIDATE_NOT_TESTED_BYTES');
 const text=bytes.toString('utf8');
 for(const anchor of [newVersion,expectedPolicy,'sendV22Forecasts(env,state,base.snap','v22ForecastDelivery:v22Run',
  'const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;','const AI_ALERT_TRANSPORT_ENABLED=false;',
  'state.v21Hour.count','evaluateV22Deliveries(state,Date.now())'])need(text.includes(anchor),'REVIEWED_CONTRACT_MISSING');
 const [old,before]=await Promise.all([readSource(),config()]);
 if(old.sha===expectedNew){console.log('V22_ALREADY_DEPLOYED_SOURCE_CONFIG_VERIFIED');return;}
 need(old.sha===oldHash,'LIVE_SOURCE_CHANGED_DO_NOT_OVERWRITE');
 need(before.health.last?.codeVersion==='IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031','CURRENT_VERSION_NOT_V21_1');
 need(before.health.last?.status==='PASS','ORIGINAL_RUNTIME_NOT_PASS');
 const report=await (await get('https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v22_latest.json?at='+Date.now(),false)).json();
 const at=Date.parse(report.at_utc||'');
 need(report.version==='IRYS_V22_CAUSAL_ADAPTIVE_V1'&&report.policy_sha256===expectedPolicy&&report.status==='ACTIVE'&&report.source_status==='PASS','V22_PRODUCER_NOT_VERIFIED');
 need(Number.isFinite(at)&&Date.now()-at>=0&&Date.now()-at<15*60000,'V22_PRODUCER_STALE');
 need((await readSource()).sha===oldHash,'SOURCE_LEASE_CHANGED');
 console.log('V22_RELEASE_PREFLIGHT',JSON.stringify({old_sha:old.sha,new_sha:expectedNew,policy:expectedPolicy,producer_at:report.at_utc,producer_status:report.status,cron:before.crons,bindings:before.bindings.map(x=>x[0]),no_messages_sent:true}));
 if(process.env.V22_DRY_RUN==='true'){console.log('V22_DRY_RUN_NO_MUTATION');return;}
 let attempted=false;
 try{
  attempted=true;await upload(bytes);await confirm(expectedNew,before);
  console.log('V22_CODE_DEPLOY_VERIFIED',JSON.stringify({worker:'irys-surge-monitor',version:newVersion,source_sha256:expectedNew,policy_sha256:expectedPolicy,at_utc:new Date().toISOString(),cron_preserved:true,bindings_preserved:true,actual_telegram_delivery_unverified:true,forecast_accuracy_unverified:true}));
 }catch(e){
  if(attempted){try{
   const active=await readSource();
   if(active.sha===expectedNew){await upload(old.data);await confirm(oldHash,before);console.error('V22_ROLLBACK_V21_1_VERIFIED');}
   else if(active.sha===oldHash)console.error('V22_ORIGINAL_SOURCE_REMAINS');
   else console.error('V22_CONCURRENT_CHANGE_NO_UNSAFE_ROLLBACK');
  }catch(restore){console.error('V22_ROLLBACK_UNVERIFIED',String(restore?.message||restore).slice(0,100));}}
  throw e;
 }
}
main().catch(e=>{console.error('V22_RELEASE_FAILED',String(e?.message||e).slice(0,170));process.exitCode=2;});
