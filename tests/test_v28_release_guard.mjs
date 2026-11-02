import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
const url=new URL('../deployment/release_v28_guarded.mjs',import.meta.url);
const old=()=>readFileSync(process.env.V28_RELEASE_BASE_WORKER||process.env.V28_BASE_WORKER||'/mnt/data/v28_first_natural/IRYS_V28_BUILDUP_WORKER.mjs');
const candidate=()=>readFileSync(new URL('../deployment/IRYS_V28_BUILDUP_WORKER.mjs',import.meta.url));
const config=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'mock'})),schedules:[{cron:'*/5 * * * *'}]});
async function execute(mode){assert(existsSync(url),'V28 guarded release missing');const {guardedRelease}=await import(url);
 let current=old(),uploads=0,broken=false;
 const io={source:async()=>mode==='lease'&&!uploads?Buffer.from('unexpected changed source'):current,
 config:async()=>{const c=config();if(mode==='binding'&&uploads===1&&!broken){broken=true;c.bindings.pop();}return c},
 health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,last:{status:mode==='unhealthy'?'ERROR':'PASS',time:'mock prior tick'}}),
 upload:async bytes=>{current=Buffer.from(bytes);uploads++},save:()=>{},clock:()=>1793630000000};
 let result=null,error=null;try{result=await guardedRelease(io,candidate())}catch(e){error=e}
 return {uploads,result,error,restored:current.equals(old())};
}
test('V28 exact-source release succeeds once and makes no natural-success or prediction claims',async()=>{const x=await execute('success');assert.equal(x.error,null);assert.equal(x.uploads,1);assert.equal(x.result.natural_tick_verified,false);assert.equal(x.result.future_accuracy_improvement_proven,false);});
test('V28 unexpected live source is never overwritten',async()=>{const x=await execute('lease');assert(x.error);assert.equal(x.uploads,0);assert(x.restored)});
test('V28 post-upload binding mismatch restores exact original source and fails visibly',async()=>{const x=await execute('binding');assert(x.error);assert.equal(x.uploads,2);assert(x.restored)});
test('V28 unhealthy previous runtime is not blindly overwritten',async()=>{const x=await execute('unhealthy');assert(x.error);assert.equal(x.uploads,0);assert(x.restored)});
