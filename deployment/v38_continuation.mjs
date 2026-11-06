/** V38 closed-bar controlled-pullback reacceleration research; no entry permit or Telegram. */
const V38_VERSION='V38_EARLY_PULLBACK_CONTINUATION_SHADOW_V1';
const STEP=300000;
const valid=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>valid(x)&&x>0;
const median=x=>{const s=x.filter(valid).sort((a,b)=>a-b);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
const ema=(a,n)=>{if(!a.length)return [];const k=2/(n+1),out=[a[0]];for(let i=1;i<a.length;i++)out.push(out.at(-1)*(1-k)+a[i]*k);return out;};
function v38ParseBitgetCandles(raw,now){
 const fail=reason=>({status:'SOURCE_UNAVAILABLE',reason,bars:[],full_taker_cvd_verified:false});
 if(raw?.code!=='00000'||!Array.isArray(raw.data)||!Number.isSafeInteger(now))return fail('INVALID_PUBLIC_CANDLE_SCHEMA');
 const bars=[];
 for(const x of raw.data){
  if(!Array.isArray(x)||x.length<7)return fail('INVALID_CANDLE_ROW');
  const start=Number(x[0]),nums=x.slice(1,7).map(Number),[open,high,low,close,base,turnover]=nums;
  if(!Number.isSafeInteger(start)||start%STEP||![open,high,low,close].every(positive)||!valid(base)||base<0||!valid(turnover)||turnover<0||
   low>Math.min(open,close)||high<Math.max(open,close))return fail('INVALID_CANDLE_OHLCV');
  if(start+STEP>now)continue;bars.push({start_ms:start,open,high,low,close,turnover_quote:turnover});
 }
 bars.sort((a,b)=>a.start_ms-b.start_ms);
 if(bars.some((b,i)=>i>0&&bars[i-1].start_ms===b.start_ms))return fail('DUPLICATE_SOURCE_CANDLES');
 return {status:'OBSERVED',reason:null,bars,full_taker_cvd_verified:false,volume_kind:'CANDLE_QUOTE_TURNOVER_NOT_CVD'};
}
function v38Detect({venue,symbol,direction,bars,now}={}){
 const fail=(status,reason)=>({version:V38_VERSION,status,reason:reason||null,venue,symbol,direction,trade_permit:false,
 future_accuracy_proven:false,probability:null,actual_execution_verified:false});
 if(!Number.isSafeInteger(now)||!Array.isArray(bars)||!['bitget','bithumb'].includes(venue)||
 !['LONG','SHORT','BUY'].includes(direction)||venue==='bithumb'&&direction!=='BUY'||
 typeof symbol!=='string'||!(venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/:/^KRW-[A-Z0-9]{1,25}$/).test(symbol))return fail('INVALID_SOURCE','IDENTITY');
 const closed=bars.filter(b=>Number.isSafeInteger(b?.start_ms)&&b.start_ms+STEP<=now);
 const r=closed.sort((a,b)=>a.start_ms-b.start_ms);
 if(r.some((b,i)=>!Number.isSafeInteger(b.start_ms)||b.start_ms%STEP||![b.open,b.high,b.low,b.close].every(positive)||
   b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||i&&b.start_ms<=r[i-1].start_ms))return fail('INVALID_SOURCE','INVALID_OR_DUPLICATED_OHLC');
 if(r.length<40)return fail('INSUFFICIENT_HISTORY','NEED_CLOSED_CONTEXT');
 if(now-(r.at(-1).start_ms+STEP)>STEP)return fail('SOURCE_NOT_FRESH','LAST_COMPLETE_BAR_STALE');
 if(r.slice(-35).some((b,i,arr)=>i>0&&b.start_ms-arr[i-1].start_ms!==STEP))return fail('INVALID_SOURCE','MISSING_CONTEXT_CANDLE');
 const sign=direction==='SHORT'?-1:1,n=r.length,original=r.slice(-65);
 const transformed=original.map(b=>({t:b.start_ms,open:sign*b.open,close:sign*b.close,high:sign===1?b.high:-b.low,low:sign===1?b.low:-b.high,turnover_quote:b.turnover_quote}));
 const len=transformed.length,last=transformed.at(-1),prev=transformed.at(-2);
 const closes=transformed.map(b=>b.close),e21=ema(closes,21),e34=ema(closes,34);
 const currentTrend=e21.at(-1)>e34.at(-1)&&e21.at(-1)>e21.at(-7);
 if(!currentTrend)return fail('NO_SETUP','NO_PRIOR_DIRECTIONAL_TREND');
 const trueRanges=transformed.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-transformed[i].close),Math.abs(b.low-transformed[i].close)));
 const atr=median(trueRanges.slice(-18));if(!positive(atr))return fail('INSUFFICIENT_HISTORY','ATR_UNAVAILABLE');
 if(!(last.close>last.open&&last.close>prev.high+0.01*atr))return fail('NO_SETUP','NO_CLOSED_BAR_RECLAIM');
 let late=false;
 for(let peak=len-4;peak>=Math.max(27,len-12);peak--){
  const high=transformed[peak].high;
  if(transformed.slice(peak+1,len-1).some(b=>b.high>high))continue;
  const prior=transformed.slice(Math.max(0,peak-26),peak);
  if(prior.length<18)continue;
  const baseLow=Math.min(...prior.map(b=>b.low)),impulse=high-baseLow;
  if(!(impulse>=2.5*atr))continue;
  const pull=transformed.slice(peak+1,len-1);if(pull.length<2)continue;
  const trough=Math.min(...pull.map(b=>b.low)),depth=(high-trough)/impulse;
  if(!(depth>=.12&&depth<=.8))continue;
  if(last.low<trough-.15*atr)continue;
  const risk=Math.max(last.close-trough,.5*atr);
  const potential=high-last.close,rr=potential/risk;
  if(potential<=.1*atr||rr<.8){late=true;continue;}
  if(last.close>high+0.15*atr){late=true;continue;}
  const priorFlows=transformed.slice(-7,-1).map(b=>b.turnover_quote).filter(valid);
  const flowMedian=median(priorFlows),flowRatio=flowMedian>0&&valid(last.turnover_quote)?last.turnover_quote/flowMedian:null;
  const stop=sign===1?trough:-trough;
  const target=sign===1?high:-high;
  const eventPrice=sign*last.close;
  return {version:V38_VERSION,status:'EARLY_RECLAIM',reason:null,venue,symbol,direction,
   signal_kind:'CONTROLLED_PULLBACK_FIRST_RECLAIM',source:'ONLY_CLOSED_5M_PUBLIC_CANDLES',evaluated_at_ms:now,
   signal_closed_at_ms:last.t+STEP,first_reclaim_bar_start_ms:last.t,impulse_peak_at_ms:transformed[peak].t,
   prior_trough_at_ms:pull.find(x=>x.low===trough)?.t??null,
   close_reference:eventPrice,previous_impulse_high:target,stop_reference:stop,prior_high_reward_risk:rr,
   pullback_depth_ratio:depth,turnover_ratio:flowRatio,turnover_is_not_cvd:true,atr_reference:atr,
   high_level_trend_confirmed:true,confirmation_after_low_not_exact_bottom:true,
   trade_permit:false,entry_ready:false,probability:null,future_accuracy_proven:false,actual_execution_verified:false};
 }
 return fail(late?'EXTENDED_MOVE':'NO_SETUP',late?'RECLAIM_AFTER_REWARD_ALREADY_SPENT':'NO_CONTROLLED_PULLBACK');
}
export {V38_VERSION,v38Detect,v38ParseBitgetCandles};
