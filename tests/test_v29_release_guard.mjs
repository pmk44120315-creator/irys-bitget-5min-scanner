import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {guardedRelease} from '../deployment/release_v29_guarded.mjs';
const original=readFileSync(process.env.V29_BASE_WORKER||'/mnt/data/v29_work/v28_release/IRYS_V28_BUILDUP_WORKER.mjs');
const candidate=readFileSync(new URL('../deployment/IRYS_V29_DIRECTION_REVIEW_WORKER.mjs',import.meta.url));
async function run(mode){let code=original,puts=0,broken=false;const saved={};
 const config=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name})),schedules:[{cron:'*/5 * * * *'}]});
 const io={source:async()=>mode==='wrong-source'&&puts===0?Buffer.from('different'):code,
 config:async()=>{const c=config();if(mode==='bad-binding'&&puts===1&&!broken){broken=true;c.bindings.pop()}return c},
 health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,marketNotificationsEnabled:mode==='still-enabled',last:{status:mode==='unhealthy'?'ERROR':'PASS',time:'fixture'}}),
 upload:async b=>{code=Buffer.from(b);puts++},save:(name,x)=>{saved[name]=x},clock:()=>1793704800000};
 let error=null;try{await guardedRelease(io,candidate)}catch(e){error=e}return {error,puts,saved,restored:code.equals(original)};
}
test('exact source release verifies central notification hold, never claims future accuracy',async()=>{const r=await run('ok');assert.equal(r.error,null);assert.equal(r.puts,1);assert.equal(r.saved['deployment.json'].market_notifications_enabled,false);assert.equal(r.saved['deployment.json'].future_accuracy_improvement_proven,false)});
test('unknown source is not overwritten',async()=>{const r=await run('wrong-source');assert(r.error);assert.equal(r.puts,0)});
test('changed config is rolled back to exact previous source',async()=>{const r=await run('bad-binding');assert(r.error);assert.equal(r.puts,2);assert(r.restored)});
test('a successful upload without disabled notification verification is NOT success',async()=>{const r=await run('still-enabled');assert(r.error);assert.equal(r.puts,2);assert(r.restored)});
