/** Candidate/actual-ACK public stream collector; V42.1 alerts remain untouched.
 * Default is a resident process. Hosted CI explicitly bounds each observation
 * session to one discovery cycle and reports any inter-session gap.
 */
import {createWriteStream,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createGzip} from 'node:zlib';import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';import {finished} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {normalizeFrame,StreamState} from './v43_stream_core.mjs';
import {QuoteOutcomeTracker} from './v43_quote_outcomes.mjs';
import {selectWatchlist} from './v43_collection_state.mjs';
import {assessDirectionAndEntry} from './v43_direction_entry.mjs';
const ROOT='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner';
const HEALTH='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const WS={bitget:'wss://ws.bitget.com/v2/ws/public',bithumb:'wss://ws-api.bithumb.com/websocket/v1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function load(path){try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
function save(path,value){const tmp=path+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');renameSync(tmp,path);}
async function get(url){
 if(!(url.startsWith(ROOT+'/')||url.startsWith(HEALTH+'?')))throw Error('PUBLIC_SOURCE_NOT_APPROVED');
 const r=await fetch(url,{redirect:'error',headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('PUBLIC_SOURCE_HTTP_'+r.status);return r.json();
}
export async function collect({duration_ms=0,out_dir='v43_stream',old_quotes_path='data/v43_actual_quote_outcomes.json',old_latest_path='data/v43_stream_latest.json'}={}){
 if(!Number.isSafeInteger(duration_ms)||duration_ms<0)throw Error('OBSERVATION_DURATION_INVALID');
 mkdirSync(out_dir,{recursive:true});const start=Date.now(),session=String(process.env.GITHUB_RUN_ID||randomUUID())+'-'+String(process.env.GITHUB_RUN_ATTEMPT||1);
 const old=load(old_quotes_path),prior=load(old_latest_path),tracker=new QuoteOutcomeTracker(old),core=new StreamState();
 const info={version:'V43_PUBLIC_CONTINUOUS_SESSION_V1',session,started_at_ms:start,ended_at_ms:null,requested_duration_ms:duration_ms,
  execution_kind:duration_ms?'BOUNDED_HOSTED_OBSERVATION_SESSION':'RESIDENT_PROCESS',
  previous_session_end_ms:prior?.ended_at_ms??null,inter_session_gap_ms:prior?.ended_at_ms?Math.max(0,start-prior.ended_at_ms):null,
  all_day_continuity_verified:false,connections:[],frames:0,normalized_events:0,accepted_events:0,source_refreshes:0,
  source_errors:{},frame_errors:{},watch_changes:0,quotes_observed:0,features_frozen:0,max_processing_delay_ms:0,
  private_endpoints_used:false,orders_sent:false,telegram_sent:false,live_alert_engine_modified:false};
 const rawFile=createWriteStream(out_dir+'/raw_frames.jsonl.gz'),raw=createGzip({level:6});raw.pipe(rawFile);
 const featureFile=createWriteStream(out_dir+'/frozen_features.jsonl.gz'),featureZip=createGzip({level:6});featureZip.pipe(featureFile);
 const sourceHashes=[];let fatal=null,stopping=false,refreshing=false,featureBusy=false,packet=null,history=null,watch={bitget:[],bithumb:[]},latestFeatures=[];
 const allSockets=new Set(),current=new Map(),pending=new Set();
 for(const x of [rawFile,raw,featureFile,featureZip])x.on('error',e=>{fatal=e;stopping=true;});
 async function write(stream,obj){if(!stream.write(JSON.stringify(obj)+'\n'))await once(stream,'drain');}
 function count(obj,key){obj[key]=(obj[key]||0)+1;}
 function startConnection(venue){
  if(stopping)return;
  const symbols=new Set(watch[venue]||[]);if(!symbols.size)return;
  const ws=new WebSocket(WS[venue]);ws.binaryType='arraybuffer';allSockets.add(ws);
  const record={venue,connection_id:venue+':'+session+':'+randomUUID(),opened_at_ms:null,closed_at_ms:null,frames:0,reason:null};info.connections.push(record);
  const c={ws,record,symbols:new Set(),queue:Promise.resolve(),subqueue:Promise.resolve(),last_receive_ms:Date.now(),heartbeat:null};current.set(venue,c);
  async function subscribe(){
   if(ws.readyState!==WebSocket.OPEN||stopping)return;
   const next=new Set(watch[venue]||[]),add=[...next].filter(x=>!c.symbols.has(x)),remove=[...c.symbols].filter(x=>!next.has(x));
   if(!add.length&&!remove.length)return;
   if(venue==='bitget'){
    for(const [op,syms] of [['unsubscribe',remove],['subscribe',add]]){
     const args=syms.flatMap(instId=>[{instType:'USDT-FUTURES',channel:'trade',instId},{instType:'USDT-FUTURES',channel:'books5',instId}]);
     for(let i=0;i<args.length;i+=20){if(ws.readyState!==WebSocket.OPEN||stopping)return;ws.send(JSON.stringify({op,args:args.slice(i,i+20)}));await sleep(220);}
    }
   }else ws.send(JSON.stringify([{ticket:'irys-v43-'+session},{type:'trade',codes:[...next],isOnlyRealtime:true},{type:'orderbook',codes:[...next],isOnlyRealtime:true}]));
   c.symbols=next;
  }
  c.resubscribe=()=>{c.subqueue=c.subqueue.then(subscribe).catch(()=>count(info.source_errors,venue+':SUBSCRIBE'));};
  ws.onopen=()=>{record.opened_at_ms=Date.now();core.open(venue,record.connection_id,record.opened_at_ms);c.resubscribe();
   c.heartbeat=setInterval(()=>{if(ws.readyState!==WebSocket.OPEN)return;if(venue==='bitget')ws.send('ping');if(Date.now()-c.last_receive_ms>60000){record.reason='NO_SERVER_MESSAGES_60S';ws.close();}},15000);
  };
  ws.onmessage=ev=>{
   if(stopping)return;
   const received=Date.now();c.last_receive_ms=received;const text=typeof ev.data==='string'?ev.data:Buffer.from(ev.data).toString('utf8');
   c.queue=c.queue.then(async()=>{
    if(fatal)return;info.frames++;record.frames++;info.max_processing_delay_ms=Math.max(info.max_processing_delay_ms,Date.now()-received);
    await write(raw,{venue,session:record.connection_id,received_at_ms:received,raw:text});
    let events;try{events=normalizeFrame(venue,text,received)}catch(e){count(info.frame_errors,venue+':'+String(e.message));return;}
    for(const e of events){
     info.normalized_events++;if(!(watch[venue]||[]).includes(e.symbol)){count(info.frame_errors,venue+':UNWATCHED_IDENTITY');continue;}
     try{if(core.accept(e,record.connection_id)){info.accepted_events++;if(e.kind==='book'){info.quotes_observed++;tracker.observe({...e,segment:record.connection_id},received);}}}
     catch(err){count(info.frame_errors,venue+':'+String(err.message));}
    }
   }).catch(e=>{fatal=e;stopping=true;});
  };
  ws.onerror=()=>count(info.source_errors,venue+':WEBSOCKET_ERROR');
  ws.onclose=ev=>{record.closed_at_ms=Date.now();record.reason??='CLOSE_'+ev.code;clearInterval(c.heartbeat);c.queue=c.queue.then(()=>core.close(venue,record.connection_id,record.closed_at_ms,record.reason));allSockets.delete(ws);
   if(!stopping){const delay=Math.min(30000,1000*2**Math.min(5,info.connections.filter(r=>r.venue===venue&&r.opened_at_ms===null).length));const timer=setTimeout(()=>{pending.delete(timer);startConnection(venue)},delay);pending.add(timer);}
  };
 }
 async function refresh(){
  if(refreshing||stopping)return;refreshing=true;
  try{
   const results=await Promise.allSettled([get(ROOT+'/main/data/v30_direction_latest.json?v43='+Date.now()),get(HEALTH+'?v43readonly='+Date.now())]);
   const at=Date.now();info.source_refreshes++;
   if(results[0].status==='fulfilled'){packet=results[0].value;sourceHashes.push({at_ms:at,packet_at_ms:packet.at_ms,packet_sha256:createHash('sha256').update(JSON.stringify(packet)).digest('hex')});}else count(info.source_errors,'DISCOVERY_READ');
   if(results[1].status==='fulfilled'){
    const h=results[1].value;history=h.last?.v30DirectionalDelivery?.public_ack_history;
    if(history){tracker.addHistory(history,at);info.latest_worker_version=h.last?.codeVersion;info.latest_ack_records=history.retained_ack_records;}
    else count(info.source_errors,'ACTUAL_ACK_HISTORY_MISSING');
   }else count(info.source_errors,'ACK_HISTORY_READ');
   const next=selectWatchlist(packet,history,at);
   if(JSON.stringify([next.bitget,next.bithumb])!==JSON.stringify([watch.bitget,watch.bithumb])){info.watch_changes++;watch=next;
    for(const v of ['bitget','bithumb']){const c=current.get(v);if(c?.ws.readyState===WebSocket.OPEN)c.resubscribe();}}
  }catch(e){count(info.source_errors,'SOURCE_SCHEMA:'+String(e.message));}finally{refreshing=false;}
 }
 async function freeze(){
  if(featureBusy||fatal)return;featureBusy=true;
  try{const now=Date.now(),observations=[];
   for(const venue of ['bitget','bithumb'])for(const symbol of watch[venue]||[]){const f=core.snapshot(venue,symbol,now,60000),a=assessDirectionAndEntry(f);
    const row={session,feature:f,assessment:a,market_context_same_interval_verified:false};await write(featureZip,row);observations.push(row);info.features_frozen++;}
   latestFeatures=observations;
  }catch(e){fatal=e;stopping=true;}finally{featureBusy=false;}
 }
 const signal=()=>{info.stop_reason='PROCESS_SIGNAL';stopping=true};process.once('SIGTERM',signal);process.once('SIGINT',signal);
 await refresh();for(const venue of ['bitget','bithumb'])startConnection(venue);
 const poll=setInterval(()=>{void refresh()},30000),features=setInterval(()=>{void freeze()},15000);
 try{while(!stopping&&(!duration_ms||Date.now()-start<duration_ms))await sleep(250);await freeze();}
 finally{
  stopping=true;clearInterval(poll);clearInterval(features);for(const timer of pending)clearTimeout(timer);
  for(const c of current.values()){clearInterval(c.heartbeat);try{c.ws.close()}catch{}}
  await Promise.all([...current.values()].map(c=>c.queue));while(refreshing||featureBusy)await sleep(20);raw.end();featureZip.end();await Promise.all([finished(rawFile),finished(featureFile)]);
  process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);
 }
 info.ended_at_ms=Date.now();info.stop_reason??=fatal?'FATAL_INGESTION':'OBSERVATION_SESSION_COMPLETE';
 info.watchlist=watch;info.sources=sourceHashes;info.outcome_summary=tracker.export(info.ended_at_ms).summary;
 info.raw_sha256=createHash('sha256').update(readFileSync(out_dir+'/raw_frames.jsonl.gz')).digest('hex');
 info.features_sha256=createHash('sha256').update(readFileSync(out_dir+'/frozen_features.jsonl.gz')).digest('hex');
 info.status=fatal?'FAILED':Object.keys(info.source_errors).length||Object.keys(info.frame_errors).length?'OBSERVED_WITH_DIAGNOSTICS':'OBSERVED';
 save(out_dir+'/session.json',info);save(out_dir+'/quote_outcomes.json',tracker.export(info.ended_at_ms));
 save(out_dir+'/latest.json',{...info,latest_features:latestFeatures,forecast_accuracy_proven:false,live_entry_enabled:false});
 console.log('V43_STREAM_SESSION',JSON.stringify({...info,connections:info.connections.map(x=>({venue:x.venue,opened_at_ms:x.opened_at_ms,closed_at_ms:x.closed_at_ms,frames:x.frames,reason:x.reason})),sources:sourceHashes.length,watchlist:{bitget:watch.bitget,bithumb:watch.bithumb}}));
 if(fatal)throw fatal;if(info.quotes_observed===0)throw Error('NO_REAL_PUBLIC_QUOTES_OBSERVED');return info;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
 collect({duration_ms:Number(value('--duration-ms')??0),out_dir:value('--out')??'v43_stream'}).catch(e=>{console.error('V43_COLLECTOR_FAILED',e.name,String(e.message).slice(0,160));process.exitCode=1;});
}
