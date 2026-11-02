import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {v23ScoutTick,v27LoadQuotes,v27ExecutableCandidates,recordReceipt,v27EffortResponse,v27PublicReceipt,v27SafeResponse} from '../deployment/IRYS_V27_RESPONSE_WORKER.mjs';
const T=1793584500000;
function doc(){
 const prices=Object.fromEntries(Array.from({length:120},(_,i)=>['X'+i+'USDT',[1,0,T-1000]]));prices.MOVERUSDT=[1.02,2,T-1000];
 const quotes=Object.fromEntries(Object.keys(prices).map(s=>[s,[1.019,1.021,T-1000,1.02]]));
 const source={version:'IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1',venue:'bitget',source_identity:'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO',at_ms:T-1000,at_utc:new Date(T-1000).toISOString(),
  status:'MARKET_COMPARISON_PASS',trade_data_included:false,not_full_orderbook_or_marketwide_cvd:true,not_profitable_future_direction_proof:true,active_verified_crypto_count:121,actual_official_tickers_count:121,prices,
  candidates:[{symbol:'MOVERUSDT',venue:'bitget',baseline_price:1,price:1.02,move_pct:2,spread_pct:.2,priority:6,quote_24h_usdt:5000000,price_timestamp_ms:T-1000,
    identity_verified_v3_crypto:true,active_contract_verified_v2:true,price_only_not_future_direction:true,source:'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST'}]};
 const tape=Array.from({length:4},(_,i)=>({symbol:'MOVERUSDT',tradeId:String(i),side:'sell',price:1+i*.01,size:10,ts:T-60000+i*10000}));
 return {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:T,parent_at_ms:T-1000,source,quotes,responses:{MOVERUSDT:v27EffortResponse(tape,'bitget',T,.2,'MOVERUSDT')},orders_sent:false,telegram_sent:false,not_full_cvd:true};
}
const reader=d=>async url=>{if(url.includes('raw.githubusercontent.com'))return d;throw Error('HTTP_403')};
test('actual compiled Worker uses fresh GitHub quote and honest failed-pressure text with exact receipt',async()=>{
 const state={},messages=[];const result=await v23ScoutTick({},state,T,{clock:()=>T,maxWaitMs:0,read:reader(doc()),
 send:async(e,m)=>{messages.push(m);return {message_id:999,ack_received_at_ms:T+200,message_text:m}},persistReceipt:async()=>true});
 assert.equal(result.status,'TELEGRAM_API_ACK',JSON.stringify(result));assert.equal(result.sent,1);assert.equal(messages.length,1);
 assert.match(messages[0],/매도 압력 실패/);assert.match(messages[0],/진입 확정 아님/);
 const receipt=state.deliveryReceiptsV12.at(-1);assert.equal(receipt.ack_received_at_ms,T+200);assert.equal(receipt.market_snapshot.current_quote.bid,1.019);
 assert.equal(receipt.market_snapshot.forecast_direction,null);assert.equal(receipt.market_snapshot.response.future_direction_proven,false);
 assert.equal(receipt.message_text,messages[0]);assert.equal(state.v23ScoutHourly.count,1);
});
test('a quote-only bounce cannot send and does not consume a success slot',async()=>{
 const d=doc();d.quotes.MOVERUSDT=[1,1.02,T-1000,1.02];const state={};
 const result=await v23ScoutTick({},state,T,{clock:()=>T,maxWaitMs:0,read:reader(d),send:async()=>{throw Error('BOUNCE_MUST_NOT_SEND')}});
 assert.equal(result.sent,0);assert.equal(result.v27ExecutableAudit.rejected[0].reason,'NO_EXECUTABLE_PROGRESS');assert.equal(state.v23ScoutHourly.count,0);
});
test('stale report cannot be sent despite HTTP success and passing old V24 eight-minute freshness',async()=>{
 const d=doc();d.at_ms=T-300000;d.parent_at_ms=T-300000;d.source.at_ms=T-300000;d.source.at_utc=new Date(d.source.at_ms).toISOString();
 const state={};const result=await v23ScoutTick({},state,T,{clock:()=>T,maxWaitMs:0,read:reader(d),send:async()=>{throw Error('STALE_MUST_NOT_SEND')}});
 assert.equal(result.sent,0);assert.equal(result.bitget_fast_fallback.status,'FRESH_GENERATION_UNAVAILABLE');assert.equal(state.telegramAcknowledgementsTotal,undefined);
});
test('failed Bot ACK leaves no receipt or successful dedupe',async()=>{
 let calls=0;const state={};const result=await v23ScoutTick({},state,T,{clock:()=>T,maxWaitMs:0,read:reader(doc()),send:async()=>{calls++;return {}},persistReceipt:async()=>true});
 assert.equal(calls,1);assert.equal(result.status,'TELEGRAM_SEND_NOT_VERIFIED');
 assert.equal(result.sent,0);assert.equal(state.telegramAcknowledgementsTotal,undefined);assert.equal(state.v23ScoutHourly.count,0);
});
test('quote timestamp is evaluated at receive time, not before awaiting provider',async()=>{
 const c={venue:'bithumb',symbol:'KRW-REAL',baseline_price:100,side_observed:'UP',move_pct:2,priority:5};
 const x=await v27ExecutableCandidates([c],{},async()=>[{market:'KRW-REAL',timestamp:T+4000,orderbook_units:[{bid_price:101,ask_price:102}]}],T,()=>T+5000);
 assert.equal(x.accepted.length,1);
});
test('malformed quote provenance never replaces current state',()=>{
 const state={v27Quotes:{KEEP:'unchanged'}},d=doc();d.orders_sent=true;
 assert.equal(v27LoadQuotes(d,state,T),false);assert.deepEqual(state.v27Quotes,{KEEP:'unchanged'});
});
test('all original strict direction proofs and Cron function are retained',()=>{
 const old=readFileSync(process.env.V27_BASE_WORKER||'/mnt/data/v27_receipts/live_worker.mjs','utf8');
 const next=readFileSync(new URL('../deployment/IRYS_V27_RESPONSE_WORKER.mjs',import.meta.url),'utf8');
 for(const [a,b] of [['function futuresSnapshotProof(','function evaluateFutures('],['function validDirectionalProof(','async function officialDirectionalRiskCheck(']]){
  assert.equal(next.slice(next.indexOf(a),next.indexOf(b)),old.slice(old.indexOf(a),old.indexOf(b)));
 }
 assert.ok(next.includes('const MAX_ALERTS=2;'));assert.ok(next.includes('const V23_MAX_HOURLY_NOTICES=2;'));
 assert.ok(next.includes('const V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false;'));
 assert.ok(!next.includes('/mix/order/place-order'));
});

test('full message bodies and private evidence stay out of public health receipt',()=>{
 const publicRow=v27PublicReceipt({channel:'TEST',symbol:'XUSDT',telegram_message_id:1,message_text:'PRIVATE_BODY',market_snapshot:{private:'EVIDENCE'},ack_received_at_ms:T});
 assert.equal(publicRow.message_text,undefined);assert.equal(publicRow.market_snapshot,undefined);assert.equal(publicRow.ack_received_at_ms,T);
});
test('aged tape is not relabeled current by a fresh quote',()=>{
 const r={status:'SAMPLED_RESPONSE',sample_end_ms:T-120000,sample_trades:50,buy_share:.9,future_direction_proven:false,full_cvd_verified:false};
 assert.equal(v27SafeResponse(r,T).status,'RESPONSE_UNAVAILABLE_OR_AGED');
});
