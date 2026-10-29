import test from 'node:test';
import assert from 'node:assert/strict';
import {runMorningAi,shouldRunExpensiveAi,selectAiFutures,verifyModelAlert}
 from '../deployment/IRYS_V16_AI_FIRST_EARLY_WATCH_WORKER.mjs';

const NOW=Date.parse('2026-10-30T00:30:00Z');
const FUTURE={
  venue:'bitget',symbol:'ALTUSDT',market:'ALTUSDT',baseCoin:'ALT',
  asset_identity:'VERIFIED_CRYPTO',isRwa:'NO',contract_status:'normal',
  symbolType:'perpetual',quoteCoin:'USDT',funding_rate:null,
  oi:{status:'OK',change_pct_from_previous_run:-.45,elapsed_min_since_previous_snapshot:5},
  windows:{'1m':{price_change_pct:.1},'5m':{price_change_pct:.3,
    quote_turnover:2600,close:1.23,coverage:1,adjacent_ratio:1.07},
    '15m':{price_change_pct:-.2,coverage:1,adjacent_ratio:.9},
    '60m':{price_change_pct:-3,coverage:1}}
};
function snap(){return {spot_flow:{status:'PASS',signals:[]},
    futures_flow:{status:'EVALUATED',observation_only:true,
     alert_eligible:false,observations:[]},
    early_pool:[structuredClone(FUTURE)],watchlist:[]};}
test('AI gets Bitget early price reversal even if prior 15m mixed and OI negative',()=>{
  const selected=selectAiFutures(snap(),NOW);
  assert.ok(selected.total>0);
  assert.equal(selected.selected[0].symbol,'ALTUSDT');
  assert.equal(selected.selected[0].oi_delta_pct,-.45);
  assert.equal(shouldRunExpensiveAi('PASS',{snap:snap()},[]),true);
});
test('AI model UP with incomplete flow is an EARLY observation, not a fake verified flow',()=>{
  const c={venue:'bitget',symbol:'ALTUSDT',symbol_type:'VERIFIED_CRYPTO_USDT_PERPETUAL',
           price_usdt:1.23,oi_delta_pct:-.45};
  const d={venue:'bitget',symbol:'ALTUSDT',signal:'UP',strength:'EARLY'};
  const proof=verifyModelAlert(d,c);
  assert.equal(proof.stage,'AI_EARLY_WATCH_UNCONFIRMED');
  assert.equal(proof.direction_verified,false);
  assert.equal(verifyModelAlert({...d,signal:'WAIT'},c),null);
});
test('Actual model called with NO pre-confirmed market alert and zero real Telegram sends in shadow',async()=>{
  const orig=globalThis.fetch;
  const sent=[];let called=0;
  const official=Array.from({length:102},(_,i)=>({
    market:'KRW-T'+String(i+10),market_warning:'NONE'}));
  const ticks=official.map((x,i)=>({
    market:x.market,trade_price:100+i,
    acc_trade_price:20000000+i*10000,acc_trade_price_24h:250000000,
    signed_change_rate:.01,market_state:'ACTIVE'}));
  globalThis.fetch=async(url,opts={})=>{
    const s=String(url);
    if(s.includes('/v1/market/all'))return Response.json(official);
    if(s.includes('/v1/market/virtual_asset_warning'))return Response.json([]);
    if(s.includes('/v1/ticker'))return Response.json(ticks);
    if(s.includes('/api/v3/klines'))return new Response('{"code":"none"}',{status:429});
    if(s.includes('/sendMessage')){sent.push(s);throw Error('ALERT_TRANSPORT_DISABLED');}
    throw Error('Unexpected request '+s);
  };
  const state={lastAlert:{}};
  const env={AI:{run:async(model,body)=>{
    called++;assert.ok(model.startsWith('@cf/'));
    assert.match(body.messages[0].content,/EARLY/);
    const doc=JSON.parse(body.messages[1].content);
    assert.ok(doc.candidates.some(x=>x.symbol==='ALTUSDT'));
    return {response:JSON.stringify({decisions:[{
      venue:'bitget',symbol:'ALTUSDT',signal:'UP',strength:'EARLY',
      reason_ko:'실제 가격이 개선됨',counter_ko:'OI 포지션 방향 미확인'}]})};
  }}};
  try{
    const out=await runMorningAi(env,{snap:snap()},state,NOW);
    assert.equal(called,1,'AI must actually run before old strict BUY condition');
    assert.equal(out.model_decisions,1);
    assert.equal(out.directional_model_hypotheses,1);
    assert.equal(out.suppressed_directional_model_decisions,1);
    assert.equal(out.status,'AI_SHADOW_REAL_MODEL_REPLIED_NO_TELEGRAM');
    assert.equal(out.alerts_sent,0);
    assert.equal(sent.length,0);
    assert.equal(state.aiV16ShadowJudgments[0].symbol,'ALTUSDT');
  }finally{globalThis.fetch=orig;}
});
