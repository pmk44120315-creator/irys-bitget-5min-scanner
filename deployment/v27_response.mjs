/** V27 executable-price / equal-notional response engine.
 * Describes present evidence. No order, account, or calibrated future probability.
 * A latest-trade bounce is not a moved executable quote; opposing pressure that
 * fails to move price is disclosed, not mechanically equated to its trade side.
 */
const V27_FRESH_MS=90000;
const V27_URL='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v27_bitget_response_latest.json';
function v27N(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function v27Quote(q,now){
 const bid=v27N(q?.bid),ask=v27N(q?.ask),at=v27N(q?.at_ms);
 if(bid===null||ask===null||bid<=0||ask<bid||!Number.isSafeInteger(at)||at>now+1000||now-at>V27_FRESH_MS)return null;
 return {bid,ask,at_ms:at,spread_pct:100*(ask/bid-1)};
}
function v27Progress(c,q,now){
 const quote=v27Quote(q,now);if(!quote)return {status:'QUOTE_UNKNOWN',future_direction_proven:false};
 const baseline=v27N(c?.baseline_price);
 if(baseline===null||baseline<=0)return {status:'BASELINE_UNKNOWN',quote,future_direction_proven:false};
 const up=c?.side_observed!=='DOWN';
 const progress=up?100*(quote.bid/baseline-1):100*(baseline-quote.ask)/baseline;
 return {status:progress>1e-9?'QUOTED_PROGRESS':'NO_EXECUTABLE_PROGRESS',
   executable_progress_pct:progress,baseline_price:baseline,quote,
   actual_fill_verified:false,quote_size_and_fees_unmeasured:true,future_direction_proven:false};
}
function v27EffortResponse(raw,venue,now,spreadPct,symbol){
 const unknown=status=>({status,future_direction_proven:false,full_cvd_verified:false});
 const source=Array.isArray(raw)?raw:raw?.code==='00000'?raw.data:null;
 if(!Array.isArray(source))return unknown('SAMPLE_UNAVAILABLE');
 const map=new Map(),providerIds=new Map();let conflict=false,providerConflict=false;
 for(const r of source){
  if(venue==='bitget'&&r.symbol&&r.symbol!==symbol)continue;
  const at=v27N(venue==='bitget'?r.ts:(r.timestamp??r.trade_timestamp));
  const p=v27N(venue==='bitget'?r.price:r.trade_price),size=v27N(venue==='bitget'?r.size:r.trade_volume);
  const side=String(venue==='bitget'?r.side:r.ask_bid).toUpperCase();
  if(!Number.isSafeInteger(at)||at>now||now-at>120000||p===null||p<=0||size===null||size<=0||!['BUY','SELL','BID','ASK'].includes(side))continue;
  const buy=['BUY','BID'].includes(side),fingerprint=[at,side,p,size].join(':');
  const providerId=String(r.tradeId??r.sequential_id??fingerprint);
  if(providerIds.has(providerId)&&providerIds.get(providerId)!==fingerprint)providerConflict=true;
  providerIds.set(providerId,fingerprint);
  // Real Bithumb REST samples contain different prints sharing sequential_id.
  // Retain distinct observed rows, dedupe exact row repeats, and disclose that
  // unique execution counts are unknown. Bitget ID conflicts still fail closed.
  const id=venue==='bithumb'?fingerprint:providerId;
  const row={at,p,size,buy,q:p*size,id};if(!Number.isFinite(row.q))continue;
  if(map.has(id)&&JSON.stringify(map.get(id))!==JSON.stringify(row))conflict=true;
  map.set(id,row);
 }
 if(conflict)return unknown('CONFLICTING_TRADE_IDS');
 const rows=[...map.values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 if(rows.length<3||rows.at(-1).at===rows[0].at||now-rows.at(-1).at>V27_FRESH_MS)return unknown('INSUFFICIENT_RECENT_SAMPLE');
 const total=rows.reduce((s,x)=>s+x.q,0),buy=rows.reduce((s,x)=>s+(x.buy?x.q:0),0),half=total/2;
 // Split observed notional, NOT synthetic trades, into equal-money halves.
 // This prevents a burst of tiny prints from dominating a meaningful large trade.
 let used=0,earlyValue=0,lateValue=0;
 const byTime=new Map();
 for(const r of rows){const bucket=byTime.get(r.at)||{q:0,qp:0};bucket.q+=r.q;bucket.qp+=r.q*r.p;byTime.set(r.at,bucket);}
 // Exchange millisecond timestamps do not establish within-millisecond order.
 // Split equal-notional observations across time buckets, never arbitrary IDs.
 for(const b of byTime.values()){const price=b.qp/b.q,first=Math.min(b.q,Math.max(0,half-used));earlyValue+=first*price;lateValue+=(b.q-first)*price;used+=b.q;}
 const early=earlyValue/half,late=lateValue/half,delta=100*(late/early-1),spread=v27N(spreadPct);
 if(!(total>0&&early>0&&late>0)||spread===null||spread<0)return unknown('SPREAD_OR_SAMPLE_UNVERIFIED');
 const effort=buy>(total-buy)?'BUY':buy<(total-buy)?'SELL':'BALANCED';
 const response=delta>spread?'UP':delta< -spread?'DOWN':'WITHIN_SPREAD';
 let state='BALANCED_EFFORT';
 if(effort==='BUY')state=response==='UP'?'BUY_PRESSURE_ADVANCES':response==='DOWN'?'BUY_PRESSURE_FAILED':'BUY_PRESSURE_STALLED';
 if(effort==='SELL')state=response==='DOWN'?'SELL_PRESSURE_ADVANCES':response==='UP'?'SELL_PRESSURE_FAILED':'SELL_PRESSURE_STALLED';
 return {status:'SAMPLED_RESPONSE',state,observed_response:response,
  exact_execution_count_verified:false,provider_id_conflict_observed:providerConflict,
  sample_count_basis:venue==='bithumb'?'DISTINCT_OBSERVED_ROW_LOWER_BOUND':'DISTINCT_PROVIDER_TRADE_IDS',
  same_millisecond_buckets:byTime.size,within_millisecond_order_verified:false,
  sample_trades:rows.length,sample_start_ms:rows[0].at,sample_end_ms:rows.at(-1).at,
  sample_span_ms:rows.at(-1).at-rows[0].at,buy_share:buy/total,
  net_sample_quote:2*buy-total,total_sample_quote:total,
  equal_notional_early_price:early,equal_notional_late_price:late,response_pct:delta,
  comparison_spread_pct:spread,continuous_absorption_verified:false,
  full_cvd_verified:false,future_direction_proven:false};
}
function v27DirectionCheck(proof,rawQuote,now){
 const quote=v27Quote(rawQuote,now),p=v27N(proof?.price);
 if(!quote||p===null||p<=0)return {status:'LATEST_QUOTE_UNAVAILABLE',future_direction_proven:false};
 if(!['LONG','SHORT'].includes(proof.direction))return {status:'DIRECTION_UNKNOWN',future_direction_proven:false};
 const reversed=proof.direction==='LONG'?quote.ask<p:quote.bid>p;
 return {status:reversed?'EVIDENCE_REVERSED':'CURRENT_QUOTE_CHECKED',quote,
  evidence_price:p,mid_change_since_evidence_pct:100*((quote.bid+quote.ask)/2/p-1),future_direction_proven:false};
}
async function v27ReadFresh(read,requestedAt,options={}){
 const clock=options.clock||Date.now,sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
 const start=clock(),deadline=start+(options.maxWaitMs??90000);
 const token=typeof options.githubToken==='string'&&options.githubToken?options.githubToken:null;
 let reads=0,lastReason='NO_GENERATION',lastObservation=null;
 while(true){
  try{
   let doc,transport='PUBLIC_RAW';
   if(token){
    try{
     const url='https://api.github.com/repos/pmk44120315-creator/irys-bitget-5min-scanner/contents/data/v27_bitget_response_latest.json?ref=main&v27='+clock();
     doc=await read(url,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github.raw+json','User-Agent':'IRYS-verified-public-market-reader','cache-control':'no-cache'},cf:{cacheTtl:0}},8500);
     reads++;transport='GITHUB_AUTHENTICATED_CONTENTS';
    }catch(_e){
     reads++;
     doc=await read(V27_URL+'?v27='+clock(),{headers:{accept:'application/json','cache-control':'no-cache'},cf:{cacheTtl:0}},8500);
     reads++;transport='PUBLIC_RAW_FALLBACK';
    }
   }else{
    doc=await read(V27_URL+'?v27='+clock(),{headers:{accept:'application/json','cache-control':'no-cache'},cf:{cacheTtl:0}},8500);reads++;
   }
   const now=clock(),at=v27N(doc?.at_ms),parent=v27N(doc?.parent_at_ms);
   lastObservation={source_transport:transport,at_ms:at,parent_at_ms:parent,requested_at_ms:requestedAt,
     now_ms:now,age_ms:at===null?null:now-at,same_generation:parent!==null&&parent>=requestedAt-15000,
     lineage:doc?.source?.at_ms===parent};
   if(doc?.version==='IRYS_V27_EXECUTABLE_RESPONSE_V1'&&Number.isSafeInteger(at)&&Number.isSafeInteger(parent)&&
      doc.source?.at_ms===parent&&at>=parent&&at<=now+1000&&now-at<=V27_FRESH_MS&&now-parent<=V27_FRESH_MS&&
      parent>=requestedAt-15000){return {status:'FRESH',doc,reads,wait_ms:now-start,source_transport:transport};}
   lastReason='OLD_OR_UNTRUSTED_GENERATION';
  }catch(_e){reads++;lastReason='FRESH_SOURCE_READ_FAILED';lastObservation={source_transport:'UNAVAILABLE',now_ms:clock(),requested_at_ms:requestedAt};}
  const remaining=deadline-clock();if(remaining<=0)break;
  await sleep(Math.min(5000,remaining));
 }
 return {status:'FRESH_GENERATION_UNAVAILABLE',reason:lastReason,reads,wait_ms:clock()-start,last_observation:lastObservation};
}

function v27ResponseText(response){
 const labels={BUY_PRESSURE_ADVANCES:'매수 체결이 실제 가격 상승으로 연결',SELL_PRESSURE_ADVANCES:'매도 체결이 실제 가격 하락으로 연결',BUY_PRESSURE_FAILED:'매수 체결 우세에도 가격 하락 · 매수 압력 실패',SELL_PRESSURE_FAILED:'매도 체결 우세에도 가격 상승 · 매도 압력 실패',BUY_PRESSURE_STALLED:'매수 우세이나 스프레드를 넘는 상승 미확인',SELL_PRESSURE_STALLED:'매도 우세이나 스프레드를 넘는 하락 미확인',BALANCED_EFFORT:'표본 매수·매도 균형'};
 if(response?.status!=='SAMPLED_RESPONSE')return '최근 체결-가격 반응: 자료 부족';
 return (labels[response.state]||'반응 미확인')+'\n공격매수 '+(response.buy_share*100).toFixed(1)+'% · '+response.sample_trades+'개 표본 / '+(response.sample_span_ms/1000).toFixed(1)+'초'+(response.sample_count_basis==='DISTINCT_OBSERVED_ROW_LOWER_BOUND'?' (고유체결수 미확인)':'')+'\n거래대금 시계 가격 반응 '+response.response_pct.toFixed(3)+'% (전체 CVD·흡수 확정 아님)';
}
export {V27_FRESH_MS,V27_URL,v27N,v27Quote,v27Progress,v27EffortResponse,v27DirectionCheck,v27ReadFresh,v27ResponseText};
