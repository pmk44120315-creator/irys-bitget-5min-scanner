#!/usr/bin/env node
/**
 * V18 causal ONLINE ensemble: learn which regime experts are currently right.
 * Each expert's delayed reward is applied ONLY when future price evidence
 * was actually published in a later market snapshot. This is prequential,
 * not a random train/test split or a hindsight re-optimization.
 * Signals are research scores only. No alerts, orders, Cloudflare writes.
 */
import {readFileSync} from 'node:fs';
const path=process.env.V18_EXPORT_EXAMPLES_JSON;
if(!path)throw Error('V18_SAVED_ARCHIVE_LABELS_REQUIRED');
const saved=JSON.parse(readFileSync(path,'utf8'));
if(saved.schema!=='V18_CAUSAL_TRAIN_RESEARCH_EXAMPLES'||
 !saved.first_seen_price_times_are_source_published_times)throw Error('ARCHIVE_CAUSALITY_SCHEMA_MISMATCH');
const s=x=>x>0?1:x<0?-1:0;
const clip=(x,a,b)=>Math.min(b,Math.max(a,x));
const expertNames={
 bitget:['5m_momentum','5m_mean_reversion','1m_momentum','15m_momentum','15m_reversal',
    'price_acceleration','5m_close_location','verified_recent5_taker','verified_taker_shift'],
 bithumb:['5m_momentum','5m_mean_reversion','price_impulse_momentum',
    'price_impulse_reversal','volume_impulse_momentum','volume_impulse_reversal']
};
function expertVotes(row,venue){
 const x=row.vec;
 if(venue==='bitget'){
  const p=s(x[1]),prev=s(x[2]),micro=s(x[0]),accel=s(x[4]);
  const flow=x[21]===1;
  return [p,-p,micro,prev,-prev,accel,s(x[6]),
     flow?s(x[18]):0,flow?s(x[19]):0];
 }
 const p=s(x[0]),mag=x[1],vol=x[2];
 return [p,-p,mag>.1?p:0,mag>.1?-p:0,
   vol>.25?p:0,vol>.25?-p:0];
}
const metrics=(items)=>{
 const right=items.filter(x=>x.signed>=.15).length,
  wrong=items.filter(x=>x.signed<=-.15).length,
  flat=items.length-right-wrong;
 const mean=items.length?items.reduce((a,b)=>a+b.signed,0)/items.length:null;
 const baseline=items.length?items.reduce((a,b)=>a+b.naive,0)/items.length:null;
 return {signals:items.length,correct:right,wrong,flat,
  decisive_accuracy:right+wrong?right/(right+wrong):null,
  mean_signed_pct:mean,mean_minus_0_18pct_assumed_cost:mean===null?null:mean-.18,
  matched_naive_mean_pct:baseline,
  unique_symbols:new Set(items.map(x=>x.symbol)).size,
  long:items.filter(x=>x.direction===1).length,
  short:items.filter(x=>x.direction===-1).length};
};
function evaluate(rows,venue){
 const names=expertNames[venue],n=names.length;
 const times=[...new Set(rows.map(x=>x.published))].sort((a,b)=>a-b);
 const firstEval=times[Math.floor(times.length*.28)];
 const stream=rows.filter(x=>x.outcome?.[15]!==undefined&&
   Number.isSafeInteger(x.outcomeKnownAt?.[15])&&x.outcomeKnownAt[15]>x.published)
   .slice().sort((a,b)=>a.published-b.published||a.symbol.localeCompare(b.symbol));
 const matured=stream.slice().sort((a,b)=>a.outcomeKnownAt[15]-b.outcomeKnownAt[15]);
 let weights=Array(n).fill(1/n),maturityIndex=0,oldWeightUpdates=0;
 const outputs=[],abstains={no_votes:0,weak_consensus:0},evidence=[];
 let position=0;
 while(position<stream.length){
  const at=stream[position].published;
  // Futures results are disclosed from future exchange snapshots, NEVER from
  // the time their candle occurred. Bithumb also uses observed later ticker.
  while(maturityIndex<matured.length && matured[maturityIndex].outcomeKnownAt[15]<=at){
    const time=matured[maturityIndex].outcomeKnownAt[15],group=[];
    while(maturityIndex<matured.length && matured[maturityIndex].outcomeKnownAt[15]===time)
      group.push(matured[maturityIndex++]);
    const rewards=Array(n).fill(0), counts=Array(n).fill(0);
    for(const old of group){
      const vote=expertVotes(old,venue),ret=clip(old.outcome[15]/.7,-1,1);
      for(let i=0;i<n;i++)if(vote[i]){
        rewards[i]+=vote[i]*ret;counts[i]++;
      }
    }
    const step=.40;
    for(let i=0;i<n;i++){
      if(counts[i]){
        const bounded=clip(rewards[i]/counts[i],-1,1);
        weights[i]=weights[i]*Math.exp(step*bounded);
      }
    }
    const sum=weights.reduce((a,b)=>a+b,0);
    weights=weights.map(v=>.97*(v/sum)+.03/n); // bounded forgetful adaptation
    oldWeightUpdates++;
  }
  const slice=[];
  while(position<stream.length && stream[position].published===at){
    const ev=stream[position++], votes=expertVotes(ev,venue);
    let weighted=0,denom=0;
    for(let i=0;i<n;i++){weighted+=weights[i]*votes[i];denom+=weights[i]*Math.abs(votes[i]);}
    if(!denom){abstains.no_votes++;continue}
    const score=weighted/denom,forecast=s(score);
    if(!forecast){abstains.no_votes++;continue}
    if(at<firstEval)continue; // warmup never counted in independent trial
    const record={symbol:ev.symbol,at,score,direction:forecast,
      signed:forecast*ev.outcome[15],naive:ev.naive*ev.outcome[15]};
    outputs.push(record);
    if(Math.abs(score)>=.30)slice.push(record);
    else abstains.weak_consensus++;
  }
  evidence.push(...slice);
 }
 const table=Object.fromEntries(names.map((name,i)=>[name,+weights[i].toFixed(4)]));
 const periods={};
 for(const record of evidence){
  const day=new Date(record.at).toISOString().slice(0,10);
  (periods[day]??=[]).push(record);
 }
 return {sample_count:stream.length,seen_timestamps:times.length,
   warmup_until_utc:new Date(firstEval).toISOString(),
   actually_matured_historic_label_batches:oldWeightUpdates,
   model:'V18_CAUSAL_DELAYED_FEEDBACK_ONLINE_EXPERTS',
   full_score:metrics(outputs),
   higher_consensus_only:metrics(evidence),
   // Bithumb cannot execute a short. Report executable research side separately.
   bithumb_buy_only:venue==='bithumb'?metrics(evidence.filter(x=>x.direction===1)):null,
   bithumb_bearish_watch_only:venue==='bithumb'?metrics(evidence.filter(x=>x.direction===-1)):null,
   by_day:Object.fromEntries(Object.entries(periods).map(([day,r])=>[day,{
     all_directions:metrics(r),
     ...(venue==='bithumb'?{spot_buy_only:metrics(r.filter(x=>x.direction===1))}:{})
   }])),
   abstains,final_expert_weights:table,
   safety:'Never uses an event before its future-price publication time',
   operating_mode:'RESEARCH_ONLY_NOT_LIVE'};
}
const futures=evaluate(saved.futures||[],'bitget');
const spot=evaluate(saved.bithumb||[],'bithumb');
console.log('IRYS_V18_DELAYED_ONLINE_RESEARCH',JSON.stringify({
 version:'V18_ADAPTIVE_LIVE_SAFE_RESEARCH_ONLY',source_commits:saved.immutable_market_archive_count,
 futures,bithumb:spot,no_deployment:true,no_telegram:true,no_trading:true,
 cannot_assume_future_accuracy:true
}));
