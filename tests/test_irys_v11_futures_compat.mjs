import test from 'node:test';
import assert from 'node:assert/strict';
import {futuresSnapshotProof,evaluateFutures,futuresMessage,scheduledCore} from '../deployment/IRYS_V11_SPOT_FUTURES_EARLY_WATCH_WORKER.mjs';
const T=Date.parse('2026-10-28T07:00:00Z');
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
function sample(i,side='LONG',spot='PASS'){
  const finished=T+i*300000;
  const end=finished-60000,price=side==='LONG'?100+i*.3:100-i*.3;
  const long=side==='LONG';
  const blocks=[0,1,2].map(()=>long?
    {trades:120,buy_usdt:13000,sell_usdt:3000,net_buy_usdt:10000,buy_share:.8125}:
    {trades:120,buy_usdt:3000,sell_usdt:13000,net_buy_usdt:-10000,buy_share:.1875});
  const oi={status:'OK',change_pct_from_previous_run:.15,
    elapsed_min_since_previous_snapshot:5,timestamp_ms:finished-25000,size_raw:78000};
  const high=long?price*1.001:price*1.012,low=long?price*.988:price*.999;
  const f={coverage:1,baseline_coverage:1,quote_turnover:15500,price_change_pct:long?.42:-.42,
    open:long?price*.995:price*1.005,close:price,high,low,upper_wick_ratio:.14};
  const q={coverage:1,baseline_coverage:1,quote_turnover:51000,price_change_pct:long?1.15:-1.15,
    open:long?price*.985:price*1.015,close:price,high:long?price*1.004:price*1.017,
    low:long?price*.983:price*.996,upper_wick_ratio:.1};
  const contract={venue:'bitget',symbol:'TESTUSDT',symbolType:'perpetual',quoteCoin:'USDT',
    asset_identity:'VERIFIED_CRYPTO',isRwa:'NO',contract_status:'normal',funding_rate:.00003,
    oi,windows:{'5m':f,'15m':q,'60m':{coverage:1,price_change_pct:long?2:-2}}};
  const evidence={verified:true,observation_only:true,
    full_exchange_local_public_taker_flow_verified:true,
    marketwide_all_exchanges_cvd_verified:false,
    position_owner_long_short_verified:false,continuous_orderbook_absorption_verified:false,
    completeness:'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED',
    venue:'bitget',category:'USDT-FUTURES',symbol:'TESTUSDT',closed_candles:15,
    pages:2,unique_trades:360,start_ms:end-900000,end_ms:end,
    taker_turnover_usdt:48000,candle_turnover_usdt:48000,
    candle_relative_error:0,net_buy_usdt:long?30000:-30000,
    buy_share:long?.8125:.1875,blocks};
  const observation={symbol:'TESTUSDT',observed_ms:end,
    flow_class:long?'SUSTAINED_FUTURES_TAKER_BUY_PRESSURE':'SUSTAINED_FUTURES_TAKER_SELL_PRESSURE',
    taker_flow_15m:evidence,send_allowed:false,observation_only:true,
    position_direction_verified:false};
  const snap={
    collector_status:'PASS',finished_utc:new Date(finished).toISOString(),
    stats:{instrument_verified_crypto:465,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:861},
    watchlist:[contract],early_pool:[],
    futures_flow:{status:'EVALUATED',observation_only:true,alert_eligible:false,
      observations:[observation]},
    spot_flow:{status:spot,observed_utc:new Date(finished).toISOString(),markets:489,
      tickers:489,details_checked:0,signals:[]}
  };
  return {snap,contract,observation,asof:finished+30000};
}
test('actual verified 15m sell/buy + price/OI yields one proof ONLY after independent next snapshot',()=>{
  for(const side of ['LONG','SHORT']){
    const state={};
    const a=sample(0,side),b=sample(1,side);
    assert.equal(futuresSnapshotProof(a.snap,a.observation,a.asof)?.direction,side);
    assert.equal(evaluateFutures(state,a.snap,a.asof).signals.length,0);
    const r=evaluateFutures(state,b.snap,b.asof);
    assert.equal(r.signals.length,1);
    assert.equal(r.signals[0].direction,side);
    assert.equal(r.signals[0].direction_accuracy_verified,false);
    assert.equal(evaluateFutures(state,b.snap,b.asof).signals.length,0);
    assert.match(futuresMessage(r.signals[0],b.asof),/미확인/);
  }
});
test('old 2m/100-trade samples or incomplete CVD cannot become directional Telegram evidence',()=>{
  const broken=[
    o=>o.taker_flow_15m.verified=false,
    o=>o.taker_flow_15m.completeness='100_RECENT_SAMPLE',
    o=>o.taker_flow_15m.candle_relative_error=.02,
    o=>o.taker_flow_15m.closed_candles=14,
    o=>o.taker_flow_15m.unique_trades=10,
    o=>o.taker_flow_15m.pages=25,
    o=>o.taker_flow_15m.blocks[2].net_buy_usdt=-4000,
    o=>o.taker_flow_15m.blocks[1].buy_share=.40,
    o=>o.taker_flow_15m.taker_turnover_usdt=2500,
    o=>o.position_direction_verified=true,
    o=>o.send_allowed=true,
    o=>o.observed_ms-=300000
  ];
  for(const change of broken){
    const a=sample(0);change(a.observation);
    assert.equal(futuresSnapshotProof(a.snap,a.observation,a.asof),null,'case '+broken.indexOf(change));
  }
});
test('RWA stocks, ambiguous crypto, warning contract, stale OI and late chase all blocked',()=>{
  const tests=[
    a=>a.contract.isRwa='YES',
    a=>a.contract.asset_identity='UNVERIFIED',
    a=>a.contract.contract_status='suspended',
    a=>a.contract.quoteCoin='USD',
    a=>a.contract.oi.change_pct_from_previous_run=-.3,
    a=>a.contract.oi.timestamp_ms-=18*60000,
    a=>a.contract.windows['5m'].coverage=.8,
    a=>a.contract.windows['15m'].price_change_pct=9,
    a=>a.contract.windows['60m'].price_change_pct=15,
    a=>a.contract.windows['5m'].price_change_pct=2.6,
    a=>a.contract.funding_rate=.009
  ];
  for(const bad of tests){
    const a=sample(0);bad(a);
    assert.equal(futuresSnapshotProof(a.snap,a.observation,a.asof),null);
  }
});
test('different direction, gaps, stale repeats and non-confirmed OI never generate signal',()=>{
  {
    const a=sample(0),b=sample(1,'SHORT'),state={};
    evaluateFutures(state,a.snap,a.asof);
    assert.equal(evaluateFutures(state,b.snap,b.asof).confirmed,0);
  }
  {
    const a=sample(0),b=sample(2),state={};
    evaluateFutures(state,a.snap,a.asof);
    assert.equal(evaluateFutures(state,b.snap,b.asof).confirmed,0);
  }
  {
    const a=sample(0),b=sample(1),state={};
    evaluateFutures(state,a.snap,a.asof);
    b.contract.oi.change_pct_from_previous_run=0;
    assert.equal(evaluateFutures(state,b.snap,b.asof).confirmed,0);
  }
});
test('scheduled pipeline sends exactly one LONG via mocked Telegram even if Bithumb spot PARTIAL',async()=>{
  const saved=globalThis.fetch;
  let stored=null,telegram=0,aiCalls=0,requests=[],payloads=[];
  const env={
    IRYS_KV:{get:async()=>stored===null?null:JSON.stringify(stored),
      put:async(_,v)=>{stored=JSON.parse(v);}},
    TELEGRAM_BOT_TOKEN:'not-a-real-token',TELEGRAM_CHAT_ID:'123456789',
    AI:{run:async()=>{aiCalls++;throw Error('AI should not run without spot evidence');}}
  };
  try{
    for(let i=0;i<2;i++){
      const sampleData=sample(i,'LONG','PARTIAL');
      globalThis.fetch=async (url,options)=>{
        const s=String(url);requests.push(s);
        if(s.startsWith(ROOT))return new Response(JSON.stringify(sampleData.snap),{status:200});
        if(s.includes('/sendMessage')){
          telegram++;
          payloads.push(JSON.parse(options.body));
          return new Response(JSON.stringify({ok:true,result:{message_id:515}}),{status:200});
        }
        throw Error('unexpected external request '+s);
      };
      const result=await scheduledCore(env,sampleData.asof,{status:'ACCEPTED',error:null});
      assert.equal(result.last.status,'PARTIAL');
      assert.equal(result.last.futuresDirection.sent,i===1?1:0);
      assert.equal(result.last.sent,0,'unchanged Bithumb spot transport');
    }
    assert.equal(telegram,1);
    assert.equal(aiCalls,0);
    assert.match(payloads[0].text,/롱 수급 우위/);
    assert.equal(requests.some(s=>s.includes('api.bitget.com')),false,
      'cloudflare must not use direct Bitget blocked REST');
    assert.equal(requests.some(s=>s.includes('api.bithumb.com')),false);
  }finally{globalThis.fetch=saved;}
});
test('worker cannot send on GitHub dispatch failure or stale futures data',async()=>{
  const orig=globalThis.fetch;
  let state=null,calls=0;
  const env={IRYS_KV:{get:async()=>state?JSON.stringify(state):null,
     put:async(_,v)=>{state=JSON.parse(v);}},
     TELEGRAM_BOT_TOKEN:'offline',TELEGRAM_CHAT_ID:'123456789'};
  try{
    for(let i=0;i<2;i++){
      const x=sample(i,'LONG');
      globalThis.fetch=async u=>{
        if(String(u).startsWith(ROOT))return new Response(JSON.stringify(x.snap),{status:200});
        calls++;
        throw Error('No Telegram on dispatch failure');
      };
      await assert.rejects(
        ()=>scheduledCore(env,x.asof,{status:'FAILED',error:'NO_PERMISSION'}),
        /GITHUB_DISPATCH_NOT_ACCEPTED/);
      assert.equal(state.last.futuresDirection.sent,0);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=orig;}
});
