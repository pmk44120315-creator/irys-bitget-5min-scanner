/* V17 Cloudflare GET-only source, binding, schedule and public health preflight. */
import {extractWorkerSource} from './parse-cloudflare-script.mjs';
const account=process.env.IRYS_REALTIME_CF_ACCOUNT_ID||'';
const token=process.env.IRYS_V7_CF_API_TOKEN||'';
if(!/^[a-f0-9]{32}$/.test(account)||token.length<20)throw Error('CLOUDFLARE_READ_CREDS_MISSING');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const publicUrl='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const headers={authorization:'Bearer '+token,accept:'application/json'};
async function get(url,h){const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('CF_READ_HTTP_'+r.status);return r;}
const [src,settings,cron,health]=await Promise.all([
 get(root,headers),get(root+'/settings',headers),get(root+'/schedules',headers),
 get(publicUrl,{accept:'application/json'})]);
const x=await extractWorkerSource(src);
const conf=await settings.json(),sc=await cron.json(),pub=await health.json();
const binding=(conf.result?.bindings||[]).map(x=>x.name+':'+x.type).sort();
const schedules=(Array.isArray(sc.result?.schedules)?sc.result.schedules:sc.result||[]).map(x=>x.cron);
const result={worker:'irys-surge-monitor',sha256:x.sha256,selectedPart:x.selectedPart,
 codeVersion:pub.last?.codeVersion||null,lastTick:pub.last?.time||null,
 latestHealth:pub.last?.status||null,latestAiStatus:pub.last?.aiJudgment?.status||null,
 bindings:binding,cron:schedules,telegramConfigured:pub.telegramSecretConfigured,
 aiConfigured:pub.workersAIConfigured,kvConfigured:pub.kvConfigured};
console.log('IRYS_V17_READONLY_PRECHECK',JSON.stringify(result));
const sha='8668138db2c213c7b675e1a10f6b8bb9c5824b757a1648a9feeae073094c9f73';
if(x.sha256!==sha)throw Error('UNEXPECTED_LIVE_SOURCE_SHA_NO_DEPLOY');
if(x.selectedPart!=='worker.js')throw Error('UNEXPECTED_LIVE_WORKER_MODULE');
if(pub.last?.codeVersion!=='IRYS-V16-AI-FIRST-OBSERVATIONAL-ALERT-20261030')throw Error('LIVE_VERSION_MISMATCH_NO_DEPLOY');
if(schedules.length!==1||schedules[0]!=='*/5 * * * *')throw Error('LIVE_CRON_MISMATCH');
for(const required of ['AI:ai','IRYS_KV:kv_namespace','GITHUB_DISPATCH_TOKEN:secret_text','TELEGRAM_BOT_TOKEN:secret_text']){
 if(!binding.includes(required))throw Error('MISSING_REQUIRED_BINDING_'+required.split(':')[0]);}
console.log('IRYS_V17_READONLY_PREFLIGHT_PASS_NO_MUTATION');
