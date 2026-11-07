/** Independent causal price-response challenger. Research only; no alert/order code. */
const RESPONSE_VERSION='V36_RESPONSE_CHALLENGER_V1',MIN=60000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const sign=x=>x>0?1:x<0?-1:0;
function quote(q,observed){
 return positive(q?.bid)&&positive(q?.ask)&&q.ask>=q.bid&&Number.isSafeInteger(q.at_ms)&&q.at_ms<=observed&&observed-q.at_ms<=45000;
}
function responseTape(snapshots,after,before){
 const seen=new Map();
 for(const s of snapshots)for(const x of Array.isArray(s.trades)?s.trades:[]){
  if(!Number.isSafeInteger(x?.at_ms)||x.at_ms<=after||x.at_ms>before||x.at_ms>s.observed_at_ms||
   !positive(x.price)||!positive(x.size)||!['BUY','SELL'].includes(x.side))continue;
  const fp=[x.at_ms,x.side,x.price,x.size].join(':');
  // IDs identify prints, NOT temporal ordering. Fallback is conservative when no unique ID exists.
  const key=typeof x.id==='string'&&x.id?'ID:'+x.id:'FP:'+fp;
  if(seen.has(key)){if(seen.get(key).fp!==fp)return {status:'TRADE_ID_CONFLICT'};continue;}
  seen.set(key,{...x,fp});
 }
 const rows=[...seen.values()];
 if(rows.length<3)return {status:'SPARSE_TAPE',count:rows.length};
 const groups=new Map();let total=0,buy=0;
 for(const x of rows){const n=x.price*x.size;if(!positive(n))return {status:'INVALID_NOTIONAL'};
  total+=n;if(x.side==='BUY')buy+=n;
  const g=groups.get(x.at_ms)||{at_ms:x.at_ms,notional:0,priceNotional:0};
  g.notional+=n;g.priceNotional+=n*x.price;groups.set(x.at_ms,g);
 }
 if(!positive(total)||groups.size<2)return {status:'SPARSE_TAPE',count:rows.length};
 const sorted=[...groups.values()].sort((a,b)=>a.at_ms-b.at_ms);let used=0,early=0,late=0;
 // Tied timestamps are pooled; do not invent the order of simultaneous trades.
 for(const g of sorted){const p=g.priceNotional/g.notional,a=Math.min(g.notional,Math.max(0,total/2-used));
  early+=a*p;late+=(g.notional-a)*p;used+=g.notional;
 }
 if(!positive(early)||!positive(late))return {status:'INVALID_NOTIONAL'};
 return {status:'OBSERVED',count:rows.length,buy_share:buy/total,notional:total,response_pct:100*(late/early-1),
  first_ms:sorted[0].at_ms,last_ms:sorted.at(-1).at_ms,source:'SAMPLED_PUBLIC_TRADES_NOT_FULL_CVD'};
}
function v36Response(item,now){
 const c=item?.candidate||{},a=item?.first,b=item?.second,f=item?.final;
 const base={version:RESPONSE_VERSION,venue:c.venue??null,symbol:c.symbol??null,candidate_direction:c.direction??null,
  issued_at_ms:now,direction:'UNCONFIRMED',probability:null,trade_permit:false,telegram_sent:false,orders_sent:false,
  future_accuracy_proven:false,absorption_proven:false,entry_reference_is_live_executable:false};
 const fail=(status,reason,extra={})=>({...base,status,reason,...extra});
 if(!Number.isSafeInteger(now)||!['bitget','bithumb'].includes(c.venue)||typeof c.symbol!=='string'||
  !(c.venue==='bithumb'?/^KRW-[A-Z0-9]{1,25}$/:/^[A-Z0-9]{1,25}USDT$/).test(c.symbol)||
  !['BUY','LONG','SHORT'].includes(c.direction)||(c.venue==='bithumb'?c.direction!=='BUY':c.direction==='BUY')||
  [a,b,f].some(s=>!s||s.venue!==c.venue||s.symbol!==c.symbol||!Number.isSafeInteger(s.observed_at_ms)||s.observed_at_ms>now)||
  a.observed_at_ms>=b.observed_at_ms||b.observed_at_ms>f.observed_at_ms||
  !quote(a.quote,a.observed_at_ms)||!quote(b.quote,b.observed_at_ms)||!quote(f.quote,now)||f.quote.at_ms<b.quote.at_ms)
  return fail('INVALID_SOURCE','IDENTITY_CLOCK_OR_QUOTE');
 const tape=responseTape([a,b],b.observed_at_ms-MIN,b.observed_at_ms);
 if(tape.status!=='OBSERVED')return fail(tape.status==='SPARSE_TAPE'?'INSUFFICIENT_EVIDENCE':'INVALID_SOURCE',tape.status);
 if(now-tape.last_ms>30000)return fail('INSUFFICIENT_EVIDENCE','STALE_SAMPLED_TAPE');
 const midA=(a.quote.bid+a.quote.ask)/2,midF=(f.quote.bid+f.quote.ask)/2;
 const move=100*(midF/midA-1),spreadPct=100*Math.max(a.quote.ask-a.quote.bid,f.quote.ask-f.quote.bid)/midF;
 const qSide=sign(move),tSide=sign(tape.response_pct),pressureSide=sign(tape.buy_share-.5);
 const evidence={quote_response_pct:move,tape_response_pct:tape.response_pct,buy_share:tape.buy_share,
  trade_count:tape.count,notional:tape.notional,first_trade_ms:tape.first_ms,last_trade_ms:tape.last_ms,
  last_trade_age_ms:now-tape.last_ms,spread_pct:spreadPct,window_start_ms:b.observed_at_ms-MIN,
  window_end_ms:b.observed_at_ms,sampled_not_full_cvd:true,rolling_24h_turnover_used:false};
 // This is an explicit uncalibrated hypothesis, not a quality gate for the production sender.
 if(!qSide||qSide!==tSide||Math.abs(move)<=spreadPct)return fail('UNRESOLVED','PRICE_RESPONSE_NOT_AGREED_ABOVE_SPREAD',{evidence});
 if(c.venue==='bithumb'&&qSide<0)return fail('SPOT_DOWNSIDE_OBSERVATION','SPOT_SELL_NOT_A_BUY_SIGNAL',{evidence});
 const direction=c.venue==='bithumb'?'BUY':qSide>0?'LONG':'SHORT';
 return {...base,status:'OBSERVED',reason:null,direction,source_observed_at_ms:f.observed_at_ms,
  source_to_decision_latency_ms:now-f.observed_at_ms,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',
  source_quote_at_ms:f.quote.at_ms,original_bid:f.quote.bid,original_ask:f.quote.ask,
  entry_price:qSide>0?f.quote.ask:f.quote.bid,first_complete_start_ms:Math.ceil(now/MIN)*MIN,
  pressure_context:pressureSide===0?'NEUTRAL':qSide===pressureSide?'AGGRESSION_ALIGNED':'PRICE_RESISTS_OPPOSITE_AGGRESSION',
  evidence,direction_outcomes:{}};
}
export {RESPONSE_VERSION,v36Response,responseTape};
