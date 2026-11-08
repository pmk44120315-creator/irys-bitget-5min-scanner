/** Called immediately after actual public V30 publication. Public GET only. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {v421ProduceQuotes} from './v421_runner_quote.mjs';
const commit=process.env.V30_PUBLISHED_COMMIT,output=process.argv[2];
if(!output)throw Error('OUTPUT_REQUIRED');
const doc=JSON.parse(readFileSync('data/v30_direction_latest.json','utf8'));
const result=await v421ProduceQuotes(doc,{publishedCommit:commit,read:async(url,options)=>{
 if(!url.startsWith('https://api.bitget.com/api/v2/mix/market/tickers?'))throw Error('PUBLIC_ENDPOINT_MISMATCH');
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('PUBLIC_HTTP_'+r.status);return r.json();
}});
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result)+'\n');
console.log('V421_OFFICIAL_POST_PUBLICATION_QUOTES',JSON.stringify({version:result.version,source_packet_at_ms:result.source_packet_at_ms,
 published_source_commit:result.published_source_commit,sampled_at_ms:result.sampled_at_ms,quotes:result.quotes.length,errors:result.errors,
 orders_sent:false,telegram_sent:false}));
if(result.errors.length)process.exitCode=2;
