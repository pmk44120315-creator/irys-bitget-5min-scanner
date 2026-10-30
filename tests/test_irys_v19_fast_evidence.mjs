import test from 'node:test';
import assert from 'node:assert/strict';
import {
  v19FuturesCandidates,v19SpotCandidates,v19FastMessage,
  v19SendFastAlerts,v19DeliveryKey,v19AlreadyRecentlyAlerted,
  runMorningAi
} from '../deployment/IRYS_V19_EARLY_FLOW_WORKER.mjs';

const NOW=Date.parse('2026-10-30T12:50:00Z');
const FINISHED='2026-10-30T12:48:00Z';
function source(){
 return {collector_status:'PASS',finished_utc:FINISHED,
  early_pool:[{symbol:'EARLYUSDT',baseCoin:'EARLY',
   venue:'bitget',asset_identity:'VERIFIED_CRYPTO',
   windows:{'5m':{close:1.12,adjacent_ratio:2.4}}},
   {symbol:'STOCKUSDT',baseCoin:'STOCK',venue:'bitget',
   asset_identity:'NON_CRYPTO',windows:{'5m':{close:1}}}],
  watchlist:[]};
}
function proof(symbol='EARLYUSDT',price=.38,prior=-.61,net=15500,verified=true){
 const end=NOW-60000;
 return {symbol,observation_only:true,send_allowed:false,
   window_5m_price_pct:price,window_15m_price_pct:prior,
   price_context_end_ms:end,price_context_status:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
   oi_change_pct:-.21,book_proof_v13:{status:'WAIT_SECOND_BOOK'},
   taker_flow_15m:{verified,symbol,venue:'bitget',end_ms:end,
     taker_turnover_usdt:62000,
     completeness:'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED',
     full_exchange_local_public_taker_flow_verified:true},
   recent5_pressure_shift_research:{
     status:'REAL_15M_RECONCILED_RECENT5_VS_PRIOR10',
     price_time_alignment_verified:true,
     recent_5m_net_taker_usdt:net,
     recent_5m_price_change_pct:price,
     recent_5m_buy_share:net>0?.65:.34,
     recent_5m_trades:175,
     recent_flow_price_same_sign:net*price>0,
     buy_share_delta:.24,actual_5m_close_location_in_range:.88}};
}
function doc(o=[proof()]){
 return {status:'PASS',version:'V18_EVIDENCE_LIVE_V1',
   at_utc:new Date(NOW-10000).toISOString(),
   source_finished_utc:FINISHED,observations:o};
}
const spot={preselected:1,observations:[
 {venue:'bithumb',market:'KRW-ALT',symbol:'KRW-ALT',
  direction_hint:'UP',spot_risk_status:'OFFICIAL_NO_WARNING_NOW',
  confirmed_market_risk_clear:true,price_change_snapshot_pct:.42,
  turnover5_est_krw:42000000,relative_turnover:2.8,price_krw:135,
  taker_2m:{coverage:true,sampled_not_marketwide_cvd:true,
   net_taker_krw:1800000,recent_min_net_krw:950000,buy_share:.69}}
]};
test('real reversal first move qualifies with validated same-window taker and no double-book gate',()=>{
 const x=v19FuturesCandidates(source(),doc(),NOW);
 assert.equal(x.feedStatus,'PASS');
 assert.equal(x.verified,1);
 assert.equal(x.reversals,1);
 assert.equal(x.candidates.length,1);
 assert.equal(x.candidates[0].kind,'DIRECTION');
 assert.equal(x.candidates[0].direction,'LONG');
 assert.equal(x.candidates[0].book_observed,false);
 assert.match(v19FastMessage(x.candidates[0],NOW),/LONG/);
});
test('same 15m buy volume but opposite latest 5m execution never becomes LONG',()=>{
 const x=v19FuturesCandidates(source(),doc([proof('EARLYUSDT',.5,-.6,-12500)]),NOW);
 assert.equal(x.verified,1);
 assert.equal(x.contrary,1);
 assert.equal(x.candidates[0].kind,'WATCH');
 assert.equal(x.candidates[0].direction,null);
});
test('stale, mismatched, incomplete evidence and noncrypto rejected',()=>{
 assert.equal(v19FuturesCandidates(source(),{...doc(),at_utc:new Date(NOW-45*60000).toISOString()},NOW).candidates.length,0);
 assert.equal(v19FuturesCandidates(source(),{...doc(),source_finished_utc:'2026-10-30T10:00:00Z'},NOW).candidates.length,0);
 const a=v19FuturesCandidates(source(),doc([proof('EARLYUSDT',.3,.2,1800,false)]),NOW);
 assert.equal(a.candidates[0].kind,'WATCH');
 assert.equal(a.candidates[0].verified,false);
 assert.equal(v19FuturesCandidates(source(),doc([proof('STOCKUSDT',.5,-.5,9000)]),NOW).candidates.length,0);
});
test('Bithumb true sample supports BUY watch, missing/opposite sample stays neutral',()=>{
 const a=v19SpotCandidates(spot,NOW);
 assert.equal(a.candidates[0].direction,'BUY');
 assert.equal(a.candidates[0].kind,'DIRECTION');
 const b=v19SpotCandidates({observations:[
   {...spot.observations[0],taker_2m:{coverage:false}}]},NOW);
 assert.equal(b.candidates[0].direction,null);
 const c=v19SpotCandidates({observations:[
   {...spot.observations[0],taker_2m:{coverage:true,sampled_not_marketwide_cvd:true,
     net_taker_krw:1000,recent_min_net_krw:-2000,buy_share:.45}}]},NOW);
 assert.equal(c.candidates[0].kind,'WATCH');
 assert.equal(c.candidates[0].opposite,true);
});
function mockEnv(){const entries=[];return {IRYS_KV:{put:async(k,v)=>{entries.push(k);}},
  entries,TELEGRAM_BOT_TOKEN:'offline-only',TELEGRAM_CHAT_ID:'123456789'};}
