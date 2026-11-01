import test from 'node:test';
import assert from 'node:assert/strict';
import {v23TickerBundle,v23ReadFeeds,v23SampleTaker,v23Message,v23ScoutTick}
 from '../deployment/v23_direct_market_scout.mjs';

const NOW=Date.parse('2026-11-01T06:10:00Z');
function feeds(now=NOW,spike=false){
 const market=Array.from({length:103},(_,i)=>({market:i===0?'KRW-POP':'KRW-T'+i,market_warning:'NONE'}));
 const spot=market.map((x,i)=>({market:x.market,
    trade_price:i===0&&spike?102:100,
    acc_trade_price:(i===0?500000000:100000000)+(spike?55000000:0),
    trade_timestamp:now-1000,market_state:'ACTIVE',is_trading_suspended:false}));
 const instruments=Array.from({length:105},(_,i)=>({
   symbol:i===0?'POPUSDT':i===1?'STOCKUSDT':'A'+i+'USDT',
   symbolType:i===1?'stock':'crypto',instrumentType:i===1?'stock':'crypto'}));
 const futures=instruments.map((x,i)=>({
   symbol:x.symbol,lastPr:i===0&&spike?'1.023':i===1&&spike?'3':'1',
   ts:now-500,bidPr:i===0&&spike?'1.021':'0.999',
   askPr:i===0&&spike?'1.023':'1.001',usdtVolume:'5000000'}));
 return {bithumb_markets:market,bithumb_warnings:[],
   bithumb_tickers:spot,bitget_instruments:instruments,bitget_tickers:futures};
}
function mockReader(d){
 return async url=>{
   if(url.includes('market/all'))return d.bithumb_markets;
   if(url.includes('virtual_asset_warning'))return d.bithumb_warnings;
   if(url.includes('/v1/ticker'))return d.bithumb_tickers;
   if(url.includes('/v3/market/instruments'))return {code:'00000',data:d.bitget_instruments};
   if(url.includes('/v2/mix/market/tickers'))return {code:'00000',data:d.bitget_tickers};
   if(url.includes('/market/fills'))return {code:'00000',data:[{side:'buy',price:'1.023',size:'10',
      ts:String(d.bitget_tickers[0].ts),tradeId:'ABC123'}]};
   if(url.includes('/v1/trades/ticks'))return [{
      ask_bid:'BID',trade_price:102,trade_volume:100,trade_timestamp:d.bithumb_tickers[0].trade_timestamp,
      sequential_id:100}];
   throw new Error('TEST_UNKNOWN_API '+url);
 };
}
test('first snapshot warms without fabricating price/volume delta',()=>{
 const result=v23TickerBundle({},feeds(),NOW);
 assert.equal(result.observation.status,'WARMUP_OR_GAP');
 assert.equal(result.observation.candidates.length,0);
 assert.equal(result.next.kst_day,'2026-11-01');
});
test('5m direct ticker comparison finds first impulse on both exchanges, no prior 15m streak',()=>{
 const old=v23TickerBundle({},feeds(),NOW).next;
 const t=NOW+300000,data=feeds(t,true),result=v23TickerBundle(old,data,t);
 assert.equal(result.observation.status,'MARKET_COMPARISON_PASS');
 assert.ok(result.observation.candidates.some(x=>x.symbol==='KRW-POP'));
 assert.ok(result.observation.candidates.some(x=>x.symbol==='POPUSDT'));
 assert.ok(result.observation.candidates.every(x=>x.price_only_not_future_direction));
 assert.ok(result.observation.candidates.find(x=>x.symbol==='KRW-POP').turnover5_est_krw>0);
 assert.equal(result.observation.candidates.some(x=>x.symbol==='STOCKUSDT'),false);
 assert.equal(result.observation.verified_futures,104);
});
test('official Bithumb warning/halts and non-crypto futures excluded without exception',()=>{
 const old=v23TickerBundle({},feeds(),NOW).next;
 const t=NOW+300000,data=feeds(t,true);
 data.bithumb_warnings=[{market:'KRW-POP'}];
 const r=v23TickerBundle(old,data,t);
 assert.equal(r.observation.candidates.some(x=>x.symbol==='KRW-POP'),false);
 assert.equal(r.observation.candidates.some(x=>x.symbol==='POPUSDT'),true);
 data.bitget_instruments=data.bitget_instruments.map(x=>
  x.symbol==='POPUSDT'?{...x,symbolType:'metal',instrumentType:'metal'}:x);
 const q=v23TickerBundle(old,data,t);
 assert.equal(q.observation.candidates.length,0);
});
test('KST midnight resets cumulative day turnover, not fake 5m liquidity',()=>{
 const midnight=Date.parse('2026-11-01T14:59:00Z');
 const next=midnight+300000,first=feeds(midnight),second=feeds(next,true);
 const past=v23TickerBundle({},first,midnight).next;
 const x=v23TickerBundle(past,second,next);
 assert.equal(x.observation.candidates.some(y=>y.symbol==='KRW-POP'),false);
 assert.equal(x.observation.candidates.some(y=>y.symbol==='POPUSDT'),true);
});
test('valid taker sample is partial not manufactured CVD, wrong future direction not asserted',()=>{
 const r=v23SampleTaker([{side:'sell',price:'1',size:'4',ts:NOW-20000,tradeId:'1'},
   {side:'buy',price:'1',size:'2',ts:NOW-15000,tradeId:'2'}],'bitget',NOW);
 assert.equal(r.status,'SAMPLE_AVAILABLE');
 assert.ok(r.buy_share<.5);
 assert.equal(r.marketwide,false);
 const msg=v23Message({venue:'bitget',symbol:'POPUSDT',move_pct:2.3,price:1.02,
  spread_pct:.1,quote_24h_usdt:3000000,price_acceleration_pct:1.2},r,NOW);
 assert.match(msg,/방향 예측 아님/);
 assert.match(msg,/매수·롱·숏 진입 신호나 미래 수익 보장은 아닙니다/);
});
test('actual Bithumb ticker epoch is UTC+9 but UTC trade_date/trade_time is correctly used',()=>{
 const old=feeds(NOW),later=feeds(NOW+300000,true);
 for(const [d,time] of [[old,NOW],[later,NOW+300000]]){
   for(const r of d.bithumb_tickers){
     const iso=new Date(time-1000).toISOString();
     r.timestamp=time+9*3600000-1000;
     r.trade_timestamp=time+9*3600000-1000;
     r.trade_date=iso.slice(0,10).replaceAll('-','');
     r.trade_time=iso.slice(11,19).replaceAll(':','');
   }
 }
 const start=v23TickerBundle({},old,NOW).next;
 const result=v23TickerBundle(start,later,NOW+300000);
 assert.ok(result.observation.candidates.some(x=>x.symbol==='KRW-POP'),
    'A valid real UTC timestamp must not be rejected as nine hours in the future');
});
test('Bithumb recent public trade samples use true timestamp, not missing trade_timestamp',()=>{
 const sample=v23SampleTaker([
 {timestamp:NOW-1000,ask_bid:'BID',trade_price:100,trade_volume:10,sequential_id:1},
 {timestamp:NOW-2000,ask_bid:'ASK',trade_price:100,trade_volume:4,sequential_id:2}
 ],'bithumb',NOW);
 assert.equal(sample.status,'SAMPLE_AVAILABLE');
 assert.equal(sample.trades,2);
 assert.ok(sample.buy_share>.5);
});
test('actual mock Telegram ACK increments exactly once; duplicate 5m episode rejected',async()=>{
 const now=NOW,state={},sent=[],store=[];
 const base=feeds(now),current=feeds(now+300000,true);
 const messages=async(_env,msg)=>{sent.push(msg);return {message_id:550};};
 const opts={
   send:messages,
   receipt:(state,channel,sym,now,ack)=>{store.push({channel,sym,at:now,id:ack.message_id});
     state.telegramAcknowledgementsTotal=(state.telegramAcknowledgementsTotal||0)+1;
     return {channel,symbol:sym,accepted_at:new Date(now).toISOString()};},
   persistReceipt:async()=>true
 };
 const first=await v23ScoutTick({},state,now,{...opts,read:mockReader(base)});
 assert.equal(first.status,'BASELINE_WARMING_OR_TIME_GAP');
 assert.equal(first.sent,0);
 const second=await v23ScoutTick({},state,now+300000,{...opts,read:mockReader(current)});
 assert.equal(second.status,'TELEGRAM_API_ACK');
 assert.equal(second.sent,1);
 assert.equal(sent.length,1);
 assert.equal(store.length,1);
 assert.equal(store[0].channel,'V23_DIRECT_FAST_MARKET_WATCH');
 const after=feeds(now+600000,true);
 after.bithumb_tickers[0].trade_price=104;
 after.bitget_tickers[0].lastPr='1.04';
 after.bitget_tickers[0].bidPr='1.038';after.bitget_tickers[0].askPr='1.04';
 await v23ScoutTick({},state,now+600000,{...opts,read:mockReader(after)});
 assert.ok(sent.length<=2);
});
test('missing exchange read never sends or overwrites previous tape with fake zeros',async()=>{
 const state={v23ScoutTape:{at_ms:NOW,spot:{'KRW-POP':[1,2,3]},futures:{}}};
 const prior=JSON.stringify(state.v23ScoutTape);
 const z=await v23ScoutTick({},state,NOW+300000,{
  read:async()=>{throw Error('EXCHANGE_OFFLINE')},
  send:async()=>{throw Error('SHOULD_NOT_SEND')}});
 assert.equal(z.status,'BOTH_VENUES_UNAVAILABLE_NO_BASELINE_CHANGE');
 assert.equal(z.sent,0);
 assert.equal(JSON.stringify(state.v23ScoutTape),prior);
});
test('failed Bot API ACK never updates sent, lock or receipt',async()=>{
 const first=feeds(NOW),current=feeds(NOW+300000,true);
 const state={v23ScoutTape:v23TickerBundle({},first,NOW).next};
 const z=await v23ScoutTick({},state,NOW+300000,{
   read:mockReader(current),send:async()=>({ok:true}),
   receipt:()=>{throw Error('RECEIPT_MUST_NOT_EXIST')}
 });
 assert.equal(z.status,'TELEGRAM_SEND_NOT_VERIFIED');
 assert.equal(z.sent,0);
 assert.equal(state.v23ScoutHourly.count,0);
 assert.equal(Object.keys(state.v23ScoutNotices||{}).length,0);
});
test('no fraudulent LIVE prediction direction is promoted from ticker/volume only',()=>{
 const first=v23TickerBundle({},feeds(),NOW).next;
 const r=v23TickerBundle(first,feeds(NOW+300000,true),NOW+300000);
 for(const c of r.observation.candidates){
   assert.equal(c.price_only_not_future_direction,true);
   assert.ok(!('signal' in c));
   assert.equal(c.warning_checked,true);
 }
});

