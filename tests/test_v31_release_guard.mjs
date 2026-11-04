import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../deployment/release_v31_guarded.mjs',import.meta.url);
const old=()=>readFileSync(new URL('../deployment/IRYS_V30_SELECTIVE_DIRECTION_WORKER.mjs',import.meta.url));
const candidate=()=>readFileSync(new URL('../deployment/IRYS_V31_TIMELY_WORKER.mjs',import.meta.url));
async function execute(mode){assert(existsSync(url),'V31 exact-source release guard absent');const m=await import(url);let current=old(),puts=0,broken=false;const saved={};
 const settings=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'MOCK'})),schedules:[{cron:'*/5 * * * *'}]});
 const io={source:async()=>mode==='lease'&&puts===0?Buffer.from('different'):current,config:async()=>{const c=settings();if(mode==='config'&&puts===1&&!broken){broken=true;c.bindings.pop();}return c},
 health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,marketNotificationsEnabled:true,last:{status:mode==='unhealthy'?'ERROR':'PASS',codeVersion:'old'}}),
 feed:async()=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:mode==='old-model'?'OLD':m.MODEL,at_ms:1000000,started_at_ms:990000,items:[],orders_sent:false,telegram_sent:false,timing:{barrier_removed:true},outcome_candles:[],summary:{listed_spot:487,listed_futures:465,selected:12,evaluated:12,unreviewed:0}}),
 upload:async b=>{current=Buffer.from(b);puts++},save:(k,v)=>saved[k]=v,clock:()=>1001000};
 let result,error;try{result=await m.release(io,candidate())}catch(e){error=e}return {result,error,puts,restored:current.equals(old()),saved};}
test('V31 verified code-only update is not an assertion of natural execution or future accuracy',async()=>{const x=await execute('ok');assert.equal(x.error,undefined);assert.equal(x.puts,1);assert.equal(x.result.natural_tick_verified,false);assert.equal(x.result.future_accuracy_proven,false)});
test('V31 changed production or unhealthy runtime causes no overwrite',async()=>{for(const mode of ['lease','unhealthy']){const x=await execute(mode);assert(x.error);assert.equal(x.puts,0);assert(x.restored)}});
test('V31 cannot deploy with unreviewed or previous producer model',async()=>{const x=await execute('old-model');assert(x.error);assert.equal(x.puts,0)});
test('V31 restores exact V30 source on configuration discrepancy after upload',async()=>{const x=await execute('config');assert(x.error);assert.equal(x.puts,2);assert(x.restored);assert(x.saved['rollback.json'].restored)});
