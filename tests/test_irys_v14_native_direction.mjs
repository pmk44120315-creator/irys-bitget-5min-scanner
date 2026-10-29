import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validDirectionalProof,directionalMessage,officialDirectionalRiskCheck,scheduledCore
} from '../deployment/IRYS_V14_NATIVE_MARKET_EVIDENCE_WORKER.mjs';

const NOW=Date.parse('2026-10-29T00:22:00Z');
const M=60_000;
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/latest.json';
function nativeProof(positive=true){
  const end=NOW-M, anchor=Math.floor(end/(5*M))*5*M;
  const side=positive?'UP':'DOWN', share=positive?.70:.30,net=positive?12_000_000:-12_000_000;
  const book=(t,first)=>({timestamp_ms:t,spread_pct:.14,
    bid_ask_top5_ratio:positive?(first?1.13:1.5):(first?.78:.65)});
  const sample=(t,first)=>({time_ms:t,book:book(t,first),buy_share:share,
    net_buy_krw:positive?5_000_000:-5_000_000,
    recent_net_buy_krw:positive?2_000_000:-2_000_000,
    trades:85,close:100});
  return {market:'KRW-PUFFER',venue:'bithumb',direction:side,
    price_krw:100,observed_ms:end,late_chase_caution:true,
    structure:{status:'PASS',source:'BITHUMB_OFFICIAL_COMPLETED_NATIVE_5M_AND_TRADE_1M',
      anchor_end_ms:anchor,observed_at_ms:end,close:100,
      no_future_data:true,missing_1m_not_zero_filled:true,
      native_missing_5m_not_zero_filled:true,native_15m_buckets_observed:3,
      closed_15m_turnover_krw:30_000_000,closed_15m_turnover_verified_by_taker:true,
      closed_20m_candles:false,observed_1m_bars_of_last20:16,
      price_5m_pct:positive?.04:-.04,price_15m_pct:positive?.07:-.07,
      up_structure:positive,down_structure:!positive,
      upper_wick_5m_ratio:.75,lower_wick_5m_ratio:.68},
    taker_flow_15m:{verified:true,marketwide_cvd_verified:false,
      start_ms:anchor-15*M,end_ms:anchor,candle_relative_error:.001,
      net_buy_krw:net,buy_share:share,blocks:Array.from({length:3},()=>({
        net_buy_krw:net/3,buy_share:share,trades:70}))},
    flow_snapshots:[sample(end-5*M,true),sample(end,false)],
    orderbook_absorption_verified:false,other_exchange_identity_verified:false,
    future_direction_accuracy_verified:false};
}
function fakeRisk({warning=false,price=101,daily=.30}={}){
  const get=async url=>{
    const s=String(url);
    let data;
    if(s.includes('/v1/market/all'))data=Array.from({length:110},(_,i)=>({
      market:i===0?'KRW-PUFFER':'KRW-T'+i,market_warning:'NONE'}));
    else if(s.includes('/v1/market/virtual_asset_warning'))
      data=warning?[{market:'KRW-PUFFER'}]:[];
    else if(s.includes('/v1/ticker'))data=[{market:'KRW-PUFFER',
      trade_price:price,signed_change_rate:daily,market_state:'ACTIVE'}];
    else throw Error('Unexpected public risk URL '+s);
    return new Response(JSON.stringify(data),{status:200});
  };
  return get;
}
test('sparse real 1m context passes if actual native 5m + two books + reconciled 15m CVD agree',()=>{
  for(const side of [true,false]){
    const p=nativeProof(side),valid=validDirectionalProof(p,NOW);
    assert.ok(valid,JSON.stringify(p));
    assert.equal(valid.direction,side?'UP':'DOWN');
    assert.equal(valid.late_chase_caution,true);
    assert.equal(valid.structure.closed_20m_candles,false);
    assert.equal(valid.structure.observed_1m_bars_of_last20,16);
    assert.match(directionalMessage({...valid,current_price_krw:side?101:99,
      post_evidence_price_change_pct:side?1:-1},NOW),/빗썸 실제 완성 5분봉/);
  }
});
test('never invent missing native buckets or accept future candle, false CVD, or fake 1m data',()=>{
  const p=nativeProof();
  for(const edit of [
    x=>x.structure.closed_15m_turnover_verified_by_taker=false,
    x=>x.structure.no_future_data=false,
    x=>x.structure.missing_1m_not_zero_filled=false,
    x=>x.structure.native_missing_5m_not_zero_filled=false,
    x=>x.structure.anchor_end_ms+=M,
    x=>x.taker_flow_15m.end_ms+=M,
    x=>x.taker_flow_15m.candle_relative_error=.2,
    x=>x.flow_snapshots[0].time_ms=x.flow_snapshots[1].time_ms,
    x=>x.taker_flow_15m.blocks[1].net_buy_krw=-1
  ]){
    const item=structuredClone(p);edit(item);
    assert.equal(validDirectionalProof(item,NOW),null,'Invalid native data must not signal');
  }
});
test('official warning/suspended listing is hard, arbitrary daily gain or 1.5pct price jump is not',async()=>{
  const saved=globalThis.fetch,p=validDirectionalProof(nativeProof(),NOW);
  try{
    globalThis.fetch=fakeRisk({price:101,daily:.30});
    const checked=await officialDirectionalRiskCheck([p]);
    assert.equal(checked.length,1);
    assert.ok(Math.abs(checked[0].post_evidence_price_change_pct-1)<1e-10);
    globalThis.fetch=fakeRisk({warning:true,price:101});
    assert.equal((await officialDirectionalRiskCheck([p])).length,0);
    globalThis.fetch=fakeRisk({price:99});
    assert.equal((await officialDirectionalRiskCheck([p])).length,0,
      'Post-proof reversal contradicts direction');
  }finally{globalThis.fetch=saved;}
});
test('native directional alert requires real evidence; price/turnover-only candidate never sends',async()=>{
  const saved=globalThis.fetch;
  const sent=[],stateWrites=[];let state=null;
  const data={collector_status:'PASS',
    finished_utc:new Date(NOW-25_000).toISOString(),
    stats:{instrument_verified_crypto:440,oi_symbols_failed:0,candle_symbols_failed:0,
      funding_feed_ok:true,bitget_active_usdt_perpetual:866},
    spot_flow:{status:'PASS',observed_utc:new Date(NOW-40_000).toISOString(),
      markets:489,tickers:489,signals:[],
      early_watch_observations:[{market:'KRW-PUFFER',price_krw:100,
        interval_price_change_pct:5,five_minute_equivalent_turnover_krw:10**9}]},
    futures_flow:{status:'EVALUATED',observations:[],observation_only:true,
      alert_eligible:false},watchlist:[],early_pool:[],
    spot_directional:{status:'EVALUATED',reviewed:1,
      diagnostics:[],signals:[nativeProof()]}};
  const env={IRYS_KV:{
      get:async()=>state?JSON.stringify(state):null,
      put:async(key,v)=>{if(key==='irys:fast:state:v1'){stateWrites.push(key);state=JSON.parse(v);}
                           else assert.match(key,/delivery-receipt/);}
    },TELEGRAM_BOT_TOKEN:'offline-only-token',TELEGRAM_CHAT_ID:'123456789'};
  globalThis.fetch=async(url,opts={})=>{
    const s=String(url);
    if(s.startsWith(ROOT))return new Response(JSON.stringify(data),{status:200});
    if(s.includes('/sendMessage')){
      sent.push(JSON.parse(opts.body).text);
      return new Response(JSON.stringify({ok:true,result:{message_id:122,chat:{id:123456789}}}),{status:200});
    }
    return fakeRisk({price:101,daily:.28})(url);
  };
  try{
    const r=await scheduledCore(env,NOW,{status:'ACCEPTED',error:null});
    assert.equal(r.last.status,'PASS');
    assert.equal(r.last.earlyMarketWatch.sent,0,'Raw volume WATCH must remain internal');
    assert.equal(r.last.spotDirectional.sent,1);
    assert.equal(sent.length,1);
    assert.match(sent[0],/실제 15분 체결/);
    assert.equal(stateWrites.length,1);
    assert.equal(state.spotOutcomesV13.length,1);
  }finally{globalThis.fetch=saved;}
});
