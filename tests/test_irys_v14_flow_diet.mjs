// Isolated NO DEPLOY regression: remove previously failed arbitrary
// filter thresholds, but never permit unverified direction or fake orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import {futuresSnapshotProof,evaluateFutures,scheduledCore}
  from '../deployment/IRYS_V14_NATIVE_MARKET_EVIDENCE_WORKER.mjs';

const M=60_000, END=Date.parse('2026-10-29T12:00:00Z'), NOW=END+M;
function setup(side='LONG'){
  const up=side==='LONG',symbol='TESTUSDT';
  const book=(time,old)=>({timestamp_ms:time,spread_pct:.12,
    bid_ask_top5_ratio:up?(old?1.2:1.3):(old?.8:.7),
    continuous_absorption_verified:false});
  const five=up?{open:100,close:100.6,high:100.8,low:99.9,price_change_pct:.6}:
    {open:100,close:99.4,high:100.1,low:99.2,price_change_pct:-.6};
  const fifteen=up?{open:99.4,close:100.6,high:100.85,low:99.3,price_change_pct:1.2072}:
    {open:100.6,close:99.4,high:100.7,low:99.1,price_change_pct:-1.1928};
  const contract={
    venue:'bitget',symbol,asset_identity:'VERIFIED_CRYPTO',isRwa:'NO',
    contract_status:'normal',symbolType:'perpetual',quoteCoin:'USDT',
    funding_rate:.0015,
    oi:{status:'OK',timestamp_ms:END-M,elapsed_min_since_previous_snapshot:5,
      change_pct_from_previous_run:-.45},
    windows:{
      '5m':{...five,coverage:1,baseline_coverage:1,quote_turnover:17_000},
      '15m':{...fifteen,coverage:1,baseline_coverage:1,quote_turnover:51_000},
      '60m':{coverage:1,price_change_pct:up?8:-8}
    }
  };
  const blocks=Array.from({length:3},()=>({
    buy_usdt:up?12_000:5_000,sell_usdt:up?5_000:12_000,
    net_buy_usdt:up?7_000:-7_000,buy_share:up?12/17:5/17,trades:60
  }));
  const observation={
    symbol,observed_ms:END,observation_only:true,send_allowed:false,
    position_direction_verified:false,
    flow_class:up?'SUSTAINED_FUTURES_TAKER_BUY_PRESSURE':'SUSTAINED_FUTURES_TAKER_SELL_PRESSURE',
    book_proof_v13:{status:'TWO_DISTINCT_BOOK_SNAPSHOTS',position_owner_verified:false,
      continuous_absorption_verified:false,
      snapshots:[book(END-5*M,true),book(END-M,false)]},
    taker_flow_15m:{
      verified:true,observation_only:true,
      full_exchange_local_public_taker_flow_verified:true,
      marketwide_all_exchanges_cvd_verified:false,
      position_owner_long_short_verified:false,
      continuous_orderbook_absorption_verified:false,
      completeness:'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED',
      venue:'bitget',category:'USDT-FUTURES',symbol,
      closed_candles:15,pages:1,unique_trades:180,
      start_ms:END-15*M,end_ms:END,candle_relative_error:0,
      taker_turnover_usdt:51_000,candle_turnover_usdt:51_000,
      net_buy_usdt:up?21_000:-21_000,buy_share:up?12/17:5/17,blocks
    }
  };
  return {collector_status:'PASS',finished_utc:new Date(NOW-10_000).toISOString(),
    stats:{instrument_verified_crypto:466,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:866},
    spot_flow:{status:'PASS',observed_utc:new Date(NOW-10_000).toISOString(),
      markets:489,tickers:489,signals:[],early_watch_observations:[]},
    watchlist:[contract],early_pool:[],
    futures_flow:{status:'EVALUATED',observation_only:true,alert_eligible:false,
      observations:[observation]}}
}
test('two REAL-timestamp books plus reconciled 15m fills suffice; negative OI does not assert short owners',()=>{
  for(const side of ['LONG','SHORT']){
    const snap=setup(side);
    const p=futuresSnapshotProof(snap,snap.futures_flow.observations[0],NOW);
    assert.ok(p,'No mandatory extra OI-positive or repeated full-window condition');
    assert.equal(p.direction,side);
    assert.equal(p.oi_delta_pct,-.45);
    const result=evaluateFutures({},snap,NOW);
    assert.equal(result.confirmed,1);
    assert.equal(result.signals[0].direction,side);
    assert.equal(result.signals[0].direction_accuracy_verified,false);
    assert.equal(result.signals[0].position_owners_verified,false);
    assert.equal(result.signals[0].book_snapshots,2);
    // Identical 15m source must not create a second signal.
    const state={};
    assert.equal(evaluateFutures(state,snap,NOW).confirmed,1);
    assert.equal(evaluateFutures(state,snap,NOW).confirmed,0);
  }
});
test('price contrary, fake books, missing fills and noncrypto never become signals',()=>{
  const edits=[
    x=>x.futures_flow.observations[0].book_proof_v13.snapshots[1].timestamp_ms=END-5*M,
    x=>x.futures_flow.observations[0].taker_flow_15m.candle_relative_error=.2,
    x=>x.futures_flow.observations[0].taker_flow_15m.verified=false,
    x=>x.watchlist[0].asset_identity='UNVERIFIED',
    x=>x.watchlist[0].windows['5m'].price_change_pct=-.3,
    x=>x.futures_flow.observations[0].taker_flow_15m.blocks[2].net_buy_usdt=-100
  ];
  for(const edit of edits){
    const snap=setup();edit(snap);
    const p=futuresSnapshotProof(snap,snap.futures_flow.observations[0],NOW);
    assert.equal(p,null,'Contradictory or unverified real evidence must not alert');
    assert.equal(evaluateFutures({},snap,NOW).confirmed,0);
  }
});
test('offline simulated Telegram only receives verified LONG and preserves receipt semantics',async()=>{
  const snap=setup('LONG');const saved=globalThis.fetch;
  const sent=[];let state=null;
  const env={IRYS_KV:{
    get:async()=>state?JSON.stringify(state):null,
    put:async(k,v)=>{if(k==='irys:fast:state:v1')state=JSON.parse(v);}
  },TELEGRAM_BOT_TOKEN:'OFFLINE_FAKE_TOKEN',TELEGRAM_CHAT_ID:'123456789'};
  globalThis.fetch=async(url,opts={})=>{
    const s=String(url);
    if(s.startsWith('https://raw.githubusercontent.com/'))
      return new Response(JSON.stringify(snap),{status:200});
    if(s.includes('/sendMessage')){
      sent.push(JSON.parse(opts.body).text);
      return new Response(JSON.stringify({ok:true,result:{message_id:987,chat:{id:123456789}}}),{status:200});
    }
    throw Error('UNEXPECTED_API_CALL '+s);
  };
  try{
    const result=await scheduledCore(env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(result.last.status,'PASS');
    assert.equal(result.last.futuresDirection.sent,1);
    assert.equal(result.last.spotDirectional.sent,0);
    assert.equal(sent.length,1);
    assert.match(sent[0],/비트겟 선물 롱 수급 우위/);
    assert.equal(state.deliveryReceiptsV12.at(-1).telegram_message_id,987);
    assert.equal(state.futuresOutcomesV13.length,1);
    assert.equal(state.futuresOutcomesV13[0].original_direction,'LONG');
  }finally{globalThis.fetch=saved;}
});
