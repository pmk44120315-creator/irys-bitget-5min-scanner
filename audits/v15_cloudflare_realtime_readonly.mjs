/** Read-only inventory of previously described irys-realtime-evidence Worker.
 * No mutations, no credential output, no touching other services.
 */
import {extractWorkerSource} from '../deployment/parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)
  throw Error('CLOUDFLARE_SCOPED_CREDENTIAL_UNAVAILABLE');
const script='irys-realtime-evidence';
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+script;
const headers={'Authorization':'Bearer '+token,'Accept':'application/json'};
async function read(u){
 const r=await fetch(u,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)return {status:'UNAVAILABLE_OR_DENIED',http_status:r.status};
 return {status:'ACCESSIBLE',response:r};
}
const [srcRes,settingsRes,schedulesRes]=await Promise.all([read(root),read(root+'/settings'),read(root+'/schedules')]);
const report={worker:script,script_access:srcRes.status,script_http_status:srcRes.http_status||200,
 settings_access:settingsRes.status,settings_http_status:settingsRes.http_status||200,
 cron_access:schedulesRes.status,cron_http_status:schedulesRes.http_status||200,
 code_sha256:null,has_external_ws:null,has_trade_data_path:null,
 has_orderbook_path:null,has_opinion_ai_path:null,binding_names:[],cron:[]};
if(srcRes.status==='ACCESSIBLE'){
 const parsed=await extractWorkerSource(srcRes.response);
 const code=parsed.data.toString('utf8');
 report.code_sha256=parsed.sha256;
 report.has_external_ws=/WebSocket|wss:\/\//i.test(code);
 report.has_trade_data_path=/trades\/ticks|fills-history|market\/fills/i.test(code);
 report.has_orderbook_path=/orderbook|merge-depth|depth/i.test(code);
 report.has_opinion_ai_path=/\.AI\.run|@cf\/meta\//i.test(code);
}
if(settingsRes.status==='ACCESSIBLE'){
 const settings=await settingsRes.response.json();
 report.binding_names=(settings.result?.bindings||[]).map(x=>({name:x.name,type:x.type}));
}
if(schedulesRes.status==='ACCESSIBLE'){
 const schedules=await schedulesRes.response.json();
 report.cron=(schedules.result?.schedules||schedules.result||[]).map?.(x=>x.cron)||[];
}
console.log('IRYS_REALTIME_EVIDENCE_READONLY_INVENTORY',JSON.stringify(report));
