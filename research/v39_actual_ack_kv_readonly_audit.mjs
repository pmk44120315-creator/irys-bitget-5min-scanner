/** Read-only Cloudflare KV audit of V35.1 actual ACK evidence.
 * Uses already-configured GitHub secret ONLY inside Actions; never logs
 * account ID, namespace ID, token, chat ID, message body or full KV state.
 * Official GET requests only; no writes, deploys, trade or Telegram calls.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function summarizeLiveRows(rows,now){
 if(!Array.isArray(rows)||!Number.isSafeInteger(now))throw new TypeError('INVALID_INPUT');
 const out={actual_ack_records:0,groups:{},latest_signals:[],metadata_only:true,never_trade_execution:true,
  costs_are_scenario_only:true,unverified_fields_skipped:0};
 const safe=[];
 for(const a of rows){
  if(!a||!['bithumb','bitget'].includes(a.venue)||
  !(a.venue==='bithumb'?a.direction==='BUY':['LONG','SHORT'].includes(a.direction))||
  typeof a.symbol!=='string'||!Number.isSafeInteger(a.issued_at_ms)||
  a.issued_at_ms>now||!finite(a.entry_quote?.bid)||!finite(a.entry_quote?.ask)||
  a.entry_quote.bid<=0||a.entry_quote.ask<a.entry_quote.bid){out.unverified_fields_skipped++;continue;}
  const entry=a.direction==='SHORT'?a.entry_quote.bid:a.entry_quote.ask;
  safe.push({venue:a.venue,symbol:a.symbol,direction:a.direction,issued_at_ms:a.issued_at_ms,entry_reference:entry,
    minute_outcomes:a.minute_outcomes||{}});
 }
 out.actual_ack_records=safe.length;
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){
  const rs=safe.filter(e=>e.venue===venue&&e.direction===direction);
  const group={events:rs.length,horizons:{}};
  for(const h of [5,15,30,60]){
   let measured=0,positive=0,netPositive=0,missing=0,pending=0,grossSum=0,extremeAdverse=0;
   for(const e of rs){
    const t=e.issued_at_ms+h*60000,lab=e.minute_outcomes?.[String(h)];
    if(now<t){pending++;continue;}
    if(lab?.status!=='MEASURED_MINUTE_CLOSE_PROXY'||lab?.target_ms!==t||
    lab.actual_execution_verified!==false||!finite(lab.gross_reference_pct)||!finite(lab.net_cost_scenario_pct)){
      missing++;continue;
    }
    measured++;grossSum+=lab.gross_reference_pct;
    if(lab.gross_reference_pct>0)positive++;
    if(lab.net_cost_scenario_pct>0)netPositive++;
    extremeAdverse=Math.min(extremeAdverse,lab.gross_reference_pct);
   }
   group.horizons[h]={measured,positive,rate:measured?positive/measured:null,
    net_scenario_positive:netPositive,missing,pending,mean_gross_pct:measured?grossSum/measured:null,
    worst_signed_pct:measured?extremeAdverse:null};
  }
  out.groups[venue+':'+direction]=group;
 }
 safe.sort((a,b)=>b.issued_at_ms-a.issued_at_ms);
 out.latest_signals=safe.slice(0,12).map(({venue,symbol,direction,issued_at_ms,minute_outcomes})=>({
  venue,symbol,direction,issued_at_ms,
  horizons:Object.fromEntries([5,15,30,60].map(h=>{
   const x=minute_outcomes?.[String(h)],valid=x?.status==='MEASURED_MINUTE_CLOSE_PROXY'&&x.actual_execution_verified===false;
   return [String(h),{status:valid?'MEASURED_PUBLIC_MINUTE_CLOSE_PROXY':x?.status||'UNKNOWN',
    signed_price_pct:valid&&finite(x.gross_reference_pct)?x.gross_reference_pct:null,
    quote_to_close_cost_scenario_pct:valid&&finite(x.net_cost_scenario_pct)?x.net_cost_scenario_pct:null}];
  }))
 }));
 return out;
}
async function main(){
 const account=process.env.IRYS_CF_ACCOUNT,token=process.env.IRYS_CF_TOKEN;
 const out={version:'V39_ACTUAL_ACK_KV_READONLY_AUDIT_V1',checked_at_utc:new Date().toISOString(),
  status:'NOT_CHECKED',token_present:!!token,account_present:!!account,
  no_write_requests:true,no_private_credentials_exported:true,
  no_raw_kv_state_exported:true,source:'CLOUDFLARE_OWNER_CONFIGURED_KV'};
 function save(){mkdirSync('v39_direction_audit',{recursive:true});writeFileSync('v39_direction_audit/actual_ack_kv_summary.json',JSON.stringify(out,null,2));
   console.log('V39_ACTUAL_ACK_KV_AUDIT',JSON.stringify(out));}
 if(!account||!token){out.status='CLOUDFLARE_CREDENTIALS_MISSING';save();return;}
 const base='https://api.cloudflare.com/client/v4/accounts/'+account;
 const headers={Authorization:'Bearer '+token,Accept:'application/json'};
 try{
  const settings=await fetch(base+'/workers/scripts/irys-surge-monitor/settings',{method:'GET',headers,signal:AbortSignal.timeout(20000)});
  if(!settings.ok){out.status='SCRIPT_SETTINGS_HTTP_'+settings.status;save();return;}
  const doc=await settings.json(),bindings=doc?.result?.bindings;
  const item=Array.isArray(bindings)?bindings.find(b=>b?.name==='IRYS_KV'):null;
  const namespace=item?.namespace_id||item?.id;
  if(typeof namespace!=='string'||!/^[0-9a-f]{32}$/.test(namespace)){out.status='IRYS_KV_BINDING_ID_NOT_FOUND';save();return;}
  const url=base+'/storage/kv/namespaces/'+namespace+'/values/'+encodeURIComponent('irys:fast:state:v1');
  const response=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(20000)});
  if(!response.ok){out.status=response.status===401||response.status===403?'KV_READ_NOT_AUTHORIZED':'KV_READ_HTTP_'+response.status;save();return;}
  const state=await response.json();const rows=state?.v30ActualForecasts;
  if(!Array.isArray(rows)){out.status='V30_ACTUAL_FORECAST_RECORDS_NOT_FOUND';save();return;}
  out.status='ACTUAL_ACK_RECORDS_READ';
  out.runtime_state_record_count=rows.length;out.safe_summary=summarizeLiveRows(rows,Date.now());
  out.technical_caveat='This read-only audit contains only preexisting ACKs and their recorded minute-close proxies; not fill evidence or independent trades.';
 }catch(e){out.status='KV_READ_EXCEPTION';out.error_type=e?.name||'Error';}
 save();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V39_KV_READONLY_AUDIT_ERROR',e?.name||'Error');process.exitCode=1;});
export {summarizeLiveRows};
