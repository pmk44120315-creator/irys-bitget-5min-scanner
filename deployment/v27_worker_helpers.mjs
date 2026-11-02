// Embedded with v27_response.mjs in the exact guarded V24 source.
function v27LoadQuotes(doc,state,now){
 if(doc?.version!=='IRYS_V27_EXECUTABLE_RESPONSE_V1'||doc.orders_sent!==false||doc.telegram_sent!==false||doc.not_full_cvd!==true||
    doc.source?.version!=='IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1'||doc.source.source_identity!=='V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO'||
    doc.source.at_ms!==doc.parent_at_ms||!Number.isSafeInteger(doc.at_ms)||doc.at_ms>now+1000||now-doc.at_ms>V27_FRESH_MS||
    now-doc.parent_at_ms>V27_FRESH_MS||Object.keys(doc.quotes||{}).length<100)return false;
 const quotes={};
 for(const [symbol,q] of Object.entries(doc.quotes)){
  if(!Object.hasOwn(doc.source.prices||{},symbol)||!Array.isArray(q))continue;
  const parsed=v27Quote({bid:q[0],ask:q[1],at_ms:q[2]},now);
  if(parsed)quotes[symbol]={...parsed,last:v27N(q[3])};
 }
 if(Object.keys(quotes).length<100)return false;
 state.v27Quotes=quotes;state.v27QuoteSourceMs=doc.at_ms;state.v27Responses=doc.responses||{};
 return true;
}
function v27EnrichFallback(fallback,doc,state,now){
 if(!v27LoadQuotes(doc,state,now))return {status:'V27_QUOTE_PROVENANCE_INVALID',age_min:null,candidates:[],observed:0};
 const original=new Map(doc.source.candidates.map(c=>[c.symbol,c]));
 fallback.candidates=fallback.candidates.map(c=>{
  const src=original.get(c.symbol),q=state.v27Quotes[c.symbol];
  const baseline=v27N(src?.baseline_price),price=v27N(q?.last);
  if(!q||baseline===null||baseline<=0||price===null||price<=0)return null;
  return {...c,baseline_price:baseline,price,move_pct:100*(price/baseline-1),
   price_timestamp_ms:q.at_ms,source_age_min:(now-q.at_ms)/60000,
   current_quote:q,response:v27SafeResponse(state.v27Responses[c.symbol],now),
   source:'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST'};
 }).filter(Boolean);
 return fallback;
}
async function v27ExecutableCandidates(candidates,state,read,now,clock=()=>now){
 const spots=candidates.filter(c=>c.venue==='bithumb'),books=new Map();
 let error=null;
 if(spots.length){try{
  const raw=await read('https://api.bithumb.com/v1/orderbook?markets='+encodeURIComponent(spots.map(x=>x.symbol).join(',')));
  if(!Array.isArray(raw))throw Error('BOOK_SCHEMA');
  for(const b of raw){const u=b.orderbook_units?.[0];books.set(b.market,{bid:u?.bid_price,ask:u?.ask_price,at_ms:Number(b.timestamp)});}
 }catch(e){error='BITHUMB_CURRENT_QUOTE_UNAVAILABLE';}}
 now=clock();
 const accepted=[],rejected=[];
 for(const c of candidates){
  const quote=c.venue==='bithumb'?books.get(c.symbol):(c.current_quote||state.v27Quotes?.[c.symbol]);
  const check=v27Progress(c,quote,now);
  if(check.status!=='QUOTED_PROGRESS'){rejected.push({venue:c.venue,symbol:c.symbol,reason:check.status});continue;}
  const retention=Math.min(1,check.executable_progress_pct/Math.max(.000001,Math.abs(c.move_pct)));
  accepted.push({...c,current_quote:check.quote,execution_check:check,
    original_priority:c.priority,priority:c.priority*retention});
 }
 accepted.sort((a,b)=>b.priority-a.priority);
 return {accepted,rejected,source_error:error};
}
function v27WatchMessage(row,response,now){
 const isSpot=row.venue==='bithumb',q=row.current_quote,e=row.execution_check;
 const f=(x,n=3)=>Number.isFinite(x)?x.toLocaleString('ko-KR',{maximumFractionDigits:n}):'미확인';
 return '🔎 [V27 실제 호가·체결 반응 관찰 · 진입 확정 아님]\n'+
  (isSpot?'빗썸 현물 ':'비트겟 선물 ')+row.symbol+' · '+kst(now)+'\n'+
  '관측 체결가 '+f(row.price,8)+(isSpot?'원':' USDT')+' · 기준 대비 '+f(row.move_pct)+'%\n'+
  '현재 최우선 매수/매도호가 '+f(q?.bid,8)+' / '+f(q?.ask,8)+'\n'+
  '기준 체결가 대비 매수호가 이동 '+f(e?.executable_progress_pct)+'% · 호가 '+f((now-q?.at_ms)/1000,1)+'초 전\n'+
  v27ResponseText(response)+'\n'+
  '⚠️ 표본 체결·현재 호가 관측이며 이후 상승·하락 적중이나 실제 체결 가격을 보장하지 않습니다. 전체 CVD·세력 흡수·자동매매 아님.';
}
function v27AuditSnapshot(row,now){
 return {version:'V27_ACTUAL_SENT_EVIDENCE_V1',venue:row.venue||'bitget',symbol:row.symbol||row.market,
  observation_at_ms:now,forecast_direction:row.direction||null,observed_direction:row.side_observed||null,
  observed_price:row.price??row.current_price_krw??row.price_krw??null,
  baseline_price:row.baseline_price??null,current_quote:row.current_quote||row.v27_current_check?.quote||null,
  response:row.response||null,execution_check:row.execution_check||null,
  source_asof_ms:row.asof_ms??row.price_timestamp_ms??row.observed_ms??null,
  future_direction_proven:false,actual_fill_verified:false};
}

function v27SafeResponse(r,now){
 if(r?.status!=='SAMPLED_RESPONSE'||r.future_direction_proven!==false||r.full_cvd_verified!==false||
   !Number.isSafeInteger(r.sample_end_ms)||r.sample_end_ms>now||now-r.sample_end_ms>V27_FRESH_MS||
   !Number.isInteger(r.sample_trades)||r.sample_trades<3||v27N(r.buy_share)===null||r.buy_share<0||r.buy_share>1)
   return {status:'RESPONSE_UNAVAILABLE_OR_AGED',future_direction_proven:false,full_cvd_verified:false};
 return r;
}
function v27PublicReceipt(r){
 if(!r)return null;
 return Object.fromEntries(['channel','symbol','telegram_message_id','accepted_at','status','kv_receipt_persisted',
   'recorded_send_ms','ack_received_at_ms','bot_accepted_at_ms'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]));
}
