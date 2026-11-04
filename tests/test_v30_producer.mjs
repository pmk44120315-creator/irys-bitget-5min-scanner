import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../deployment/v30_producer.mjs',import.meta.url),T=1793729400000;
async function mod(){assert(existsSync(url),'reliable public paired producer missing');return import(url)}
function environment(failFutures=false){
 let now=T;const names=Array.from({length:105},(_,i)=>'KRW-C'+i),futs=Array.from({length:120},(_,i)=>'F'+i+'USDT');
 const first=()=>now===T;
 const direction=s=>Number(s.match(/\d+/)?.[0]||0)%2===0?'LONG':'SHORT';
 const price=s=>s.startsWith('KRW-')?(first()?100:101):(direction(s)==='LONG'?(first()?100:101):(first()?104:103));
 const quote=s=>({bid:price(s),ask:price(s)+.05,at_ms:now-10});
 const trades=s=>Array.from({length:4},(_,i)=>({id:(first()?'a':'b')+i,at_ms:now-6500+i*2000,price:direction(s)==='SHORT'&&!s.startsWith('KRW-')?price(s)+(first()?1.2:.6)-i*(first()?.4:.2):price(s)-(first()?1.2:.6)+i*(first()?.4:.2),size:10,side:direction(s)==='SHORT'&&!s.startsWith('KRW-')?'SELL':'BUY'}));
 const seen=[];
 const read=async raw=>{
  const u=new URL(raw);seen.push(u.pathname);
  if(u.hostname==='api.bitget.com'&&failFutures)throw Error('PUBLIC_HTTP_403');
  if(u.pathname.endsWith('/market/all'))return names.map(market=>({market,market_warning:'NONE'}));
  if(u.pathname.endsWith('/virtual_asset_warning'))return [];
  if(u.pathname==='/v1/ticker')return u.searchParams.get('markets').split(',').map((market,i)=>({market,trade_price:i<8?100:98,trade_timestamp:now-10,acc_trade_price:1020000,signed_change_rate:0}));
  if(u.pathname==='/v1/orderbook')return u.searchParams.get('markets').split(',').map(market=>({market,timestamp:now-10,orderbook_units:[{bid_price:quote(market).bid,ask_price:quote(market).ask}]}));
  if(u.pathname==='/v1/trades/ticks')return trades(u.searchParams.get('market')).map(t=>({sequential_id:t.id,timestamp:t.at_ms,trade_price:t.price,trade_volume:t.size,ask_bid:'BID'}));
  if(u.pathname.endsWith('/instruments'))return {code:'00000',data:futs.map(symbol=>({symbol,symbolType:'crypto',instrumentType:'crypto'}))};
  if(u.pathname.endsWith('/contracts'))return {code:'00000',data:futs.map(symbol=>({symbol,symbolType:'perpetual',symbolStatus:'normal',quoteCoin:'USDT'}))};
  if(u.pathname.endsWith('/tickers')||u.pathname.endsWith('/ticker')){
   const wanted=u.searchParams.get('symbol');return {code:'00000',data:(wanted?[wanted]:futs).map(symbol=>({symbol,lastPr:price(symbol),bidPr:quote(symbol).bid,askPr:quote(symbol).ask,ts:now-10,usdtVolume:10000}))};
  }
  if(u.pathname.endsWith('/fills'))return {code:'00000',data:trades(u.searchParams.get('symbol')).map(t=>({tradeId:t.id,ts:t.at_ms,price:t.price,size:t.size,side:t.side.toLowerCase()}))};
  throw Error('UNEXPECTED_ENDPOINT_'+u.pathname);
 };
 const state={market:{futures:{at_ms:T-300000,prices:Object.fromEntries(futs.map(s=>[s,direction(s)==='LONG'?98:106]))}}};
 const legacy={spot_at_ms:T-300000,spot:Object.fromEntries(names.map(s=>[s,[98,1000000]]))};
 return {read,clock:()=>now,sleep:async ms=>{now+=ms},state,legacy,seen};
}
test('all selected candidates are checked, without the old arbitrary six-candidate ceiling',async()=>{
 const p=await mod(),e=environment();const {report}=await p.v30Produce({read:e.read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test'});
 assert(report.summary.selected>6,JSON.stringify(report.summary));assert.equal(report.summary.evaluated,report.summary.selected);assert.equal(report.summary.unreviewed,0);
 assert(report.items.some(x=>x.candidate.direction==='SHORT'));assert(report.items.some(x=>x.candidate.direction==='BUY'));
 assert(report.summary.ready>0);assert.equal(report.orders_sent,false);assert.equal(report.telegram_sent,false);
});
test('one venue HTTP failure is visible and cannot kill independent valid spot evidence',async()=>{
 const p=await mod(),e=environment(true);const {report}=await p.v30Produce({read:e.read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test'});
 assert(report.summary.provider_errors.bitget);assert(report.items.some(x=>x.candidate.venue==='bithumb'));assert(!report.items.some(x=>x.candidate.venue==='bitget'));
});
test('only future quotes inside their actual target window count; original evidence stays fixed',async()=>{
 const p=await mod(),row={id:'x',model:'V30',venue:'bitget',symbol:'TESTUSDT',direction:'LONG',issued_at_ms:T,entry_quote:{bid:100,ask:100.1,at_ms:T},outcomes:{},evidence_status:'READY_CURRENT_EVIDENCE'};
 const r=p.v30Settle([row],[{venue:'bitget',symbol:'TESTUSDT',bid:101,ask:101.1,at_ms:T+300000}],T+300000);
 assert.equal(r[0].outcomes['5'].status,'MEASURED_PUBLIC_QUOTE');assert.equal(row.outcomes['5'],undefined);
 const x=p.v30Settle([row],[],T+500000);assert.equal(x[0].outcomes['5'].status,'UNMEASURED_TARGET_QUOTE');
 assert.equal(x[0].entry_quote.ask,100.1);
});
export {environment,T};
