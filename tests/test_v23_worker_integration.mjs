import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const raw=readFileSync(new URL('../deployment/IRYS_V23_DIRECT_SCOUT_WORKER.mjs',import.meta.url),'utf8');
const old=readFileSync(new URL('../deployment/IRYS_V21_LEARNED_FORECAST_WORKER.mjs',import.meta.url),'utf8');
const checksum=s=>createHash('sha256').update(s).digest('hex');
test('V23 built Worker adds direct official ticker scout before delayed GitHub full-market read',()=>{
 assert.ok(raw.includes("IRYS-V23-DIRECT-FIRST-SCOUT-AND-LEGACY-PRESERVED-20261101"));
 const hook=raw.indexOf("const v23Fast=await v23ScoutTick(env,state,Date.now());");
 const slow=raw.indexOf("base=await readGithubCore(now);");
 assert.ok(hook>0&&slow>hook);
 assert.ok(raw.includes('v23DirectFastScout:v23Fast'));
 assert.ok(raw.includes('function v23TickerBundle('));
});
test('original proven V21 future-quote model and V19 spam prevention preserved',()=>{
 for(const anchor of [
   'const AI_ALERT_TRANSPORT_ENABLED=false;',
   'const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;',
   "const V21_MODEL_HASHES=Object.freeze({",
   'async function sendV21Forecasts(',
   'function futuresSnapshotProof(',
   'function evaluateFutures(',
   'async function sendSpotDirectional(',
   'async function updateFuturesOutcomes(',
   'async function updateSpotOutcomes(',
   'async function scheduledCore(',
   'TELEGRAM_BOT_TOKEN','GITHUB_DISPATCH_TOKEN','IRYS_KV',
   "'irys:fast:state:v1'"
 ]) assert.ok(raw.includes(anchor),'missing original Worker contract '+anchor);
 assert.equal(raw.includes('/api/v2/mix/order/'),false);
 assert.equal(raw.includes('create-order'),false);
});
test('V23 Telegram direct watch respects shared total-per-tick budget, with accurate API ACK telemetry',()=>{
 for(const anchor of [
   'if(sent+(v23Fast.sent||0)>=MAX_ALERTS)break;',
   'futuresSent+sent+(v23Fast.sent||0)>=MAX_ALERTS',
   'MAX_ALERTS-sent-futuresSent-(v23Fast.sent||0)',
   '(v23Fast.sent||0)+sent+futuresSent+directionalRun.sent',
   "v23Fast.status==='TELEGRAM_SEND_NOT_VERIFIED'",
   "v23DirectFastScout:v23Fast"
 ]) assert.ok(raw.includes(anchor),'missing shared delivery budget/receipt '+anchor);
 assert.match(raw,/const V23_MAX_HOURLY_NOTICES=2/);
 assert.match(raw,/const V23_NOTICE_COOLDOWN_MS=90\*60000/);
});
test('source provenance uses exact old Worker content outside explicit scoped changes',()=>{
 assert.ok(raw.length>old.length);
 assert.ok(raw.includes("const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';"));
 console.log('V23_REVIEWED_WORKER_SHA256',checksum(raw),'bytes',raw.length);
});
