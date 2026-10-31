import test from 'node:test';
import assert from 'node:assert/strict';
import {
 v19FuturesCandidates,v19SpotCandidates,v19SendFastAlerts,runMorningAi,
 futuresSnapshotProof,evaluateFutures,sendSpotDirectional,updateAiV16Outcomes
} from '../deployment/IRYS_V20_ACCURACY_FIRST_WORKER.mjs';

const NOW=Date.parse('2026-10-31T04:50:00Z');
const ASOF='2026-10-31T04:48:00Z';
function market(){
 return {collector_status:'PASS',finished_utc:ASOF,
  early_pool:[{symbol:'REVERSALUSDT',baseCoin:'REVERSAL',
    venue:'bitget',asset_identity:'VERIFIED_CRYPTO',
    windows:{'5m':{close:1.25,adjacent_ratio:1.8}}}],
  watchlist:[]};
}
function futures(){
 const end=NOW-60000;
 return {version:'V18_EVIDENCE_LIVE_V1',status:'PASS',
 at_utc:new Date(NOW-10000).toISOString(),
 source_finished_utc:ASOF,
 observations:[{
  symbol:'REVERSALUSDT',price_context_status:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
  price_context_end_ms:end,window_5m_price_pct:.42,window_15m_price_pct:-.77,
  taker_flow_15m:{verified:true,symbol:'REVERSALUSDT',venue:'bitget',end_ms:end,
   taker_turnover_usdt:85000,
   completeness:'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED',
   full_exchange_local_public_taker_flow_verified:true},
  recent5_pressure_shift_research:{
   status:'REAL_15M_RECONCILED_RECENT5_VS_PRIOR10',
   price_time_alignment_verified:true,recent_5m_net_taker_usdt:12500,
   recent_5m_price_change_pct:.42,recent_5m_buy_share:.67,
   recent_flow_price_same_sign:true,recent_5m_trades:300}
 }]};
}
const spot={preselected:1,observations:[{
 venue:'bithumb',market:'KRW-ALT',symbol:'KRW-ALT',
 price_change_snapshot_pct:2.1,turnover5_est_krw:180000000,
 relative_turnover:9.2,price_krw:120,
 spot_risk_status:'OFFICIAL_NO_WARNING_NOW',confirmed_market_risk_clear:true,
 taker_2m:{coverage:true,sampled_not_marketwide_cvd:true,
  net_taker_krw:34000000,recent_min_net_krw:29000000,buy_share:.81}}]};
const env={TELEGRAM_BOT_TOKEN:'test_only',TELEGRAM_CHAT_ID:'123456789',
 IRYS_KV:{put:async()=>{throw Error('SHOULD_NEVER_WRITE_RECEIPT')}}};
