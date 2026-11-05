import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
import {packet,NOW} from './fixtures/v34_risk.mjs';
const path=new URL('../deployment/IRYS_V34_CRASH_WARNING_WORKER.mjs',import.meta.url);
async function mod(){assert(existsSync(path),'V34 Worker not built');return import(path)}
test('compiled Worker uses actual Telegram adapter only with independently verified risk permit',async()=>{const m=await mod(),store=new Map(),s={},env={GITHUB_DISPATCH_TOKEN:'TEST_SOURCE',TELEGRAM_BOT_TOKEN:'TEST_BOT',TELEGRAM_CHAT_ID:'123456789',IRYS_KV:{get:async k=>store.get(k)||null,put:async(k,v)=>store.set(k,v)}};
 const p=packet();p.model_digest=m.V34_RISK_DIGEST;let posts=0;const oldFetch=globalThis.fetch,oldNow=Date.now;Date.now=()=>NOW;
 globalThis.fetch=async (url,opt)=>{assert(String(url).startsWith('https://api.telegram.org/botTEST_BOT/sendMessage'));posts++;assert.match(JSON.parse(opt.body).text,/위험경보/);return new Response(JSON.stringify({ok:true,result:{message_id:800,chat:{id:123456789},date:NOW/1000}}),{headers:{'content-type':'application/json'}})};
 try{const r=await m.v34WorkerReview(env,s,NOW,{clock:()=>NOW,maxWaitMs:0,read:async()=>p});assert.equal(r.sent,1,JSON.stringify(r));assert.equal(posts,1);assert.equal(s.deliveryReceiptsV12.at(-1).channel,'V34_MARKET_DROP_RISK');assert.equal(s.deliveryReceiptsV12.at(-1).market_snapshot.forecast_direction,null);assert.equal(s.v30ActualForecasts,undefined);assert.equal(s.deliveryReceiptsV12.at(-1).kv_receipt_persisted,true)}finally{globalThis.fetch=oldFetch;Date.now=oldNow;}});
test('legacy and invented risk permissions cannot force messages',async()=>{const m=await mod();await assert.rejects(m.telegram({},'fake',{risk:true}),/PERMIT_REQUIRED/)});
test('entry proof, caps, original Cron and read-only fetch remain intact',async()=>{const m=await mod();const src=readFileSync(path,'utf8'),old=readFileSync(process.env.V34_BASE_WORKER||'/mnt/data/irys_v34/evidence/v31_original_worker.mjs','utf8');
 for(const [a,b] of [['function v30Qualify(','function v30FuturesCandidates('],['function v29CheckPair(','function v29DeliveryPolicy(']])assert.equal(src.slice(src.indexOf(a),src.indexOf(b)),old.slice(old.indexOf(a),old.indexOf(b)));
 assert(src.includes('const V30_SEND_CAP=2,V30_SYMBOL_COOLDOWN_MS=90*60000;'));
 assert.equal(src.split('  async scheduled(_controller,env){')[1].split('\nexport {V34_RISK_DIGEST')[0],old.split('  async scheduled(_controller,env){')[1]);
 const h=await(await m.default.fetch(new Request('https://test/'),{IRYS_KV:{get:async()=>null}})).json();assert.equal(h.marketRiskWarningsEnabled,true);assert.equal(h.marketNotificationsEnabled,true);
});
