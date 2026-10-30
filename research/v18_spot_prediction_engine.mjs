/**
 * Separate empirical Bithumb KRW BUY predictor feature family.
 * Train ONLY on original Bithumb observations and post-publication future
 * official ticker snapshots. Never reuse Bitget futures learned weights.
 * This is NOT a quote-level order-flow model; public ticker alone is insufficient
 * to claim verified CVD, bid/ask absorption, or profit.
 */
export const SPOT_FEATURES_V18=Object.freeze([
  'price_momentum_5m','price_impulse_magnitude',
  'turnover_increase_vs_baseline','turnover_absolute',
  'historical_baseline_size','price_x_turnover',
  'large_move_reversion','low_baseline_instability',
  'rank_priority','late_chase_caution'
]);
const n=x=>x===null||x===undefined||x===''?null:
  Number.isFinite(Number(x))?Number(x):null;
const clip=(x,l,h)=>Math.max(l,Math.min(h,x));
const logpos=x=>x===null||x<=0?0:Math.log1p(x);
export function spotFeaturesV18(seed){
 if(!seed||typeof seed.market!=='string'||!/^KRW-[A-Z0-9]+$/.test(seed.market))
  return {status:'INVALID_SPOT_MARKET',vector:null};
 const p=n(seed.observed_5m_price_change_pct);
 const quote=n(seed.five_minute_equivalent_turnover_krw);
 const baseline=n(seed.five_minute_prior_ema_krw);
 const price=n(seed.price_krw);
 if(p===null||quote===null||quote<0||baseline===null||baseline<0||price===null||price<=0)
  return {status:'SPOT_MISSING_CAUSAL_PRICE_TURNOVER',vector:null};
 // A tiny EMA denominator cannot create an unbounded confidence feature.
 const normal=quote/Math.max(5_000_000,baseline);
 const momentum=clip(p/4,-3,3),turnover=clip(logpos(normal)/3,0,3);
 const prior=clip(logpos(baseline)/22,0,2);
 const vec=[
  momentum,clip(Math.abs(p)/5,0,3),turnover,
  clip(logpos(quote)/22,0,2),prior,
  clip(momentum*turnover,-3,3),
  clip(p*Math.abs(p)/100,-3,3),
  baseline<5_000_000?1:0,
  clip(n(seed.review_priority_score)||0,0,5),
  seed.risk_class==='LATE_CHASE_CAUTION'?1:0
 ];
 if(vec.length!==SPOT_FEATURES_V18.length||vec.some(x=>!Number.isFinite(x)))
  throw Error('V18_SPOT_FEATURE_CONTRACT');
 return {status:'READY_RESEARCH_SPOT_FEATURES',vector:vec,price_krw:price,
   evidence:{venue:'bithumb',market:seed.market,no_futures_weights:true,
     no_verified_spot_cvd:true,no_execution_price:true}};
}
export function spotScoreV18(model,vector){
 if(!model||model.schema!=='IRYS_V18_SPOT_LOGISTIC_V1'||
   JSON.stringify(model.feature_order)!==JSON.stringify(SPOT_FEATURES_V18)||
   !Array.isArray(model.weights)||model.weights.length!==vector?.length||
   !Number.isFinite(model.intercept))throw Error('V18_SPOT_MODEL_SCHEMA');
 let z=model.intercept;
 for(let i=0;i<vector.length;i++)z+=model.weights[i]*vector[i];
 if(!Number.isFinite(z))throw Error('V18_SPOT_SCORE_NOT_FINITE');
 const base=1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
 const priceSign=Math.sign(vector[0]);
 const score=model.target_mode==='CONTINUATION_VS_REVERSAL'?
   (priceSign===0?.5:priceSign>0?base:1-base):base;
 return {score_buy:score,
   horizon_min:model.horizon_min,verified_accuracy:null,
   label:'UNVERIFIED_DIRECTION_SCORE_NOT_A_WIN_PROBABILITY'};
}
