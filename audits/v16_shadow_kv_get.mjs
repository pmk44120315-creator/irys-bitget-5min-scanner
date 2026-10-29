/** Read-only scoped Cloudflare KV state inspection; print only sanitized AI decisions. */
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'',
 token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('AUTH_UNAVAILABLE');
const headers={Authorization:'Bearer '+token,Accept:'application/json'};
const settingsUrl='https://api.cloudflare.com/client/v4/accounts/'+account+
 '/workers/scripts/irys-surge-monitor/settings';
const response=await fetch(settingsUrl,{headers,signal:AbortSignal.timeout(18000)});
if(!response.ok)throw Error('CLOUDFLARE_SETTINGS_HTTP_'+response.status);
const cfg=await response.json();
const binding=(cfg.result?.bindings||[]).find(x=>x.name==='IRYS_KV'&&x.type==='kv_namespace');
if(!binding?.namespace_id)throw Error('KV_BINDING_NOT_FOUND');
const stateKey=encodeURIComponent('irys:fast:state:v1');
const valueUrl='https://api.cloudflare.com/client/v4/accounts/'+account+
 '/storage/kv/namespaces/'+binding.namespace_id+'/values/'+stateKey;
const result=await fetch(valueUrl,{headers,signal:AbortSignal.timeout(18000)});
if(!result.ok){console.log('IRYS_V16_READONLY_KV_ACCESS',JSON.stringify({
 status:'KV_API_READ_UNAVAILABLE',http_code:result.status}));
 process.exitCode=0;
}else{
 const state=await result.json();
 const rows=Array.isArray(state.aiV16ShadowJudgments)?state.aiV16ShadowJudgments:[];
 const selected=rows.filter(x=>['bithumb','bitget'].includes(x.venue)&&
   typeof x.symbol==='string'&&x.symbol.length<=30).map(x=>({
     venue:x.venue,symbol:x.symbol,direction:x.direction,
     strength:x.strength,at:x.at
   }));
 console.log('IRYS_V16_REAL_MODEL_SHADOW_JUDGMENTS',JSON.stringify({
   status:'ACTUAL_KV_READ_NO_MUTATION',
   last_cron:state.last?.time||null,
   ai_status:state.last?.aiJudgment?.status||null,
   model_decisions:state.last?.aiJudgment?.model_decisions??null,
   selected_decisions:selected,
   last_alerts_count:Object.keys(state.lastAlert||{}).length,
   no_order_api:true
 }));
}
