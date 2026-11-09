/** V45 adds candle context to the existing official quote publication.
 * Fetch indicator data first, then obtain the final executable quotes.
 * Indicator outages are visible and never invalidate the old quote transport.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {dirname} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {v30Qualify} from './v30_core.mjs';import {publicReader} from './v30_producer.mjs';
import {v421ProduceQuotes} from './v421_runner_quote.mjs';import {V45_VERSION,v45ClosedBars} from './v45_rsi_context.mjs';
async function v45ProduceQuotePacket({doc,publishedCommit,read,clock=Date.now}){
 const candidates=(doc?.items||[]).filter(x=>v30Qualify(x,clock()).allowed),contexts=[];
 for(const item of candidates){const c=item.candidate,context={venue:c.venue,symbol:c.symbol,source:'OFFICIAL_NATIVE_CANDLES',fetched_at_ms:clock(),frames:{},errors:[]};
  for(const minutes of [1,5]){try{
   const at=clock(),end=Math.floor(at/(minutes*60000))*minutes*60000;
   const params=c.venue==='bitget'?{symbol:c.symbol,productType:'USDT-FUTURES',granularity:minutes+'m',endTime:String(end),limit:'200'}:{market:c.symbol,count:'200'};
   const url=(c.venue==='bitget'?'https://api.bitget.com/api/v2/mix/market/history-candles':'https://api.bithumb.com/v1/candles/minutes/'+minutes)+'?'+new URLSearchParams(params);
   const raw=await read(url),received=clock();context.frames[minutes]={bars:v45ClosedBars(raw,c.venue,c.symbol,minutes,received),raw_sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),received_at_ms:received};
  }catch(e){context.errors.push({timeframe_minutes:minutes,reason:'ORIGINAL_CANDLE_CONTEXT_UNAVAILABLE'});}}
  context.fetched_at_ms=clock();contexts.push(context);
 }
 const result=await v421ProduceQuotes(doc,{publishedCommit,read,clock});
 return {...result,entry_context_version:V45_VERSION,entry_contexts:contexts,entry_context_summary:{eligible_contexts:candidates.length,contexts:contexts.length,frame_errors:contexts.reduce((n,c)=>n+c.errors.length,0),hard_entry_filter_added:false,forecast_accuracy_proven:false}};
}
async function main(){const output=process.argv[2];if(!output)throw Error('OUTPUT_REQUIRED');const doc=JSON.parse(readFileSync('data/v30_direction_latest.json','utf8'));
 const result=await v45ProduceQuotePacket({doc,publishedCommit:process.env.V30_PUBLISHED_COMMIT,read:publicReader()});
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result)+'\n');
 console.log('V45_CONTEXT_AND_QUOTE_PUBLICATION',JSON.stringify({version:result.version,entry_context_version:result.entry_context_version,source_packet_at_ms:result.source_packet_at_ms,quotes:result.quotes.length,errors:result.errors,context:result.entry_context_summary,orders_sent:false,telegram_sent:false}));
 if(result.errors.length)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V45_QUOTE_PRODUCER_FAILED',String(e.message).slice(0,140));process.exitCode=1});
export {v45ProduceQuotePacket};
