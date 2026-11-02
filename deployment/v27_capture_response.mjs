/** Public-market enrichment. Never Telegram, accounts, or orders. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {v27Quote,v27EffortResponse} from './v27_response.mjs';
async function v27Capture(source,api,clock=Date.now){
 const now=clock();
 if(source?.version!=='IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1'||source?.source_identity!=='V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO'||
    !Number.isSafeInteger(source.at_ms)||source.at_ms>now||now-source.at_ms>90000||!Array.isArray(source.candidates))throw Error('SOURCE_NOT_FRESH_VERIFIED_CRYPTO');
 const tapes={},errors={};
 for(const c of source.candidates){
  if(c.venue!=='bitget'||c.identity_verified_v3_crypto!==true||c.active_contract_verified_v2!==true||typeof c.symbol!=='string')continue;
  try{const x=await api('/api/v2/mix/market/fills',{symbol:c.symbol,productType:'USDT-FUTURES',limit:100});
   if(x.code!=='00000'||!Array.isArray(x.data))throw Error('PUBLIC_TAPE_SCHEMA');tapes[c.symbol]=x.data;
  }catch(e){errors[c.symbol]=String(e.message||'TAPE_UNAVAILABLE').slice(0,100);}
 }
 // Requote AFTER sample collection; no stale cached ticker presented as current.
 const data=await api('/api/v2/mix/market/tickers',{productType:'USDT-FUTURES'});
 if(data.code!=='00000'||!Array.isArray(data.data))throw Error('CURRENT_TICKERS_UNAVAILABLE');
 const at=clock(),quotes={},responses={};
 for(const t of data.data){
  if(!Object.hasOwn(source.prices||{},t.symbol))continue;
  const q=v27Quote({bid:t.bidPr,ask:t.askPr,at_ms:Number(t.ts)},at),last=Number(t.lastPr);
  if(q&&Number.isFinite(last)&&last>0)quotes[t.symbol]=[q.bid,q.ask,q.at_ms,last];
 }
 if(Object.keys(quotes).length<100)throw Error('QUOTE_UNIVERSE_INCOMPLETE');
 for(const c of source.candidates){const q=quotes[c.symbol];
  responses[c.symbol]=v27EffortResponse(tapes[c.symbol],'bitget',at,q?100*(q[1]/q[0]-1):null,c.symbol);}
 return {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:at,parent_at_ms:source.at_ms,
  source,quotes,responses,tape_errors:errors,source_is_public:true,
  not_full_cvd:true,future_direction_proven:false,orders_sent:false,telegram_sent:false};
}
async function main(){
 let next=0;
 async function api(path,params){
  const delay=Math.max(0,next-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));next=Date.now()+220;
  const r=await fetch('https://api.bitget.com'+path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('PUBLIC_HTTP_'+r.status);return r.json();
 }
 const source=JSON.parse(readFileSync('data/v24_bitget_fast_latest.json','utf8'));
 const report=await v27Capture(source,api);
 writeFileSync('data/.v27_response_tmp.json',JSON.stringify(report));renameSync('data/.v27_response_tmp.json','data/v27_bitget_response_latest.json');
 console.log('V27_PUBLIC_RESPONSE',JSON.stringify({at_ms:report.at_ms,parent_at_ms:report.parent_at_ms,
  quotes:Object.keys(report.quotes).length,responses:Object.values(report.responses).reduce((a,r)=>(a[r.state||r.status]=(a[r.state||r.status]||0)+1,a),{}),
  errors:report.tape_errors,orders_sent:false,telegram_sent:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V27_CAPTURE_FAILED',String(e.message||e));process.exitCode=1;});
export {v27Capture};