test('one failed Bitget official feed never blocks healthy Bithumb WATCH delivery',async()=>{
 const base=feeds(NOW),after=feeds(NOW+300000,true);
 const previous=v23TickerBundle({},base,NOW).next;
 const state={v23ScoutTape:previous,lastAlert:{}};
 let sent=0;
 const read=async url=>{
  if(url.includes('api.bitget.com'))throw Error('HTTP_403_OFFICIAL_BITGET_FROM_CLOUDFLARE');
  return mockReader(after)(url);
 };
 const result=await v23ScoutTick({},state,NOW+300000,{
  read,send:async()=>{sent++;return {message_id:880}},
  receipt:()=>({channel:'V23_DIRECT_FAST_MARKET_WATCH'}),
  persistReceipt:async()=>true
 });
 assert.equal(result.status,'TELEGRAM_API_ACK');
 assert.equal(result.sent,1);
 assert.equal(result.sent_venue,'bithumb');
 assert.equal(result.sent_symbol,'KRW-POP');
 assert.equal(sent,1);
 assert.ok(result.read_errors.some(x=>x.includes('bitget')));
 assert.deepEqual(state.v23ScoutTape.futures,previous.futures,
   'failed venue baseline cannot be overwritten with an empty object');
});
test('one failed Bithumb feed never blocks current verified crypto Bitget market WATCH',async()=>{
 const base=feeds(NOW),after=feeds(NOW+300000,true);
 const previous=v23TickerBundle({},base,NOW).next;
 const state={v23ScoutTape:previous};
 let calls=0;
 const read=async url=>{
   if(url.includes('api.bithumb.com'))throw Error('BITHUMB_CURRENT_SOURCE_OFFLINE');
   return mockReader(after)(url);
 };
 const result=await v23ScoutTick({},state,NOW+300000,{
  read,send:async()=>{calls++;return {message_id:881}},
  receipt:()=>({channel:'V23_DIRECT_FAST_MARKET_WATCH'}),
  persistReceipt:async()=>true
 });
 assert.equal(result.status,'TELEGRAM_API_ACK');
 assert.equal(result.sent,1);
 assert.equal(result.sent_venue,'bitget');
 assert.equal(result.sent_symbol,'POPUSDT');
 assert.equal(calls,1);
 assert.deepEqual(state.v23ScoutTape.spot,previous.spot,
   'failed spot source must not destroy its most recent good baseline');
});
test('partial venue outage without a measurable move persists valid side and never sends',async()=>{
 const first=feeds(NOW),after=feeds(NOW+300000,false);
 const previous=v23TickerBundle({},first,NOW).next;
 const state={v23ScoutTape:previous};
 const result=await v23ScoutTick({},state,NOW+300000,{
  read:async url=>{
    if(url.includes('api.bitget.com'))throw Error('HTTP_503_BITGET');
    return mockReader(after)(url);
  },
  send:async()=>{throw Error('NO_MOVER_MUST_NOT_SEND')}
 });
 assert.equal(result.status,'NO_SIGNIFICANT_FIRST_IMPULSE');
 assert.ok(result.observed>0);
 assert.equal(result.sent,0);
 assert.equal(state.v23ScoutTape.at_ms,NOW+300000);
});
