/** V29 independent CURRENT-evidence check + prospective outcome journal.
 * A matching price/tape pair is not demonstrated future directional quality.
 * Forecast delivery stays locked until a separately verified release changes it.
 * No orders, account API, private-data reads or Telegram transport in this module.
 */
const V29_MODEL='V29_PAIRED_QUOTE_NEW_TRADE_RESPONSE_V1';
const V29_QUOTE_MAX_AGE_MS=15000,V29_PAIR_MAX_AGE_MS=60000;
const V29_MIN_SEPARATION_MS=8000,V29_MAX_SEPARATION_MS=45000;
const V29_COST_SCENARIO_PCT=.20;
function v29N(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function v29Clock(x){return Number.isSafeInteger(x)&&x>=0;}
function v29Quote(q,now,maxAge=V29_QUOTE_MAX_AGE_MS){
 const bid=v29N(q?.bid),ask=v29N(q?.ask),at=q?.at_ms;
 return bid!==null&&ask!==null&&bid>0&&ask>=bid&&v29Clock(at)&&at<=now&&now-at<=maxAge?
  {bid,ask,at_ms:at,spread_pct:100*(ask/bid-1)}:null;
}
function v29Trades(rows,venue,after,before){
 if(!Array.isArray(rows))return {rows:[],conflict:false};const map=new Map();let conflict=false;
 for(const x of rows){
  const at=x?.at_ms,price=v29N(x?.price),size=v29N(x?.size),side=x?.side;
  if(!v29Clock(at)||at<=after||at>before||price===null||price<=0||size===null||size<=0||!['BUY','SELL'].includes(side))continue;
  const id=typeof x.id==='string'?x.id:null,fp=[at,side,price,size].join(':');
  if(venue==='bitget'&&!id)continue;
  const key=venue==='bitget'?id:fp,row={id:key,at_ms:at,price,size,side};
  if(map.has(key)&&JSON.stringify(map.get(key))!==JSON.stringify(row))conflict=true;
  map.set(key,row);
 }
 return {rows:[...map.values()].sort((a,b)=>a.at_ms-b.at_ms||a.id.localeCompare(b.id)),conflict};
}
function v29Response(rows,spread){
 if(rows.length<3||new Set(rows.map(x=>x.at_ms)).size<2)return null;
 const buckets=new Map();let total=0,buy=0;
 for(const x of rows){const q=x.price*x.size;if(!Number.isFinite(q)||q<=0)return null;total+=q;if(x.side==='BUY')buy+=q;
  const b=buckets.get(x.at_ms)||{q:0,qp:0};b.q+=q;b.qp+=q*x.price;buckets.set(x.at_ms,b);}
 if(!Number.isFinite(total)||total<=0)return null;const half=total/2;let used=0,early=0,late=0;
 for(const b of buckets.values()){const a=Math.min(b.q,Math.max(0,half-used));early+=a*b.qp/b.q;late+=(b.q-a)*b.qp/b.q;used+=b.q;}
 const p0=early/half,p1=late/half,move=100*(p1/p0-1);
 if(!Number.isFinite(move))return null;
 return {sample_rows:rows.length,start_ms:rows[0].at_ms,end_ms:rows.at(-1).at_ms,buy_share:buy/total,
  sampled_net_quote:2*buy-total,sampled_quote:total,response_pct:move,spread_pct:spread,
  aggression:buy>total/2?'BUY':buy<total/2?'SELL':'BALANCED',price_response:move>spread?'UP':move< -spread?'DOWN':'WITHIN_SPREAD',
  full_cvd_verified:false,exact_execution_count_verified:false,within_millisecond_order_verified:false};
}
function v29CheckPair(candidate,first,second,now){
 const fail=reason=>({model:V29_MODEL,status:'NOT_CONFIRMED',reason,symbol:candidate?.symbol??null,venue:candidate?.venue??null,
  direction:candidate?.direction??null,future_accuracy_proven:false,trading_permit:false});
 const c=candidate||{},long=['LONG','BUY'].includes(c.direction);
 if(!v29Clock(now)||!['bithumb','bitget'].includes(c.venue)||typeof c.symbol!=='string'||
  !(c.venue==='bithumb'?/^KRW-[A-Z0-9]{1,25}$/:/^[A-Z0-9]{1,25}USDT$/).test(c.symbol)||
  !(c.venue==='bithumb'?c.direction==='BUY':['LONG','SHORT'].includes(c.direction)))return fail('IDENTITY_OR_DIRECTION_INVALID');
 if(c.identity_verified!==true||c.risk_checked!==true||!Array.isArray(c.risk_flags)||c.risk_flags.length)return fail('IDENTITY_OR_RISK_UNVERIFIED');
 if(first?.venue!==c.venue||second?.venue!==c.venue||first?.symbol!==c.symbol||second?.symbol!==c.symbol)return fail('SNAPSHOT_IDENTITY_MISMATCH');
 const at1=first.observed_at_ms,at2=second.observed_at_ms;
 if(!v29Clock(at1)||!v29Clock(at2)||at1>now||at2>now||at2-at1<V29_MIN_SEPARATION_MS||at2-at1>V29_MAX_SEPARATION_MS)return fail('SECOND_OBSERVATION_NOT_INDEPENDENT');
 if(now-at1>V29_PAIR_MAX_AGE_MS)return fail('FIRST_OBSERVATION_STALE');
 const a=v29Quote(first.quote,at1),b=v29Quote(second.quote,now);
 if(!a||!b||b.at_ms<=at1||b.at_ms>at2||now-at2>V29_QUOTE_MAX_AGE_MS)return fail('CURRENT_QUOTES_UNVERIFIED');
 const anchor=v29N(c.anchor_price);
 if(anchor===null||anchor<=0||long&&b.bid<=anchor||!long&&b.ask>=anchor)return fail('OBSERVED_STRUCTURE_INVALIDATED');
 if(long?b.bid<=a.ask:b.ask>=a.bid)return fail('DIRECTION_NOT_CONFIRMED_IN_EXECUTABLE_QUOTES');
 const t1=v29Trades(first.trades,c.venue,at1-60000,at1),t2=v29Trades(second.trades,c.venue,at1,at2);
 if(t1.conflict||t2.conflict)return fail('CONFLICTING_TRADES');
 const firstIds=new Set(t1.rows.map(x=>x.id));const fresh=t2.rows.filter(x=>!firstIds.has(x.id));
 if(fresh.length<3||new Set(fresh.map(x=>x.at_ms)).size<2||now-fresh.at(-1).at_ms>V29_QUOTE_MAX_AGE_MS)return fail('NEW_TRADES_UNAVAILABLE');
 const r1=v29Response(t1.rows,a.spread_pct),r2=v29Response(fresh,b.spread_pct);
 if(!r1||!r2||at1-r1.end_ms>V29_QUOTE_MAX_AGE_MS)return fail('FIRST_TRADE_RESPONSE_UNMEASURED');
 const side=long?'BUY':'SELL',direction=long?'UP':'DOWN';
 if(r1.aggression!==side||r2.aggression!==side||r1.price_response!==direction||r2.price_response!==direction)return fail('TRADE_PRESSURE_PRICE_DISAGREEMENT');
 return {model:V29_MODEL,status:'DOUBLE_CHECKED_CURRENT_EVIDENCE',reason:null,venue:c.venue,symbol:c.symbol,direction:c.direction,
  checked_at_ms:now,first_observed_ms:at1,second_observed_ms:at2,anchor_price:anchor,first_quote:a,entry_quote:b,
  first_response:r1,new_trade_response:r2,nonoverlap_verified:true,
  executable_progress_pct:long?100*(b.bid/a.ask-1):100*(a.bid-b.ask)/a.bid,
  future_accuracy_proven:false,trading_permit:false};
}
function v29DeliveryPolicy(result){
 return {allowed:false,reason:result?.status==='DOUBLE_CHECKED_CURRENT_EVIDENCE'?'FORWARD_DIRECTIONAL_QUALITY_UNPROVEN':result?.reason||'NO_INDEPENDENT_CONFIRMATION',
  policy:'NO_UNVALIDATED_MARKET_ALERTS',model:V29_MODEL};
}
function v29Record(old,result,now){
 const state=structuredClone(old||{});state.records=Array.isArray(state.records)?state.records:[];
 state.model=V29_MODEL;
 if(result?.status!=='DOUBLE_CHECKED_CURRENT_EVIDENCE'||result.checked_at_ms!==now)return state;
 const id=[result.venue,result.symbol,result.direction,result.second_observed_ms].join(':');
 if(state.records.some(r=>r.id===id))return state;
 const recent=state.records.filter(r=>r.venue===result.venue&&r.symbol===result.symbol&&r.direction===result.direction).at(-1);
 if(recent&&now-recent.issued_at_ms<15*60000)return state; // no overlapping repeated forecast path per symbol
 state.records.push({id,model:V29_MODEL,venue:result.venue,symbol:result.symbol,direction:result.direction,
  issued_at_ms:now,entry_quote:structuredClone(result.entry_quote),evidence:structuredClone(result),outcomes:{},telegram_sent:false});
 state.records=state.records.slice(-600);return state;
}
function v29Settle(old,quotes,now){
 const state=structuredClone(old||{});state.records=Array.isArray(state.records)?state.records:[];
 const by=new Map((Array.isArray(quotes)?quotes:[]).map(q=>[q.venue+':'+q.symbol,q]));
 for(const r of state.records){if(r.model!==V29_MODEL)continue;r.outcomes??={};
  for(const h of [5,15,30,60]){const k=String(h),target=r.issued_at_ms+h*60000;if(r.outcomes[k]||now<target)continue;
   const raw=by.get(r.venue+':'+r.symbol),q=v29Quote(raw,now),entry=v29Quote(r.entry_quote,r.issued_at_ms);
   if(q&&entry&&q.at_ms>=target&&q.at_ms<=target+150000){
    const gross=r.direction==='SHORT'?100*(entry.bid-q.ask)/entry.bid:100*(q.bid/entry.ask-1);
    r.outcomes[k]={status:'MEASURED_PUBLIC_QUOTE_PROXY',at_ms:q.at_ms,gross_quote_proxy_pct:gross,net_cost_scenario_pct:gross-V29_COST_SCENARIO_PCT,
      cost_assumption_pct:V29_COST_SCENARIO_PCT,exit_quote:q,actual_fill_verified:false};
   }else if(now>target+150000)r.outcomes[k]={status:'UNMEASURED_TARGET_QUOTE',actual_fill_verified:false};
  }
 }
 return state;
}
function v29Summary(state){const rows=(state?.records||[]).filter(r=>r.model===V29_MODEL),horizons={};
 for(const h of [5,15,30,60]){const k=String(h),o=rows.map(r=>r.outcomes?.[k]),m=o.filter(x=>x?.status==='MEASURED_PUBLIC_QUOTE_PROXY');
  horizons[k]={measured:m.length,unmeasured:o.filter(x=>x?.status==='UNMEASURED_TARGET_QUOTE').length,pending:o.filter(x=>!x).length,
   positive_net_scenario:m.filter(x=>x.net_cost_scenario_pct>0).length,mean_net_scenario_pct:m.length?m.reduce((s,x)=>s+x.net_cost_scenario_pct,0)/m.length:null};}
 return {model:V29_MODEL,stored_forecasts:rows.length,horizons,scope:'ROLLING_STORED_EVENTS_NOT_ALL_TIME',future_accuracy_proven:false,telegram_enabled:false};
}
export {V29_MODEL,v29N,v29Quote,v29Trades,v29CheckPair,v29DeliveryPolicy,v29Record,v29Settle,v29Summary};
