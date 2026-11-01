import test from 'node:test';
import assert from 'node:assert/strict';
import {v24FastFallback} from '../deployment/v24_bitget_fast_fallback.mjs';
import {v23ScoutTick} from '../deployment/v23_direct_market_scout.mjs';
const NOW=Date.parse('2026-11-01T11:48:00Z');
function report(now=NOW){
 const t=now-4*60000;
 return {version:'IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1',
  status:'MARKET_COMPARISON_PASS',venue:'bitget',
  at_ms:t,at_utc:new Date(t).toISOString(),
  source_identity:'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO',
  not_full_orderbook_or_marketwide_cvd:true,
  not_profitable_future_direction_proof:true,trade_data_included:false,
  active_verified_crypto_count:465,actual_official_tickers_count:465,
  candidates:[{venue:'bitget',symbol:'MOVERUSDT',
    price:1.2,move_pct:1.2,priority:12.0,
    spread_pct:.07,quote_24h_usdt:5000000,
    price_timestamp_ms:t-2000,price_acceleration_pct:.4,
    identity_verified_v3_crypto:true,
    active_contract_verified_v2:true,
    price_only_not_future_direction:true,
    source:'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST'}]};
}
test('confirmed recent V2/V3 actual crypto first-impulse is WATCH-only with truthful source age',()=>{
 const x=v24FastFallback(report(),NOW);
 assert.equal(x.status,'PASS');
 assert.equal(x.observed,465);
 assert.equal(x.candidates.length,1);
 assert.equal(x.candidates[0].symbol,'MOVERUSDT');
 assert.equal(x.candidates[0].source_age_min,4);
 assert.equal(x.candidates[0].direct_current_Bitget_API_verified,false);
 assert.equal(x.candidates[0].price_only_not_future_direction,true);
});
test('old delayed GitHub observation never promoted to a live early candidate',()=>{
 const x=v24FastFallback(report(NOW-7*60000),NOW);
 assert.equal(x.status,'STALE_FAST_SOURCE');
 assert.equal(x.candidates.length,0);
});
test('invalid identity, metal stock and synthetically high ranking cannot circumvent V3',()=>{
 const r=report();
 r.candidates[0].identity_verified_v3_crypto=false;
 assert.equal(v24FastFallback(r,NOW).candidates.length,0);
 r.candidates[0].identity_verified_v3_crypto=true;
 r.candidates[0].symbol='STOCK/AUSDT';
 assert.equal(v24FastFallback(r,NOW).candidates.length,0);
});
test('unverified, incomplete or failed official fast-source documents remain unavailable',()=>{
 const a=report();a.source_identity='MARKETWIDE_CVD_LIE';
 assert.equal(v24FastFallback(a,NOW).status,'UNTRUSTED_SOURCE_SCHEMA');
 const b=report();b.status='BASELINE_WARMING_OR_TIME_GAP';
 assert.equal(v24FastFallback(b,NOW).status,'BASELINE_WARMUP_NOT_READY');
 const c=report();c.actual_official_tickers_count=2;
 assert.equal(v24FastFallback(c,NOW).status,'UNTRUSTED_SOURCE_SCHEMA');
});
test('tradeable top-of-book and validated clock are mandatory',()=>{
 const a=report();a.candidates[0].spread_pct=2.1;
 assert.equal(v24FastFallback(a,NOW).candidates.length,0);
 const b=report();b.candidates[0].price_timestamp_ms=NOW+120000;
 assert.equal(v24FastFallback(b,NOW).candidates.length,0);
 const c=report();c.candidates[0].move_pct=.2;
 assert.equal(v24FastFallback(c,NOW).candidates.length,0);
});

test('actual V24 GitHub Bitget official source restores one MARKET WATCH despite both Cloudflare venue failures',async()=>{
 const state={lastAlert:{}},sent=[],receipts=[];
 const read=async url=>{
  if(url.includes('raw.githubusercontent.com'))return report();
  throw Error('HTTP_403_CF_NETWORK');
 };
 const result=await v23ScoutTick({},state,NOW,{
   read,send:async(_env,msg)=>{sent.push(msg);return {message_id:491}},
   receipt:(_state,channel,symbol,at,ack)=>{
     receipts.push({channel,symbol,id:ack.message_id});return {channel,symbol}},
   persistReceipt:async()=>true
 });
 assert.equal(result.status,'TELEGRAM_API_ACK');
 assert.equal(result.sent_venue,'bitget');
 assert.equal(result.sent_symbol,'MOVERUSDT');
 assert.equal(result.bitget_fast_fallback.status,'PASS');
 assert.ok(result.compared_venues.includes('bitget_github_official'));
 assert.equal(sent.length,1);
 assert.match(sent[0],/GitHub 경유/);
 assert.match(sent[0],/미래 방향 확인 아님/);
 assert.match(sent[0],/진입 신호나 미래 수익 보장은 아닙니다/);
 assert.equal(receipts[0].channel,'V23_DIRECT_FAST_MARKET_WATCH');
});
test('stale GitHub fallback and both Cloudflare APIs down produce NO alert, no baseline forgery',async()=>{
 const saved={at_ms:NOW-400000,spot:{'KRW-KEEP':[100,200]},futures:{'ABCUSDT':[1,0]}};
 const state={v23ScoutTape:saved},before=JSON.stringify(saved);
 const x=await v23ScoutTick({},state,NOW,{
   read:async url=>{
     if(url.includes('raw.githubusercontent.com'))return report(NOW-7*60000);
     throw Error('PUBLIC_403');
   },
   send:async()=>{throw Error('MUST_NOT_SEND_STALE_BITGET')}
 });
 assert.equal(x.sent,0);
 assert.equal(x.status,'BOTH_VENUES_UNAVAILABLE_NO_BASELINE_CHANGE');
 assert.equal(x.bitget_fast_fallback.status,'STALE_FAST_SOURCE');
 assert.equal(JSON.stringify(state.v23ScoutTape),before);
});
