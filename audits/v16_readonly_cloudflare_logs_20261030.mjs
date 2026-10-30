/* Cloudflare Workers Observability REST query only; no production mutations. */
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CF_CREDENTIAL_UNAVAILABLE');
const url='https://api.cloudflare.com/client/v4/accounts/'+account+
 '/workers/observability/telemetry/query';
const query={
 queryId:'irys-readonly-20261030-early-alerts',
 timeframe:{from:Date.parse('2026-10-30T01:40:00Z'),to:Date.now()},
 view:'events',dry:true,limit:1500,
 parameters:{
   datasets:['cloudflare-workers'],filters:[],filterCombination:'and',limit:1500
 }
};
const response=await fetch(url,{method:'POST',headers:{
  Authorization:'Bearer '+token,'Content-Type':'application/json',
  Accept:'application/json'
 },body:JSON.stringify(query),signal:AbortSignal.timeout(25000)});
let json;
try{json=await response.json()}catch(_e){json={error:'NON_JSON_RESPONSE'}}
if(!response.ok||json.success===false){
 console.log('IRYS_CF_OBSERVABILITY_AUTH_RESULT',JSON.stringify({
   http_status:response.status,
   errors:(json.errors||[]).map(x=>({code:x.code||null,message:String(x.message||'').slice(0,140)})),
   no_worker_mutation:true
 }));
 process.exit(0);
}
const records=json.result?.events?.events||json.result?.events||[];
const visible=[];
for(const e of Array.isArray(records)?records:[]){
 const raw=typeof e.source==='string'?e.source:JSON.stringify(e.source||'');
 const msg=raw.match(/\"telegramLastApiReceipt\"\s*:\s*(\{[^}]{0,800}\})/);
 if(!msg)continue;
 try{
  const j=JSON.parse(msg[1]);
  if(j.channel&&j.symbol&&j.accepted_at)visible.push({
   channel:j.channel,symbol:j.symbol,
   at_kst:j.accepted_at,message_id:j.telegram_message_id
  });
 }catch(_e){}
}
const unique=[...new Map(visible.map(x=>[x.channel+':'+x.message_id,x])).values()];
console.log('IRYS_CLOUDFLARE_OBSERVABILITY_READONLY',JSON.stringify({
 count:Array.isArray(records)?records.length:0,
 distinct_receipts:unique.length,
 receipt_summary:unique.slice(0,80),
 shape:Object.keys(json.result||{}).slice(0,12),
 no_worker_mutation:true
}));
