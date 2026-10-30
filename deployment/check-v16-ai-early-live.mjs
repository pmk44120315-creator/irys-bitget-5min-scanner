/** Cloudflare production GET-only V16 early AI + Telegram evidence; no sends or changes. */
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CF_CREDENTIAL_MISSING');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const headers={Authorization:'Bearer '+token,Accept:'application/json'};
const fetchGet=async(url,h)=>{
 const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('CLOUDFLARE_READ_ONLY_HTTP_'+r.status);
 return r;
};
const [sourceResp,settingsResp,cronResp,publicResp]=await Promise.all([
 fetchGet(root,headers),fetchGet(root+'/settings',headers),
 fetchGet(root+'/schedules',headers),
 fetchGet('https://irys-surge-monitor.vhehwpfl.workers.dev/',{Accept:'application/json'})
]);
const actual=await extractWorkerSource(sourceResp);
const settings=await settingsResp.json(),schedules=await cronResp.json(),pub=await publicResp.json();
const bindings=(settings.result?.bindings||[]).map(b=>({name:b.name,type:b.type}));
const required=[['IRYS_KV','kv_namespace'],['AI','ai'],['GITHUB_DISPATCH_TOKEN','secret_text'],
 ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text']];
const missing=required.filter(([name,type])=>!bindings.some(b=>b.name===name&&b.type===type)).map(v=>v[0]);
const cron=(schedules.result?.schedules||schedules.result||[]).map?.(x=>x.cron)||[];
const last=pub.last||{},ai=last.aiJudgment||{},at=last.time||null;
const launchedAt=Date.parse('2026-10-30T01:42:47Z');
const lastAt=Date.parse(String(at||'').replace(' KST','+09:00').replace(' ','T'));
const expected='8668138db2c213c7b675e1a10f6b8bb9c5824b757a1648a9feeae073094c9f73';
const afterDeploy=Number.isFinite(lastAt)&&lastAt>launchedAt;
const report={
 worker:'irys-surge-monitor',actual_sha256:actual.sha256,expected_sha_match:actual.sha256===expected,
 settings_missing:missing,cron,
 last_kst:at,last_run_after_deploy:afterDeploy,
 runtime:last.codeVersion||null,
 market_scan_status:last.status||null,
 github_dispatch:last.githubDispatchStatus||null,
 last_data_snapshot_utc:last.githubBitgetFinishedUtc||null,
 ai_transport_enabled:last.aiDirectTransportEnabled??null,
 ai_status:ai.status||null,ai_model:ai.model||null,
 ai_spot_preselected:ai.spot_preselected??null,ai_spot_checked:ai.spot_evaluated??null,
 ai_futures_preselected:ai.futures_preselected??null,ai_futures_checked:ai.futures_evaluated??null,
 ai_model_decisions:ai.model_decisions??null,
 ai_real_execution_supported:ai.real_execution_supported??null,
 ai_unconfirmed:ai.model_only_unconfirmed??null,
 ai_contrary_observed:ai.contrary_taker_observations??null,
 ai_alerts_sent:ai.alerts_sent??null,ai_error:ai.error||null,ai_spot_error:ai.spot_error||null,
 telegram_this_run_api_ack:last.telegramApiAckedThisRun??null,
 latest_market_receipt:last.telegramLastApiReceipt||null,
 ai_outcome_audit:last.aiOutcomeAudit||null,
 verified_device_receipt:false
};
console.log('IRYS_V16_EARLY_LIVE_OPERATION_EVIDENCE',JSON.stringify(report));
if(actual.sha256!==expected||missing.length||cron.length!==1||cron[0]!=='*/5 * * * *'){
 throw Error('V16_EARLY_LIVE_SOURCE_OR_BINDING_MISMATCH');
}
if(!afterDeploy)console.log('IRYS_V16_EARLY_FIRST_SCHEDULED_RUN_PENDING');
else if(report.runtime!=='IRYS-V16-AI-FIRST-OBSERVATIONAL-ALERT-20261030')
 throw Error('V16_EARLY_LIVE_VERSION_MISMATCH');
else console.log('IRYS_V16_AI_FIRST_POSTDEPLOY_CRON_VERIFIED',JSON.stringify({
 time:at,ai_status:ai.status,ai_alerts_sent:ai.alerts_sent??0,
 telegram_this_run_api_ack:report.telegram_this_run_api_ack,
 source_snapshot_utc:report.last_data_snapshot_utc
}));
