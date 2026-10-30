import test from 'node:test';
import assert from 'node:assert/strict';
import {runMorningAi} from '../deployment/IRYS_V16_AI_FIRST_LIVE_WORKER.mjs';
const now=Date.parse('2026-10-30T01:00:00Z');
function source(){return {snap:{watchlist:[],futures_flow:{observations:[]},
 early_pool:[{venue:'bitget',symbol:'ALTUSDT',market:'ALTUSDT',baseCoin:'ALT',
 asset_identity:'VERIFIED_CRYPTO',windows:{
 '1m':{price_change_pct:0.2},
 '5m':{price_change_pct:0.3,close:1.4,quote_turnover:2600,
 coverage:1,adjacent_ratio:1.02},
 '15m':{price_change_pct:-0.1,adjacent_ratio:0.95,coverage:1},
 '60m':{price_change_pct:-3,coverage:1}},
 oi:{status:'OK',change_pct_from_previous_run:-0.4,elapsed_min_since_previous_snapshot:5}}],
 spot_flow:{status:'PASS',signals:[]}}};}
test('actual AI output emits clearly provisional observation once, Telegram ACK and outcome receipt',async()=>{
 const saved=globalThis.fetch,sends=[];
 const markets=Array.from({length:105},(_,i)=>({market:'KRW-T'+(i+100),market_warning:'NONE'}));
 const ticks=markets.map(x=>({market:x.market,trade_price:100,
 acc_trade_price:10000000,acc_trade_price_24h:500000000}));
 globalThis.fetch=async(url,options={})=>{
  const s=String(url);
  if(s.includes('/v1/market/all'))return Response.json(markets);
  if(s.includes('/v1/market/virtual_asset_warning'))return Response.json([]);
  if(s.includes('/v1/ticker'))return Response.json(ticks);
  if(s.includes('binance.com'))return new Response('{}',{status:429});
  if(s.includes('/sendMessage')){
   sends.push(JSON.parse(options.body).text);
   return Response.json({ok:true,result:{message_id:91,chat:{id:123456789}}});
  }
  throw Error('Unexpected URL '+s);
 };
 const state={lastAlert:{}};
 const env={
  AI:{run:async()=>({response:JSON.stringify({decisions:[
    {venue:'bitget',symbol:'ALTUSDT',signal:'UP',strength:'EARLY',
    reason_ko:'가격이 움직임',counter_ko:'실제 체결 부재'}]})})},
  TELEGRAM_BOT_TOKEN:'offline-mock-only',
  TELEGRAM_CHAT_ID:'123456789',
  IRYS_KV:{put:async()=>{}}
 };
 try{
  const one=await runMorningAi(env,source(),state,now);
  assert.equal(one.alerts_sent,1);
  assert.equal(sends.length,1);
  assert.match(sends[0],/매매 신호 아님/);
  assert.match(sends[0],/상승 가설/);
  assert.match(sends[0],/체결 방향 미확정/);
  assert.equal(state.deliveryReceiptsV12[0].telegram_message_id,91);
  assert.equal(state.aiV16Outcomes.length,1);
  const two=await runMorningAi(env,source(),state,now+300000);
  assert.equal(two.alerts_sent,0);
  assert.equal(sends.length,1);
 }finally{globalThis.fetch=saved;}
});
test('AI provider error never fabricates a BUY or futures alert',async()=>{
 const saved=globalThis.fetch;
 const markets=Array.from({length:105},(_,i)=>({market:'KRW-T'+(i+100),market_warning:'NONE'}));
 globalThis.fetch=async url=>{
  if(String(url).includes('/v1/market/all'))return Response.json(markets);
  if(String(url).includes('/v1/market/virtual_asset_warning'))return Response.json([]);
  if(String(url).includes('/v1/ticker'))return Response.json([]);
  if(String(url).includes('binance.com'))return new Response('{}',{status:429});
  throw Error('Unexpected network request');
 };
 try{
  const state={lastAlert:{}};
  const r=await runMorningAi({AI:{run:async()=>{throw Error('model inaccessible')}}},source(),state,now);
  assert.equal(r.alerts_sent,0);
  assert.equal(r.status,'AI_INFERENCE_FAILED');
  assert.equal(state.deliveryReceiptsV12,undefined);
 }finally{globalThis.fetch=saved;}
});
