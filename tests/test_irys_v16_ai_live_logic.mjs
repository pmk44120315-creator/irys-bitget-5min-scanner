import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyModelAlert,shouldRunExpensiveAi,morningMessage} from '../deployment/IRYS_V16_AI_FIRST_LIVE_WORKER.mjs';

test('Model sees crypto LONG even with negative OI and mixed prior candles',()=>{
  const candidate={venue:'bitget',symbol:'ALTUSDT',
    symbol_type:'VERIFIED_CRYPTO_USDT_PERPETUAL',
    price_usdt:1.4,oi_delta_pct:-.3};
  const decision={venue:'bitget',symbol:'ALTUSDT',signal:'UP',strength:'EARLY'};
  const value=verifyModelAlert(decision,candidate);
  assert.equal(value.stage,'AI_EARLY_WATCH_UNCONFIRMED');
  assert.equal(value.direction_verified,false);
  assert.equal(shouldRunExpensiveAi('PASS',{snap:{}},[]),true);
});

test('Actual venue fills and signed price are required before claiming corroborated flow',()=>{
  const d={venue:'bitget',symbol:'ALTUSDT',signal:'UP',strength:'STRONG'};
  const c={venue:'bitget',symbol:'ALTUSDT',
    symbol_type:'VERIFIED_CRYPTO_USDT_PERPETUAL',price_usdt:1.4,pct5m:.25,
    real_futures_taker:{net_buy_usdt:2500,
      price_time_alignment:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT'}};
  assert.equal(verifyModelAlert(d,c).stage,'REAL_EXECUTION_SUPPORT_OBSERVED');
  const contradictory={...c,real_futures_taker:{
    net_buy_usdt:-2500,price_time_alignment:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT'}};
  assert.equal(verifyModelAlert(d,contradictory).stage,'AI_WATCH_CONTRARY_TAKER_EVIDENCE');
  assert.equal(verifyModelAlert(d,{...c,pct5m:-.3}).stage,'AI_EARLY_WATCH_UNCONFIRMED');
  assert.equal(verifyModelAlert(d,{...c,real_futures_taker:null}).stage,'AI_EARLY_WATCH_UNCONFIRMED');
});

test('Spot DOWN cannot be presented as spot BUY',()=>{
  const candidate={venue:'bithumb',symbol:'KRW-ALT',market:'KRW-ALT',
    confirmed_market_risk_clear:true,
    spot_risk_status:'OFFICIAL_NO_WARNING_NOW',price_krw:100};
  assert.equal(verifyModelAlert({venue:'bithumb',symbol:'KRW-ALT',
    signal:'DOWN',strength:'STRONG'},candidate),null);
  assert.equal(verifyModelAlert({venue:'bithumb',symbol:'KRW-ALT',
    signal:'UP',strength:'EARLY'},candidate).stage,'AI_EARLY_WATCH_UNCONFIRMED');
});


test('UP and DOWN messages MUST use model direction, not the evidence grade',()=>{
  const c={venue:'bitget',symbol:'ALTUSDT',price_usdt:1.4,pct5m:.3,
    turnover5_usdt:3500,relative_volume5:1.1,
    funding_rate:null,oi_delta_pct:-.3,oi_elapsed_min:5,binance_spot:{status:'UNAVAILABLE'}};
  const grade={stage:'AI_EARLY_WATCH_UNCONFIRMED'};
  const base={venue:'bitget',symbol:'ALTUSDT',strength:'EARLY',reason_ko:'실제 가격 반응',
    counter_ko:'연속 체결 미확인'};
  const up=morningMessage({...base,signal:'UP'},c,grade,Date.parse('2026-10-30T00:00:00Z'));
  const down=morningMessage({...base,signal:'DOWN'},c,grade,Date.parse('2026-10-30T00:00:00Z'));
  assert.match(up,/상승 가설/);
  assert.match(up,/비트겟 선물 LONG 관찰/);
  assert.match(down,/비트겟 선물 SHORT 관찰/);
  assert.doesNotMatch(up,/하락 가설/);
  assert.match(down,/하락 가설/);
  assert.doesNotMatch(down,/상승 가설/);
  assert.match(up,/펀딩 미확인/);
  assert.match(up,/매매 신호 아님/);
  assert.match(up,/비트겟 15분 검증 순매수\/순매도: 미확인/);
  assert.match(up,/비트겟 두 시점 호가: 미확인/);
});
