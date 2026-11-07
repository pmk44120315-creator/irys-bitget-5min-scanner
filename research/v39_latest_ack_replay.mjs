/** Read-only reconstruction of the latest public Telegram API ACK.
 * Searches original commits strictly before the ACK, never uses post-ACK inputs
 * to construct the prediction. Later public candles are only outcome labels.
 * Does not read private Telegram chats or change production, KV or orders.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const REPO='pmk44120315-creator/irys-bitget-5min-scanner',MIN=60000,HOST='https://api.github.com/repos/'+REPO;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const approvedSymbol=(venue,symbol)=>venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(symbol):venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(symbol);
function validateAckSource(source,ackMs,symbol){
 if(!source||source.version!=='IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1'||source.source!=='OFFICIAL_PUBLIC_RUNNER'||
 source.telegram_sent!==false||source.orders_sent!==false||!Number.isSafeInteger(source.at_ms)||
 source.at_ms>ackMs||ackMs-source.at_ms>120000||!Array.isArray(source.items))return null;
 const matches=source.items.filter(x=>{
  const c=x.candidate||{},f=x.final||{},q=f.quote||{};
  return c.symbol===symbol&&['LONG','SHORT','BUY'].includes(c.direction)&&
   approvedSymbol(c.venue,symbol)&&Number.isSafeInteger(f.observed_at_ms)&&f.observed_at_ms<=ackMs&&
   Number.isSafeInteger(q.at_ms)&&q.at_ms<=ackMs&&ackMs-q.at_ms<=45000&&
   finite(q.bid)&&finite(q.ask)&&q.bid>0&&q.ask>=q.bid;
 });
 return matches.length===1?matches[0]:null;
}
function parseBars(raw,venue,now){
 const list=venue==='bitget'?raw?.code==='00000'&&Array.isArray(raw.data)?raw.data:null:Array.isArray(raw)?raw:null;
 if(!list)return {status:'SOURCE_UNAVAILABLE',bars:[]};
 const bars=[];
 for(const x of list){let t,o,h,l,c;
  if(venue==='bitget'){if(!Array.isArray(x)||x.length<5)continue;t=Number(x[0]);[o,h,l,c]=x.slice(1,5).map(Number);}
  else{t=Date.parse((x?.candle_date_time_utc||'')+'Z');[o,h,l,c]=[x?.opening_price,x?.high_price,x?.low_price,x?.trade_price].map(Number);}
  if(!Number.isSafeInteger(t)||t%MIN||t+MIN>now||!([o,h,l,c].every(finite)&&o>0&&h>0&&l>0&&c>0)||
   l>Math.min(o,c)||h<Math.max(o,c))continue;
  bars.push({start_ms:t,open:o,high:h,low:l,close:c});
 }
 bars.sort((a,b)=>a.start_ms-b.start_ms);const seen=new Map();
 for(const b of bars){if(seen.has(b.start_ms)&&JSON.stringify(b)!==JSON.stringify(seen.get(b.start_ms)))return {status:'DUPLICATE_CONFLICT',bars:[]};seen.set(b.start_ms,b);}
 return {status:'OBSERVED',bars:[...seen.values()]};
}
function markOutcomes(item,ackMs,bars,now){
 const c=item.candidate,q=item.final.quote;
 const entry=c.direction==='SHORT'?q.bid:q.ask,dir=c.direction==='SHORT'?-1:1;
 const by=new Map(bars.map(b=>[b.start_ms,b]));
 const firstFull=Math.ceil(ackMs/MIN)*MIN,out={};
 for(const h of [5,15,30,60]){
  const target=ackMs+h*MIN,closeAt=Math.floor(target/MIN)*MIN;
  if(now<target){out[h]={status:'PENDING_HORIZON'};continue;}
  const candle=by.get(closeAt-MIN);
  if(!candle){out[h]={status:'MISSING_FULL_MINUTE_CLOSE',target_ms:target};continue;}
  const available=[...by.values()].filter(b=>b.start_ms>=firstFull&&b.start_ms<closeAt);
  const signed=dir*100*(candle.close/entry-1);
  out[h]={status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:target,closed_at_ms:closeAt,
   direction:c.direction,reference_entry_bid_or_ask:entry,target_close:candle.close,
   signed_price_pct:signed,positive_direction:signed>0,
   scenario_after_0_20pct_cost:signed-.20,actual_execution_verified:false,
   path_minutes_observed:available.length,path_minutes_expected:Math.max(0,(closeAt-firstFull)/MIN),
   max_high:available.length?Math.max(...available.map(b=>b.high)):null,
   min_low:available.length?Math.min(...available.map(b=>b.low)):null};
 }
 return out;
}
async function fetchJson(url,headers={}){
 const u=new URL(url);
 if(u.protocol!=='https:'||!['api.github.com','raw.githubusercontent.com','api.bitget.com','api.bithumb.com'].includes(u.host))throw Error('UNTRUSTED_HOST');
 const r=await fetch(u,{headers:{'User-Agent':'IRYS-V39-READONLY-CAUSAL-AUDIT',accept:'application/json',...headers},signal:AbortSignal.timeout(24000)});
 if(!r.ok)throw Error('HTTP_'+r.status);return r.json();
}
async function replay({ack,snapshotAtMs=Date.now(),githubToken=null,read=fetchJson}={}){
 const base={version:'V39_PUBLIC_TELEGRAM_ACK_REPLAY_V1',read_only:true,telegram_sent:false,
 orders_sent:false,actual_execution_verified:false,same_pre_ack_evidence_verified:false,forecast_accuracy_improvement_proven:false,
 status:'NO_CURRENT_PUBLIC_ACK',source_commit:null,source_at_ms:null,ack_at_ms:null,symbol:null,outcomes:{}};
 const ms=ack?.last_api_ack_ms,symbol=ack?.last_api_ack_symbol;
 if(!Number.isSafeInteger(ms)||ms<=0||ms>snapshotAtMs||!typeof symbol==='string')return base;
 // Correct malformed symbol input is rejected before constructing any request.
 if(typeof symbol!=='string'||!/^(KRW-)?[A-Z0-9]{1,25}(USDT)?$/.test(symbol))return {...base,status:'INVALID_PUBLIC_ACK_REFERENCE'};
 const until=new Date(ms).toISOString();
 let commits;
 try{
  const url=HOST+'/commits?'+new URLSearchParams({path:'data/v30_direction_latest.json',until,per_page:'24'});
  commits=await read(url,githubToken?{authorization:'Bearer '+githubToken}:{});
 }catch(e){return {...base,status:'HISTORY_COMMIT_LIST_UNAVAILABLE'};}
 let evidence=null,sourceSha=null,sourceDoc=null;
 for(const c of Array.isArray(commits)?commits:[]){
  const sha=c?.sha;if(typeof sha!=='string'||!/^[0-9a-f]{40}$/.test(sha))continue;
  let doc;
  try{doc=await read('https://raw.githubusercontent.com/'+REPO+'/'+sha+'/data/v30_direction_latest.json',{});}
  catch{continue;}
  const hit=validateAckSource(doc,ms,symbol);
  if(hit){evidence=hit;sourceSha=sha;sourceDoc=doc;break;}
 }
 if(!evidence)return {...base,status:'NO_MATCHING_PRE_ACK_FROZEN_SOURCE',ack_at_ms:ms,symbol};
 const c=evidence.candidate,q=evidence.final.quote,venue=c.venue;
 const out={...base,status:'PRE_ACK_SOURCE_MATCHED',same_pre_ack_evidence_verified:true,source_commit:sourceSha,
  source_at_ms:sourceDoc.at_ms,source_to_ack_ms:ms-sourceDoc.at_ms,
  quote_to_ack_ms:ms-q.at_ms,ack_at_ms:ms,symbol,venue,direction:c.direction,
  first_observed_at_ms:evidence.first?.observed_at_ms??null,
  second_observed_at_ms:evidence.second?.observed_at_ms??null,
  last_quote: {bid:q.bid,ask:q.ask,at_ms:q.at_ms},
  feed_source:'OFFICIAL_PUBLIC_PRE_ACK_V30_PACKET',signal_derived_from_telegram_text:false};
 const end=Math.min(Math.floor(snapshotAtMs/MIN)*MIN,ms+62*MIN);
 try{
  let url;
  if(venue==='bitget')url='https://api.bitget.com/api/v2/mix/market/history-candles?'+
     new URLSearchParams({symbol,productType:'USDT-FUTURES',granularity:'1m',endTime:String(end),limit:'160'});
  else{
   const to=new Date(end).toISOString().slice(0,19);
   url='https://api.bithumb.com/v1/candles/minutes/1?'+new URLSearchParams({market:symbol,to,count:'160'});
  }
  const parsed=parseBars(await read(url),venue,snapshotAtMs);
  if(parsed.status!=='OBSERVED'){out.status='PUBLIC_CANDLES_'+parsed.status;return out;}
  out.outcomes=markOutcomes(evidence,ms,parsed.bars,snapshotAtMs);
  out.status='MEASURED_PUBLIC_MINUTE_CLOSE_PROXY';
  out.official_bars=parsed.bars.length;
 }catch(e){out.status='OFFICIAL_HISTORY_UNAVAILABLE';out.error_class=String(e?.message||e).replace(/https?:\/\/\S+/g,'[URL]').slice(0,80);}
 return out;
}
async function main(){
 const h=JSON.parse(readFileSync('v39_direction_audit/worker_health_sanitized.json','utf8'));
 const r=await replay({ack:h,snapshotAtMs:Date.now(),githubToken:process.env.GITHUB_TOKEN||null});
 mkdirSync('v39_direction_audit',{recursive:true});
 writeFileSync('v39_direction_audit/latest_ack_replay.json',JSON.stringify(r,null,2));
 console.log('V39_ACK_REPLAY',JSON.stringify(r));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V39_ACK_AUDIT_FAILED',String(e?.message||e));process.exitCode=1;});
export {validateAckSource,parseBars,markOutcomes,replay};
