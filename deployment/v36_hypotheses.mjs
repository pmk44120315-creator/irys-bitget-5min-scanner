/** V36 competing directional observations; not a probability or permission. */
const V36_HYPOTHESIS_VERSION='V36_CONTRA_FLOW_OBSERVATION_V1';
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const clip=x=>Math.min(5,Math.max(-5,x));
function validQuote(q,now){const bid=num(q?.bid),ask=num(q?.ask),t=q?.at_ms;
 return bid!==null&&ask!==null&&bid>0&&ask>=bid&&Number.isSafeInteger(t)&&t<=now&&now-t<=45000?{bid,ask,at:t,mid:(bid+ask)/2,spread:ask-bid}:null;
}
function tapeSummary(raw,venue,after,before){
 if(!Array.isArray(raw)||!Number.isSafeInteger(after)||!Number.isSafeInteger(before))return null;
 const records=[],seen=new Map();let conflict=false;
 for(const x of raw){if(!Number.isSafeInteger(x?.at_ms)||x.at_ms<=after||x.at_ms>before)continue;
  const p=num(x.price),s=num(x.size);if(p===null||s===null||p<=0||s<=0||!['BUY','SELL'].includes(x.side))continue;
  const fp=[x.at_ms,x.side,p,s].join(':'),key=venue==='bithumb'?fp:typeof x.id==='string'&&x.id?x.id:fp;
  if(seen.has(key)){if(seen.get(key)!==fp)conflict=true;continue;}seen.set(key,fp);records.push({...x,price:p,size:s});
 }
 if(conflict)return {status:'TRADE_ID_CONFLICT'};
 records.sort((a,b)=>a.at_ms-b.at_ms||a.price-b.price||a.side.localeCompare(b.side));
 if(records.length<3||new Set(records.map(x=>x.at_ms)).size<2)return {status:'SPARSE_TAPE'};
 let buy=0,total=0,early=0,late=0,used=0;
 for(const x of records){const v=x.price*x.size;total+=v;if(x.side==='BUY')buy+=v;}
 if(!Number.isFinite(total)||total<=0)return {status:'INVALID_TAPE'};
 for(const x of records){const v=x.price*x.size,a=Math.min(v,Math.max(0,total/2-used));early+=a*x.price;late+=(v-a)*x.price;used+=v;}
 return {status:'OBSERVED',count:records.length,buy_share:buy/total,notional:total,price_response_pct:100*(late/early-1),
  last_ms:records.at(-1).at_ms,source:'SAMPLED_PUBLIC_TAKER_NOT_FULL_CVD'};
}
function v36Evidence(item,now,benchmark={}){
 const c=item?.candidate||{},a=item?.first,b=item?.second,f=item?.final;
 const fail=(status,reason)=>({version:V36_HYPOTHESIS_VERSION,status,reason,symbol:c.symbol||null,venue:c.venue||null,support:0,counter:0,probability:null,future_direction_proven:false,trade_permission:false});
 if(!['bitget','bithumb'].includes(c.venue)||typeof c.symbol!=='string'||!['LONG','SHORT','BUY'].includes(c.direction)||c.venue==='bithumb'&&c.direction!=='BUY')return fail('INVALID_IDENTITY','MARKET_DIRECTION');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(a?.observed_at_ms)||!Number.isSafeInteger(b?.observed_at_ms)||!Number.isSafeInteger(f?.observed_at_ms)||
 a.observed_at_ms>=b.observed_at_ms||b.observed_at_ms>f.observed_at_ms||f.observed_at_ms>now||
 [a,b,f].some(x=>x.venue!==c.venue||x.symbol!==c.symbol))return fail('INVALID_TIME','SOURCE_IDENTITY_OR_CLOCK');
 const qa=validQuote(a.quote,a.observed_at_ms),qb=validQuote(b.quote,b.observed_at_ms),qf=validQuote(f.quote,now);
 if(!qa||!qb||!qf||qf.at<qb.at)return fail('SOURCE_NOT_FRESH','QUOTE_INVALID_OR_EXPIRED');
 const first=tapeSummary(a.trades,c.venue,a.observed_at_ms-60000,a.observed_at_ms),recent=tapeSummary(b.trades,c.venue,a.observed_at_ms,b.observed_at_ms);
 if(first?.status!=='OBSERVED'||recent?.status!=='OBSERVED')return fail('INSUFFICIENT_EVIDENCE','TAPE_MISSING_OR_CONFLICTING');
 const dir=c.direction==='SHORT'?-1:1,spreadPct=100*qa.spread/qa.mid;
 const move=dir*100*(qf.mid/qa.mid-1),one=dir*(2*first.buy_share-1),two=dir*(2*recent.buy_share-1),delta=two-one;
 const response1=dir*first.price_response_pct,response2=dir*recent.price_response_pct;
 const base=Number.isFinite(benchmark?.market_move_pct)&&Number.isSafeInteger(benchmark.source_at_ms)&&benchmark.source_at_ms<=now&&now-benchmark.source_at_ms<=90000?dir*benchmark.market_move_pct:null;
 const relative=base===null?null:move-base,z=Math.max(.02,spreadPct);
 const support=Math.max(0,one)*1.2+Math.max(0,two)*2+Math.max(0,move/z)*.5+
 Math.max(0,response2/z)*.25+(relative===null?0:Math.max(0,clip(relative))*.15);
 const counter=Math.max(0,-two)*2+Math.max(0,-move/z)*.65+Math.max(0,-delta)*1.2+
 Math.max(0,-response2/z)*.35+(relative===null?0:Math.max(0,-clip(relative))*.15)+Math.max(0,spreadPct-.25)*2;
 return {version:V36_HYPOTHESIS_VERSION,status:'OBSERVED',reason:null,venue:c.venue,symbol:c.symbol,direction:c.direction,
 observed_at_ms:f.observed_at_ms,support,counter,state:support>counter*1.5?'SUPPORT_LEADING':counter>support*1.5?'COUNTER_LEADING':'UNRESOLVED',
 probability:null,future_direction_proven:false,trade_permission:false,
 evidence:{signed_quote_move_pct:move,first_buy_share:first.buy_share,new_buy_share:recent.buy_share,first_response_pct:response1,
 new_response_pct:response2,signed_pressure_change:delta,spread_pct:spreadPct,relative_to_market_pct:relative,
 first_trade_count:first.count,new_trade_count:recent.count,sampled_taker_not_full_cvd:true,market_baseline_available:base!==null}};
}
export {V36_HYPOTHESIS_VERSION,v36Evidence,tapeSummary};
