/**
 * V18 standalone actual-learning market direction feature engine (research only).
 *
 * No LLM guessing, no Telegram, no orders, no future prices in features.
 * Designed for Bitget VERIFIED_CRYPTO perpetuals; Bithumb has a separate
 * evidence population and must never inherit futures weights by accident.
 * Attribution: quote-turnover != aggressive taker, OI direction != position owner,
 * two passive orderbook ratios != event-level OFI or proven absorption.
 */
export const FEATURE_ORDER_V18 = Object.freeze([
  'ret1m','ret5m','ret15m','ret60m','ret5_minus_15pace',
  'ret1_minus_5pace','close_location_5m','body_vs_range_5m',
  'close_location_15m','upper_wick_5m','upper_wick_15m',
  'relative_turnover_5m','relative_turnover_15m','absolute_turnover_5m',
  'range_pct_5m','range_pct_15m','oi_change','funding_context',
  'verified_recent5_taker_bias','recent5_taker_bias_shift',
  'recent5_taker_net_relative','verified_recent5_flow_available',
  'flow_price_divergence','recent5_flow_trades',
  'book_top5_ratio_context','book_two_snapshots_available',
  'price_x_taker_bias','oi_x_price','snapshot_staleness',
]);
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const num=v=>{
  if(v===undefined||v===null||v===''||typeof v==='boolean')return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
};
const scaled=(n,cap=1)=>n===null?0:clamp(n/cap,-3,3);
const poslog=(n,scale)=>n===null||n<0?0:clamp(Math.log1p(n)/scale,0,3);
const signedLog=n=>n===null?0:Math.sign(n)*Math.log1p(Math.abs(n));
function closeLocation(window) {
  const c=num(window?.close),h=num(window?.high),l=num(window?.low);
  return c===null||h===null||l===null||h<=l?0:
    clamp((2*(c-l)/(h-l))-1,-1,1);
}
function bodyRange(window){
  const o=num(window?.open),c=num(window?.close),h=num(window?.high),l=num(window?.low);
  return o===null||c===null||h===null||l===null||h<=l?0:
    clamp((c-o)/(h-l),-1,1);
}
function rangePct(w){
  const c=num(w?.close),h=num(w?.high),l=num(w?.low);
  return c===null||c<=0||h===null||l===null||h<l?null:
    100*(h-l)/c;
}
/** Only source-at-observation inputs. Never add future return, post-alert price, outcomes or model judgment here. */
export function marketFeaturesV18(item, flow=null, finishedMs=null){
  if(!item||item.asset_identity!=='VERIFIED_CRYPTO'||
      item.venue!=='bitget'||typeof item.symbol!=='string'||!item.symbol.endsWith('USDT'))
    return {status:'UNVERIFIED_FUTURES_ASSET',vector:null};
  const windows=item.windows||{},a=windows['1m']||{},b=windows['5m']||{},
    c=windows['15m']||{},d=windows['60m']||{};
  const end=num(windows.end_utc_ms),price=num(b.close);
  if(price===null||price<=0||end===null||end<1.6e12||num(b.coverage)!==1)
    return {status:'INVALID_PRICE_OR_CANDLE_TIME',vector:null};
  if(finishedMs!==null&&(finishedMs<end||finishedMs-end>20*60000))
    return {status:'CAUSAL_SNAPSHOT_CLOCK_INVALID',vector:null};
  const p1=num(a.price_change_pct),p5=num(b.price_change_pct),
    p15=num(c.price_change_pct),p60=num(d.price_change_pct);
  if(p5===null)return {status:'MISSING_FIVE_MINUTE_MOVEMENT',vector:null};
  const oi=num(item.oi?.change_pct_from_previous_run),funding=num(item.funding_rate);
  const recent=flow?.recent5_pressure_shift_research||null;
  const verified=flow?.taker_flow_15m?.verified===true&&
    flow?.price_context_status==='ALIGNED_REAL_OFFICIAL_1M_CONTEXT'&&
    recent?.status==='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10'&&
    recent?.price_time_alignment_verified===true&&
    num(flow.price_context_end_ms)!==null&&
    Math.abs(flow.price_context_end_ms-end)<=5*60000;
  const share=verified?num(recent.recent_5m_buy_share):null;
  const shift=verified?num(recent.buy_share_delta):null;
  const net=verified?num(recent.recent_5m_net_taker_usdt):null;
  const q5=num(b.quote_turnover);
  const book=flow?.book_proof_v13?.snapshots;
  const bookReady=Array.isArray(book)&&book.length>=2&&
    flow.book_proof_v13.status==='TWO_DISTINCT_BOOK_SNAPSHOTS';
  const br=bookReady?num(book[book.length-1].bid_ask_top5_ratio):null;
  const bias=share===null?0:clamp((share-.5)*2,-1,1);
  const flowDisagree=verified&&net!==null&&p5!==0&&net!==0?
    (Math.sign(net)!==Math.sign(p5)?1:0):0;
  const age=finishedMs!==null?Math.max(0,(finishedMs-end)/60000):null;
  const f=[
    scaled(p1,1.5),scaled(p5,3),scaled(p15,9),scaled(p60,20),
    scaled(p5!==null&&p15!==null?p5-p15/3:null,3),
    scaled(p1!==null&&p5!==null?p1-p5/5:null,1.5),
    closeLocation(b),bodyRange(b),closeLocation(c),
    scaled(num(b.upper_wick_ratio),1),scaled(num(c.upper_wick_ratio),1),
    poslog(num(b.adjacent_ratio),2.4),
    poslog(num(c.adjacent_ratio),2.4),
    poslog(q5,12),scaled(rangePct(b),4),scaled(rangePct(c),10),
    scaled(oi,3),scaled(funding===null?null:funding*10000,5),
    bias,scaled(shift===null?null:shift*2,1),
    net===null||q5===null||q5<=0?0:clamp(net/q5,-1,1),
    verified?1:0,flowDisagree,
    poslog(verified?num(recent.recent_5m_trades):null,8),
    br===null||br<=0?0:clamp(Math.log(br),-2,2),
    bookReady?1:0,
    clamp(scaled(p5,3)*bias,-3,3),
    clamp(scaled(p5,3)*scaled(oi,3),-3,3),
    scaled(age,10)
  ];
  if(f.length!==FEATURE_ORDER_V18.length||f.some(x=>!Number.isFinite(x)))
    throw Error('V18_FEATURE_CONTRACT_BROKEN');
  return {status:'READY_RESEARCH_FEATURES',vector:f,
    evidence:{symbol:item.symbol,end_ms:end,finished_ms:finishedMs,
      future_fields_used:false,verified_recent5_taker:verified,
      two_book_snapshots:bookReady,OI_direction_unverified:true,
      fill_execution_price_unverified:true,flow_price_disagreement:flowDisagree===1}};
}
export function forecastV18(model,vector){
  if(!model||model.schema!=='IRYS_V18_CAUSAL_LOGISTIC_V1'||
     JSON.stringify(model.feature_order)!==JSON.stringify(FEATURE_ORDER_V18)||
     !Array.isArray(model.weights)||model.weights.length!==FEATURE_ORDER_V18.length||
     !Array.isArray(vector)||vector.length!==FEATURE_ORDER_V18.length||
     !Number.isFinite(model.intercept))throw Error('V18_MODEL_SCHEMA_MISMATCH');
  let z=model.intercept;
  for(let i=0;i<vector.length;i++){
    if(!Number.isFinite(model.weights[i])||!Number.isFinite(vector[i]))
      throw Error('V18_NONFINITE_MODEL_INPUT');
    z+=model.weights[i]*vector[i];
  }
  const rawScore=1/(1+Math.exp(-clamp(z,-35,35)));
  const priceSign=Math.sign(vector[FEATURE_ORDER_V18.indexOf('ret5m')]);
  // Continuation-vs-reversal training removes the global ALWAYS_SHORT bias.
  const score=model.target_mode==='CONTINUATION_VS_REVERSAL'?
    (priceSign===0?.5:priceSign>0?rawScore:1-rawScore):rawScore;
  return {score_up:score,score_down:1-score,horizon_min:model.horizon_min,
    verified_accuracy:null,
    meaning:'UNCALIBRATED_RELATIVE_MODEL_SCORE_NOT_A_SUCCESS_PROBABILITY'};
}
export function modelObservationV18(model,item,flow,finishedMs){
 const x=marketFeaturesV18(item,flow,finishedMs);
 if(!x.vector)return {status:x.status,forecast:null};
 return {status:x.status,forecast:forecastV18(model,x.vector),evidence:x.evidence};
}
