import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAckSource,parseBars,markOutcomes,replay} from '../research/v39_latest_ack_replay.mjs';
const ACK=1794042086397,MIN=60000,END=ACK+2*3600000,SYMBOL='CTUSDT';
const source=()=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',source:'OFFICIAL_PUBLIC_RUNNER',
 orders_sent:false,telegram_sent:false,at_ms:ACK-30000,items:[{
 candidate:{venue:'bitget',symbol:SYMBOL,direction:'LONG',change_pct:1.2,priority:1.2},
 first:{observed_at_ms:ACK-55000,trades:[{price:99,size:2,side:'BUY'},{price:99,size:1,side:'SELL'}]},
 second:{observed_at_ms:ACK-25000,trades:[{price:100,size:1,side:'BUY'},{price:100,size:3,side:'SELL'}]},
 final:{observed_at_ms:ACK-14000,quote:{bid:100,ask:100.1,at_ms:ACK-15000}}
 }]});
const nextCloseStart=Math.floor((ACK+5*MIN)/MIN)*MIN-MIN;
const bars=()=>({code:'00000',data:[[nextCloseStart,'100.3','101','99','100.2','0','0']]});
test('select only matching pre-ACK source and original quote',()=>{
 const item=validateAckSource(source(),ACK,SYMBOL);
 assert(item);assert.equal(item.candidate.direction,'LONG');
});
test('reject packet written after Telegram ACK',()=>{
 const d=source();d.at_ms=ACK+1;assert.equal(validateAckSource(d,ACK,SYMBOL),null);
});
test('reject quote stale before Telegram send',()=>{
 const d=source();d.items[0].final.quote.at_ms=ACK-50000;assert.equal(validateAckSource(d,ACK,SYMBOL),null);
});
test('reject symbol missing or multiple direction-mismatched items instead of guessing',()=>{
 const d=source();assert.equal(validateAckSource(d,ACK,'ZZZUSDT'),null);
 d.items.push(structuredClone(d.items[0]));assert.equal(validateAckSource(d,ACK,SYMBOL),null);
});
test('minute parser refuses incomplete current candle and conflicting historical candles',()=>{
 const now=nextCloseStart+MIN+100;
 const a=parseBars({code:'00000',data:[[nextCloseStart,'100','101','99','100.2'],[now-MIN/2,'100','101','99','100.2']]},'bitget',now);
 assert.equal(a.status,'OBSERVED');assert.equal(a.bars.length,1);
 const c=parseBars({code:'00000',data:[[nextCloseStart,'100','101','99','100.2'],[nextCloseStart,'100','101','99','100.9']]},'bitget',now);
 assert.equal(c.status,'DUPLICATE_CONFLICT');
});
test('long outcome is quote-to-closed-candle proxy, not an executable gain',()=>{
 const p=parseBars(bars(),'bitget',END);
 const z=markOutcomes(source().items[0],ACK,p.bars,END);
 assert.equal(z['5'].status,'MEASURED_MINUTE_CLOSE_PROXY');
 assert(z['5'].signed_price_pct>0);
 assert.equal(z['5'].actual_execution_verified,false);
 assert(z['5'].path_minutes_observed<z['5'].path_minutes_expected);
});
test('replay binds latest public ACK to original commit and future official public bar only',async()=>{
 const read=async url=>{
  if(url.includes('/commits?'))return [{sha:'a'.repeat(40)}];
  if(url.startsWith('https://raw.githubusercontent.com/'))return source();
  if(url.startsWith('https://api.bitget.com/'))return bars();
  throw new Error('unexpected URL');
 };
 const r=await replay({ack:{last_api_ack_ms:ACK,last_api_ack_symbol:SYMBOL},snapshotAtMs:END,githubToken:'test',read});
 assert.equal(r.status,'MEASURED_PUBLIC_MINUTE_CLOSE_PROXY');
 assert.equal(r.same_pre_ack_evidence_verified,true);
 assert.equal(r.direction,'LONG');
 assert.equal(r.quote_to_ack_ms,15000);
 assert.equal(r.preselection_5m_move_pct,1.2);
 assert(Math.abs(r.independent_first_taker_share-2/3)<1e-9);
 assert(Math.abs(r.independent_second_taker_share-.25)<1e-9);
 assert.equal(r.outcomes['5'].target_close,100.2);
 assert.equal(r.telegram_sent,false);assert.equal(r.actual_execution_verified,false);
});
test('unmatched historical packet does not invent a Telegram direction',async()=>{
 const r=await replay({ack:{last_api_ack_ms:ACK,last_api_ack_symbol:SYMBOL},snapshotAtMs:END,
 read:async url=>url.includes('/commits?')?[{sha:'a'.repeat(40)}]:{...source(),items:[]}});
 assert.equal(r.status,'NO_MATCHING_PRE_ACK_FROZEN_SOURCE');
 assert.equal(r.same_pre_ack_evidence_verified,false);
});
test('not yet matured outcomes remain pending',()=>{
 const z=markOutcomes(source().items[0],ACK,[],ACK+200000);
 assert.equal(z['5'].status,'PENDING_HORIZON');
});
test('source-side official completed-candle data absence cannot become a win',async()=>{
 const read=async url=>url.includes('/commits?')?[{sha:'a'.repeat(40)}]:
 url.startsWith('https://raw.githubusercontent.com/')?source():{code:'99999',data:[]};
 const r=await replay({ack:{last_api_ack_ms:ACK,last_api_ack_symbol:SYMBOL},snapshotAtMs:END,read});
 assert.equal(r.status,'PUBLIC_CANDLES_SOURCE_UNAVAILABLE');
 assert.deepEqual(r.outcomes,{});
});
