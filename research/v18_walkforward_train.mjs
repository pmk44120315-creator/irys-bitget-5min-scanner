#!/usr/bin/env node
/**
 * IRYS V18: actual data-trained directional model, chronological held-out test.
 * ALL immutable GitHub main market snapshot history is read. No cloud API,
 * Telegram or orders. Features are historical as of published snapshot time.
 * Labels only from later exchange timestamps. No look-ahead, no random split.
 */
import {execFileSync} from 'node:child_process';
import {marketFeaturesV18,forecastV18,FEATURE_ORDER_V18} from './v18_prediction_engine.mjs';
import {spotFeaturesV18,spotScoreV18,SPOT_FEATURES_V18} from './v18_spot_prediction_engine.mjs';

const MIN=60000;
const HORIZONS=[5,15,30,60];
const hist=new Map(),spots=new Map(),futuresEvents=[],spotEvents=[],counters={};
const inc=(key)=>counters[key]=(counters[key]||0)+1;
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:3000000});
const finite=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const ms=s=>{const x=Date.parse(s||'');return Number.isFinite(x)?x:null};
const bisectRight=(xs,n)=>{let lo=0,hi=xs.length;while(lo<hi){const m=(lo+hi)>>1;if(xs[m]<=n)lo=m+1;else hi=m}return lo};
function nearestAt(xs,n,tolerance){
 let lo=bisectRight(xs,n),candidates=[];
 for(const j of [lo-2,lo-1,lo,lo+1])if(j>=0&&j<xs.length)candidates.push(xs[j]);
 const sorted=candidates.sort((a,b)=>Math.abs(a-n)-Math.abs(b-n));
 return sorted.length&&Math.abs(sorted[0]-n)<=tolerance?sorted[0]:null;
}
const unique=git('log','refs/remotes/origin/main','--format=%H','--','data/latest.json')
 .trim().split('\n').filter(Boolean).reverse();
