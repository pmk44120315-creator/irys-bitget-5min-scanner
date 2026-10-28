import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validDirectionalProof,directionalMessage,sendSpotDirectional,scheduledCore,
  evaluateOutcomeAtHorizon,parseOutcomeCandles,updateSpotOutcomes,
  parseBitgetOutcomeCandles,evaluateFuturesOutcome,updateFuturesOutcomes
} from '../deployment/IRYS_V13_CAUSAL_DIRECTION_OUTCOMES_WORKER.mjs';

const NOW=Date.parse('2026-10-29T00:20:00Z');
const M=60000;
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
const STATE='irys:fast:state:v1';

function proof(direction='UP',at=NOW-60_000){
  const up=direction==='UP',end=Math.floor(at/M)*M;
  const book=(at,old=false)=>({timestamp_ms:at,spread_pct:.10,bid_ask_top5_ratio:up?(old?1.2:1.35):.74});
  const sample=(at,old=false)=>({
    time_ms:at,book:book(at,old),
    buy_share:up?.71:.29,net_buy_krw:up?6_000_000:-6_000_000,
    recent_net_buy_krw:up?2_000_000:-2_000_000,trades:85,
    close:100});
  const net=up?10_000_000:-10_000_000,share=up?.68:.32;
  return {venue:'bithumb',market:'KRW-AAA',direction,observed_ms:at,price_krw:100,
    structure:{status:'PASS',close:100,closed_20m_candles:true,
      up_structure:up,down_structure:!up,price_5m_pct:up?.55:-.55,
      price_15m_pct:up?1.5:-1.5,upper_wick_5m_ratio:.11,lower_wick_5m_ratio:.10},
    taker_flow_15m:{verified:true,start_ms:end-15*M,end_ms:end,marketwide_cvd_verified:false,
      candle_relative_error:0,net_buy_krw:net,buy_share:share,
      blocks:Array.from({length:3},()=>({trades:70,net_buy_krw:net/3,buy_share:share}))},
    flow_snapshots:[sample(at-5*M,true),sample(at)],
    orderbook_absorption_verified:false,other_exchange_identity_verified:false,
    future_direction_accuracy_verified:false};
}
function snapshot(directions=[],early=[]){
  return {collector_status:'PASS',finished_utc:new Date(NOW-20_000).toISOString(),
    stats:{instrument_verified_crypto:455,oi_symbols_failed:0,candle_symbols_failed:0,
       funding_feed_ok:true,bitget_active_usdt_perpetual:860},
    watchlist:[],early_pool:[],
    futures_flow:{status:'EVALUATED',observation_only:true,alert_eligible:false,observations:[]},
    spot_flow:{status:'PASS',markets:489,tickers:489,signals:[],
      observed_utc:new Date(NOW-60_000).toISOString(),
      early_watch_observations:early},
    spot_directional:{status:'EVALUATED',reviewed:directions.length,
      signals:directions,diagnostics:directions.map(p=>({market:p.market,status:'QUALIFIED_VENUE_LOCAL_MULTI_EVIDENCE'}))}};
}
function harness(snap,{warning=false,price=100}={}){
  let state=null;const sent=[],kvWrites=[],urls=[];
  const env={IRYS_KV:{
    get:async()=>state?JSON.stringify(state):null,
    put:async(key,v)=>{kvWrites.push(key);if(key===STATE)state=JSON.parse(v);}
  },TELEGRAM_BOT_TOKEN:'offline-dummy',TELEGRAM_CHAT_ID:'123456789'};
  const fetcher=async (url,opt={})=>{
    const s=String(url);urls.push(s);
    if(s.startsWith(ROOT))return new Response(JSON.stringify(snap),{status:200});
    if(s.includes('/v1/market/all')){
      return new Response(JSON.stringify(Array.from({length:105},(_,i)=>({
        market:i===0?'KRW-AAA':'KRW-T'+i,market_warning:'NONE'}))),{status:200});
    }
    if(s.includes('/v1/market/virtual_asset_warning')){
      return new Response(JSON.stringify(warning?[{market:'KRW-AAA'}]:[]),{status:200});
    }
    if(s.includes('/v1/ticker')){
      return new Response(JSON.stringify([{market:'KRW-AAA',trade_price:price,
         market_state:'ACTIVE',signed_change_rate:.01}]),{status:200});
    }
    if(s.includes('/sendMessage')){
      const payload=JSON.parse(opt.body);sent.push(payload.text);
      return new Response(JSON.stringify({ok:true,result:{message_id:1000+sent.length,
        chat:{id:123456789}}}),{status:200});
    }
    throw Error('Unexpected external URL '+s);
  };
  return {env,sent,urls,kvWrites,fetcher,get:()=>state,set:o=>{state=o;}};
}

