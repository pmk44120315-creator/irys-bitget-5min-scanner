/** V22 learned-return notification and actual sent-alert quote audit.
 * Existing V19/LLM flood gates are untouched. Shared V21/V22 pacing prevents
 * a new algorithm doubling notifications. Future quote evidence is not fills.
 */
const V22_POLICY_SHA='__V22_POLICY_SHA__';
const V22_REPORT_URL='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v22_latest.json';
function v22Number(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function v22Quote(q){return q&&Number.isSafeInteger(q.at_ms)&&v22Number(q.bid)>0&&v22Number(q.ask)>=q.bid;}
function v22Proof(p,pid){return p?.ready===true&&p.policy_sha256===pid&&
 p.evidence_type==='CAUSAL_PREQUENTIAL_ADAPTIVE_POLICY_QUOTE_RETURNS'&&
 v22Number(p.span_hours)>=24&&v22Number(p.hour_blocks)>=8&&v22Number(p.coverage_ratio)>=.95&&
 v22Number(p.lower_net_pct)>0&&v22Number(p.mean_net_pct)>0&&v22Number(p.observed_signals)>0;}
async function v22CurrentQuote(c){
 if(c.venue==='bitget')return v21CurrentQuote(c);
 const rows=await requestJson('https://api.bithumb.com/v1/orderbook?markets='+encodeURIComponent(c.symbol),{},8000);
 const item=Array.isArray(rows)?rows.find(r=>r.market===c.symbol):null,u=item?.orderbook_units?.[0];
 return {bid:v22Number(u?.bid_price),ask:v22Number(u?.ask_price),at_ms:Number(item?.timestamp)};
}
function v22Message(c,p,q,now){
 const direction=c.venue==='bithumb'?'BUY':c.side===1?'LONG':'SHORT';
 const time=new Date(now+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
 const n=x=>Number.isFinite(x)?Number(x).toFixed(3):'미확인';
 return '🔎 [V22 학습형 방향 후보 · '+direction+']\n'+
 (c.venue==='bithumb'?'빗썸 현물 ':'비트겟 선물 ')+c.symbol+' · '+time+'\n'+
 '예측 구간 '+c.horizon_min+'분 · 남은 구간 '+Math.max(0,(c.expires_ms-now)/60000).toFixed(1)+'분\n'+
 '모델 예상 변동 '+n(c.expected_gross_pct)+'% (승률이 아님)\n'+
 '매수/매도 최우선 호가 '+q.bid+' / '+q.ask+'\n'+
 '별도 미래 호가 검증 '+p.observed_signals+'건 · 가정 비용 차감 평균 '+n(p.mean_net_pct)+'%\n'+
 '⚠️ 통계적 후보이며 방향·수익 보장 또는 자동 주문이 아닙니다. 거래비용은 0.2% 가정이며 실제 계좌 손익과 다릅니다.';
}
async function readV22ReadyReport(read,clock,pause,expectedPolicy){
 const wait=pause||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 let doc;
 for(let attempt=0;attempt<6;attempt++){
  doc=await read(V22_REPORT_URL+'?at='+clock()+'&attempt='+attempt);
  const list=Array.isArray(doc?.delivery_candidates)?doc.delivery_candidates:[];
  if(doc?.policy_sha256!==expectedPolicy||!list.length)return doc;
  const at=clock();
  if(list.some(c=>Number.isSafeInteger(c.issued_ms)&&c.issued_ms<=at&&c.expires_ms>at&&at-c.issued_ms<=c.horizon_min*30000))return doc;
  if(!Object.values(doc.certificates||{}).some(sides=>Object.values(sides||{}).some(p=>v22Proof(p,expectedPolicy))))return doc;
  if(attempt<5)await wait(15000);
 }
 return doc;
}
async function sendV22Forecasts(env,state,snap,now,capacity=1,options={}){
 const out={status:'INITIAL',sent:0,inspected:0,reasons:{},send_error:null,policy_sha256:options.expectedPolicy||V22_POLICY_SHA};
 const reject=k=>{out.reasons[k]=(out.reasons[k]||0)+1;};
 if(snap?.collector_status!=='PASS'){out.status='SOURCE_NOT_READY';return out;}
 const clock=options.clock||Date.now,pid=out.policy_sha256;
 const read=options.readReport||((u)=>requestJson(u,{headers:{accept:'application/json'}},8500));
 let doc;try{doc=await readV22ReadyReport(read,clock,options.pause,pid);}catch{out.status='V22_REPORT_UNAVAILABLE';return out;}
 const at=clock(),published=Date.parse(doc?.at_utc||'');
 if(doc?.version!=='IRYS_V22_CAUSAL_ADAPTIVE_V1'||doc.status!=='ACTIVE'||doc.source_status!=='PASS'||doc.policy_sha256!==pid){out.status='MODEL_OR_SOURCE_NOT_VERIFIED';return out;}
 if(!Number.isFinite(published)||published>at||at-published>12*60000){out.status='STALE_SOURCE_REPORT';return out;}
 const list=Array.isArray(doc.delivery_candidates)?doc.delivery_candidates:[];
 if(!list.length){out.status='MEASURED_FORWARD_ADVANTAGE_NOT_YET_SUPPORTED';return out;}
 if(capacity<=0){out.status='LEGACY_CAPACITY_USED';return out;}
 if(state.v21Hour?.hour!==Math.floor(at/3600000))state.v21Hour={hour:Math.floor(at/3600000),count:0};
 state.v22LastSent=state.v22LastSent||{};
 const send=options.send||telegram,getQuote=options.getQuote||v22CurrentQuote;
 for(const c of [...list].sort((a,b)=>(b.expected_net_pct||0)-(a.expected_net_pct||0))){
  if(out.sent>=1||out.sent>=capacity)break;
  if(state.v21Hour.count>=2){reject('DELIVERY_PACING');break;}
  out.inspected++;
  const selected=(c?.model_key==='bitget_15'&&c.venue==='bitget'&&c.horizon_min===15&&[1,-1].includes(c.side))||
    (c?.model_key==='bithumb_5'&&c.venue==='bithumb'&&c.horizon_min===5&&c.side===1);
  if(!selected||c.model_sha256!==pid||typeof c.event_id!=='string'||c.event_id.length>100){reject('POLICY_IDENTITY');continue;}
  if(c.venue==='bitget'){
   if(!/^[A-Z0-9]{2,25}USDT$/.test(c.symbol||'')){reject('INSTRUMENT');continue;}
   const item=[...(snap.watchlist||[]),...(snap.early_pool||[])].find(x=>x.symbol===c.symbol&&x.venue==='bitget');
   const full=snap.verified_crypto_futures_closed_prices?.[c.symbol];
   if((item&&item.asset_identity!=='VERIFIED_CRYPTO')||(!item&&!full)||item?.contract_status&&item.contract_status!=='normal'){reject('INSTRUMENT');continue;}
  }else if(!/^KRW-[A-Z0-9]+$/.test(c.symbol||'')){reject('INSTRUMENT');continue;}
  const proof=doc.certificates?.[c.model_key]?.[String(c.side)];
  if(c.notification_eligible!==true||!v22Proof(proof,pid)){reject('FORWARD_EVIDENCE');continue;}
  if(!Number.isSafeInteger(c.issued_ms)||!Number.isSafeInteger(c.expires_ms)||c.issued_ms>at||
    c.expires_ms!==c.issued_ms+c.horizon_min*60000||at-c.issued_ms>c.horizon_min*30000||!v22Quote(c.entry_quote)){
    reject('EXPIRED_OR_LATE_FORECAST');continue;}
  const key=c.venue+':'+c.symbol+':'+c.side,previous=state.v22LastSent[key];
  if(previous&&(previous.event_id===c.event_id||at-previous.at_ms<3600000)){reject('DUPLICATE_EPISODE');continue;}
  if(c.venue==='bithumb'){
   const risk=options.riskCheck||officialAiSpotRiskCheck;
   try{const approved=await risk({market:c.symbol,price_krw:c.entry_quote.ask});if(v22Number(approved)===null||approved<=0){reject('OFFICIAL_SPOT_WARNING');continue;}}
   catch{reject('SPOT_RISK_UNAVAILABLE');continue;}
  }
  let q;try{q=await getQuote(c);}catch{reject('QUOTE_UNAVAILABLE');continue;}
  const checked=clock();
  if(checked-c.issued_ms>c.horizon_min*30000){reject('FORECAST_BECAME_LATE');continue;}
  if(!v22Quote(q)||q.at_ms>checked||checked-q.at_ms>60000){reject('QUOTE_STALE');continue;}
  const original=c.side===1?c.entry_quote.ask:c.entry_quote.bid,current=c.side===1?q.ask:q.bid;
  const chase=Math.max(0,c.side*100*(current/original-1));
  const increasedSpread=Math.max(0,100*(q.ask/q.bid-c.entry_quote.ask/c.entry_quote.bid));
  if(chase+increasedSpread>=proof.lower_net_pct){reject('MEASURED_EDGE_CONSUMED');continue;}
  try{
   const ack=await send(env,v22Message(c,proof,q,checked));
   if(!Number.isSafeInteger(ack?.message_id))throw Error('TELEGRAM_ACK_NOT_VALID');
   state.v21Hour.count++;state.v22LastSent[key]={at_ms:checked,event_id:c.event_id};out.sent++;
   const record=options.recordReceipt||recordReceipt,persist=options.persistReceipt||persistReceiptEvent;
   const receipt=record(state,'V22_PROSPECTIVE_ADAPTIVE_FORECAST',c.symbol,checked,ack);
   receipt.kv_receipt_persisted=await persist(env,receipt,checked);
   state.v22LastMessage={symbol:c.symbol,venue:c.venue,side:c.side,model_key:c.model_key,event_id:c.event_id,message_id:ack.message_id,at_ms:checked};
   state.v22AlertLedger=[...(state.v22AlertLedger||[]),{...state.v22LastMessage,issued_ms:checked,target_ms:c.expires_ms,entry_quote:q,policy_sha256:pid}].slice(-100);
  }catch(e){out.send_error=String(e?.message||'TELEGRAM_FAILURE').slice(0,120);break;}
 }
 out.status=out.send_error?'TELEGRAM_SEND_ERROR':out.sent?'TELEGRAM_API_ACK':'NO_NEW_QUALIFIED_DIRECTION';return out;
}
async function evaluateV22Deliveries(state,now,options={}){
 const getQuote=options.getQuote||v22CurrentQuote;
 for(const row of state.v22AlertLedger||[]){
  if(row.result||now<row.target_ms)continue;
  if(now>row.target_ms+300000){row.result={status:'UNMEASURED_LATE_QUOTE'};continue;}
  try{
   const q=await getQuote(row);
   const checked=Math.max(now,(options.clock||Date.now)());
   if(!v22Quote(q)||q.at_ms<row.target_ms||q.at_ms>checked||checked-q.at_ms>60000||q.at_ms>row.target_ms+300000)continue;
   const gross=row.side===1?100*(q.bid/row.entry_quote.ask-1):100*(row.entry_quote.bid-q.ask)/row.entry_quote.bid;
   row.result={status:'MEASURED_QUOTE_NOT_FILL',gross_pct:gross,net_pct:gross-.2,closed_ms:q.at_ms,actual_execution_verified:false};
  }catch{}
 }
 const measured=(state.v22AlertLedger||[]).filter(r=>r.result?.status==='MEASURED_QUOTE_NOT_FILL');
 return {measured:measured.length,net_wins:measured.filter(r=>r.result.net_pct>0).length,
   net_losses:measured.filter(r=>r.result.net_pct<0).length,
   pending:(state.v22AlertLedger||[]).filter(r=>!r.result).length,
   unmeasured:(state.v22AlertLedger||[]).filter(r=>r.result?.status==='UNMEASURED_LATE_QUOTE').length,
   actual_execution_verified:false};
}
export {sendV22Forecasts,evaluateV22Deliveries,v22Proof,v22Message,readV22ReadyReport};