for(let j=0;j<unique.length;j++){
 const sha=unique[j],key=sha+':data/latest.json';
 let snap;
 try{snap=JSON.parse(git('show',key))}catch(_e){inc('archive_parse_failed');continue}
 if(snap.collector_status!=='PASS')continue;
 const published=ms(snap.finished_utc);if(!published)continue;
 for(const [symbol,val] of Object.entries(snap.verified_crypto_futures_closed_prices||{})){
   const time=val?.closed_end_ms,price=finite(val?.close_usdt);
   if(!Number.isSafeInteger(time)||price===null||price<=0)continue;
   if(!hist.has(time))hist.set(time,new Map());
   hist.get(time).set(symbol,price);
 }
 const relevant=new Map();
 for(const x of snap.early_pool||[])if(x?.asset_identity==='VERIFIED_CRYPTO')relevant.set(x.symbol,x);
 for(const x of snap.watchlist||[])if(x?.asset_identity==='VERIFIED_CRYPTO')relevant.set(x.symbol,x);
 const matched=new Map((snap.futures_flow?.observations||[])
   .filter(x=>x?.symbol).map(x=>[x.symbol,x]));
 for(const [symbol,item] of relevant){
   const f=marketFeaturesV18(item,matched.get(symbol)||null,published);
   if(!f.vector){inc('futures_feature_'+f.status);continue}
   futuresEvents.push({symbol,published,vec:f.vector,
     naive:Math.sign(finite(item.windows?.['5m']?.price_change_pct)||0),
     flow_verified:f.evidence.verified_recent5_taker});
 }
 let state;
 try{state=JSON.parse(git('show',sha+':data/state.json')))}
 catch(_e){inc('state_blob_missing');continue}
 const tape=state.spot_fast||{},when=tape.time_ms;
 if(Number.isSafeInteger(when)&&when>0){
   const entry=new Map();
   for(const [symbol,row] of Object.entries(tape.prices||{})){
     const price=Array.isArray(row)?finite(row[0]):null;
     if(price!==null&&price>0&&symbol.startsWith('KRW-'))entry.set(symbol,price);
   }
   if(entry.size>=100)spots.set(when,entry);
 }
 const seeds=new Map((snap.spot_flow?.direction_review_seeds||[])
   .filter(x=>x?.market).map(x=>[x.market,x]));
 for(const [symbol,seed] of seeds){
   const f=spotFeaturesV18(seed);
   if(!f.vector){inc('spot_feature_'+f.status);continue}
   spotEvents.push({symbol,published,vec:f.vector,
     naive:Math.sign(finite(seed.observed_5m_price_change_pct)||0)});
 }
 if((j+1)%250===0)console.log('V18_TRAIN_ARCHIVE_READ',j+1,'/',unique.length);
}
const histTimes=[...hist.keys()].sort((a,b)=>a-b);
const spotTimes=[...spots.keys()].sort((a,b)=>a-b);
function attachOutcomes(events,times,prices,market){
 const labeled=[];const misses={};
 const miss=x=>misses[x]=(misses[x]||0)+1;
 for(const e of events){
  const i=bisectRight(times,e.published);
  if(i>=times.length){miss('no_future_entry');continue}
  const entryAt=times[i],lag=entryAt-e.published;
  if(lag<=0||lag>7*MIN){miss('entry_delayed_more_than_7m');continue}
  const price=prices.get(entryAt)?.get(e.symbol);
  if(!price||price<=0){miss('entry_price_not_covered');continue}
  const outcome={};
  for(const h of HORIZONS){
   const desired=entryAt+h*MIN;
   const timestamp=market==='bitget'?desired:nearestAt(times,desired,150000);
   const future=timestamp===null||timestamp===undefined?null:prices.get(timestamp)?.get(e.symbol);
   if(future&&future>0)outcome[h]=100*(future/price-1);
  }
  if(outcome[15]===undefined){miss('no_15m_future_price');continue}
  labeled.push({...e,outcome,entryAt,entryLagMin:lag/MIN});
 }
 return {labeled,misses};
}
const fut=attachOutcomes(futuresEvents,histTimes,hist,'bitget');
const spot=attachOutcomes(spotEvents,spotTimes,spots,'bithumb');
function split(events){
 const times=[...new Set(events.map(x=>x.published))].sort((a,b)=>a-b);
 const first=times[Math.floor(times.length*.57)],second=times[Math.floor(times.length*.80)];
 const embargo=60*MIN;
 return {train:events.filter(x=>x.published<first-embargo),
   validation:events.filter(x=>x.published>first+embargo&&x.published<second-embargo),
   test:events.filter(x=>x.published>second+embargo),
   embargo_minutes:60,
   first: first||null,second:second||null,
   source_start:times[0]||null,source_end:times.at(-1)||null,
   distinct_asof_times:times.length};
}
const sigmoid=z=>1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
function trainLogistic(events,horizon,features,schema){
 const rows=events.filter(x=>Number.isFinite(x.outcome[horizon]));
 const weights=features.map(()=>0);let intercept=0;
 // Training weight is bounded to prevent large spikes dominating the objective.
 // Explicit L2 regularization; same trainer for both venues, separate models.
 const epochs=90,reg=.035;
 for(let epoch=0;epoch<epochs;epoch++){
  const grad=features.map(()=>0);let gb=0,total=0;
  for(const r of rows){
   const target=r.outcome[horizon]>0?1:0;
   const confidenceWeight=Math.min(1.5,Math.max(.10,Math.abs(r.outcome[horizon])/.3));
   const z=intercept+weights.reduce((a,w,i)=>a+w*r.vec[i],0);
   const diff=(sigmoid(z)-target)*confidenceWeight;
   for(let i=0;i<features.length;i++)grad[i]+=diff*r.vec[i];
   gb+=diff;total+=confidenceWeight;
  }
  if(total===0)break;
  const rate=.42/Math.sqrt(1+epoch/14);
  for(let i=0;i<weights.length;i++)
    weights[i]-=rate*(grad[i]/total+reg*weights[i]);
  intercept-=rate*gb/total;
 }
 return {schema,feature_order:features,horizon_min:horizon,
   weights:weights.map(x=>+x.toFixed(9)),
   intercept:+intercept.toFixed(9),trained_samples:rows.length,
   training: 'chronological_only_regularized_logistic_no_external_training',
   no_future_prices_in_features:true,probability_not_calibrated:true,
   training_cutoff_ms:rows.length?Math.max(...rows.map(x=>x.published)):null};
}
function score(model,row,venue){
 return venue==='bitget'?
   forecastV18(model,row.vec).score_up:spotScoreV18(model,row.vec).score_buy;
}
function decision(row,model,threshold,venue){
 const p=score(model,row,venue);
 if(p>=threshold)return 1;
 if(venue==='bitget'&&p<=1-threshold)return -1;
 return 0;
}
function evaluate(rows,model,threshold,venue,horizon=15){
 const seen=[],byDay={};
 for(const r of rows){
   const d=decision(r,model,threshold,venue);
   if(!d||r.outcome[horizon]===undefined)continue;
   const ret=r.outcome[horizon]*d;
   seen.push({symbol:r.symbol,at:r.published,ret,baseline:r.naive*r.outcome[horizon],
     up:d===1});
   const day=new Date(r.published).toISOString().slice(0,10);
   (byDay[day]??=[]).push(ret);
 }
 const right=seen.filter(x=>x.ret>=.15).length,
   wrong=seen.filter(x=>x.ret<=-.15).length,flat=seen.length-right-wrong;
 const average=seen.length?seen.reduce((sum,x)=>sum+x.ret,0)/seen.length:null;
 const sameBaseline=seen.length?seen.reduce((sum,x)=>sum+x.baseline,0)/seen.length:null;
 return {signals:seen.length,selected_fraction:rows.length?seen.length/rows.length:0,
   right,wrong,flat,decisive_accuracy:right+wrong?right/(right+wrong):null,
   average_signed_return_pct:average,average_after_assumed_0_18pct_cost:average===null?null:average-.18,
   naive_same_selected_mean_pct:sameBaseline,
   unique_instruments:new Set(seen.map(x=>x.symbol)).size,
   up:seen.filter(x=>x.up).length,down:seen.filter(x=>!x.up).length,
   by_day:Object.fromEntries(Object.entries(byDay).map(([day,list])=>
      [day,{signals:list.length,mean_signed_pct:list.reduce((a,b)=>a+b,0)/list.length}])),
   note:'Proxy price returns, NOT executable bid/ask, real fills, slippage or live win rate.'};
}
const thresholds=[.55,.58,.60,.62,.65,.68,.70,.73];
function selectThreshold(validation,model,venue){
 const table=thresholds.map(value=>({
  threshold:value,metric:evaluate(validation,model,value,venue)
 }));
 const eligible=table.filter(x=>x.metric.signals>=30);
 if(!eligible.length)return {threshold:.62,selected_on_validation:false,table};
 // Maximize validation-only mean after estimated costs, with modest coverage
 // preference. Test period must never influence this choice.
 eligible.sort((a,b)=>
   (b.metric.average_after_assumed_0_18pct_cost+.04*Math.log1p(b.metric.signals))-
   (a.metric.average_after_assumed_0_18pct_cost+.04*Math.log1p(a.metric.signals)));
 return {threshold:eligible[0].threshold,selected_on_validation:true,table};
}
function prove(label,data,venue,featureOrder,schema){
 const s=split(data.labeled);
 if(s.train.length<100||s.validation.length<30||s.test.length<30){
  return {label,status:'INSUFFICIENT_CHRONOLOGICAL_SPLIT',
   hist_rows:data.labeled.length,partitions:[s.train.length,s.validation.length,s.test.length],
   reasons:data.misses};
 }
 const model5=trainLogistic(s.train,5,featureOrder,schema);
 const model15=trainLogistic(s.train,15,featureOrder,schema);
 const selection=selectThreshold(s.validation,model15,venue);
 const holdout=evaluate(s.test,model15,selection.threshold,venue);
 const validation=evaluate(s.validation,model15,selection.threshold,venue);
 const naive=evaluate(s.test,model15,.50000001,venue);
 const rawMomentum={
   signals:s.test.filter(x=>x.naive!==0).length,
   all_decisive_accuracy:(()=>{
    const r=s.test.filter(x=>x.naive!==0&&Math.abs(x.outcome[15])>=.15);
    return r.length?r.filter(x=>x.naive*x.outcome[15]>0).length/r.length:null;
   })()
 };
 const ratio=holdout.decisive_accuracy;
 const same=holdout.signals?holdout.naive_same_selected_mean_pct:null;
 // This is a research gate, not a promise of future profitable trading.
 const candidatePass=holdout.signals>=30&&holdout.unique_instruments>=10&&
   holdout.up>0&&(venue!=='bitget'||holdout.down>0)&&
   holdout.average_after_assumed_0_18pct_cost>0&&
   holdout.average_signed_return_pct>same &&
   ratio!==null&&ratio>=.56&&
   Object.keys(holdout.by_day).length>=2;
 return {label,status:'RESEARCH_HOLDOUT_EVALUATED_NOT_LIVE_PROOF',
   candidate_meets_minimal_historical_evidence:!!candidatePass,
   observations:data.labeled.length,partitions:{train:s.train.length,
      validation:s.validation.length,test:s.test.length,
      asof_windows:s.distinct_asof_times,first_cutoff_utc:new Date(s.first).toISOString(),
      second_cutoff_utc:new Date(s.second).toISOString(),embargo_minutes:s.embargo_minutes},
   training_5m_model: {samples:model5.trained_samples},
   threshold_selected_on_validation:selection.threshold,
   threshold_selection_evidence:selection.table.map(x=>({
     threshold:x.threshold,selected:x.metric.signals,
     mean_net:x.metric.average_after_assumed_0_18pct_cost
   })),
   validation,holdout,naive_raw_momentum:rawMomentum,naive_full_model_half_cut:naive,
   missing_price_evidence:data.misses,
   "model_weights_research_only":model15,
   "model_5m_research_only":model5,
   "outcome_warning":"Holdout only a short historic time period; performance may not generalize"};
}
const output={
 version:'V18_TEMPORALLY_HELD_OUT_REAL_LABEL_FORECAST_RESEARCH',
 source_git_commits:unique.length,market_data_from:'real main Git archival snapshots',
 bitget_full_market_price_times:histTimes.length,bithumb_ticker_snapshot_times:spotTimes.length,
 bitget:prove('BITGET_USDT_FUTURES',fut,'bitget',FEATURE_ORDER_V18,'IRYS_V18_CAUSAL_LOGISTIC_V1'),
 bithumb:prove('BITHUMB_KRW_SPOT',spot,'bithumb',SPOT_FEATURES_V18,'IRYS_V18_SPOT_LOGISTIC_V1'),
 counters,
 no_external_AI_api:true,no_cloudflare_mutation:true,no_telegram_delivery:true,no_orders:true,
 market_forecast_improvement_not_assumed:true
};
console.log('IRYS_V18_WALKFORWARD_RESEARCH',JSON.stringify(output));