test('V13 strictly checks actual 15m CVD, price, real books and two independent taker windows for both sides',()=>{
  for(const direction of ['UP','DOWN']){
    const p=proof(direction);
    assert.equal(validDirectionalProof(p,NOW)?.direction,direction);
    assert.match(directionalMessage({...validDirectionalProof(p,NOW),current_price_krw:100},NOW),
      /실제 15분 체결/);
    const a=structuredClone(p);a.taker_flow_15m.blocks[1].net_buy_krw*=-1;
    assert.equal(validDirectionalProof(a,NOW),null,'One contradictory CVD block must reject');
    const b=structuredClone(p);b.flow_snapshots[0].book.timestamp_ms=b.flow_snapshots[1].book.timestamp_ms;
    assert.equal(validDirectionalProof(b,NOW),null,'Fake duplicate book snapshots must reject');
    const c=structuredClone(p);c.flow_snapshots[1].buy_share=direction==='UP'?.40:.80;
    assert.equal(validDirectionalProof(c,NOW),null,'Last taker contradicts direction');
    const d=structuredClone(p);d.orderbook_absorption_verified=true;
    assert.equal(validDirectionalProof(d,NOW),null,'Never claim absorption from two books');
  }
  assert.equal(validDirectionalProof(proof('UP',NOW-12*M),NOW),null,'Stale source');
});

test('volume-only early spot watch may update diagnostics but NEVER generates Telegram',async()=>{
  const old=globalThis.fetch,early=[{market:'KRW-AAA',price_krw:100,interval_price_change_pct:5}];
  const m=harness(snapshot([],early));
  globalThis.fetch=m.fetcher;
  try{
    const r=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.status,'PASS');
    assert.equal(r.last.earlyMarketWatch.status,'PRICE_TURNOVER_ONLY_INTERNAL_WATCH_NOT_TELEGRAM');
    assert.equal(r.last.earlyMarketWatch.observed,1);
    assert.equal(r.last.earlyMarketWatch.sent,0);
    assert.equal(r.last.spotDirectional.sent,0);
    assert.equal(m.sent.length,0);
    assert.equal(m.urls.filter(x=>x.includes('/sendMessage')).length,0);
    assert.equal(m.kvWrites.filter(x=>x===STATE).length,1);
  }finally{globalThis.fetch=old;}
});

test('qualified direction only sends after live Bithumb warning/ticker check and logs Telegram API receipt',async()=>{
  const old=globalThis.fetch,m=harness(snapshot([proof()]));
  globalThis.fetch=m.fetcher;
  try{
    const r=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.spotDirectional.sent,1,JSON.stringify(r.last.spotDirectional));
    assert.equal(r.last.earlyMarketWatch.sent,0);
    assert.equal(m.sent.length,1);
    assert.match(m.sent[0],/상승 우위/);
    assert.equal(r.last.telegramApiAckedThisRun,1);
    assert.equal(m.get().spotOutcomesV13.length,1);
    assert.equal(m.get().spotOutcomesV13[0].alert_price_krw,100);
    assert.equal(m.get().spotOutcomesV13[0].direction,'UP');
    assert.equal(m.kvWrites.filter(x=>x===STATE).length,1);
    // second run with independent evidence but not after cooldown: no duplicate
    const second=await scheduledCore(m.env,NOW+5*M,{status:'ACCEPTED',error:null});
    assert.equal(second.last.spotDirectional.sent,0);
    assert.equal(m.sent.length,1);
  }finally{globalThis.fetch=old;}
});

test('live official warning prevents even perfect historical multi-evidence',async()=>{
  const old=globalThis.fetch,m=harness(snapshot([proof()]),{warning:true});
  globalThis.fetch=m.fetcher;
  try{
    const r=await scheduledCore(m.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.spotDirectional.official_risk_passed,0);
    assert.equal(r.last.spotDirectional.sent,0);
    assert.equal(m.sent.length,0);
  }finally{globalThis.fetch=old;}
});

