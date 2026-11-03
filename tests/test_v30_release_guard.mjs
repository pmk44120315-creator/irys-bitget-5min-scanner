import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../deployment/release_v30_guarded.mjs',import.meta.url);
const old=()=>readFileSync(process.env.V30_BASE_WORKER||'/mnt/data/irys_v30/prior_evidence/IRYS_V29_DIRECTION_REVIEW_WORKER.mjs');
const candidate=()=>readFileSync(new URL('../deployment/IRYS_V30_SELECTIVE_DIRECTION_WORKER.mjs',import.meta.url));
async function execute(mode){assert(existsSync(url),'V30 guarded release missing');const m=await import(url);let current=old(),puts=0,broken=false;const saved={};
 const settings=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'MOCK'})),schedules:[{cron:'*/5 * * * *'}]});
 const io={source:async()=>mode==='lease'&&puts===0?Buffer.from('different'):current,config:async()=>{const c=settings();if(mode==='config'&&puts===1&&!broken){broken=true;c.bindings.pop();}return c},
 health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,marketNotificationsEnabled:puts>0,last:{status:mode==='unhealthy'?'ERROR':'PASS',codeVersion:'old'}}),
 feed:async()=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',model_digest:m.MODEL,at_ms:1000000,started_at_ms:990000,items:[],orders_sent:false,telegram_sent:false,summary:{listed_spot:487,listed_futures:465,selected:12,evaluated:12,unreviewed:0,...(mode==='missing-feed'?{listed_futures:0}:{})}}),
 upload:async b=>{current=Buffer.from(b);puts++},save:(k,v)=>saved[k]=v,clock:()=>1001000};
 let result,error;try{result=await m.release(io,candidate())}catch(e){error=e}return {result,error,puts,restored:current.equals(old()),saved};}
test('guarded V30 exact source capability deploy is not a forecast-success assertion',async()=>{const x=await execute('ok');assert.equal(x.error,undefined);assert.equal(x.puts,1);assert.equal(x.result.natural_tick_verified,false);assert.equal(x.result.future_accuracy_proven,false)});
test('changed live source and unhealthy prior tick cause no writes',async()=>{for(const mode of ['lease','unhealthy']){const x=await execute(mode);assert(x.error);assert.equal(x.puts,0);assert(x.restored)}});
test('missing actual provider must not be hidden by successful code tests',async()=>{const x=await execute('missing-feed');assert(x.error);assert.equal(x.puts,0)});
test('postupload config discrepancy restores exact V29 and reports failure',async()=>{const x=await execute('config');assert(x.error);assert.equal(x.puts,2);assert(x.restored);assert(x.saved['rollback.json'].restored)});