test('quota independent flow sends actual Telegram API ACK and audit receipt (mock only)',async()=>{
 const env=mockEnv(),state={lastAlert:{}},messages=[];
 const x=await v19SendFastAlerts(env,state,spot,source(),NOW,1,{
   readEvidence:async()=>doc(),
   riskCheck:async()=>135,
   send:async(_env,msg)=>{messages.push(msg);return {message_id:79};}
 });
 assert.equal(x.status,'TELEGRAM_API_ACK');
 assert.equal(x.sent,1);
 assert.equal(x.direction_sent,1);
 assert.equal(state.telegramAcknowledgementsTotal,1);
 assert.equal(state.deliveryReceiptsV12[0].status,'TELEGRAM_API_ACK_ONLY_DEVICE_RECEIPT_UNVERIFIED');
 assert.ok(env.entries.some(k=>k.includes('delivery-receipt')));
 assert.ok(messages[0].includes('진입 신호 아님'));
 const next=await v19SendFastAlerts(env,state,spot,source(),NOW+5*60000,1,{
   readEvidence:async()=>({...doc(),at_utc:new Date(NOW+5*60000).toISOString()}),
   riskCheck:async()=>135,
   send:async()=>{throw Error('unexpected duplicate');}
 });
 assert.equal(next.sent,0);
});
test('Telegram failure cannot create a false acknowledgement or lastAlert',async()=>{
 const state={lastAlert:{}},env=mockEnv();
 const x=await v19SendFastAlerts(env,state,{preselected:1,observations:[spot.observations[0]]},
   {...source(),early_pool:[]},NOW,1,{
     readEvidence:async()=>({status:'UNAVAILABLE'}),
     riskCheck:async()=>135,
     send:async()=>{throw Error('TELEGRAM_DOWN_MOCK');}
   });
 assert.equal(x.status,'TELEGRAM_SEND_FAILED');
 assert.equal(x.sent,0);
 assert.equal(state.telegramAcknowledgementsTotal,undefined);
 assert.equal(Object.keys(state.lastAlert).length,0);
});
test('delivery budget is only an hourly anti-spam, never a candidate selection gate',async()=>{
 const env=mockEnv(),state={lastAlert:{},v19FastHour:{hour:new Date(NOW+9*3600000).toISOString().slice(0,13),count:8}};
 const x=await v19SendFastAlerts(env,state,spot,source(),NOW,1,{
   readEvidence:async()=>doc(),riskCheck:async()=>135,send:async()=>({message_id:2})});
 assert.equal(x.sent,0);
 assert.equal(x.skipped_rate,1);
 assert.ok(x.futures_candidates>0);
});
test('source candidate identity and early ranking never depend on 20 consecutive 1m bars',()=>{
 const x=source();x.early_pool[0].windows={...x.early_pool[0].windows,'1m':{coverage:0}};
 assert.equal(v19FuturesCandidates(x,doc(),NOW).candidates[0].direction,'LONG');
});
test('rapid Bithumb warning survives separate Futures feed outage',async()=>{
 const state={lastAlert:{}},env=mockEnv();
 const x=await v19SendFastAlerts(env,state,spot,{...source(),early_pool:[]},NOW,1,{
  readEvidence:async()=>{throw Error('independent flow API unavailable')},
  riskCheck:async()=>135,
  send:async()=>({message_id:90})});
 assert.equal(x.sent,1);
 assert.equal(x.spot_sent,1);
 assert.equal(x.source_status,'STALE_OR_UNMATCHED');
});
