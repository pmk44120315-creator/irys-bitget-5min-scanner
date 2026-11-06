import test from 'node:test';
import assert from 'node:assert/strict';
import {v38Universe,v38RunCycle} from '../deployment/v38_runner.mjs';
const STEP=300000,T=1793952300000;
const ticker=(symbol='ONEUSDT',change='0.23',time=T)=>({symbol,lastPr:'1.20',bidPr:'1.19',askPr:'1.20',change24h:change,usdtVolume:'1000000',ts:String(time)});
const fast={venue:'bitget',at_ms:T,prices:{ONEUSDT:[1.2,2,T],SHORTUSDT:[2,-2,T]},candidates:[{symbol:'ONEUSDT'}]};
const xs=()=>[ticker(),ticker('SHORTUSDT','-0.15')];
test('source universe includes verified crypto movers without requiring late breakout at signal evaluation',()=>{
 const r=v38Universe({fastFeed:fast,tickers:xs(),now:T});
 assert.equal(r.crypto_verified,2);assert.equal(r.valid_tickers,2);assert(r.selected.some(x=>x.symbol==='ONEUSDT'));
 assert(r.selected.some(x=>x.symbol==='SHORTUSDT'));
});
test('unverified stock and stale pseudo ticker cannot silently become futures opportunities',()=>{
 const r=v38Universe({fastFeed:fast,tickers:[...xs(),ticker('AAPLUSDT','0.99'),ticker('ONEUSDT','0.5',T-180000)],now:T});
 assert(!r.selected.some(x=>x.symbol==='AAPLUSDT'));assert(r.valid_tickers<=2);
});
test('stale verified identity feed makes production observation explicitly partial',()=>{
 const r=v38Universe({fastFeed:{...fast,at_ms:T-600000},tickers:xs(),now:T});
 assert.equal(r.selected.length,0);assert(r.errors.includes('STALE_VETTED_CRYPTO_UNIVERSE'));
});
test('marketwide scan only produces research, never a real long order or Telegram message',()=>{
 const r=v38RunCycle({fastFeed:fast,tickers:xs(),prior:{events:[]},now:T,pages:[]});
 assert.equal(r.output.telegram_sent,false);assert.equal(r.output.orders_sent,false);
 assert.equal(r.output.actual_telegram_acks,0);assert.equal(r.output.auto_promote,false);
 assert.equal(r.output.live_signal_modified,false);
});
test('missing official historical source is not secretly counted as a model rejection',()=>{
 const select={selected:[{symbol:'ONEUSDT',change24h:.23}],provider_total:2,crypto_verified:2,valid_tickers:2,not_scanned:0,errors:[]};
 const r=v38RunCycle({fastFeed:fast,tickers:xs(),prior:{events:[]},now:T,pages:[],selection:select});
 assert.equal(r.output.inspected_symbols,1);assert.equal(r.output.diagnostic_statuses.NO_SETUP,undefined);
 assert.equal(r.output.history_success,0);
});
