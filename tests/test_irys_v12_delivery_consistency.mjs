import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledCore,earlyMessage,recheckEarlyMarkets} from '../deployment/IRYS_V12_DELIVERY_CONSISTENCY_WORKER.mjs';

const NOW=Date.parse('2026-10-28T08:10:00Z');
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
function watch(){
  return {market:'KRW-MPLX',price_krw:68.01,interval_minutes:4.91,
    interval_price_change_pct:3.061,five_minute_equivalent_turnover_krw:34173381,
    five_minute_prior_ema_krw:56384,turnover_ratio_prior_ema:606.08,
    day_price_change_pct:4.1,risk_class:'EARLY_MOMENTUM_WATCH',
    official_warning_checked:true,risk_status:'NO_OFFICIAL_WARNING_AT_COLLECTION',
    observation_only:true,is_buy_signal:false,order_allowed:false,
    notify_observation_eligible:true,
    source:'Bithumb public KRW ticker/market/official-warning snapshots'};
}
function snapshot(){
  return {collector_status:'PASS',finished_utc:new Date(NOW-60_000).toISOString(),
    stats:{instrument_verified_crypto:465,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:861},
    watchlist:[],early_pool:[],
    futures_flow:{status:'EVALUATED',observation_only:true,alert_eligible:false,observations:[]},
    spot_flow:{status:'PASS',observed_utc:new Date(NOW-60_000).toISOString(),
      markets:489,tickers:489,signals:[],early_watch_observations:[watch()]}};
}
function mock(){
  let stored=null;const messages=[],calls=[];
  const env={IRYS_KV:{get:async()=>stored?JSON.stringify(stored):null,
    put:async(_,v)=>{stored=JSON.parse(v);}},
    TELEGRAM_BOT_TOKEN:'offline-only-mock',TELEGRAM_CHAT_ID:'123456789'};
  return {env,messages,calls,get:()=>stored,set:v=>{stored=v;}};
}
function http(mockState,{price=70.0,receipt=8124,warning=false}={}){
  return async(url,opts={})=>{
    const s=String(url);mockState.calls.push(s);
    if(s.startsWith(ROOT))return new Response(JSON.stringify(snapshot()),{status:200});
    if(s.includes('/v1/market/all'))
      return new Response(JSON.stringify(Array.from({length:105},(_,i)=>({
        market:i===0?'KRW-MPLX':'KRW-T'+i,market_warning:'NONE'}))),{status:200});
    if(s.includes('/v1/market/virtual_asset_warning'))
      return new Response(JSON.stringify(warning?[{market:'KRW-MPLX'}]:[]),{status:200});
    if(s.includes('/v1/ticker'))
      return new Response(JSON.stringify([{market:'KRW-MPLX',trade_price:price,
        market_state:'ACTIVE',signed_change_rate:.04}]),{status:200});
    if(s.includes('/sendMessage')){
      mockState.messages.push(JSON.parse(opts.body).text);
      const result=receipt===null?{ok:true,result:{}}:
        {ok:true,result:{message_id:receipt,chat:{id:123456789}}};
      return new Response(JSON.stringify(result),{status:200});
    }
    throw Error('Unexpected request '+s);
  };
}
test('sub-160s duplicate tick does not dispatch GitHub or use any external request',async()=>{
  const backup=globalThis.fetch,m=mock();
  m.set({version:1,prevAt:NOW-60_000,lastAlert:{},run:1});
  globalThis.fetch=async()=>{throw Error('No network allowed during duplicate');};
  try{
    const result=await scheduledCore(m.env,NOW);
    assert.equal(result.skipped,true);
    assert.equal(result.dispatch.status,'SKIPPED_DUPLICATE_TICK');
    assert.equal(m.get().prevAt,NOW-60_000);
    assert.equal(m.calls.length,0);
  }finally{globalThis.fetch=backup;}
});
test('real Telegram API message_id is recorded and cooldown blocks a repeated early-watch',async()=>{
  const backup=globalThis.fetch,m=mock();globalThis.fetch=http(m,{price:70,receipt:8124});
  try{
    const res=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(res.last.status,'PASS');
    assert.equal(res.last.earlyMarketWatch.sent,1);
    assert.equal(res.last.telegramApiAckedThisRun,1);
    assert.equal(res.last.telegramDeviceReceiptVerified,false);
    assert.equal(res.last.telegramApiAcknowledgementsTotal,1);
    assert.equal(res.last.telegramLastApiReceipt.telegram_message_id,8124);
    assert.equal(res.last.telegramLastApiReceipt.channel,'BITHUMB_EARLY_WATCH');
    assert.equal(m.messages.length,1);
    assert.equal(m.get().deliveryReceiptsV12.length,1);
    const next=NOW+5*60_000;
    const again=await scheduledCore(m.env,next,{status:'ACCEPTED',error:null});
    assert.equal(again.last.earlyMarketWatch.blocked_cooldown,1);
    assert.equal(m.messages.length,1);
  }finally{globalThis.fetch=backup;}
});
test('Telegram ok without message id is not counted as a verified API acknowledgement',async()=>{
  const backup=globalThis.fetch,m=mock();globalThis.fetch=http(m,{receipt:null});
  try{
    await assert.rejects(()=>scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null}),
      /TELEGRAM_DELIVERY_NOT_CONFIRMED/);
    assert.equal(m.get().last.earlyMarketWatch.sent,0);
    assert.equal(m.get().last.telegramApiAckedThisRun,0);
  }finally{globalThis.fetch=backup;}
});
test('an additional 6% price runup after collection is not sent as an early alert',async()=>{
  const backup=globalThis.fetch,m=mock();globalThis.fetch=http(m,{price:73});
  try{
    const res=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(res.last.earlyMarketWatch.status,'EARLY_RISK_BLOCKED');
    assert.equal(m.messages.length,0);
  }finally{globalThis.fetch=backup;}
});
test('a 3% added rise is explicitly labelled late chase, not a fresh buy',async()=>{
  const backup=globalThis.fetch,m=mock();globalThis.fetch=http(m,{price:70.3});
  try{
    const res=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(res.last.earlyMarketWatch.sent,1);
    assert.match(m.messages[0],/늦은 추격/);
    assert.match(m.messages[0],/매수신호 아님/);
  }finally{globalThis.fetch=backup;}
});
