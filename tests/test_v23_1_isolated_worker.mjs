import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const current=readFileSync(new URL('../deployment/IRYS_V23_1_VENUE_ISOLATED_WORKER.mjs',import.meta.url),'utf8');
const previous=readFileSync(new URL('../deployment/IRYS_V23_DIRECT_SCOUT_WORKER.mjs',import.meta.url),'utf8');
const path='deployment/IRYS_V23_1_VENUE_ISOLATED_WORKER.mjs';
test('live source marks venue-specific failure independently and preserves old latest scope',()=>{
 assert.ok(current.includes("IRYS-V23.1-VENUE-ISOLATED-DIRECT-SCOUT-20261101"));
 assert.ok(current.includes("if(!availability.bithumb&&!availability.bitget)"));
 assert.ok(current.includes("output.venue_availability=availability"));
 assert.ok(current.includes("spot_at_ms:spotReady?now:spotOld"));
 assert.ok(current.includes("futures_at_ms:futuresReady?now:futuresOld"));
 assert.ok(current.includes("read_errors:[]"));
 assert.ok(current.includes("const v23Fast=await v23ScoutTick(env,state,Date.now());"));
});
test('new code retains every existing proven production alert channel and anti-spam',()=>{
 const anchors=[
  'const AI_ALERT_TRANSPORT_ENABLED=false;',
  'const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;',
  'async function sendV21Forecasts(',
  'async function updateFuturesOutcomes(',
  'async function updateSpotOutcomes(',
  'function futuresSnapshotProof(',
  'function evaluateFutures(',
  'async function sendSpotDirectional(',
  'async function scheduledCore(',
  "'irys:fast:state:v1'",
  'const MAX_ALERTS=2;',
  "const V23_MAX_HOURLY_NOTICES=2;",
  'v23DirectFastScout:v23Fast',
  'TELEGRAM_BOT_TOKEN','GITHUB_DISPATCH_TOKEN','IRYS_KV',
  "v23Fast.status==='TELEGRAM_SEND_NOT_VERIFIED'"
 ];
 for(const a of anchors)assert.ok(current.includes(a),'original source marker missing: '+a);
 assert.ok(current.length>previous.length);
});
test('critical original hourly and 5min market paths remain byte-level unchanged',()=>{
 const oldSnap=previous.split('async function scheduledCore(')[1];
 const newSnap=current.split('async function scheduledCore(')[1];
 assert.equal(oldSnap,newSnap,'core original scheduled code must be byte-identical');
 assert.ok(current.includes("const ROOT='https://raw.githubusercontent.com/"));
});
