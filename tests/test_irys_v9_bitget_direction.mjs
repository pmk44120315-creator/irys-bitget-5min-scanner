import test from 'node:test';
import assert from 'node:assert/strict';
import {bitgetTickEvidence,accumulateBitgetProof,scheduledCore} from '../deployment/IRYS_V9_SPOT_BITGET_DUAL_WORKER.mjs';
const START=Date.parse('2026-10-28T05:00:00Z'),STEP=300000;
function future(i,side='LONG'){
 const finished=START+i*STEP,up=side==='LONG',close=up?100+i*.35:100-i*.35;
 const op=up?close/1.0055:close/0.9945,hi=up?close*1.002:op*1.001,
   lo=up?op*.998:close*.998;
 const qhi=up?close*1.004:close*1.03, qlo=up?close*.97:close*.996;
 return {
  venue:'bitget',symbol:'TESTUSDT',baseCoin:'TEST',quoteCoin:'USDT',
  contract_status:'normal',symbolType:'perpetual',asset_identity:'VERIFIED_CRYPTO',isRwa:'NO',
  funding_rate:.00005,
  windows:{
    '1m':{coverage:1,price_change_pct:up?.3:-.3},
    '5m':{coverage:1,baseline_coverage:1,close,open:op,high:hi,low:lo,
      upper_wick_ratio:up?.12:.2,price_change_pct:up?.55:-.55,
      quote_turnover:50000,prior_adjacent_quote_turnover:22000},
    '15m':{coverage:1,baseline_coverage:1,close,high:qhi,low:qlo,
      upper_wick_ratio:.16,price_change_pct:up?1.25:-1.25,quote_turnover:180000},
    '60m':{coverage:1,price_change_pct:up?2:-2}
  },
  oi:{status:'OK',change_pct_from_previous_run:.25,elapsed_min_since_previous_snapshot:5,
      timestamp_ms:finished-15000,size_raw:800000},
  recent_trades_sample:{venue:'bitget',total_trades_sampled:90,
    buy_taker_quote:up?16000:6000,sell_taker_quote:up?6000:16000,
    oldest_trade_timestamp_ms:finished-110000,
    newest_trade_timestamp_ms:finished-15000}
 };
}
function snap(i,side='LONG',status='PASS'){
 const finished=START+i*STEP;
 return {snap:{collector_status:'PASS',finished_utc:new Date(finished).toISOString(),
     stats:{instrument_verified_crypto:465,oi_symbols_failed:0,candle_symbols_failed:0,
       funding_feed_ok:true,bitget_active_usdt_perpetual:860},
     watchlist:[future(i,side)],early_pool:[],
     spot_flow:{status,observed_utc:new Date(finished-10000).toISOString(),
       markets:489,tickers:489,signals:[]}},finished};
}
test('FOUR distinct 5m Bitget LONG snapshots produce one non-CVD direction observation',()=>{
 const state={};for(let i=0;i<4;i++){
  const result=accumulateBitgetProof(state,snap(i),START+i*STEP+70000);
  assert.equal(result.confirmed,i===3?1:0,'step '+i);
  if(i===3)assert.deepEqual(
    [result.signals[0].direction,result.signals[0].checks,
     result.signals[0].full_futures_cvd_verified],
    ['LONG',4,false]);
 }
 assert.equal(accumulateBitgetProof(state,snap(3),START+3*STEP+70000).confirmed,0);
});
test('FOUR distinct 5m Bitget SHORT snapshots can produce non-CVD short observation',()=>{
 const state={};for(let i=0;i<4;i++){
  const result=accumulateBitgetProof(state,snap(i,'SHORT'),START+i*STEP+70000);
  assert.equal(result.confirmed,i===3?1:0);
  if(i===3)assert.equal(result.signals[0].direction,'SHORT');
 }
});
test('stock, ETF, unverified crypto and missing data remain excluded',()=>{
 for(const change of [
   x=>x.isRwa='YES',
   x=>x.asset_identity='INSTRUMENT_UNKNOWN',
   x=>x.contract_status='suspended',
   x=>x.quoteCoin='USD',
   x=>x.windows['5m'].coverage=.8,
   x=>x.windows['5m'].quote_turnover=2000,
   x=>x.windows['5m'].prior_adjacent_quote_turnover=0,
   x=>x.recent_trades_sample.buy_taker_quote=0,
   x=>x.recent_trades_sample.newest_trade_timestamp_ms-=240000,
   x=>x.recent_trades_sample.oldest_trade_timestamp_ms=x.recent_trades_sample.newest_trade_timestamp_ms,
   x=>x.oi.change_pct_from_previous_run=-1,
   x=>x.funding_rate=.006,
   x=>x.windows['5m'].price_change_pct=5,
   x=>x.windows['15m'].price_change_pct=-1
 ]){
   const x=future(0);change(x);
   assert.equal(bitgetTickEvidence(x,START,START+70000),null);
 }
});
test('missing intermediate cycle, repeated overlapping 100-fill samples and direction flip reset chain',()=>{
 for(const mutate of [
   x=>{x.finished+=STEP;x.snap.finished_utc=new Date(x.finished).toISOString()},
   x=>{x.snap.watchlist[0].recent_trades_sample.oldest_trade_timestamp_ms=START-15000},
   x=>{x.snap.watchlist[0]=future(1,'SHORT')}
 ]){
   const state={};
   accumulateBitgetProof(state,snap(0),START+70000);
   const z=snap(1);mutate(z);
   assert.equal(accumulateBitgetProof(state,z,z.finished+70000).confirmed,0);
   assert.equal(state.bitgetFlowHistory.TESTUSDT.history.length,1);
 }
});
test('OI fails and flat or faded aggressive trade samples cannot trigger',()=>{
 const scenarios=[
  x=>{x.oi.change_pct_from_previous_run=-.1;},
  x=>{x.recent_trades_sample.buy_taker_quote=9000;
      x.recent_trades_sample.sell_taker_quote=9000;},
  x=>{x.windows['5m'].price_change_pct=-.2;},
  x=>{x.windows['15m'].price_change_pct=10;},
 ];
 for(const change of scenarios){
  const state={};
  for(let i=0;i<4;i++){const x=snap(i);change(x.snap.watchlist[0]);accumulateBitgetProof(state,x,x.finished+70000);}
  assert.equal((state.bitgetFlowHistory.TESTUSDT?.history||[]).length<4,true);
 }
});
test('actual scheduledCore sends Bitget independently even if Bithumb status PARTIAL; no AI calls',async()=>{
 const oldFetch=globalThis.fetch;
 let persisted=null,calls=0,telegram=0,seenUrl=[];
 const env={
  IRYS_KV:{get:async()=>persisted?JSON.stringify(persisted):null,
    put:async(_key,val)=>{persisted=JSON.parse(val);}},
  TELEGRAM_BOT_TOKEN:'test-not-real',TELEGRAM_CHAT_ID:'12345678',
  AI:{run:async()=>{calls++;return {response:'{"decisions":[]}'};}}
 };
 try {
  for(let i=0;i<4;i++){
   const row=snap(i,'LONG','PARTIAL');
   globalThis.fetch=async(u)=>{
    const url=String(u);seenUrl.push(url);
    if(url.includes('/sendMessage')){telegram++;return new Response(JSON.stringify({ok:true,result:{message_id:987}}),{status:200});}
    if(url.includes('raw.githubusercontent.com'))return new Response(JSON.stringify(row.snap),{status:200});
    throw Error('Unexpected request '+url);
   };
   const result=await scheduledCore(env,row.finished+70000,{status:'ACCEPTED',error:null});
   assert.equal(result.last.status,'PARTIAL');
   assert.equal(result.last.futuresDirection.sent,i===3?1:0);
   assert.equal(result.last.futuresDirection.status,i===3?'FUTURES_DIRECTIONAL_SAMPLE_PROOF':'WAIT_FUTURES_4_INDEPENDENT_CHECKS');
 }
 assert.equal(calls,0);assert.equal(telegram,1);
 assert.equal(seenUrl.some(x=>x.includes('api.bitget.com')),false,'Cloudflare-to-Bitget 403 route must not be used');
 assert.equal(seenUrl.some(x=>x.includes('api.bithumb.com')),false,'PARTIAL Bithumb cannot block futures');
 }finally{globalThis.fetch=oldFetch;}
});
