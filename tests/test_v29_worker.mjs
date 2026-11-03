import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../deployment/IRYS_V29_DIRECTION_REVIEW_WORKER.mjs',import.meta.url);
async function worker(){assert(existsSync(url),'V29 compiled Worker missing');return import(url)}
const T=1793704800000;
function fixtures(){const markets=Array.from({length:105},(_,i)=>({market:'KRW-C'+i,market_warning:'NONE'}));const iso=new Date(T-1000).toISOString();const ticks=markets.map((m,i)=>({market:m.market,trade_price:i<3?100.4:100,acc_trade_price:1010000,trade_date:iso.slice(0,10).replaceAll('-',''),trade_time:iso.slice(11,19).replaceAll(':',''),signed_change_rate:0}));return {markets,ticks}}
test('transport boundary refuses every old message route before touching Telegram',async()=>{const w=await worker();let calls=0;globalThis.fetch=async()=>{calls++;throw Error('NETWORK_MUST_NOT_HAPPEN')};await assert.rejects(w.telegram({TELEGRAM_BOT_TOKEN:'MOCK_ONLY',TELEGRAM_CHAT_ID:'123456'},'unverified LONG'),/V29_NO_UNVALIDATED_MARKET_ALERTS/);assert.equal(calls,0)});
test('all-market discovery continues but custom/default bulk sender cannot run',async()=>{const w=await worker(),f=fixtures();let sends=0;const state={v23ScoutTape:{spot_at_ms:T-300000,spot:Object.fromEntries(f.markets.map(x=>[x.market,[100,1000000,0,0]]))}};
 const read=async u=>u.includes('/v1/market/all')?f.markets:u.includes('virtual_asset_warning')?[]:u.includes('/v1/ticker')?f.ticks:Promise.reject(Error('HTTP_403'));
 const r=await w.v23ScoutTick({},state,T,{read,clock:()=>T,maxWaitMs:0,send:async()=>{sends++;return {message_id:99}}});
 assert.equal(sends,0);assert.equal(r.sent,0);assert.equal(r.status,'V29_DISCOVERY_INTERNAL_ONLY');assert.equal(state.v29DiscoveryInput.items.length>0,true);assert.equal(Object.keys(state.v28Ledger.assets).length,105);assert.equal(state.deliveryReceiptsV12,undefined);
});
test('public health clearly reports policy-disabled notifications, not a claimed transport failure',async()=>{const w=await worker();const r=await w.default.fetch(new Request('https://example.test/'),{IRYS_KV:{get:async()=>null}});const j=await r.json();assert.equal(j.marketNotificationsEnabled,false);assert.equal(j.directionalQualityStatus,'FORWARD_QUALITY_UNPROVEN');});
test('independent discovery and legacy direction-proof code are not erased by delivery hold',async()=>{await worker();const s=readFileSync(url,'utf8'),old=readFileSync(process.env.V29_BASE_WORKER||'/mnt/data/v29_work/v28_release/IRYS_V28_BUILDUP_WORKER.mjs','utf8');
 for(const [a,b] of [['function futuresSnapshotProof(','function evaluateFutures('],['function validDirectionalProof(','async function officialDirectionalRiskCheck(']])assert.equal(s.slice(s.indexOf(a),s.indexOf(b)),old.slice(old.indexOf(a),old.indexOf(b)));
 assert.ok(s.includes('await scheduledCore(env,now)'));assert.ok(s.includes('V29_LEGACY_SENDER_DISABLED'));assert.ok(s.includes('state.v29Forward'));assert.ok(s.includes('v29DirectionalReview:v29Run'));
});
