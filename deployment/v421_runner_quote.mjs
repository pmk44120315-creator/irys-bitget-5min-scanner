/** V42.1: post-publication original Bitget quotes over the existing trusted
 * GitHub runner path. Never substitute the old pair's final quote, relax its
 * age limit, use a private account API, or claim a forecast-performance gain.
 */
import {v29Quote} from './v29_direction_gate.mjs';
import {v30ValidatePacket} from './v30_core.mjs';
import {v30ReviewAndDeliver,v30FormatSignal} from './v30_delivery.mjs';
import {v42ReadFinalQuote,v42PublicAckHistory} from './v42_dispatch_evidence.mjs';
const V421_VERSION='V421_OFFICIAL_POST_PUBLICATION_QUOTES_V1';
const V421_FEED='https://api.github.com/repos/pmk44120315-creator/irys-bitget-5min-scanner/contents/data/v421_dispatch_quotes.json';
const v421Clock=x=>Number.isSafeInteger(x)&&x>=0;
const v421Symbol=x=>typeof x==='string'&&/^[A-Z0-9]{1,25}USDT$/.test(x);
async function v421ProduceQuotes(doc,{publishedCommit,read,clock=Date.now}={}){
 const started=clock();
 if(!v421Clock(started)||!v30ValidatePacket(doc,started,doc?.model_digest).ok||typeof publishedCommit!=='string'||!/^[a-f0-9]{40}$/.test(publishedCommit)||typeof read!=='function')throw Error('RUNNER_INPUT_IDENTITY_INVALID');
 const out={version:V421_VERSION,source:'OFFICIAL_PUBLIC_RUNNER_POST_PUBLICATION',source_packet_at_ms:doc.at_ms,
  source_model_digest:doc.model_digest,published_source_commit:publishedCommit,read_started_at_ms:started,
  sampled_at_ms:started,orders_sent:false,telegram_sent:false,quotes:[],errors:[]};
 const items=doc.items.filter(x=>x?.candidate?.venue==='bitget'&&v421Symbol(x.candidate.symbol));
 if(!items.length)return out;
 try{
  const r=await read('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES',
    {headers:{accept:'application/json','cache-control':'no-cache'}},12000);
  const finished=clock();if(!v421Clock(finished)||finished<started)throw Error('CLOCK');
  out.sampled_at_ms=finished;
  if(r?.code!=='00000'||!Array.isArray(r.data))throw Error('SCHEMA');
  for(const item of items){
   const symbol=item.candidate.symbol,found=r.data.filter(q=>q?.symbol===symbol);
   if(found.length!==1||!v421Clock(item.final?.quote?.at_ms)||!v421Clock(item.second?.observed_at_ms))continue;
   const raw=found[0],q={bid:Number(raw.bidPr),ask:Number(raw.askPr),at_ms:Number(raw.ts)};
   if(!v29Quote(q,finished,15000)||q.at_ms<=item.final.quote.at_ms)continue;
   out.quotes.push({venue:'bitget',symbol,prior_quote_at_ms:item.final.quote.at_ms,
    paired_at_ms:item.second.observed_at_ms,...q});
  }
 }catch{out.errors.push('OFFICIAL_RUNNER_QUOTE_UNAVAILABLE');out.quotes=[];}
 return out;
}
function v421ValidateQuote(batch,item,doc,now){
 if(batch?.version!==V421_VERSION||batch.source!=='OFFICIAL_PUBLIC_RUNNER_POST_PUBLICATION'||batch.orders_sent!==false||batch.telegram_sent!==false||
  batch.source_packet_at_ms!==doc.at_ms||batch.source_model_digest!==doc.model_digest||
  typeof batch.published_source_commit!=='string'||!/^[a-f0-9]{40}$/.test(batch.published_source_commit)||
  !v421Clock(batch.sampled_at_ms)||batch.sampled_at_ms>now||now-batch.sampled_at_ms>15000||!Array.isArray(batch.quotes))return null;
 const found=batch.quotes.filter(x=>x?.venue==='bitget'&&x.symbol===item.candidate.symbol);
 if(found.length!==1)return null;
 const r=found[0];
 if(r.prior_quote_at_ms!==item.final.quote.at_ms||r.paired_at_ms!==item.second.observed_at_ms||
  r.at_ms<=item.final.quote.at_ms||r.at_ms>batch.sampled_at_ms)return null;
 return v29Quote(r,now,15000);
}
async function v421ReadRunnerQuote(item,doc,{read,clock=Date.now,githubToken,expectedDigest,sleep,maxWaitMs=15000}={}){
 const start=clock();
 if(item?.candidate?.venue!=='bitget'||!v421Symbol(item.candidate.symbol)||!v421Clock(item.final?.quote?.at_ms)||
  !v421Clock(item.second?.observed_at_ms)||typeof read!=='function'||typeof githubToken!=='string'||!githubToken||
  !v30ValidatePacket(doc,start,expectedDigest).ok)throw Error('RUNNER_REFRESH_INPUT_INVALID');
 if(!Number.isFinite(maxWaitMs)||maxWaitMs<0)throw Error('RUNNER_REFRESH_WAIT_INVALID');
 const deadline=Math.min(start+Math.min(maxWaitMs,15000),item.second.observed_at_ms+90000);
 const wait=sleep||(ms=>new Promise(r=>setTimeout(r,ms)));let reads=0;
 do{
  let batch;
  try{batch=await read(V421_FEED+'?ref=data%2Firys-v421-dispatch-quotes&generation='+clock(),
   {headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github.raw+json','User-Agent':'IRYS-official-quote-transport','cache-control':'no-cache'},cf:{cacheTtl:0}},12000);}catch{}
  reads++;const finish=clock();
  if(!v421Clock(finish)||finish<start)throw Error('RUNNER_REFRESH_CLOCK_INVALID');
  const q=v421ValidateQuote(batch,item,doc,finish);
  if(q&&v30ValidatePacket(doc,finish,expectedDigest).ok)return {...item,final:{venue:'bitget',symbol:item.candidate.symbol,observed_at_ms:finish,quote:q},
   dispatch_snapshot:{version:'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1',transport:'GITHUB_RUNNER_POST_PUBLICATION',
    transport_version:V421_VERSION,read_started_at_ms:start,read_completed_at_ms:finish,
    prior_quote_at_ms:item.final.quote.at_ms,provider_quote_at_ms:q.at_ms,prior_quote_age_ms:start-item.final.quote.at_ms,
    published_source_commit:batch.published_source_commit,reads,uses_new_official_quote:true,no_account_or_order_api:true}};
  const remaining=deadline-finish;if(remaining<=0)break;
  await wait(Math.min(1000,remaining));
 }while(clock()<=deadline);
 throw Error('RUNNER_REFRESH_UNAVAILABLE');
}
async function v421ReviewAndDeliver(env,state,requestedAt,options={}){
 const clock=options.clock||Date.now,stats={version:'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1',transport_version:V421_VERSION,
  attempted:0,verified:0,rejected:0,errors:0,reason_counts:{},safe_error_counts:{}};
 const output=await v30ReviewAndDeliver(env,state,requestedAt,{...options,
  refreshFinalQuote:async(item,doc)=>{
   stats.attempted++;
   try{return item.candidate.venue==='bitget'?await v421ReadRunnerQuote(item,doc,{read:options.read,clock,
     githubToken:env?.GITHUB_DISPATCH_TOKEN,expectedDigest:options.expectedDigest,sleep:options.sleep,maxWaitMs:options.runnerMaxWaitMs??15000}):
     await v42ReadFinalQuote(item,{read:options.read,clock});}
   catch(e){stats.errors++;const code=['RUNNER_REFRESH_INPUT_INVALID','RUNNER_REFRESH_WAIT_INVALID','RUNNER_REFRESH_CLOCK_INVALID','RUNNER_REFRESH_UNAVAILABLE',
    'DISPATCH_IDENTITY_OR_READER_INVALID','DISPATCH_OFFICIAL_QUOTE_IDENTITY','DISPATCH_OFFICIAL_QUOTE_CLOCK'].includes(e?.message)?e.message:'OFFICIAL_DISPATCH_PROVIDER_UNAVAILABLE';
    stats.safe_error_counts[code]=(stats.safe_error_counts[code]||0)+1;throw Error(code);}
  },
  onDispatchRecheck:(allowed,reason)=>{stats[allowed?'verified':'rejected']++;if(reason)stats.reason_counts[reason]=(stats.reason_counts[reason]||0)+1;},
  formatSignal:(p,at)=>v30FormatSignal(p,at).replace('[V35 방향 근거·후속 상태 확인]','[V42.1 발송 직전 방향 근거 확인]').replace('독립 신규 체결·호가 2회 확인 + 최종 호가 재확인','독립 체결·호가 2회 확인 + 새 공식 호가로 발송 직전 재검사')});
 output.dispatch_revalidation=stats;output.public_ack_history=v42PublicAckHistory(state.v30ActualForecasts||[],clock());
 output.forecast_accuracy_proven=false;return output;
}
export {V421_VERSION,v421ProduceQuotes,v421ReadRunnerQuote,v421ReviewAndDeliver};
