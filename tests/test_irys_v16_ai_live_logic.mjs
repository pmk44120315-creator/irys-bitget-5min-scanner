import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyModelAlert,shouldRunExpensiveAi} from '../deployment/IRYS_V16_AI_FIRST_LIVE_WORKER.mjs';

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

test('Spot DOWN cannot be presented as spot BUY',()=>{
  const candidate={venue:'bithumb',symbol:'KRW-ALT',market:'KRW-ALT',
    confirmed_market_risk_clear:true,
    spot_risk_status:'OFFICIAL_NO_WARNING_NOW',price_krw:100};
  assert.equal(verifyModelAlert({venue:'bithumb',symbol:'KRW-ALT',
    signal:'DOWN',strength:'STRONG'},candidate),null);
  assert.equal(verifyModelAlert({venue:'bithumb',symbol:'KRW-ALT',
    signal:'UP',strength:'EARLY'},candidate).stage,'AI_EARLY_WATCH_UNCONFIRMED');
});
