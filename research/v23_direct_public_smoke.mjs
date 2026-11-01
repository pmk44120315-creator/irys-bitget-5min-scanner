/** V23 real-exchange source smoke, never sends Telegram or changes Cloudflare.
 * Check Bithumb official market/risk/ticker coverage and Bitget official V3
 * crypto classification + V2 best bid/ask tickers in a single current read.
 */
import {v23ReadFeeds,v23TickerBundle} from '../deployment/v23_direct_market_scout.mjs';
const now=Date.now();
const reader=async url=>{
 const response=await fetch(url,{
   headers:{accept:'application/json','user-agent':'IRYS-ReadOnly-Market-Scout/1.0'},
   signal:AbortSignal.timeout(17000)});
 if(!response.ok)throw Error('REAL_EXCHANGE_HTTP_'+response.status+' '+new URL(url).pathname);
 return await response.json();
};
const start=Date.now();
const {feeds,failures}=await v23ReadFeeds(reader);
const report=v23TickerBundle({},feeds,now).observation;
const crypto=new Set(feeds.bitget_instruments.filter(x=>String(x?.symbolType).toLowerCase()==='crypto'
  &&String(x?.instrumentType).toLowerCase()==='crypto').map(x=>x.symbol));
const matched=feeds.bitget_tickers.filter(x=>crypto.has(x.symbol));
const spot=new Set(feeds.bithumb_markets.filter(x=>/^KRW-/.test(x?.market||'')).map(x=>x.market));
const spotMapped=feeds.bithumb_tickers.filter(x=>spot.has(x.market));
const summary={
  verified_at_utc:new Date().toISOString(),fetch_duration_ms:Date.now()-start,
  failed_provider_feeds:failures,bitget_crypto_instruments:crypto.size,
  bitget_crypto_current_tickers:matched.length,
  bitget_current_spreads_finite:matched.filter(x=>+x.bidPr>0&&+x.askPr>=+x.bidPr).length,
  bithumb_krw_markets:spot.size,bithumb_active_tickers:spotMapped.length,
  bitget_first_3_crypto_samples:matched.slice(0,3).map(x=>({
    symbol:x.symbol,ts:x.ts,has_bidask:!!x.bidPr&&!!x.askPr})),
  bithumb_first_3_current:spotMapped.slice(0,3).map(x=>({
    market:x.market,trade_timestamp:x.trade_timestamp,acc_trade_price_present:x.acc_trade_price!==undefined})),
  cold_start_correctly_warms_without_messages:report.status==='WARMUP_OR_GAP'
     &&report.candidates.length===0,
  telegram_sent:false,cloudflare_touched:false,model_winner_claimed:false};
console.log('V23_ACTUAL_LIVE_PROVIDER_SMOKE',JSON.stringify(summary));
if(failures.length||crypto.size<100||matched.length<100||spot.size<100||
   spotMapped.length<spot.size*.95||!summary.cold_start_correctly_warms_without_messages)
  throw Error('V23_ACTUAL_PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
