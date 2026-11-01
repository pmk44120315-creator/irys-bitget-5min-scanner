/** Strictly read-only Bithumb ticker vs trade clock, never user data or orders. */
const now=Date.now();
const urls=[
  'https://api.bithumb.com/v1/ticker?markets=KRW-BTC,KRW-ETH',
  'https://api.bithumb.com/v1/trades/ticks?market=KRW-BTC&count=3',
  'https://api.bitget.com/api/v2/mix/market/ticker?symbol=BTCUSDT&productType=USDT-FUTURES'
];
const values=await Promise.allSettled(urls.map(async url=>{
 const res=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(17000)});
 if(!res.ok)throw Error('HTTP '+res.status);
 return await res.json();
}));
const output={read_at_utc:new Date(now).toISOString(),now_ms:now,samples:[]};
for(let i=0;i<urls.length;i++){
 const p=values[i];if(p.status!=='fulfilled'){output.samples.push({market:i,error_type:p.reason?.constructor?.name||'API_ERROR'});continue;}
 const data=i===2?p.value.data:p.value;
 const a=Array.isArray(data)?data.slice(0,i===0?2:3):[];
 output.samples.push({source:i===0?'BITHUMB_TICKER':i===1?'BITHUMB_TRADES':'BITGET_TICKER',
   records:a.map(z=>({
    symbol:z.market||z.symbol,
    timestamp_ms:z.timestamp??null,
    trade_timestamp_ms:z.trade_timestamp??null,
    exchange_ts_ms:z.ts??null,
    response_timestamp_delta_sec:z.timestamp?Math.round((Number(z.timestamp)-now)/1000):null,
    trade_timestamp_delta_sec:z.trade_timestamp?Math.round((Number(z.trade_timestamp)-now)/1000):null,
    exchange_timestamp_delta_sec:z.ts?Math.round((Number(z.ts)-now)/1000):null,
    trade_date:z.trade_date??null,trade_time:z.trade_time??null,
    trade_date_kst:z.trade_date_kst??null,trade_time_kst:z.trade_time_kst??null,
    has_trade_side:z.ask_bid!==undefined})});
}
console.log('IRYS_PUBLIC_EXCHANGE_CLOCK_DIAGNOSTIC',JSON.stringify(output));
if(output.samples.some(x=>x.error_type))throw Error('SOME_EXCHANGE_TIME_FEEDS_UNAVAILABLE');