test('post-alert 5, 15, 30, 60m directional score is strictly future closed candles',()=>{
  const at=NOW+25_000,now=NOW+62*M;
  const raw=Array.from({length:74},(_,i)=>{
    const t=NOW+(i-5)*M;
    const price=100+(i-5)*.08;
    return {candle_date_time_utc:new Date(t).toISOString().slice(0,19),
      trade_price:price,high_price:price+.1,low_price:price-.1};
  });
  const rows=parseOutcomeCandles(raw,now);
  const item={market:'KRW-AAA',alert_ms:at,alert_price_krw:100,direction:'UP'};
  assert.equal(evaluateOutcomeAtHorizon(item,60,NOW+5*M,rows),null,'Future results unavailable before horizon');
  for(const mins of [5,15,30,60]){
    const result=evaluateOutcomeAtHorizon(item,mins,now,rows);
    assert.equal(result.status,'CLOSED_1M_PRICE_VERIFIED');
    assert.equal(result.direction_right,true);
    assert.ok(result.return_pct>0);
    assert.ok(result.excursion_full_coverage);
  }
  assert.equal(evaluateOutcomeAtHorizon(item,60,now,new Map()),null,'Missing candle must be unknown');
});

test('Bitget futures outcome uses first post-alert CLOSED 1m baseline, not old pre-alert snapshot',async()=>{
  const at=NOW+25_000,now=NOW+62*M;
  const raw=Array.from({length:73},(_,i)=>{
    const t=NOW+(i-3)*M;
    const p=1.0+(i-3)*.0004;
    return [String(t),String(p-.0001),String(p+.0001),String(p-.0002),
      String(p),'100','100'];
  });
  const rows=parseBitgetOutcomeCandles({code:'00000',data:raw},now);
  assert.equal(parseBitgetOutcomeCandles({code:'50000',data:raw},now).size,0);
  const record={market:'ABCUSDT',alert_ms:at,direction:'UP',
    first_postalert_close_usdt:rows.get(NOW).close,results:{}};
  assert.equal(evaluateFuturesOutcome(record,60,NOW+M,rows),null);
  for(const min of [5,15,30,60]){
    const result=evaluateFuturesOutcome(record,min,now,rows);
    assert.equal(result.status,'CLOSED_1M_PRICE_VERIFIED');
    assert.equal(result.direction_right,true);
    assert.equal(result.source,'BITGET_OFFICIAL_CLOSED_1M_HISTORY');
    assert.equal(result.baseline_is_first_postalert_minute,true);
  }
  // State transitions in an independent offline HTTP-mocked scan.
  const state={version:1,prevAt:0,lastAlert:{},
    futuresOutcomesV13:[{market:'ABCUSDT',direction:'UP',
      original_direction:'LONG',alert_ms:at,first_postalert_close_usdt:null,
      prealert_snapshot_price_usdt:.5,results:{},followup_sent:false}]};
  const gets=[];
  const env={TELEGRAM_BOT_TOKEN:'offline-only',TELEGRAM_CHAT_ID:'123456789',
    IRYS_KV:{put:async()=>{}}};
  const saved=globalThis.fetch;
  globalThis.fetch=async(url,opts={})=>{
    const s=String(url);gets.push(s);
    if(s.includes('/api/v2/mix/market/history-candles')){
      assert.match(s,/symbol=ABCUSDT/);
      return new Response(JSON.stringify({code:'00000',data:raw}),{status:200});
    }
    if(s.includes('/sendMessage'))
      return new Response(JSON.stringify({ok:true,result:{message_id:765,
        chat:{id:123456789}}}),{status:200});
    throw Error('unplanned '+s);
  };
  try{
    const out=await updateFuturesOutcomes(env,state,now);
    assert.equal(out.updated,4);
    assert.equal(out.followups_sent,1);
    assert.equal(state.futuresOutcomesV13[0].followup_sent,true);
    assert.equal(state.futuresOutcomesV13[0].first_postalert_close_usdt,rows.get(NOW).close);
    assert.equal(state.futuresOutcomesV13[0].results['60m'].direction_right,true);
    assert.ok(gets.some(s=>s.includes('/sendMessage')));
  }finally{globalThis.fetch=saved;}
});

test('Blocked Bitget public price API records UNVERIFIED, never fabricates directional outcome',async()=>{
  const now=NOW+60*M;
  const state={futuresOutcomesV13:[{market:'ABCUSDT',direction:'DOWN',
    original_direction:'SHORT',alert_ms:NOW-1000,results:{},
    first_postalert_close_usdt:null,followup_sent:false}]};
  const backup=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('EGRESS_UNAVAILABLE');};
  try{
    const out=await updateFuturesOutcomes({},state,now);
    assert.equal(out.api_not_confirmed,1);
    assert.equal(out.updated,0);
    assert.equal(out.followups_sent,0);
    assert.deepEqual(state.futuresOutcomesV13[0].results,{});
  }finally{globalThis.fetch=backup;}
});
