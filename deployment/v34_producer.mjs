/** Lightweight independent public producer; no account, Telegram or old state. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {V34_VERSION,v34ParseBars,v34Evaluate} from './v34_crash.mjs';
const ASSETS=['BTC','ETH','XRP'];
async function v34Produce({read,clock=Date.now,modelDigest}){
 if(typeof read!=='function'||typeof modelDigest!=='string'||!modelDigest)throw Error('READER_MODEL_REQUIRED');
 const started=clock(),sources=[],errors=[];
 await Promise.all(ASSETS.flatMap(asset=>['bithumb','bitget'].map(async venue=>{
  const symbol=venue==='bithumb'?'KRW-'+asset:asset+'USDT';
  const url=venue==='bithumb'?'https://api.bithumb.com/v1/candles/minutes/5?'+new URLSearchParams({market:symbol,count:'12'}):
   'https://api.bitget.com/api/v2/mix/market/history-candles?'+new URLSearchParams({symbol,productType:'USDT-FUTURES',granularity:'5m',endTime:String(clock()),limit:'12'});
  try{const raw=await read(url);if(venue==='bitget'&&raw?.code!=='00000')throw Error('SCHEMA');const data=venue==='bithumb'?raw:raw.data;
   if(!Array.isArray(data))throw Error('SCHEMA');const at=clock(),bars=v34ParseBars(data,venue,symbol,at);
   if(bars.length<4)throw Error('INCOMPLETE_CLOSED_BARS');sources.push({asset,venue,symbol,source:'OFFICIAL_NATIVE_5M_AND_QUOTES',bars,bar_fetched_at_ms:at});
  }catch{errors.push({venue,symbol,phase:'CANDLES',reason:'OFFICIAL_CANDLES_UNAVAILABLE_OR_INCOMPLETE'});}
 })));
 const quotes=new Map();
 await Promise.all([
  (async()=>{try{const raw=await read('https://api.bithumb.com/v1/orderbook?markets=KRW-BTC%2CKRW-ETH%2CKRW-XRP');if(!Array.isArray(raw))throw Error('SCHEMA');
   for(const b of raw){if(!ASSETS.some(a=>'KRW-'+a===b.market))continue;const q=b.orderbook_units?.[0];if(q)quotes.set('bithumb:'+b.market,{bid:Number(q.bid_price),ask:Number(q.ask_price),at_ms:Number(b.timestamp)});}
  }catch{errors.push({venue:'bithumb',phase:'QUOTE',reason:'OFFICIAL_QUOTE_UNAVAILABLE'});}})(),
  (async()=>{try{const raw=await read('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');if(raw?.code!=='00000'||!Array.isArray(raw.data))throw Error('SCHEMA');
   for(const q of raw.data)if(ASSETS.some(a=>a+'USDT'===q.symbol))quotes.set('bitget:'+q.symbol,{bid:Number(q.bidPr),ask:Number(q.askPr),at_ms:Number(q.ts)});
  }catch{errors.push({venue:'bitget',phase:'QUOTE',reason:'OFFICIAL_QUOTE_UNAVAILABLE'});}})()]);
 const at=clock(),items=sources.filter(x=>quotes.has(x.venue+':'+x.symbol)).map(x=>({...x,quote:quotes.get(x.venue+':'+x.symbol),fetched_at_ms:at}));
 const report={version:V34_VERSION,source:'OFFICIAL_PUBLIC_MARKETS',model_digest:modelDigest,started_at_ms:started,at_ms:at,items,provider_errors:errors,orders_sent:false,telegram_sent:false};
 report.summary=v34Evaluate(report,at,modelDigest);return report;
}
function v34ModelDigest(){const h=createHash('sha256');for(const name of ['v34_crash.mjs','v34_producer.mjs']){h.update(name+'\0');h.update(readFileSync(new URL(name,import.meta.url)));}return h.digest('hex');}
function v34PublicRead(){const next=new Map();return async url=>{const host=new URL(url).hostname;if(!['api.bithumb.com','api.bitget.com'].includes(host))throw Error('INVALID_PUBLIC_HOST');
 const slot=Math.max(Date.now(),next.get(host)||0);next.set(host,slot+230);if(slot>Date.now())await new Promise(r=>setTimeout(r,slot-Date.now()));
 const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('PUBLIC_HTTP_'+r.status);return r.json();};}
async function main(){const doc=await v34Produce({read:v34PublicRead(),modelDigest:v34ModelDigest()});writeFileSync('data/.v34_crash_tmp.json',JSON.stringify(doc));renameSync('data/.v34_crash_tmp.json','data/v34_crash_latest.json');
 console.log('V34_PUBLIC_RISK',JSON.stringify({at_ms:doc.at_ms,model_digest:doc.model_digest,items:doc.items.length,provider_errors:doc.provider_errors,summary:doc.summary,no_messages:true,no_orders:true}));if(doc.items.length===0)process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('V34_PUBLIC_RISK_FAILED');process.exitCode=1});
export {v34Produce,v34ModelDigest,v34PublicRead};
