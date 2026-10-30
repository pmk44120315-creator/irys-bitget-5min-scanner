import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAiV16Outcome} from '../deployment/IRYS_V16_AI_FIRST_LIVE_WORKER.mjs';

const M=60000,ALERT=Date.parse('2026-10-30T00:00:03Z'),CLOSED=Math.floor(ALERT/M)*M;
function candles(count=63,up=true){
 const map=new Map();
 for(let i=0;i<count;i++){
   const close=100*(1+(up?1:-1)*.0005*(i+1));
   map.set(CLOSED+i*M,{open:100,close,high:close*1.0002,low:close*.9998});
 }
 return map;
}
test('AI BUY hypothesis uses only later completed Bithumb prices, reports unverified outcome not trade PnL',()=>{
 const rec={venue:'bithumb',symbol:'KRW-TEST',direction:'UP',at_ms:ALERT,price:100};
 const rows=candles();
 assert.equal(evaluateAiV16Outcome(rec,5,ALERT+4*M,rows),null);
 const v=evaluateAiV16Outcome(rec,5,ALERT+7*M,rows);
 assert.equal(v.source,'BITHUMB_OFFICIAL_COMPLETED_1M');
 assert.equal(v.basis,'OFFICIAL_TICKER_NEAR_TELEGRAM_ACK_NOT_TRADE_EXECUTION');
 assert.equal(v.direction_right,true);
 assert.equal(v.excursion_full_coverage,true);
 assert.equal(v.adverse_excursion_pct>=0,true);
});
test('No fabricated excursion when an intermediate future candle is missing',()=>{
 const rec={venue:'bithumb',symbol:'KRW-TEST',direction:'DOWN',at_ms:ALERT,price:100};
 const rows=candles();rows.delete(CLOSED+3*M);
 const v=evaluateAiV16Outcome(rec,5,ALERT+7*M,rows);
 assert.equal(v.source,'BITHUMB_OFFICIAL_COMPLETED_1M');
 assert.equal(v.excursion_full_coverage,false);
 assert.equal(v.favourable_excursion_pct,null);
 assert.equal(v.adverse_excursion_pct,null);
});
test('Bitget provisional LONG is not scored before real first post-alert close',()=>{
 const rec={venue:'bitget',symbol:'ALTUSDT',direction:'UP',at_ms:ALERT,
   price:1.2,first_postalert_close_usdt:null};
 assert.equal(evaluateAiV16Outcome(rec,5,ALERT+7*M,candles()),null);
 rec.first_postalert_close_usdt=100;
 const v=evaluateAiV16Outcome(rec,5,ALERT+7*M,candles());
 assert.equal(v.source,'BITGET_OFFICIAL_COMPLETED_1M');
 assert.equal(v.basis,'FIRST_COMPLETED_1M_AFTER_TELEGRAM_ACK_NOT_EXECUTION');
 assert.equal(v.baseline_is_first_postalert_minute,true);
});
