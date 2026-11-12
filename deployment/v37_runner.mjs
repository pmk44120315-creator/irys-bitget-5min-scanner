import {v48RecoveryPlan} from './v48_backfill.mjs';
import {v48LoadState,v48PublishResearch} from './v48_persistence.mjs';
import {v48Audit} from './v48_readiness_report.mjs';
import {V48_MEASUREMENT_VERSION,v48PendingMarkets,v48RecordHistoryAttempts,v48Measured,v48SpacedEvents} from './v48_measurement.mjs';
/** Public read-only V37 watch runner. Does NOT change V35.1/V36 forecasts or Telegram. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {v37AssessSnapshot,v37SelectEarly,v37BuildEvents,v37LabelEvents,V37_EARLY_VERSION} from './v37_early.mjs';
import {v36NativeHistory,officialReader} from './v36_runner.mjs';
import {v37CompareToReady} from './v37_compare.mjs';
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const between=(t,now,limit=120000)=>Number.isSafeInteger(t)&&t<=now&&now-t<=limit;
function v37PrepareRows({spotState,fastFeed,tickers,futuresHistory={},now}={}){
 const rows=[],nextFutures={},source_errors=[];
 const assets=spotState?.v28?.assets;
 if(!between(spotState?.v28?.at_ms,now)||!assets||typeof assets!=='object')source_errors.push({venue:'bithumb',reason:'STALE_OR_MISSING_PUBLIC_SPOT_STATE'});
 else for(const [symbol,record] of Object.entries(assets)){
  if(!/^KRW-[A-Z0-9]{1,25}$/.test(symbol))continue;
  const points=(record?.points||[]).filter(x=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&good(x[1])&&x[0]<=now);
  if(!points.length||!between(points.at(-1)[0],now))continue;
  rows.push({venue:'bithumb',symbol,points,observed_at_ms:points.at(-1)[0],eligible:true,
   flow_kind:'BITHUMB_DAILY_CUMULATIVE_QUOTE',identity_risk_verified_for_trade:false});
 }
 const fastOK=between(fastFeed?.at_ms,now)&&fastFeed?.venue==='bitget'&&fastFeed?.prices&&typeof fastFeed.prices==='object';
 if(!fastOK)source_errors.push({venue:'bitget',reason:'STALE_OR_MISSING_VETTED_FUTURES_UNIVERSE'});
 const bySym=new Map((Array.isArray(tickers)?tickers:[]).filter(x=>typeof x?.symbol==='string').map(x=>[x.symbol,x]));
 if(fastOK)for(const symbol of Object.keys(fastFeed.prices)){
  if(!/^[A-Z0-9]{1,25}USDT$/.test(symbol))continue;
  const ticker=bySym.get(symbol),t=Number(ticker?.ts),px=Number(ticker?.lastPr),vol=Number(ticker?.usdtVolume);
  if(!between(t,now,90000)||!good(px)||!Number.isFinite(vol)||vol<0){
   // Per-symbol provider errors are counted, without publishing private data.
   source_errors.push({venue:'bitget',reason:'STALE_OR_INVALID_FUTURES_PRICE'});continue;
  }
  const old=(Array.isArray(futuresHistory?.[symbol])?futuresHistory[symbol]:[]).filter(p=>Array.isArray(p)&&Number.isSafeInteger(p[0])&&p[0]<t&&good(p[1]));
  const history=[...old,[t,px,vol]].slice(-12);nextFutures[symbol]=history;
  rows.push({venue:'bitget',symbol,points:history,observed_at_ms:t,eligible:true,
   flow_kind:'BITGET_ROLLING_24H_QUOTE_DIFFERENCE_PROXY',identity_risk_verified_for_trade:false});
 }
 for(const venue of ['bithumb','bitget']){
  const grp=rows.filter(x=>x.venue===venue),changes=grp.map(x=>x.points.length>1?100*(x.points.at(-1)[1]/x.points.at(-2)[1]-1):null).filter(Number.isFinite).sort((a,b)=>a-b);
  const median=changes.length?(changes.length%2?changes[(changes.length-1)/2]:(changes[changes.length/2-1]+changes[changes.length/2])/2):null;
  for(const row of grp)row.market_reference_pct=median;
 }
 return {rows,nextFutures,source_errors};
}
function v37Stats(events){
 const verified=events.filter(e=>e.time_basis==='ACTUAL_EVALUATOR_DECISION_CLOCK'&&Number.isSafeInteger(e.issued_at_ms)&&Number.isSafeInteger(e.source_observed_at_ms)&&e.source_observed_at_ms<=e.issued_at_ms);
 const out={events:events.length,clock_verified:verified.length,legacy_unverified_clock:events.length-verified.length,
 actual_telegram_acks:0,ready_to_promote:false,source_quote_proxy_only:true,measurement_version:V48_MEASUREMENT_VERSION,legacy_outcomes_excluded:true,statistical_independence_proven:false,measured:{},positive:{},unknown:{},directions:{}};
 for(const h of [5,15,30,60]){let measured=0,positive=0,missing=0;for(const e of verified){const v=e.outcomes?.[String(h)];if(v48Measured(e,h)){measured++;if(v.direction_positive)positive++;}else missing++;}
  out.measured[h]=measured;out.positive[h]=positive;out.unknown[h]=missing;
 }
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){
  const group=verified.filter(e=>e.venue===venue&&e.direction===direction);
  out.directions[venue+':'+direction]={candidates:group.length,measured5:group.filter(e=>v48Measured(e,5)).length,
   direction_positive5:group.filter(e=>v48Measured(e,5)&&e.outcomes[5].direction_positive).length};
 }out.rolling_30m_candidates=v48SpacedEvents(verified).length;return out;
}
function v37PendingMarkets(events,now,max=40){return v48PendingMarkets(events,now,max,'v37');}
function v37RecordHistoryAttempts(old,markets,now){return v48RecordHistoryAttempts(old,markets,now);}
function v37RunCycle({spotState,fastFeed,tickers,history={},old={},now,nativePages=[]}={}){
 const prepared=v37PrepareRows({spotState,fastFeed,tickers,futuresHistory:history,now});
 const selections=[...v37SelectEarly(prepared.rows.filter(x=>x.venue==='bithumb'),now,12),
 ...v37SelectEarly(prepared.rows.filter(x=>x.venue==='bitget'&&v37AssessSnapshot(x,now).direction==='LONG'),now,8),
 ...v37SelectEarly(prepared.rows.filter(x=>x.venue==='bitget'&&v37AssessSnapshot(x,now).direction==='SHORT'),now,8)];
 const r=v37BuildEvents(old,selections,now);
 const state=v37LabelEvents(r.state,nativePages,now);
 state.futuresHistory={...history,...prepared.nextFutures};
 state.last_source_at_ms=now;
 const stats=v37Stats(state.events);
 const readyTiming=v37CompareToReady(state.events,spotState?.records||[]);
 const output={version:V37_EARLY_VERSION,source:'CURRENT_PUBLIC_PRIOR_ONLY',at_ms:now,source_errors:prepared.source_errors,
  public_baseline_ready_timing:readyTiming,
  spot_candidates_observed:prepared.rows.filter(x=>x.venue==='bithumb').length,
  futures_candidates_observed:prepared.rows.filter(x=>x.venue==='bitget').length,
  new_events:r.added.length,selected_early_count:selections.length,tracked:state.events.length,
  selected_early:r.added.slice(0,12).map(e=>({id:e.id,venue:e.venue,symbol:e.symbol,direction:e.direction,issued_at_ms:e.issued_at_ms,
    early_score:e.early_score,pre_observation_move_pct:e.pre_observation_move_pct,flow_acceleration:e.flow_acceleration})),
  shadow_only:true,live_entry_approved:false,actual_telegram_acks:0,telegram_sent:false,orders_sent:false,
  prediction_accuracy_proven:false,late_entry_problem_solved:false,stats};
 return {state,output,selection:selections,evicted:r.evicted};
}
function readJSON(path,fallback={}){try{return JSON.parse(readFileSync(path,'utf8'))}catch{return fallback}}
async function safeRead(url){const u=new URL(url);if(u.protocol!=='https:'||!['api.bitget.com','api.bithumb.com'].includes(u.hostname))throw Error('INVALID_OFFICIAL_SOURCE');
 const r=await fetch(url,{headers:{accept:'application/json','User-Agent':'IRYS-V37-no-orders-early-shadow'},signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('OFFICIAL_HTTP_'+r.status);return r.json();}
async function main(){
 const spotState=readJSON('data/v30_state.json'),fastFeed=readJSON('data/v24_bitget_fast_latest.json'),old=v48LoadState('data/v37_early_state.json');
 let tickers=[],tickerError=null;
 try{const raw=await safeRead('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');if(raw.code!=='00000'||!Array.isArray(raw.data))throw Error('OFFICIAL_TICKERS_SCHEMA');tickers=raw.data;}
 catch(e){tickerError='BITGET_OFFICIAL_TICKERS_UNAVAILABLE';}
 const now=Date.now(),initial=v37RunCycle({spotState,fastFeed,tickers,history:old.futuresHistory||{},old,now});
 const pending=v48RecoveryPlan(old,initial.state,now,40,'v37');
 const data=await v36NativeHistory(pending,officialReader(),now);
 const attempted=v37RecordHistoryAttempts(initial.state,pending,now);
 const state=v37LabelEvents(attempted,data.pages,Date.now());
 const stats=v37Stats(state.events),output={...initial.output,at_ms:Date.now(),stats,native_history_pages:data.pages.length,
  native_history_errors:data.errors,source_errors:[...initial.output.source_errors,...(tickerError?[{venue:'bitget',reason:tickerError}]:[])],
  source_used:'V30_OBSERVED_SPOT_AND_V24_VETTED_FUTURES_PLUS_OFFICIAL_PUBLIC_TICKERS',
  no_private_market_information:true};
 output.evidence_quality=v48Audit(state.events,output.at_ms,'v37');
 v48PublishResearch({kind:'v37',old,state,output,now:output.at_ms,evicted:initial.evicted||[]});
 console.log('V37_EARLY_SHADOW',JSON.stringify({at_ms:output.at_ms,spot:output.spot_candidates_observed,futures:output.futures_candidates_observed,
   selected_early:output.selected_early_count,new_events:output.new_events,tracked:output.tracked,
   native_histories:output.native_history_pages,errors:output.source_errors.length,history_errors:output.native_history_errors.length,
   measured5:stats.measured[5],positive5:stats.positive[5],orders_sent:false,telegram_sent:false,late_entry_problem_solved:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V37_RUN_ERROR',String(e?.message||e));process.exitCode=1});
export {v37PrepareRows,v37Stats,v37PendingMarkets,v37RecordHistoryAttempts,v37RunCycle};
