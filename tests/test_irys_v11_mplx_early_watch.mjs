import test from 'node:test';
import assert from 'node:assert/strict';
import {
  earlyCandidateProof,earlyMessage,sendEarlyWatch,scheduledCore
} from '../deployment/IRYS_V11_SPOT_FUTURES_EARLY_WATCH_WORKER.mjs';

const NOW=Date.parse('2026-10-28T08:10:00Z');
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
function watch(overrides={}){
  return {market:'KRW-MPLX',price_krw:68.01,interval_minutes:4.91,
    interval_price_change_pct:3.061,five_minute_equivalent_turnover_krw:34173381,
    five_minute_prior_ema_krw:56384,turnover_ratio_prior_ema:606.08,
    day_price_change_pct:4.1,risk_class:'EARLY_MOMENTUM_WATCH',
    official_warning_checked:true,risk_status:'NO_OFFICIAL_WARNING_AT_COLLECTION',
    observation_only:true,is_buy_signal:false,order_allowed:false,
    notify_observation_eligible:true,
    source:'Bithumb public KRW ticker/market/official-warning snapshots',
    ...overrides};
}
function marketSnapshot(observations=[watch()],now=NOW){
  return {
    collector_status:'PASS',finished_utc:new Date(now-60000).toISOString(),
    stats:{instrument_verified_crypto:465,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:861},
    watchlist:[],early_pool:[],
    futures_flow:{status:'EVALUATED',alert_eligible:false,
      observation_only:true,observations:[]},
    spot_flow:{status:'PASS',observed_utc:new Date(now-60000).toISOString(),
      markets:489,tickers:489,signals:[],early_watch_observations:observations}
  };
}
function marketFeeds(snap,opts={}){
  const {warning=false,price=70,status='ok'}=opts;
  const requests=[],telegram=[];
  const fetcher=async(input,request={})=>{
    const url=String(input);
    requests.push(url);
    if(url.startsWith(ROOT))return new Response(JSON.stringify(snap),{status:200});
    if(url.includes('api.bithumb.com/v1/market/all')){
      if(status==='fail')throw Error('PUBLIC_BITHUMB_OFFLINE');
      return new Response(JSON.stringify([{market:'KRW-MPLX',market_warning:'NONE'},
        ...Array.from({length:105},(_,i)=>({market:'KRW-T'+i,market_warning:'NONE'}))]),{status:200});
    }
    if(url.includes('api.bithumb.com/v1/market/virtual_asset_warning'))
      return new Response(JSON.stringify(warning?[{market:'KRW-MPLX'}]:[]),{status:200});
    if(url.includes('api.bithumb.com/v1/ticker'))
      return new Response(JSON.stringify([{market:'KRW-MPLX',trade_price:price,
        market_state:'ACTIVE',signed_change_rate:.04}]),{status:200});
    if(url.includes('/sendMessage')){
      telegram.push(JSON.parse(request.body));
      return new Response(JSON.stringify({ok:true,result:{message_id:12345}}),{status:200});
    }
    throw Error('Unplanned HTTP '+url);
  };
  return {fetcher,requests,telegram};
}
function mockEnv(){
  let state=null;
  return {
    env:{IRYS_KV:{get:async()=>state?JSON.stringify(state):null,
      put:async(_,v)=>{state=JSON.parse(v);}},
      TELEGRAM_BOT_TOKEN:'mock-unusable-not-live',TELEGRAM_CHAT_ID:'123456789'},
    getState:()=>state,
    setState:v=>{state=v;}
  };
}
test('actual MPLX first 17:08 quote+price change qualifies only as observation not a BUY',()=>{
  const q=earlyCandidateProof(watch(),NOW,NOW-60000);
  assert.equal(q.market,'KRW-MPLX');
  assert.equal(q.pct,3.061);
  assert.match(earlyMessage({...q,current_price_krw:70},NOW),/매수신호 아님/);
  assert.match(earlyMessage({...q,current_price_krw:70},NOW),/5분 환산 추정/);
  assert.doesNotMatch(earlyMessage({...q,current_price_krw:70},NOW),/매수 확정/);
});
test('unsafe/old/warning/unverified or wrong quote evidence is rejected without network',()=>{
  const changes=[
    o=>{o.is_buy_signal=true;},o=>{o.order_allowed=true;},
    o=>{o.notify_observation_eligible=false;},
    o=>{o.official_warning_checked=false;},o=>{o.risk_status='OFFICIAL_WARNING';},
    o=>{o.interval_minutes=1.4;},o=>{o.interval_minutes=10;},
    o=>{o.interval_price_change_pct=.6;},
    o=>{o.five_minute_equivalent_turnover_krw=1_000_000;},
    o=>{o.turnover_ratio_prior_ema=1.1;},
    o=>{o.source='untrusted';}
  ];
  for(const c of changes){
    const w=watch();c(w);
    assert.equal(earlyCandidateProof(w,NOW,NOW-60000),null);
  }
  assert.equal(earlyCandidateProof(watch(),NOW,NOW-11*60000),null);
});
test('V11 scheduled sends one early watch and no verified spot BUY, then cooldown suppresses duplicates',async()=>{
  const orig=globalThis.fetch,env=mockEnv();
  try{
    const a=marketFeeds(marketSnapshot(),{price:70});
    globalThis.fetch=a.fetcher;
    const result=await scheduledCore(env.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(result.last.status,'PASS');
    assert.equal(result.last.earlyMarketWatch.sent,1);
    assert.equal(result.last.sent,0);
    assert.equal(result.last.futuresDirection.sent,0);
    assert.equal(a.telegram.length,1);
    assert.match(a.telegram[0].text,/KRW-MPLX/);
    assert.match(a.telegram[0].text,/매수신호 아님/);
    assert.ok(!a.requests.some(x=>x.includes('api.bitget.com')));
    const next=NOW+300000;
    const b=marketFeeds(marketSnapshot([watch()],next),{price:70});
    globalThis.fetch=b.fetcher;
    const r=await scheduledCore(env.env,next,{status:'ACCEPTED',error:null});
    assert.equal(r.last.earlyMarketWatch.sent,0);
    assert.equal(r.last.earlyMarketWatch.blocked_cooldown,1);
    assert.equal(b.telegram.length,0);
  }finally{globalThis.fetch=orig;}
});
test('official warning at send time overrides old collection and prevents messages',async()=>{
  const old=globalThis.fetch,env=mockEnv();
  try{
    const api=marketFeeds(marketSnapshot(),{warning:true});
    globalThis.fetch=api.fetcher;
    const r=await scheduledCore(env.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.earlyMarketWatch.status,'EARLY_RISK_BLOCKED');
    assert.equal(r.last.earlyMarketWatch.sent,0);
    assert.equal(api.telegram.length,0);
  }finally{globalThis.fetch=old;}
});
test('Bithumb API outage suppresses message without inventing market risk clearance',async()=>{
  const old=globalThis.fetch,env=mockEnv();
  try{
    const api=marketFeeds(marketSnapshot(),{status:'fail'});
    globalThis.fetch=api.fetcher;
    const r=await scheduledCore(env.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.earlyMarketWatch.status,'EARLY_RISK_CHECK_UNAVAILABLE');
    assert.equal(r.last.earlyMarketWatch.sent,0);
    assert.equal(api.telegram.length,0);
  }finally{globalThis.fetch=old;}
});
test('LATE_CHASE_CAUTION headline is explicit, even for daily gain above 9%',()=>{
  const o=watch({risk_class:'LATE_CHASE_CAUTION',day_price_change_pct:23,
    interval_price_change_pct:10.2,five_minute_equivalent_turnover_krw:55_000_000,
    five_minute_prior_ema_krw:13_700_000,turnover_ratio_prior_ema:4.01,
    interval_minutes:2.824,price_krw:74.96});
  const p=earlyCandidateProof(o,NOW,NOW-60000);
  assert.ok(p);
  assert.match(earlyMessage({...p,current_price_krw:76},NOW),/늦은 추격/);
});
test('hourly cap prevents spamming even if multiple candidates are valid',async()=>{
  const old=globalThis.fetch,env=mockEnv();
  try{
    const a=marketFeeds(marketSnapshot());
    globalThis.fetch=a.fetcher;
    const st={version:1,prevAt:0,lastAlert:{},run:0,
      earlyAlertHistory:[NOW-300000,NOW-500000,NOW-700000]};
    env.setState(st);
    const r=await scheduledCore(env.env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.earlyMarketWatch.status,'EARLY_HOURLY_CAP');
    assert.equal(a.telegram.length,0);
  }finally{globalThis.fetch=old;}
});
