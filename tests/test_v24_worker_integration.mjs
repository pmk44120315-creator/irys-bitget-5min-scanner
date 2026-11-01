import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const prior=readFileSync(new URL('../deployment/IRYS_V23_1_VENUE_ISOLATED_WORKER.mjs',import.meta.url),'utf8');
const next=readFileSync(new URL('../deployment/IRYS_V24_BITGET_FALLBACK_WORKER.mjs',import.meta.url),'utf8');
const mod=readFileSync(new URL('../deployment/v23_direct_market_scout.mjs',import.meta.url),'utf8');
const helper=mod.replace('export {v23TickerBundle,v23SpotTradeMs,v23ReadFeeds,v23SampleTaker,v23Message,v23ScoutTick,V23_VER,v24FastFallback,V24_FAST_URL};','').trim();
test('V24 Cloudflare future direction and original 5-minute scheduled execution byte-identical',()=>{
 assert.ok(next.includes("IRYS-V24-BITGET-GITHUB-FAST-FALLBACK-20261101"));
 const oldBody=prior.split('async function scheduledCore(env,now=Date.now(),preDispatch=null){')[1];
 const newBody=next.split('async function scheduledCore(env,now=Date.now(),preDispatch=null){')[1];
 assert.equal(oldBody,newBody);
 for(const k of ['const AI_ALERT_TRANSPORT_ENABLED=false;',
   'const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;',
   'async function sendV21Forecasts(', 'async function sendSpotDirectional(',
   'async function updateSpotOutcomes(', 'async function updateFuturesOutcomes(',
   'function futuresSnapshotProof(', 'const MAX_ALERTS=2;',
   "const v23Fast=await v23ScoutTick(env,state,Date.now());"])
    assert.ok(next.includes(k),'missing original source '+k);
});
test('verified V24 standalone helper integrated into deployed Worker byte for byte',()=>{
 assert.ok(helper.includes('function v24FastFallback('));
 assert.ok(next.includes(helper),'source drift between tested V24 module and production source');
 assert.ok(next.includes("output.bitget_fast_fallback="));
 assert.ok(next.includes("status:'STALE_FAST_SOURCE'"));
});
test('source identity and latency claims exposed; no speculative trade orders added',()=>{
 assert.ok(next.includes("source_age_min"));
 assert.ok(next.includes("BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST"));
 assert.ok(next.includes("V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO"));
 assert.ok(next.includes("분 전 자료"));
 assert.equal(next.includes('/api/v2/mix/order/place-order'),false);
 const sha=createHash('sha256').update(next).digest('hex');
 console.log('IRYS_V24_REVIEWED_WORKER_SHA256',sha,'bytes',next.length);
});
