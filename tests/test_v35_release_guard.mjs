import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../deployment/release_v35_guarded.mjs',import.meta.url);
const old=()=>readFileSync(new URL('../deployment/IRYS_V34_CRASH_WARNING_WORKER.mjs',import.meta.url));
const candidate=()=>readFileSync(new URL('../deployment/IRYS_V35_LIFECYCLE_WORKER.mjs',import.meta.url));
async function execute(mode){assert(existsSync(url),'V35 verified source guard missing');const m=await import(url);let current=old(),puts=0,broken=false;const saved={};
 const settings=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'MOCK'})),schedules:[{cron:'*/5 * * * *'}]});
 const io={source:async()=>mode==='lease'&&!puts?Buffer.from('changed'):current,config:async()=>{const c=settings();if(mode==='config'&&puts===1&&!broken){broken=true;c.bindings.pop()}return c},
 health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,marketNotificationsEnabled:true,marketRiskWarningsEnabled:true,last:{status:mode==='unhealthy'?'ERROR':'PASS'}}),
 feed:async()=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',model_digest:mode==='old-model'?'OLD':m.MODEL,at_ms:1000000,orders_sent:false,telegram_sent:false,timing:{history_reads_in_live_path:false},followups:[],summary:{listed_spot:488,listed_futures:475,selected:12,evaluated:12,unreviewed:0}}),
 upload:async b=>{current=Buffer.from(b);puts++},save:(k,v)=>saved[k]=v,clock:()=>1001000};
 let result,error;try{result=await m.release(io,candidate())}catch(e){error=e}return {result,error,puts,restored:current.equals(old()),saved};}
test('V35 ordinary code-only deployment never claims live edit or forecasting success',async()=>{const x=await execute('ok');assert.equal(x.error,undefined);assert.equal(x.puts,1);assert.equal(x.result.natural_tick_verified,false);assert.equal(x.result.forecast_accuracy_proven,false);assert.equal(x.result.live_message_edit_verified,false)});
test('V35 source lease or unhealthy prior run prevents any write',async()=>{for(const mode of ['lease','unhealthy']){const x=await execute(mode);assert(x.error);assert.equal(x.puts,0);assert(x.restored)}});
test('V35 requires current reviewed producer model before writing code',async()=>{const x=await execute('old-model');assert(x.error);assert.equal(x.puts,0)});
test('V35 postupload binding drift restores exact prior V34 and reports failure',async()=>{const x=await execute('config');assert(x.error);assert.equal(x.puts,2);assert(x.restored);assert(x.saved['rollback.json'].restored)});
