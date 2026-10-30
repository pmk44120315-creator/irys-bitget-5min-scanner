import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyModelAlert, aiNeutralWatchMessage, runMorningAi} from
 '../deployment/IRYS_V17_CAUSAL_AI_DIRECTION_WORKER.mjs';

const NOW=Date.parse('2026-10-30T01:00:00Z');
const DELTA='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10';
function fut(overrides={}){
 return {venue:'bitget',symbol:'ALTUSDT',
  symbol_type:'VERIFIED_CRYPTO_USDT_PERPETUAL',price_usdt:1.4,
  pct5m:.4,...overrides};
}
function ai(signal='UP',symbol='ALTUSDT',venue='bitget'){
 return {venue,symbol,signal,strength:'STRONG',reason_ko:'가설',counter_ko:'반론'};
}
function recent(net,price,same=true){
 return {source:'BITGET_REAL_15M_RECONCILED_TAKER',net_buy_usdt:6000,
  price_time_alignment:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
  recent5:{status:DELTA,price_time_alignment_verified:true,
   recent_5m_net_taker_usdt:net,recent_5m_price_change_pct:price,
   recent_flow_price_same_sign:same}};
}
function spot(overrides={}){
 return {venue:'bithumb',symbol:'KRW-ALT',market:'KRW-ALT',
  price_krw:110,price_change_snapshot_pct:.4,
  spot_risk_status:'OFFICIAL_NO_WARNING_NOW',
  confirmed_market_risk_clear:true,...overrides};
}
test('positive 15m aggregate cannot override negative current 5m taker',()=>{
 const p=verifyModelAlert(ai(),fut({real_futures_taker:recent(-1779,.43,false)}));
 assert.equal(p.stage,'AI_WATCH_CONTRARY_TAKER_EVIDENCE');
 assert.equal(p.direction_verified,false);
});
test('recent 5m real flow and price agree for long and short, no promised outcome',()=>{
 const up=verifyModelAlert(ai(),fut({real_futures_taker:recent(1500,.35,true)}));
 const down=verifyModelAlert(ai('DOWN'),fut({real_futures_taker:recent(-1500,-.35,true)}));
 assert.equal(up.stage,'REAL_EXECUTION_SUPPORT_OBSERVED');
 assert.equal(down.stage,'REAL_EXECUTION_SUPPORT_OBSERVED');
 assert.equal(up.direction_verified,false);
 assert.equal(down.direction_verified,false);
});
test('fresh 1h sample is not contemporaneous 5m verified flow',()=>{
 const p=verifyModelAlert(ai(),fut({recent_futures_taker_sample:{
  sample_fresh:true,net_taker_quote_usdt:90000,counted_trades:400
 }}));
 assert.equal(p.stage,'AI_EARLY_WATCH_UNCONFIRMED');
});
test('Bithumb positive total but latest minute negative is contradiction',()=>{
 const c=spot({taker_2m:{coverage:true,sampled_not_marketwide_cvd:true,
  net_taker_krw:5000000,recent_min_net_krw:-300000,buy_share:.65}});
 assert.equal(verifyModelAlert(ai('UP','KRW-ALT','bithumb'),c).stage,
  'AI_WATCH_CONTRARY_TAKER_EVIDENCE');
});
test('Bithumb covered bullish recent taker and price qualifies; incomplete only watch',()=>{
 const d=ai('UP','KRW-ALT','bithumb');
 assert.equal(verifyModelAlert(d,spot({taker_2m:{
  coverage:true,sampled_not_marketwide_cvd:true,net_taker_krw:100,
  recent_min_net_krw:50}})).stage,'REAL_EXECUTION_SUPPORT_OBSERVED');
 assert.equal(verifyModelAlert(d,spot({taker_2m:{
  coverage:false,sampled_not_marketwide_cvd:true,net_taker_krw:100,
  recent_min_net_krw:50}})).stage,'AI_EARLY_WATCH_UNCONFIRMED');
 assert.equal(verifyModelAlert(ai('DOWN','KRW-ALT','bithumb'),spot()),null);
});
test('neutral watch gives no BUY LONG SHORT direction suggestion',()=>{
 const msg=aiNeutralWatchMessage(ai(),fut(),{
  stage:'AI_EARLY_WATCH_UNCONFIRMED',basis:'BITGET_MISSING' },NOW);
 assert.match(msg,/방향 미확정/);
 assert.match(msg,/중립 WATCH/);
 assert.doesNotMatch(msg,/상승 가설|하락 가설|LONG 관찰|SHORT 관찰|BUY 관찰/);
});

