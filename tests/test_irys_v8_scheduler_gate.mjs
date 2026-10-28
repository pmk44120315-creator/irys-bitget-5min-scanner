/** V8 alert transport integration regression; all sources and Telegram are mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {scheduledCore,validateSignal} from '../deployment/IRYS_V8_PROOF_GATED_WORKER.mjs';

const NOW=Date.parse('2026-10-28T04:00:00Z');
const publicRoot='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
const bh='https://api.bithumb.com';
function snapshot(signals=[],early_pool=[]) {
  return {
    collector_status:'PASS',finished_utc:new Date(NOW-60_000).toISOString(),
    stats:{instrument_verified_crypto:465,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:861},
    early_pool,
    spot_flow:{status:'PASS',observed_utc:new Date(NOW-60_000).toISOString(),
      markets:489,tickers:489,details_checked:1,signals}
  };
}
function fakeSources(source,{warning=false,nowPrice=100}={}) {
  const requests=[];
  const fetcher=async input=>{
    const url=String(input);requests.push(url);
    let result;
    if(url.startsWith(publicRoot))result=source;
    else if(url.startsWith(bh+'/v1/market/all'))result=[
      {market:'KRW-TEST',market_warning:'NONE'},
      ...Array.from({length:110},(_,i)=>({market:'KRW-X'+i,market_warning:'NONE'}))];
    else if(url.startsWith(bh+'/v1/market/virtual_asset_warning'))
      result=warning?[{market:'KRW-TEST'}]:[];
    else if(url.startsWith(bh+'/v1/ticker'))
      result=[{market:'KRW-TEST',trade_price:nowPrice,signed_change_rate:0,market_state:'ACTIVE'}];
    else throw Error('Unexpected request (test must not call Telegram or GitHub dispatch): '+url);
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
  return {fetcher,requests};
}
function mockEnv() {
  const kvWrites=[];
  let aiCalls=0;
  const env={
    IRYS_KV:{get:async()=>null,put:async(key,value)=>{kvWrites.push({key,value:JSON.parse(value)});}},
    AI:{run:async()=>{aiCalls++;return {response:'{"decisions":[]}'};}},
    TELEGRAM_BOT_TOKEN:'offline-test-not-a-real-token',TELEGRAM_CHAT_ID:'123456789',
  };
  return {env,kvWrites,aiCalls:()=>aiCalls};
}
async function runWith(source,opts={}) {
  const original=globalThis.fetch,{fetcher,requests}=fakeSources(source,opts);
  const m=mockEnv();
  globalThis.fetch=fetcher;
  try {
    const out=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(m.kvWrites.length,1,'Only one KV state write expected');
    return {last:out.last,requests,aiCalls:m.aiCalls()};
  }finally{globalThis.fetch=original;}
}
function pythonProof() {
  const p=spawnSync('python',['tests/generate_spot_proof_bridge.py'],
    {encoding:'utf8',timeout:8000});
  assert.equal(p.status,0,p.stderr);
  const row=JSON.parse(p.stdout);
  assert.equal(validateSignal(row.signal,NOW),true,'real Python proof must meet V8 contract');
  return row.signal;
}
test('scheduled V8 never forwards legacy burst BUY nor short/up model suggestions',async()=>{
  const legacy=['KRW-EPT','KRW-REZ'].map(market=>({
    market,venue:'bithumb',direction:'BUY_OBSERVATION',
    timestamp_utc:new Date(NOW-60_000).toISOString(),observation_only:true
  }));
  const {last,requests,aiCalls}=await runWith(snapshot(legacy,[
    {symbol:'EPTUSDT',venue:'bitget',direction_hint:'DOWN'}
  ]));
  assert.equal(last.status,'PASS');
  assert.equal(last.spotEarlyAlerts,2,'The old observations were present upstream');
  assert.equal(last.confirmed,0,'Unproven burst observations cannot be confirmed');
  assert.equal(last.sent,0);
  assert.equal(last.aiJudgment.status,'SKIPPED_NO_SUSTAINED_SPOT_SIGNAL');
  assert.equal(aiCalls,0,'No expensive AI call without sustained proof');
  assert.equal(requests.length,1,'No risk, Telegram or other HTTP calls should occur');
});
test('real Python 4x5m proof is blocked at final send gate by official warning',async()=>{
  const proof=pythonProof();
  const {last,requests,aiCalls}=await runWith(snapshot([proof]),{warning:true});
  assert.equal(last.spotEarlyAlerts,1);
  assert.equal(last.blockedByRisk,1);
  assert.equal(last.confirmed,0);
  assert.equal(last.sent,0);
  assert.equal(aiCalls,0);
  assert.equal(requests.some(x=>x.startsWith(bh+'/v1/market/virtual_asset_warning')),true);
  assert.equal(requests.some(x=>x.includes('api.telegram.org')),false);
});
test('reversed live price invalidates even a real sustained proof before Telegram',async()=>{
  const proof=pythonProof();
  const {last,requests,aiCalls}=await runWith(snapshot([proof]),{nowPrice:104});
  assert.equal(last.blockedByRisk,1);
  assert.equal(last.confirmed,0);
  assert.equal(last.sent,0);
  assert.equal(aiCalls,0);
  assert.equal(requests.some(x=>x.includes('api.telegram.org')),false);
});
