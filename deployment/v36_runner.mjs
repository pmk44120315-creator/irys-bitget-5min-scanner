import {v48RecoveryPlan} from './v48_backfill.mjs';
import {v48LoadState,v48PublishResearch} from './v48_persistence.mjs';
import {v48Audit} from './v48_readiness_report.mjs';
import {v48PendingMarkets,v48RecordHistoryAttempts} from './v48_measurement.mjs';
/** Independent read-only market data evaluator; never connects to Telegram/trading. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {v36Observe,v36Advance,v36Summary,v36Gate,V36_VERSION} from './v36_shadow.mjs';
import {compareDirectionHypotheses} from './direction_response_research.mjs';
const MIN=60000;
function parsedBars(raw,venue,symbol,now){
 const rows=venue==='bitget'?raw?.code==='00000'&&Array.isArray(raw.data)?raw.data:null:Array.isArray(raw)?raw:null;
 if(!rows)return null;
 const map=new Map(),conflicts=new Set();
 for(const x of rows){let t,o,h,l,c;
  if(venue==='bitget'){if(!Array.isArray(x)||x.length<5)continue;t=Number(x[0]);[o,h,l,c]=x.slice(1,5).map(z=>z===null||z===''||typeof z==='boolean'?NaN:Number(z));}
  else{if(x?.market!==symbol||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(x.candle_date_time_utc))continue;
   t=Date.parse(x.candle_date_time_utc+'Z');[o,h,l,c]=[x.opening_price,x.high_price,x.low_price,x.trade_price].map(z=>z===null||z===''||typeof z==='boolean'?NaN:Number(z));}
  if(!Number.isSafeInteger(t)||t%MIN||t+MIN>now||![o,h,l,c].every(z=>Number.isFinite(z)&&z>0)||l>Math.min(o,c)||h<Math.max(o,c))continue;
  const bar={start_ms:t,open:o,high:h,low:l,close:c};
  if(map.has(t)&&JSON.stringify(map.get(t))!==JSON.stringify(bar))conflicts.add(t);
  map.set(t,bar);
 }
 if(conflicts.size)return {error:'CONFLICTING_NATIVE_CANDLES',bars:[]};
 return {bars:[...map.values()].sort((a,b)=>a.start_ms-b.start_ms)};
}
async function v36NativeHistory(markets,read,now){
 const pages=[],errors=[];if(typeof read!=='function'||!Array.isArray(markets)||!Number.isSafeInteger(now)||now<0)return {pages,errors:[{reason:'INVALID_READER_OR_MARKETS'}]};
 const work=[...new Map(markets.map(m=>[m?.venue+':'+m?.symbol+':'+(Object.hasOwn(m||{},'history_end_ms')?String(m.history_end_ms):'CURRENT'),m])).values()].filter(m=>
 (m?.venue==='bitget'&&/^[A-Z0-9]{1,25}USDT$/.test(m.symbol))||(m?.venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(m.symbol)));
 let index=0;
 await Promise.all(Array.from({length:Math.min(3,work.length)},async()=>{while(index<work.length){const m=work[index++];
  const bounded=Object.hasOwn(m,'history_end_ms'),end=bounded?m.history_end_ms:now;
  if(bounded&&(!Number.isSafeInteger(end)||end<0||end>now)){
   errors.push({venue:m.venue,symbol:m.symbol,reason:'INVALID_HISTORY_END_MS'});continue;
  }
  try{
   // An optional frozen episode window makes delayed evaluation recoverable.
   // Callers without a bound keep the existing current-window query.
   const qs=m.venue==='bitget'?new URLSearchParams({symbol:m.symbol,productType:'USDT-FUTURES',granularity:'1m',endTime:String(Math.floor(end/MIN)*MIN),limit:'200'}):
    new URLSearchParams({market:m.symbol,to:new Date(end+9*3600000).toISOString().slice(0,19),count:'200'});
   const url=m.venue==='bitget'?'https://api.bitget.com/api/v2/mix/market/history-candles?'+qs:'https://api.bithumb.com/v1/candles/minutes/1?'+qs;
   const x=parsedBars(await read(url),m.venue,m.symbol,end);if(!x||x.error)throw Error(x?.error||'OFFICIAL_SCHEMA');
   pages.push({venue:m.venue,symbol:m.symbol,source:'OFFICIAL_NATIVE_1M',fetched_at_ms:now,history_end_ms:end,request_key:m.venue+':'+m.symbol+':'+end,bars:x.bars});
  }catch(e){errors.push({venue:m.venue,symbol:m.symbol,reason:/CONFLICTING_NATIVE_CANDLES/.test(String(e))?'CONFLICTING_NATIVE_CANDLES':'PUBLIC_OFFICIAL_SOURCE_UNAVAILABLE'});}
 }}));
 return {pages,errors};
}
function pendingMarkets(state,now,maxSymbols=40){return v48PendingMarkets(state?.events,now,maxSymbols,'v36');}
async function v36Process({old={},packet,baselineDigest,now,benchmark=null,readHistory,maxSymbols=40}={}){
 const enrolled=v36Observe(old,{packet,now,baselineDigest,benchmark});let state=enrolled.state;
 state=v36Advance(state,[],now);
 const markets=v48RecoveryPlan(old,state,now,Math.max(0,Math.min(60,maxSymbols)),'v36');
 const hist=await v36NativeHistory(markets,readHistory,now);
 state=v36Advance(v48RecordHistoryAttempts(state,markets,now),hist.pages,now);
 const summary=v36Summary(state);
 const comparisons=Object.fromEntries([5,15,30,60].map(h=>[String(h),compareDirectionHypotheses(state.events,{now,horizon:h})]));
 const public_output={version:V36_VERSION,source:'OFFICIAL_PUBLIC_SHADOW',source_packet_asof_ms:enrolled.source_asof_ms,at_ms:now,
  status:enrolled.status,new_events:enrolled.events.length,tracked_episodes:summary.events,direction_response_comparisons:comparisons,source_markets_attempted:markets.length,
  successful_native_histories:hist.pages.length,source_errors:hist.errors,summary,prospective_only:true,
  actual_ack_performance_verified:false,shadow_only:true,orders_sent:false,telegram_sent:false,future_accuracy_proven:false,
  auto_promotion:false,release_gate:v36Gate({}),
  latest_hypotheses:enrolled.events.slice(-8).map(x=>({id:x.id,venue:x.venue,symbol:x.symbol,direction:x.direction,
  asof_ms:x.issued_at_ms,state:x.observed_hypothesis.state,support:x.observed_hypothesis.support,counter:x.observed_hypothesis.counter,probability:null}))};
 public_output.evidence_quality=v48Audit(state.events,now,'v36');
 return {state,public_output,evicted:enrolled.evicted||[]};
}
function readJSON(p,fallback={}){try{return JSON.parse(readFileSync(p,'utf8'))}catch{return fallback}}
function officialReader(){const next=new Map();return async url=>{
 const u=new URL(url);if(u.protocol!=='https:'||!['api.bitget.com','api.bithumb.com'].includes(u.hostname))throw Error('INVALID_PUBLIC_HOST');
 const at=Math.max(Date.now(),next.get(u.hostname)||0);next.set(u.hostname,at+250);
 if(at>Date.now())await new Promise(r=>setTimeout(r,at-Date.now()));
 const res=await fetch(url,{headers:{accept:'application/json','User-Agent':'IRYS-V36-prospective-public-shadow'},signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('OFFICIAL_HTTP_'+res.status);return res.json();
};}
async function main(){
 const packet=readJSON('data/v30_direction_latest.json'),old=v48LoadState('data/v36_shadow_state.json'),now=Date.now();
 let benchmark={};const crash=readJSON('data/v34_crash_latest.json');
 if(Number.isSafeInteger(crash.at_ms)&&crash.at_ms<=now&&now-crash.at_ms<=90000){
  const btc=crash.summary?.observations?.find(x=>x.asset==='BTC'&&x.venue==='bitget');
  if(Number.isFinite(btc?.return_5m_pct))benchmark={market_move_pct:btc.return_5m_pct,source_at_ms:crash.at_ms};
 }
 const expected=process.env.V36_BASELINE_DIGEST||'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9';
 const result=await v36Process({old,packet,baselineDigest:expected,now,benchmark,readHistory:officialReader(),maxSymbols:40});
 v48PublishResearch({kind:'v36',old,state:result.state,output:result.public_output,now:Date.now(),evicted:result.evicted});
 console.log('V36_PUBLIC_SHADOW',JSON.stringify({at_ms:now,status:result.public_output.status,new_events:result.public_output.new_events,
  tracked:result.public_output.tracked_episodes,history_pages:result.public_output.successful_native_histories,
  source_errors:result.public_output.source_errors.length,directions:result.public_output.summary.directions,
  telegram_sent:false,orders_sent:false,future_accuracy_proven:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V36_SHADOW_RUN_ERROR',String(e?.message||e));process.exitCode=1});
export {v36NativeHistory,v36Process,pendingMarkets,parsedBars,officialReader};
