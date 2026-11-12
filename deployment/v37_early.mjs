import {V48_MEASUREMENT_VERSION,v48ValidIdentity,v48MigrateEvent,v48MergeNativePages,v48Measured} from './v48_measurement.mjs';
/** V37 prospective precursor / entry-phase research. No Telegram, orders or trade permissions. */
import {v36LabelClose} from './v36_paths.mjs';
const V37_EARLY_VERSION='V37_PREMOVE_OPPORTUNITY_SHADOW_V1';
const MIN=60000,EPISODE=1800000,MAX_EVENTS=3000;
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
// Preserve cross-cycle evidence when enrollment and labeling each rebuild the state.
function copyV37State(old,now){
 const state=structuredClone(old||{});
 state.version=V37_EARLY_VERSION;state.asof_ms=now;
 if(!Array.isArray(state.events))state.events=[];
 return state;
}
const median=x=>{const a=x.filter(Number.isFinite).sort((p,q)=>p-q);return a.length?(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2):null};
function v37AssessSnapshot(row,now){
 const fail=(status,reason)=>({version:V37_EARLY_VERSION,status,reason,phase:'UNCONFIRMED',direction:'UNCONFIRMED',trade_permit:false,entry_ready:false,probability:null,flow_acceleration:null});
 const venue=row?.venue,symbol=row?.symbol,t=row?.observed_at_ms;
 if(!['bithumb','bitget'].includes(venue)||typeof symbol!=='string'||!(venue==='bithumb'?/^KRW-[A-Z0-9]{1,25}$/:/^[A-Z0-9]{1,25}USDT$/).test(symbol))return fail('INVALID_SOURCE','IDENTITY');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(t)||t>now||now-t>120000||row.eligible===false)return fail('INVALID_SOURCE','CLOCK_OR_ELIGIBILITY');
 const raw=(row.points||[]).filter(x=>Array.isArray(x)&&x.length>=3&&Number.isSafeInteger(x[0])&&x[0]<=t&&num(x[1])!==null&&x[1]>0).slice(-12);
 if(raw.length<4)return fail('INCOMPLETE','INSUFFICIENT_PRIOR_OBSERVATIONS');
 if(raw.some((p,i)=>i&&p[0]<=raw[i-1][0]))return fail('INVALID_SOURCE','DUPLICATE_OR_REVERSED_TIME');
 const px=raw.map(x=>x[1]),times=raw.map(x=>x[0]);
 if(t-times.at(-1)>120000)return fail('INVALID_SOURCE','STALE_LAST_PRICE');
 const gaps=times.slice(1).map((t,i)=>t-times[i]);
 if(gaps.some(x=>x<120000||x>600000))return fail('INCOMPLETE','IRREGULAR_OBSERVATION_GAP');
 const priceMoves=px.slice(1).map((x,i)=>100*(x/px[i]-1)),last=priceMoves.at(-1),cumulative=100*(px.at(-1)/px[0]-1);
 const priorMedian=median(priceMoves.slice(0,-1).map(Math.abs)),relative= num(row.market_reference_pct)===null?null:last-row.market_reference_pct;
 const priceTrend=Math.abs(last)<1e-10?'UNCONFIRMED':last>0?'UP':'DOWN';
 const direction=priceTrend==='UNCONFIRMED'?'UNCONFIRMED':venue==='bithumb'?(priceTrend==='UP'?'BUY':'UNCONFIRMED'):(priceTrend==='UP'?'LONG':'SHORT');
 const flow=raw.map(x=>num(x[2])),flowKind=row.flow_kind||'UNVERIFIED_FLOW_SOURCE';
 const common={version:V37_EARLY_VERSION,venue,symbol,observed_at_ms:t,source_times_ms:times,
  current_price:px.at(-1),first_recorded_price:px[0],pre_observation_move_pct:cumulative,last_move_pct:last,
  prior_median_abs_move_pct:priorMedian,relative_to_market_pct:relative,flow_source:flowKind,
  direction,price_trend:priceTrend,trade_permit:false,entry_ready:false,probability:null,future_accuracy_proven:false};
 if(flow.some(x=>x===null))return {...common,direction:'UNCONFIRMED',status:'PRICE_ONLY',phase:'INSUFFICIENT_FLOW',reason:'VOLUME_HISTORY_MISSING',flow_acceleration:null,early_score:null};
 const diffs=flow.slice(1).map((v,i)=>v-flow[i]);
 if(diffs.some(x=>x<0))return {...common,status:'INCOMPLETE',phase:'INSUFFICIENT_FLOW',reason:'CUMULATIVE_VOLUME_RESET_OR_ROLLING_OUTFLOW',flow_acceleration:null,early_score:null};
 const past=median(diffs.slice(0,-1)),lastTurn=diffs.at(-1),accel=past>0?lastTurn/past:null;
 if(accel===null)return {...common,status:'INCOMPLETE',phase:'INSUFFICIENT_FLOW',reason:'UNMEASURABLE_FLOW_BASELINE',flow_acceleration:null,early_score:null};
 // Research-relative phase: extension measured against prior observed price movement,
 // not against a fixed % gain that would suppress genuine early low-volatility moves.
 const extensionUnit=Math.max(.5,2*(priorMedian||0));
 const extensionRatio=Math.abs(cumulative)/extensionUnit;
 const extended=extensionRatio>=1;
 const risingFlow=accel>=1.5;
 const phase=extended?'EXTENDED_MOVE':risingFlow&&direction!=='UNCONFIRMED'?'EARLY_FLOW_LEAD':'UNCONFIRMED';
 const score=Math.log1p(Math.max(0,accel-1))*2+Math.max(0,relative===null?0:Math.abs(relative))*.1-Math.max(0,extensionRatio-1)*4;
 return {...common,status:'OBSERVED',reason:null,phase,flow_acceleration:accel,recent_turnover_delta:lastTurn,
  turnover_baseline:past,extension_ratio:extensionRatio,early_score:score,
  flow_interpretation:flowKind==='BITHUMB_DAILY_CUMULATIVE_QUOTE'?'GROSS_TRADE_VALUE_NOT_NET_TAKER': 'ROLLING_24H_VOLUME_DIFFERENCE_PROXY_NOT_REAL_TIME_CVD'};
}
function v37SelectEarly(rows,now,max=12){
 if(!Number.isInteger(max)||max<1)return [];
 const by=new Map();for(const row of rows||[]){const x=v37AssessSnapshot(row,now);
  if(x.status!=='OBSERVED'||x.phase!=='EARLY_FLOW_LEAD'||!Number.isFinite(x.early_score))continue;
  const key=x.venue+':'+x.symbol+':'+x.direction,p=by.get(key);
  if(!p||x.early_score>p.early_score)by.set(key,x);
 }
 return [...by.values()].sort((a,b)=>b.early_score-a.early_score||a.symbol.localeCompare(b.symbol)).slice(0,max);
}
function v37BuildEvents(old,selected,now){
 const state=copyV37State(old,now);
 const ids=new Set(state.events.map(x=>x.id)),added=[],latest=new Map();
 for(const e of state.events){if(!Number.isSafeInteger(e?.issued_at_ms))continue;const k=e.venue+':'+e.symbol+':'+e.direction;latest.set(k,Math.max(latest.get(k)??-Infinity,e.issued_at_ms));}
 for(const x of selected||[]){if(x.status!=='OBSERVED'||x.phase!=='EARLY_FLOW_LEAD'||x.trade_permit!==false||!v48ValidIdentity(x)||
 !Number.isSafeInteger(now)||!Number.isSafeInteger(x.observed_at_ms)||x.observed_at_ms<0||x.observed_at_ms>now||now-x.observed_at_ms>120000||num(x.current_price)===null||x.current_price<=0)continue;
  const episodeKey=x.venue+':'+x.symbol+':'+x.direction;
  if(latest.has(episodeKey)&&now-latest.get(episodeKey)<EPISODE)continue;
  const id=['EVAL',x.venue,x.symbol,x.direction,Math.floor(now/EPISODE)].join(':');
  if(ids.has(id))continue;ids.add(id);
  const e={id,version:V37_EARLY_VERSION,venue:x.venue,symbol:x.symbol,direction:x.direction,
   issued_at_ms:now,source_observed_at_ms:x.observed_at_ms,source_to_decision_latency_ms:now-x.observed_at_ms,
   time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',entry_reference_is_live_executable:false,
   first_complete_start_ms:Math.ceil(now/MIN)*MIN,entry_price:x.current_price,
   first_recorded_price:x.first_recorded_price,pre_observation_move_pct:x.pre_observation_move_pct,
   early_score:x.early_score,flow_source:x.flow_source,flow_acceleration:x.flow_acceleration,
   phase_at_issue:x.phase,source_label:'PUBLIC_PRIOR_OBSERVATIONS_ONLY',trade_permit:false,probability:null,
   future_accuracy_proven:false,actual_execution_verified:false,direction_measurement_version:V48_MEASUREMENT_VERSION,
   causal_features:{asof_ms:x.observed_at_ms,last_move_pct:num(x.last_move_pct),prior_median_abs_move_pct:num(x.prior_median_abs_move_pct),
    relative_to_market_pct:num(x.relative_to_market_pct),extension_ratio:num(x.extension_ratio),recent_turnover_delta:num(x.recent_turnover_delta),turnover_baseline:num(x.turnover_baseline)},outcomes:{}};
  state.events.push(e);added.push(e);latest.set(episodeKey,now);
 }
 const evicted=state.events.slice(0,Math.max(0,state.events.length-MAX_EVENTS));state.events=state.events.slice(-MAX_EVENTS);return {state,added,evicted};
}
function v37LabelEvents(old,pages,now){
 const state=copyV37State(old,now);state.direction_measurement_version=V48_MEASUREMENT_VERSION;
 const by=v48MergeNativePages(pages,now);
 for(const e of state.events){
  v48MigrateEvent(e,'v37');
  const p=by.get(e.venue+':'+e.symbol);if(!p)continue;
  for(const h of [5,15,30,60]){const k=String(h);
   if(e.outcomes[k]?.status==='MEASURED_DIRECTION'){
    if(!v48Measured(e,h))throw Error('V48_PERSISTED_OUTCOME_INVALID');
    continue;
   }
   const label=v36LabelClose(e,p.bars,Math.min(now,p.fetched_at_ms),h);
   if(label.status==='MEASURED_DIRECTION')e.outcomes[k]={...label,at_ms:label.close_at_ms,close_price:label.target_close,
      signed_pct:label.signed_direction_pct,source:'OFFICIAL_NATIVE_1M',cost_included:false};
   else if(label.status!=='PENDING')e.outcomes[k]=label;
  }
 }return state;
}

export {V37_EARLY_VERSION,v37AssessSnapshot,v37SelectEarly,v37BuildEvents,v37LabelEvents};