test('highly favorable real futures is candidate for research, not an unvalidated prediction Telegram alert',async()=>{
 const x=await v19SendFastAlerts(env,{lastAlert:{}},{observations:[]},market(),NOW,2,{
  readEvidence:async()=>futures(),
  send:async()=>{throw Error('UNVALIDATED_FUTURES_SENT')},
  riskCheck:async()=>120
 });
 assert.equal(x.status,'V20_FORECAST_UNVALIDATED_NO_SPECULATIVE_SEND');
 assert.equal(x.sent,0);
 assert.equal(x.futures_candidates,1);
 assert.equal(x.verified_futures,1);
 assert.equal(x.research_direction_candidates,1);
});
test('highly favorable spot real sampled buys cannot trigger an untested BUY Telegram',async()=>{
 const state={lastAlert:{}},x=await v19SendFastAlerts(env,state,spot,market(),NOW,2,{
  readEvidence:async()=>futures(),
  send:async()=>{throw Error('UNVALIDATED_BUY_SENT')},
  riskCheck:async()=>120
 });
 assert.equal(x.sent,0);
 assert.ok(x.spot_candidates>=1);
 assert.ok(x.research_candidates>=2);
 assert.equal(state.telegramAcknowledgementsTotal,undefined);
 assert.ok(state.v20LastResearchSnapshot);
});
test('no candidate is fabricated when evidence missing',async()=>{
 const x=await v19SendFastAlerts(env,{lastAlert:{}},{observations:[]},
  {...market(),early_pool:[]},NOW,1,{readEvidence:async()=>{throw Error('OFFLINE')}});
 assert.equal(x.sent,0);
 assert.equal(x.status,'NO_FRESH_EARLY_EVIDENCE');
});
test('research-only collection remains independent of model or Telegram access',async()=>{
 const state={lastAlert:{}},x=await v19SendFastAlerts({},state,spot,market(),NOW,1,
  {readEvidence:async()=>futures()});
 assert.equal(x.sent,0);
 assert.equal(x.status,'V20_FORECAST_UNVALIDATED_NO_SPECULATIVE_SEND');
 assert.equal(state.v20LastResearchSnapshot.flow_verified,1);
});
test('futures and spot source filters still exclude contradictory and unverified proof',()=>{
 const f=futures();f.observations[0].recent5_pressure_shift_research.recent_5m_net_taker_usdt=-12000;
 f.observations[0].recent5_pressure_shift_research.recent_flow_price_same_sign=false;
 const r=v19FuturesCandidates(market(),f,NOW);
 assert.equal(r.candidates[0].kind,'WATCH');
 assert.equal(r.candidates[0].opposite,true);
 const s=v19SpotCandidates({...spot,observations:[{...spot.observations[0],
  taker_2m:{coverage:false}}]},NOW);
 assert.equal(s.candidates[0].kind,'WATCH');
});
test('existing independently verified legacy directional evaluation paths retained',()=>{
 assert.equal(typeof futuresSnapshotProof,'function');
 assert.equal(typeof evaluateFutures,'function');
 assert.equal(typeof sendSpotDirectional,'function');
 assert.equal(typeof updateAiV16Outcomes,'function');
});
test('AI quota backoff cannot create any V19 message even through full morning pipeline',async()=>{
 const saved=globalThis.fetch;
 const official=Array.from({length:105},(_,i)=>({
  market:i===0?'KRW-ALT':'KRW-Z'+(i+100),market_warning:'NONE'}));
 const tickers=official.map((x,i)=>({
  market:x.market,trade_price:i===0?102:100,
  acc_trade_price:i===0?160000000:110000000,
  acc_trade_price_24h:700000000,
  market_state:'ACTIVE'}));
 globalThis.fetch=async url=>{
  const s=String(url);
  if(s.includes('/v1/market/all'))return Response.json(official);
  if(s.includes('/v1/market/virtual_asset_warning'))return Response.json([]);
  if(s.includes('/v1/ticker'))return Response.json(tickers);
  if(s.includes('/v1/candles/minutes/')||s.includes('/v1/trades/ticks')||
    s.includes('/v1/orderbook'))return Response.json([]);
  if(s.includes('/data/v18_evidence_latest.json'))return Response.json(futures());
  if(s.includes('api.telegram.org/'))throw Error('UNTESTED_ALARM_LEAK');
  throw Error('UNEXPECTED_URL '+s);
 };
 const state={version:1,lastAlert:{},
  aiQuotaBackoffUntil:NOW+60*60000,
  aiSpotTape:{at:NOW-300000,day:'2026-10-31',
   prices:Object.fromEntries(official.map(x=>[x.market,[100,100000000,1000000,2]]))}};
 try{
  const a=await runMorningAi({AI:{run:async()=>{throw Error('NO_QUOTA')}},...env},
    {snap:{...market(),early_pool:[],watchlist:[]}},state,NOW,2);
  assert.equal(a.status,'AI_QUOTA_BACKOFF_ACTIVE');
  assert.equal(a.fastAlertsSent,0);
  assert.equal(a.fastEarly.status,'V20_FORECAST_UNVALIDATED_NO_SPECULATIVE_SEND');
  assert.equal(a.fastEarly.spot_candidates>0,true);
 }finally{globalThis.fetch=saved;}
});
