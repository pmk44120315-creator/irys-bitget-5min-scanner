import test from 'node:test';import assert from 'node:assert/strict';
import {v27Capture} from '../deployment/v27_capture_response.mjs';
const T=1793584500000;
function source(){return {version:'IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1',source_identity:'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO',at_ms:T-10000,
 prices:Object.fromEntries(Array.from({length:120},(_,i)=>['T'+i+'USDT',[1,1,T-10000]])),candidates:[{symbol:'T0USDT',venue:'bitget',identity_verified_v3_crypto:true,active_contract_verified_v2:true,baseline_price:1,price:1.02,move_pct:2}]};}
function api(path){if(path.includes('/fills'))return {code:'00000',data:Array.from({length:4},(_,i)=>({symbol:'T0USDT',tradeId:String(i),side:'sell',size:'1',price:1+i*.01,ts:T-5000+i*1000}))};
return {code:'00000',data:Array.from({length:121},(_,i)=>({symbol:i===120?'EVILUSDT':'T'+i+'USDT',lastPr:1.02,bidPr:1.019,askPr:1.021,ts:T-1000}))};}
test('public capture keeps identity, preserves exact baseline, requotes after samples and no trading',async()=>{
 const calls=[];const r=await v27Capture(source(),async p=>(calls.push(p),api(p)),()=>T);
 assert.deepEqual(calls,['/api/v2/mix/market/fills','/api/v2/mix/market/tickers']);assert.equal(Object.keys(r.quotes).length,120);
 assert.equal(r.quotes.EVILUSDT,undefined);assert.equal(r.source.candidates[0].baseline_price,1);
 assert.equal(r.responses.T0USDT.state,'SELL_PRESSURE_FAILED');assert.equal(r.orders_sent,false);assert.equal(r.telegram_sent,false);
});
test('missing tape stays unknown while honest quotes remain usable',async()=>{
 const r=await v27Capture(source(),async p=>{if(p.includes('/fills'))throw Error('TAPE_503');return api(p)},()=>T);
 assert.equal(r.responses.T0USDT.status,'SAMPLE_UNAVAILABLE');assert.equal(r.tape_errors.T0USDT,'TAPE_503');assert.equal(Object.keys(r.quotes).length,120);
});
test('old and incomplete sources never become a fresh generation',async()=>{
 const s=source();s.at_ms=T-120000;await assert.rejects(v27Capture(s,api,()=>T),/SOURCE_NOT_FRESH/);
 await assert.rejects(v27Capture(source(),async p=>p.includes('/fills')?api(p):({code:'00000',data:[]}),()=>T),/QUOTE_UNIVERSE_INCOMPLETE/);
});
