/** Post-release passive health: no Worker writes, no Telegram, no scheduled tick. **/
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('SCOPED_CLOUDFLARE_READ_TOKEN_MISSING');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const url='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const auth={authorization:'Bearer '+token,accept:'application/json'};
const sha='b2a98c8c988157866e28ea8d8c8418454c443c1c0ffd32ff6a1ee6b8c0012423';
const version='IRYS-V17-CAUSAL-DIRECTION-VS-WATCH-20261030';
const releasedAt=Date.parse('2026-10-30T06:02:24Z');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function get(u,h){const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('CF_HEALTH_HTTP_'+r.status);return r;}
const [script,settings,schedule]=await Promise.all([
 get(root,auth),get(root+'/settings',auth),get(root+'/schedules',auth)]);
const actual=await extractWorkerSource(script);
const cfg=await settings.json(),sc=await schedule.json();
if(actual.sha256!==sha||actual.selectedPart!=='worker.js')throw Error('LIVE_WORKER_NOT_V17_EXPECTED_SHA');
const bindings=cfg.result?.bindings||[];
for(const [name,type] of [['AI','ai'],['IRYS_KV','kv_namespace'],
 ['TELEGRAM_BOT_TOKEN','secret_text'],['TELEGRAM_CHAT_ID','plain_text'],
 ['GITHUB_DISPATCH_TOKEN','secret_text']]){
 if(!bindings.some(x=>x.name===name&&x.type===type))throw Error('MISSING_BINDING_'+name);
}
const cron=(Array.isArray(sc.result?.schedules)?sc.result.schedules:sc.result||[]).map(x=>x.cron);
if(cron.length!==1||cron[0]!=='*/5 * * * *')throw Error('CRON_CHANGED');
let lastHealth=null,verified=false,attempts=0;
const deadline=Date.now()+8*60000;
do {
 attempts++;
 const pub=await (await get(url,{accept:'application/json'})).json();
 lastHealth=pub.last||{};
 const latestMs=Date.parse(String(lastHealth.time||'').replace(' KST','+09:00').replace(' ','T'));
 if(lastHealth.codeVersion===version&&Number.isFinite(latestMs)&&latestMs>releasedAt){
  verified=true;
  break;
 }
 await sleep(20000);
}while(Date.now()<deadline);
console.log('IRYS_V17_POST_RELEASE_LIVE_OBSERVATION',JSON.stringify({
 worker_source_sha256:actual.sha256,worker_source_verified:true,
 cron_preserved:true,bindings_preserved:true,
 last_version:lastHealth?.codeVersion||null,last_tick_kst:lastHealth?.time||null,
 last_status:lastHealth?.status||null,last_ai_status:lastHealth?.aiJudgment?.status||null,
 last_ai_watches:lastHealth?.aiJudgment?.watch_sent??null,
 last_ai_directional:lastHealth?.aiJudgment?.directional_sent??null,
 future_market_snapshot:lastHealth?.githubBitgetFinishedUtc||null,
 last_telegram_ack_this_tick:lastHealth?.telegramApiAckedThisRun??null,
 natural_cron_tick_verified:verified,checks:attempts,
 profitability_verified:false,post_alert_directional_accuracy_verified:false
}));
if(!verified)throw Error('NATURAL_POST_RELEASE_CRON_RUN_NOT_VERIFIED');
if(lastHealth.status!=='PASS')throw Error('V17_POST_RELEASE_CRON_MARKET_NOT_PASS');
console.log('IRYS_V17_PRODUCTION_NATURAL_CRON_PASS');