function fixture(contradictory=false){
 const x={venue:'bitget',symbol:'ALTUSDT',market:'ALTUSDT',baseCoin:'ALT',
  asset_identity:'VERIFIED_CRYPTO',funding_rate:.0001,
  windows:{'1m':{price_change_pct:.2},'5m':{
   price_change_pct:.3,close:1.4,quote_turnover:2600,coverage:1,adjacent_ratio:1.05},
   '15m':{price_change_pct:.2,coverage:1,adjacent_ratio:1},
   '60m':{price_change_pct:-1,coverage:1}},
  oi:{status:'OK',change_pct_from_previous_run:-.3,elapsed_min_since_previous_snapshot:5}};
 const obs=contradictory?[{symbol:'ALTUSDT',price_context_status:
    'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',taker_flow_15m:{
       verified:true,net_buy_usdt:5000,buy_share:.65},
    recent5_pressure_shift_research:{
       status:DELTA,price_time_alignment_verified:true,
       recent_5m_net_taker_usdt:-1779,recent_5m_price_change_pct:.4,
       recent_flow_price_same_sign:false}}]:[];
 return {snap:{early_pool:[x],watchlist:[],futures_flow:{observations:obs},
   spot_flow:{status:'PASS',signals:[]}}};
}
async function runMock(contradictory){
 const saved=globalThis.fetch;
 let sent=0,body='';
 const markets=Array.from({length:105},(_,i)=>({
  market:'KRW-T'+(i+100),market_warning:'NONE'}));
 const ticks=markets.map(x=>({market:x.market,trade_price:100,
  acc_trade_price:10000000,acc_trade_price_24h:500000000}));
 globalThis.fetch=async(url,opts={})=>{
  const s=String(url);
  if(s.includes('/v1/market/all'))return Response.json(markets);
  if(s.includes('/v1/market/virtual_asset_warning'))return Response.json([]);
  if(s.includes('/v1/ticker'))return Response.json(ticks);
  if(s.includes('binance.com'))return new Response('{}',{status:429});
  if(s.includes('/sendMessage')){
   sent++;body=JSON.parse(opts.body).text;
   return Response.json({ok:true,result:{message_id:99,chat:{id:123456789}}});
  }
  throw Error('Unexpected mock fetch '+s);
 };
 const env={AI:{run:async()=>({response:JSON.stringify({decisions:[ai()]})})},
  TELEGRAM_BOT_TOKEN:'offline-test-only',TELEGRAM_CHAT_ID:'123456789',
  IRYS_KV:{put:async()=>{}}};
 const state={lastAlert:{}};
 try{
  const one=await runMorningAi(env,fixture(contradictory),state,NOW);
  const two=await runMorningAi(env,fixture(contradictory),state,NOW+300000);
  return {one,two,sent,body,state};
 }finally{globalThis.fetch=saved;}
}
test('unverified AI direction sends a neutral WATCH but no fake directional outcome',async()=>{
 const r=await runMock(false);
 assert.equal(r.one.alerts_sent,1);
 assert.equal(r.one.watch_sent,1);
 assert.equal(r.one.directional_sent,0);
 assert.equal(r.sent,1);
 assert.match(r.body,/방향 미확정/);
 assert.equal(r.state.aiV16Outcomes,undefined);
 assert.equal(r.state.deliveryReceiptsV12[0].channel,'AI_V17_NEUTRAL_DISCOVERY_WATCH');
 assert.equal(r.two.alerts_sent,0);
});
test('opposing real 5m taker suppresses AI direction and neutral Telegram entirely',async()=>{
 const r=await runMock(true);
 assert.equal(r.one.alerts_sent,0);
 assert.equal(r.one.contrary_suppressed,1);
 assert.equal(r.sent,0);
 assert.equal(r.state.aiV16Outcomes,undefined);
});
