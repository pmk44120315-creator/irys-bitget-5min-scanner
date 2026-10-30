/* One-time owner-authorized retrospective audit.
 * Temporary authenticated GET-only diagnostic in the same Worker, restored
 * byte-for-byte in finally before ANY official public market data requests.
 * Does not change Cron, model behavior, alerts, KV, bot or trading settings.
 * The randomly generated audit secret stays ONLY in this job and transient
 * Worker memory; source repository never contains its value.
 */
import {randomBytes,createHash} from 'node:crypto';
import {extractWorkerSource} from '../deployment/parse-cloudflare-script.mjs';

const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)
  throw Error('AUDIT_SCOPED_CLOUDFLARE_CREDS_UNAVAILABLE');
const worker='irys-surge-monitor';
const url='https://irys-surge-monitor.vhehwpfl.workers.dev';
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker;
const auth={authorization:'Bearer '+token,accept:'application/json'};
const exactOriginal='8668138db2c213c7b675e1a10f6b8bb9c5824b757a1648a9feeae073094c9f73';
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(x,msg)=>{if(!x)throw Error(msg)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const asNum=x=>{const n=Number(x);return Number.isFinite(n)?n:null};
async function getCode(){
 const r=await fetch(root,{headers:auth,signal:AbortSignal.timeout(18000)});
 return extractWorkerSource(r);
}
async function readJson(endpoint){
 const r=await fetch(root+endpoint,{headers:auth,signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('CLOUDFLARE_SETTINGS_READ_'+r.status);
 return r.json();
}
async function putCode(buffer){
 const form=new FormData();
 form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([buffer],{type:'application/javascript+module'}),'worker.js');
 const r=await fetch(root+'/content',{method:'PUT',headers:{authorization:'Bearer '+token},
   body:form,signal:AbortSignal.timeout(25000)});
 const j=await r.json().catch(()=>({success:false}));
 check(r.ok&&j.success===true,'CLOUDFLARE_CODE_ONLY_UPDATE_FAILED_'+r.status);
}
function bindingId(x){
 return (x.result?.bindings||[]).map(b=>[b.name,b.type,
   b.type==='kv_namespace'?b.namespace_id:null,b.type==='plain_text'?b.text:null])
   .sort((a,b)=>a[0].localeCompare(b[0]));
}
function cronId(x){
 const r=Array.isArray(x.result?.schedules)?x.result.schedules:
   Array.isArray(x.result)?x.result:[];
 return r.map(x=>x.cron).filter(Boolean).sort();
}
let stateRaw=null,restoreOk=false;
const original=await getCode();
check(original.sha256===exactOriginal,'PRODUCTION_WORKER_SHA_LEASE_MISMATCH_NO_WRITE');
check(original.selectedPart==='worker.js','CLOUDFLARE_MAIN_MODULE_MISMATCH_NO_WRITE');
const [settings,schedules]=await Promise.all([readJson('/settings'),readJson('/schedules')]);
const bindings=bindingId(settings),cron=cronId(schedules);
check(cron.length===1&&cron[0]==='*/5 * * * *','PRODUCTION_CRON_NOT_EXPECTED');
check(bindings.some(x=>x[0]==='IRYS_KV'&&x[1]==='kv_namespace'),'KV_BINDING_UNAVAILABLE');
const secret=randomBytes(32).toString('hex');
const expiry=Date.now()+2*60000;
const originalSource=original.data.toString('utf8');
const marker='  async fetch(_request,env){';
check(originalSource.split(marker).length===2,'EXACT_FETCH_INJECTION_POINT_NOT_UNIQUE');
const safeFields=[
 'aiV16Outcomes','deliveryReceiptsV12','spotOutcomesV13','futuresOutcomesV13'
];
const lines=[
 "    // Temporary owner audit. Auth secret minted inside the runner; not in repo.",
 "    if(_request.method==='GET' &&",
 "       new URL(_request.url).pathname==='/__irys_private_retrospective' &&",
 "       Date.now()<"+expiry+" &&",
 "       _request.headers.get('x-irys-private-audit')==="+JSON.stringify(secret)+"){",
 "      try{",
 "        const snapshot=await readState(env);",
 "        const result={fetched_at_ms:Date.now(),last_run:snapshot.last?.time||null,",
 "          total_api_acks:snapshot.telegramAcknowledgementsTotal||0,",
 ...safeFields.map((field,i)=>
   "          "+field+":Array.isArray(snapshot."+field+")?snapshot."+field+":[]"+(i===safeFields.length-1?"":",")),
 "        };",
 "        return new Response(JSON.stringify(result),{headers:{",
 "          'content-type':'application/json','cache-control':'no-store'}});",
 "      }catch(_e){return new Response('PRIVATE_READ_FAILED',{status:503});}",
 "    }"
];
const injected=originalSource.replace(marker,marker+'\n'+lines.join('\n'));
const modified=Buffer.from(injected,'utf8'),temporaryHash=sha(modified);
let patched=false,fetchSucceeded=false,failed=null;
try{
 check((await getCode()).sha256===exactOriginal,'SOURCE_CHANGED_BEFORE_AUDIT_NO_WRITE');
 patched=true;await putCode(modified);
 check((await getCode()).sha256===temporaryHash,'TEMP_DIAGNOSTIC_DEPLOY_NOT_VERIFIED');
 const response=await fetch(url+'/__irys_private_retrospective',{
   method:'GET',headers:{'x-irys-private-audit':secret,accept:'application/json'},
   signal:AbortSignal.timeout(15000)
 });
 check(response.ok,'PRIVATE_AUDIT_EDGE_GET_FAILED_'+response.status);
 stateRaw=await response.json();
 check(Array.isArray(stateRaw.aiV16Outcomes)&&Array.isArray(stateRaw.deliveryReceiptsV12),
   'PRIVATE_AUDIT_RESPONSE_CONTRACT_INVALID');
 fetchSucceeded=true;
}catch(err){failed=String(err?.message||err).slice(0,150)}
finally{
 if(patched){
   const current=await getCode();
   if(current.sha256===temporaryHash)await putCode(original.data);
   else if(current.sha256!==exactOriginal)
     throw Error('EXTERNAL_DEPLOYMENT_RACE_ABORT_RESTORE_NOT_ATTEMPTED');
 }
 const restored=await getCode();
 restoreOk=restored.sha256===exactOriginal;
 const [newSettings,newSchedules]=await Promise.all([readJson('/settings'),readJson('/schedules')]);
 check(restoreOk,'ROLLBACK_SOURCE_HASH_FAILED');
 check(JSON.stringify(bindings)===JSON.stringify(bindingId(newSettings)),'KV_OR_TELEGRAM_BINDINGS_CHANGED');
 check(JSON.stringify(cron)===JSON.stringify(cronId(newSchedules)),'CRON_CHANGED_DURING_AUDIT');
}
console.log('IRYS_PRIVATE_KV_READ_AND_BYTE_IDENTICAL_RESTORE',JSON.stringify({
  status:fetchSucceeded?'SUCCESS':'READ_FAILED',
  error:failed,restored_sha256:exactOriginal,restore_verified:restoreOk,
  cron_preserved:true,bindings_preserved:true,
  ai_records:stateRaw?.aiV16Outcomes.length??null,
  receipts:stateRaw?.deliveryReceiptsV12.length??null,
  market_signals_not_changed:true,
  no_orders_or_actual_telegram_sends:true
}));
if(!fetchSucceeded)process.exit(0);

// Independent official completed 1m candle verification. SOURCE HAS ALREADY BEEN RESTORED.
const alertCutoff=Date.parse('2026-10-30T01:40:00Z');
const H=[5,15,30,60],M=60000;
const alerts=(stateRaw.aiV16Outcomes||[]).filter(x=>
  x&&['bithumb','bitget'].includes(x.venue)&&['UP','DOWN'].includes(x.direction)&&
  Number.isSafeInteger(x.at_ms)&&x.at_ms>=alertCutoff&&
  /^[A-Z0-9-]+$/.test(x.symbol||'')&&Number.isSafeInteger(x.telegram_message_id));
const receiptRows=stateRaw.deliveryReceiptsV12||[];
const matched=alerts.filter(x=>receiptRows.some(z=>
  z.channel==='AI_V16_EARLY_OBSERVATION'&&z.telegram_message_id===x.telegram_message_id));
const realNow=Date.now();
const stats={bithumb:0,bitget:0,api_failed:0};
const output=[];
async function jsonWithRetry(uri){
 let last='NOT_ATTEMPTED';
 for(let k=0;k<3;k++){
  try{
   const r=await fetch(uri,{headers:{accept:'application/json'},signal:AbortSignal.timeout(18000)});
   if(!r.ok){last='HTTP_'+r.status;
     if([429,500,502,503,504].includes(r.status)&&k<2){await wait(800*(k+1));continue}
     throw Error(last);
   }
   return await r.json();
  }catch(e){last=String(e?.message||e).slice(0,80);
    if(k<2){await wait(750*(k+1));continue}
  }
 }
 throw Error(last);
}
async function officialMinutes(rec){
 let doc,map=new Map();
 if(rec.venue==='bithumb'){
   // Bithumb 'to' is KST and exclusive; anchor it AFTER the outcome window.
   const through=Math.min(realNow,rec.at_ms+66*M);
   const toKst=new Date(through+9*3600000).toISOString().slice(0,19);
   const query=new URLSearchParams({market:rec.symbol,to:toKst,count:'150'});
   doc=await jsonWithRetry('https://api.bithumb.com/v1/candles/minutes/1?'+query);
   if(!Array.isArray(doc))throw Error('BITHUMB_UNEXPECTED_RESPONSE');
   for(const r of doc){
     const t=Date.parse(String(r?.candle_date_time_utc||'')+'Z'),
     high=asNum(r?.high_price),low=asNum(r?.low_price),close=asNum(r?.trade_price);
     if(!Number.isSafeInteger(t)||t%M||high===null||low===null||close===null||
        low<=0||high<low||close<low||close>high)continue;
     map.set(t,{high,low,close});
   }
 }else{
   const start=Math.floor(rec.at_ms/M)*M-M;
   const end=Math.min(Math.floor(realNow/M)*M,Math.floor(rec.at_ms/M)*M+66*M);
   const query=new URLSearchParams({symbol:rec.symbol,productType:'USDT-FUTURES',
     granularity:'1m',startTime:String(start),endTime:String(end),limit:'200'});
   doc=await jsonWithRetry('https://api.bitget.com/api/v2/mix/market/history-candles?'+query);
   if(doc?.code!=='00000'||!Array.isArray(doc?.data))
     throw Error('BITGET_INVALID_OFFICIAL_HISTORY');
   for(const r of doc.data){
     if(!Array.isArray(r)||r.length<5)continue;
     const t=asNum(r[0]),high=asNum(r[2]),low=asNum(r[3]),close=asNum(r[4]);
     if(!Number.isSafeInteger(t)||t%M||high===null||low===null||close===null||
        low<=0||high<low||close<low||close>high)continue;
     map.set(t,{high,low,close});
   }
 }
 return map;
}
function outcome(rec,rows,h,baseline){
 const end=Math.ceil((rec.at_ms+h*M)/M)*M;
 if(realNow<end+1500)return {status:'PENDING'};
 const bar=rows.get(end-M);
 if(!bar)return {status:'NO_CLOSED_CANDLE'};
 if(baseline===null||baseline<=0)return {status:'NO_VALID_BASELINE'};
 const raw=100*(bar.close/baseline-1);
 const signed=rec.direction==='UP'?raw:-raw;
 const predicted=signed>=.15?'RIGHT':signed<=-.15?'WRONG':'FLAT';
 const first=Math.ceil(rec.at_ms/M)*M;
 const subseq=[];
 for(let t=first;t<=end-M;t+=M){
  const b=rows.get(t);
  if(!b)return {status:'MEASURED_INCOMPLETE_RANGE',
    signed_pct:+signed.toFixed(4),raw_pct:+raw.toFixed(4),judgment:predicted};
  subseq.push(b);
 }
 let mfe=null,mae=null;
 if(subseq.length){
   const high=Math.max(...subseq.map(x=>x.high));
   const low=Math.min(...subseq.map(x=>x.low));
   if(rec.direction==='UP'){
     mfe=100*(high/baseline-1);mae=100*(1-low/baseline);
   }else{mfe=100*(1-low/baseline);mae=100*(high/baseline-1)}
 }
 return {status:'MEASURED',
   signed_pct:+signed.toFixed(4),raw_pct:+raw.toFixed(4),
   judgment:predicted,
   max_favourable_pct:mfe===null?null:+Math.max(0,mfe).toFixed(4),
   max_adverse_pct:mae===null?null:+Math.max(0,mae).toFixed(4)};
}
let next=0;
async function workerJob(){
 for(;;){
  const index=next++;if(index>=alerts.length)break;
  const rec=alerts[index];stats[rec.venue]++;
  let rows=null,error=null,baseline=null;
  try{
   rows=await officialMinutes(rec);
   if(rec.venue==='bithumb'){
     baseline=asNum(rec.price);
   }else{
     const first=Math.ceil(rec.at_ms/M)*M;
     baseline=rows.get(first)?.close??null;
     // Alert's 5m snapshot is not an execution price. Use the first
     // actual one-minute close after the Telegram alert as baseline.
   }
  }catch(e){error=String(e?.message||e).slice(0,75);stats.api_failed++;}
  const computed={};
  for(const h of H)computed[h+'m']=rows?
    outcome(rec,rows,h,baseline):{status:'OFFICIAL_API_FAILED'};
  output[index]={
   id:rec.telegram_message_id,
   at_kst:new Date(rec.at_ms+9*3600000).toISOString().slice(0,16).replace('T',' '),
   venue:rec.venue,side:rec.direction,
   baseline_method:rec.venue==='bithumb'?'TICKER_AT_AI_ACK':'FIRST_COMPLETED_1M_AFTER_AI_ACK',
   results:computed,error: error?error:null,
   original_record_has_60m:!!rec.results?.['60m']
  };
 }
}
await Promise.all(Array.from({length:4},()=>workerJob()));
const perH={},perVenue={};
for(const h of H){
 const k=h+'m',rows=output.map(x=>x.results[k]);
 const scored=rows.filter(x=>x.status==='MEASURED'||x.status==='MEASURED_INCOMPLETE_RANGE');
 const vals=scored.map(x=>x.signed_pct);
 perH[k]={
   measured:scored.length,correct:scored.filter(x=>x.judgment==='RIGHT').length,
   wrong:scored.filter(x=>x.judgment==='WRONG').length,
   flat:scored.filter(x=>x.judgment==='FLAT').length,
   pending:rows.filter(x=>x.status==='PENDING').length,
   unavailable:rows.filter(x=>!['MEASURED','MEASURED_INCOMPLETE_RANGE','PENDING'].includes(x.status)).length,
   mean_signed_pct:vals.length?+(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(3):null,
   full_excursion_coverage:scored.filter(x=>x.status==='MEASURED').length
 };
}
for(const venue of ['bithumb','bitget']){
 perVenue[venue]={total:output.filter(x=>x.venue===venue).length};
 for(const h of H){
  const arr=output.filter(x=>x.venue===venue).map(x=>x.results[h+'m']);
  const measured=arr.filter(x=>x.status.startsWith('MEASURED'));
  perVenue[venue][h+'m']={measured:measured.length,
    right:measured.filter(x=>x.judgment==='RIGHT').length,
    wrong:measured.filter(x=>x.judgment==='WRONG').length,
    flat:measured.filter(x=>x.judgment==='FLAT').length};
 }
}
console.log('IRYS_RETROSPECTIVE_OFFICIAL_CANDLE_AUDIT',JSON.stringify({
  range_start_kst:'2026-10-30 10:40',audit_at_kst:new Date(realNow+9*3600000).toISOString().slice(0,19),
  ai_alert_records:alerts.length,ai_receipt_matches:matched.length,
  all_kv_receipts:receiptRows.length,
  other_spot_outcomes:stateRaw.spotOutcomesV13.length,
  other_futures_outcomes:stateRaw.futuresOutcomesV13.length,
  by_horizon:perH,by_venue:perVenue,
  per_message_id_no_symbol:output,
  official_price_sources:'Bithumb KRW public completed 1m, Bitget USDT futures public completed 1m',
  important_limits:[
    'User Telegram device receipt is unverified; only Bot API ACK and KV records are matched.',
    'AI early observation is not a trading entry price.',
    'For Bitget the first completed minute after ACK is the reference, not actual execution.',
    'MFE/MAE excludes the partly observed minute containing the alert.',
    'Missing minutes are not zero-filled and unmeasured signals are NOT counted as wins.',
    'Repeated messages for one symbol are separate observations, not independent market opportunities.'
  ]
}));
