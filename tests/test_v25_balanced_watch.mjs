import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {v25BalancedTop,v25HourlyView,v25ChooseNotice} from '../deployment/v25_balanced_watch.mjs';
import {v23TickerBundle,v23ScoutTick} from '../deployment/v23_direct_market_scout.mjs';

const NOW=Date.parse('2026-11-01T11:50:00Z'); // 20:50 KST
const hour=Math.floor(NOW/3600000);
const row=(venue,symbol,priority)=>({venue,symbol,priority});
const both={bithumb:true,bitget:true};
const onlySpot={bithumb:true,bitget:false};

test('preserve total hourly budget, reserve one notice per venue when both sources are verified',()=>{
 const choices=[row('bithumb','KRW-POP',9),row('bitget','MOVERUSDT',5)];
 const hourly={hour,count:1,by_venue:{bithumb:1,bitget:0}};
 const pick=v25ChooseNotice(choices,hourly,both);
 assert.equal(pick.status,'PASS');
 assert.equal(pick.target.symbol,'MOVERUSDT');
 hourly.count=2;hourly.by_venue.bitget=1;
 assert.equal(v25ChooseNotice(choices,hourly,both).status,'DELIVERY_RATE_PACED');
});
test('when Bitget source genuinely unavailable, two Bithumb observations remain allowed',()=>{
 const h={hour,count:1,by_venue:{bithumb:1,bitget:0}};
 assert.equal(v25ChooseNotice([row('bithumb','KRW-POP',1)],h,onlySpot).status,'PASS');
 assert.equal(v25ChooseNotice([row('bithumb','KRW-POP',1)],h,both).status,'DELIVERY_VENUE_RESERVED');
});
test('live V24 hourly migration uses only same-hour successful notice timestamps',()=>{
 const old={hour,count:1},last={
  'bithumb:KRW-POP':NOW-10*60000,'bitget:ANCIENTUSDT':NOW-5*3600000};
 const v=v25HourlyView(old,last,NOW);
 assert.equal(v.count,1);
 assert.deepEqual(v.by_venue,{bithumb:1,bitget:0});
 assert.equal(v25ChooseNotice([row('bitget','MOVERUSDT',1)],v,both).status,'PASS');
 const rolled=v25HourlyView(v,last,NOW+3600000);
 assert.equal(rolled.count,0);
 assert.deepEqual(rolled.by_venue,{bithumb:0,bitget:0});
});
test('top-12 selection cannot starve verified Bitget when Bithumb has 20 higher-ranked observations',()=>{
 const pool=Array.from({length:20},(_,i)=>row('bithumb','KRW-X'+i,100-i));
 pool.push(row('bitget','MOVERUSDT',1));
 const chosen=v25BalancedTop(pool,12);
 assert.equal(chosen.length,12);
 assert.equal(chosen.filter(x=>x.venue==='bitget').length,1);
 assert.equal(chosen.filter(x=>x.venue==='bithumb').length,11);
 assert.equal(v25BalancedTop(pool.slice(0,7),12).length,7);
});
test('standalone watcher helper and Cloudflare V24 integration keep identical fair-distribution code',()=>{
 const m=readFileSync(new URL('../deployment/v23_direct_market_scout.mjs',import.meta.url),'utf8');
 const w=readFileSync(new URL('../deployment/IRYS_V24_BITGET_FALLBACK_WORKER.mjs',import.meta.url),'utf8');
 const section=s=>s.split('function v25BalancedTop(rows,max=12){')[1].split('async function v23ScoutTick(env,state,now,options={}){')[0];
 assert.ok(section(m).includes('v25ChooseNotice'));
 assert.equal(section(m),section(w));
 assert.ok(w.includes('state.v23ScoutHourly.by_venue[target.venue]++;'));
 assert.ok(w.includes('V20_EXPERIMENTAL_DIRECTIONAL_DELIVERY_APPROVED=false'));
});
function twoVenueMarket(now,up=false){
 const ms=Array.from({length:103},(_,i)=>({market:i===0?'KRW-POP':'KRW-X'+i,market_warning:'NONE'}));
 return {markets:ms, warnings:[],tickers:ms.map((m,i)=>({
  market:m.market,trade_price:i===0&&up?103:100,
  acc_trade_price:(i===0?400000000:100000000)+(up&&i===0?35000000:0),
  trade_timestamp:now-1000,market_state:'ACTIVE',is_trading_suspended:false
 }))};
}
function fastDoc(now){
 const at=now-3*60000;
 return {version:'IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1',status:'MARKET_COMPARISON_PASS',
   venue:'bitget',at_ms:at,at_utc:new Date(at).toISOString(),
   source_identity:'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO',
   not_full_orderbook_or_marketwide_cvd:true,not_profitable_future_direction_proof:true,
   trade_data_included:false,active_verified_crypto_count:465,actual_official_tickers_count:465,
   candidates:[{venue:'bitget',symbol:'MOVERUSDT',price:1.2,move_pct:1.4,priority:4,
    spread_pct:.03,quote_24h_usdt:4000000,
    price_timestamp_ms:at-1000,price_acceleration_pct:.4,
    identity_verified_v3_crypto:true,active_contract_verified_v2:true,
    price_only_not_future_direction:true,source:'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST'}]};
}
function fakeRead(market,now){
 return async url=>{
  if(url.includes('market/all'))return market.markets;
  if(url.includes('virtual_asset_warning'))return market.warnings;
  if(url.includes('/v1/ticker'))return market.tickers;
  if(url.includes('raw.githubusercontent.com'))return fastDoc(now);
  if(url.includes('/v1/trades/ticks'))return [];
  if(url.includes('api.bitget.com'))throw Error('CF_EGRESS_403');
  throw Error('UNEXPECTED_URL');
 };
}
test('real watcher routes Bitget after Bithumb already used one slot; sends NO orders',async()=>{
 const before=twoVenueMarket(NOW-300000),current=twoVenueMarket(NOW,true);
 const tape=v23TickerBundle({},{
  bithumb_markets:before.markets,bithumb_warnings:[],bithumb_tickers:before.tickers
 },NOW-300000,{bithumb:true,bitget:false}).next;
 const state={v23ScoutTape:tape,v23ScoutHourly:{hour,count:1},
  v23ScoutNotices:{'bithumb:KRW-OTHER':NOW-10*60000}};
 let calls=0,body='';
 const result=await v23ScoutTick({},state,NOW,{
  read:fakeRead(current,NOW),
  send:async(_env,msg)=>{calls++;body=msg;return {message_id:72};},
  receipt:()=>({channel:'V23_DIRECT_FAST_MARKET_WATCH'}),
  persistReceipt:async()=>true
 });
 assert.equal(result.status,'TELEGRAM_API_ACK');
 assert.equal(result.sent_venue,'bitget');
 assert.equal(result.sent_symbol,'MOVERUSDT');
 assert.equal(calls,1);
 assert.equal(state.v23ScoutHourly.count,2);
 assert.equal(state.v23ScoutHourly.by_venue.bitget,1);
 assert.match(body,/미래 방향 확인 아님/);
 assert.equal(result.original_directional_channels_untouched,true);
});
test('both-venue notice budget cannot be bypassed after two acknowledged sends',async()=>{
 const state={v23ScoutHourly:{hour,count:2,by_venue:{bithumb:1,bitget:1}}};
 const result=await v23ScoutTick({},state,NOW,{
  read:fakeRead(twoVenueMarket(NOW,true),NOW),
  send:async()=>{throw Error('MUST_NOT_SEND_WHEN_RATE_PACED')}
 });
 assert.notEqual(result.status,'TELEGRAM_API_ACK');
 assert.equal(result.sent,0);
});
