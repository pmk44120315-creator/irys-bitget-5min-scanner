import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const moduleURL=new URL('../deployment/release_v34_guarded.mjs',import.meta.url);
const prior=()=>readFileSync(process.env.V34_BASE_WORKER||'/mnt/data/irys_v34/evidence/v31_original_worker.mjs');
const compiled=()=>readFileSync(new URL('../deployment/IRYS_V34_CRASH_WARNING_WORKER.mjs',import.meta.url));
async function run(mode){assert(existsSync(moduleURL),'V34 source-leased release missing');const m=await import(moduleURL);let active=prior(),writes=0,broken=false;const saved={};
const settings=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'MOCK'})),schedules:[{cron:'*/5 * * * *'}]});
const io={source:async()=>mode==='lease'&&!writes?Buffer.from('other deploy'):active,
config:async()=>{const c=settings();if(mode==='config'&&writes===1&&!broken){broken=true;c.bindings.pop()}return c},
health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,last:{status:mode==='unhealthy'?'ERROR':'PASS'}}),
feed:async()=>({version:'IRYS_V34_CROSS_VENUE_DROP_V1',model_digest:mode==='old-model'?'OLD':m.MODEL,at_ms:1000000,orders_sent:false,telegram_sent:false,items:Array(6).fill({}),summary:{status:'VERIFIED_QUIET',missing_assets:[]},provider_errors:[]}),
upload:async bytes=>{active=Buffer.from(bytes);writes++},clock:()=>1005000,save:(n,v)=>saved[n]=v};
let result,error;try{result=await m.release(io,compiled())}catch(e){error=e}return {result,error,writes,restored:active.equals(prior()),saved};}
test('exact code and source release proves no future accuracy or actual natural risk message',async()=>{const r=await run('ok');assert.equal(r.error,undefined);assert.equal(r.writes,1);assert.equal(r.result.natural_tick_verified,false);assert.equal(r.result.forecast_accuracy_proven,false)});
test('unknown source or unhealthy existing runtime never overwritten',async()=>{for(const mode of ['lease','unhealthy']){const r=await run(mode);assert(r.error);assert.equal(r.writes,0);assert(r.restored)}});
test('wrong risk producer digest blocks deployment without writes',async()=>{const r=await run('old-model');assert(r.error);assert.equal(r.writes,0)});
test('postdeploy configuration discrepancy triggers exact original source restore',async()=>{const r=await run('config');assert(r.error);assert.equal(r.writes,2);assert(r.restored);assert(r.saved['rollback.json'].restored)});
