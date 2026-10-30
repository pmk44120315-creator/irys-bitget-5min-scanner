/** Only the isolated local wrangler development process reads existing production KV.
 * No worker deployments, no KV writes, no Telegram calls, no account keys logged.
 */
import {writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CLOUDFLARE_SECRETS_UNAVAILABLE');
const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+
 '/workers/scripts/irys-surge-monitor/settings',{
 headers:{Authorization:'Bearer '+token,Accept:'application/json'},
 signal:AbortSignal.timeout(18000)
});
if(!response.ok)throw Error('WORKER_SETTINGS_READ_FAILED_'+response.status);
const settings=await response.json();
const binding=(settings.result?.bindings||[]).find(b=>b.name==='IRYS_KV'&&b.type==='kv_namespace');
if(!/^[a-f0-9]{32}$/.test(binding?.namespace_id||''))throw Error('REMOTE_KV_NAMESPACE_ID_NOT_DISCOVERED');
const name=join(tmpdir(),'irys-local-kv-read-'+randomBytes(6).toString('hex')+'.json');
const config={
 name:'irys-readonly-audit-do-not-deploy',
 compatibility_date:'2026-10-30',
 main:resolve('audits/v16_read_kv_local_worker.mjs'),
 kv_namespaces:[{binding:'IRYS_KV',id:binding.namespace_id,remote:true}]
};
await writeFile(name,JSON.stringify(config));
let processRef,stderr='',last=null;
try{
 processRef=spawn('npx',['--yes','wrangler@4.135.0','dev',
   '--config',name,'--ip','127.0.0.1','--port','8791'],{
    env:{...process.env,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,
      WRANGLER_SEND_METRICS:'false',CI:'true'},
    detached:true,stdio:['ignore','pipe','pipe']});
 processRef.stderr.on('data',buf=>{stderr=(stderr+String(buf)).slice(-2000)});
 processRef.stdout.on('data',()=>{});
 for(let i=0;i<80;i++){
   await new Promise(r=>setTimeout(r,1000));
   try{
     const r=await fetch('http://127.0.0.1:8791/diag',{signal:AbortSignal.timeout(1500)});
     const j=await r.json();
     last=j;
     if(j.status==='ACTUAL_STATE_FOUND'||j.status==='STATE_NOT_FOUND'||j.status==='KV_READ_FAILED')
        break;
   }catch(_e){}
   if(processRef.exitCode!==null)break;
 }
 console.log('IRYS_Wrangler_REMOTE_KV_READONLY_PROBE',JSON.stringify({
   status:last?.status||'WRANGLER_RUNTIME_UNAVAILABLE',
   last_kst:last?.last_kst||null,worker_version:last?.version||null,
   ai_alert_records:last?.ai_alert_records??null,
   receipt_records:last?.receipt_records??null,
   spot_outcomes:last?.spot_outcomes??null,
   futures_outcomes:last?.futures_outcomes??null,
   diagnostic_error:last?.message||null,
   dev_error_type:last?'NONE':(stderr.includes('Authentication')?'WRANGLER_AUTH_FAILED':
     stderr.includes('error')?'LOCAL_DEV_FAILURE':'UNKNOWN'),
   no_production_worker_deploy:true,no_kv_writes:true
 }));
}finally{
 if(processRef?.pid){
  try{process.kill(-processRef.pid,'SIGTERM')}catch(_e){}
 }
 await unlink(name).catch(()=>{});
}
