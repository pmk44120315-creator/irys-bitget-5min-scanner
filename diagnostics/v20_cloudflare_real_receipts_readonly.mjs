/* Cloudflare Workers Observability REST query only; no production mutations. */
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CF_CREDENTIAL_UNAVAILABLE');
const url='https://api.cloudflare.com/client/v4/accounts/'+account+
 '/workers/observability/telemetry/query';
const query={
 queryId:'irys-v20-last-telegram-receipts-20261031',
 timeframe:{from:Date.parse('2026-10-30T13:03:00Z'),to:Date.now()},
 view:'events',dry:true,limit:2400,
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
function nestedObject(raw,key){
 const p=raw.indexOf('"'+key+'":');
 if(p<0)return null;
 const start=raw.indexOf('{',p+key.length+3);
 if(start<0||start-p>65)return null;
 let depth=0,str=false,escape=false;
 for(let i=start;i<raw.length;i++){
  const c=raw[i];
  if(str){
    if(escape)escape=false;
    else if(c==='\\')escape=true;
    else if(c==='"')str=false;
  }else if(c==='"')str=true;
  else if(c==='{')depth++;
  else if(c==='}'){
   depth--;if(depth===0){try{return JSON.parse(raw.slice(start,i+1))}catch(e){return null}}
  }
 }
 return null;
}
const visible=[],outcomes=[],statuses=[];
for(const e of Array.isArray(records)?records:[]){
 const raw=typeof e.source==='string'?e.source:JSON.stringify(e.source||'');
 const audit=nestedObject(raw,'aiOutcomeAudit');
 const last=nestedObject(raw,'aiJudgment');
 if(audit){
   for(const item of (audit.last_completed||[])){
     if(item?.symbol && item?.horizon_min) outcomes.push({
       at_event_utc:e.timestamp?new Date(e.timestamp).toISOString():null,
       venue:item.venue||null,symbol:item.symbol,
       direction:item.direction,horizon:item.horizon_min,
       return_pct:item.return_pct,direction_right:item.direction_right
     });
   }
 }
 if(last?.status)statuses.push({
   at_utc:e.timestamp?new Date(e.timestamp).toISOString():null,status:last.status,
   ai_sent:last.alerts_sent||0
 });
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
console.log('IRYS_V20_TELEGRAM_RECEIPTS_READONLY',JSON.stringify({
 outcome_events_count:outcomes.length,outcome_events:outcomes.slice(0,250),
 recent_ai_states:statuses.slice(0,4),
 count:Array.isArray(records)?records.length:0,
 distinct_receipts:unique.length,
 receipt_summary:unique.slice(0,80),
 shape:Object.keys(json.result||{}).slice(0,12),
 no_worker_mutation:true
}));
