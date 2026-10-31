/** V21 learned forecast delivery. Inline into the existing Worker.
 * The old V19/LLM direction heuristics remain disabled. This path accepts only
 * reviewed immutable models with positive independently recorded FUTURE quote
 * evidence. Quote returns and bootstrap estimates are not guaranteed fills.
 */
const V21_REPORT_URL='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v21_latest.json';
const V21_MODEL_HASHES=Object.freeze({
  bitget_5:'2b87c4fa2894dc665b584de6a1c816691d53152f70ea6528741c9524c776bbf3'
});
function v21Num(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function v21QuoteOk(q){return q&&v21Num(q.bid)>0&&v21Num(q.ask)>=v21Num(q.bid)&&Number.isSafeInteger(q.at_ms);}
function v21ProofReady(p){
 return p?.ready===true&&p.evidence_type==='FROZEN_MODEL_PROSPECTIVE_QUOTE_RETURNS'&&
   v21Num(p.lower_net_pct)>0&&v21Num(p.mean_net_pct)>0&&v21Num(p.span_hours)>=24&&
   Number.isInteger(p.hour_blocks)&&p.hour_blocks>=8&&
   Number.isInteger(p.observed_signals)&&p.observed_signals>0&&
   v21Num(p.cost_scenario_pct)>=.20&&v21Num(p.coverage_ratio)>=.95;
}
function v21Message(c,proof,quote,at){
 const fmt=(n,d=3)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}).format(n);
 const kst=x=>new Date(x+9*3600000).toISOString().slice(0,19).replace('T',' ')+' KST';
 return (c.side===1?'🟢':'🔴')+' [V21 '+c.horizon_min+'분 '+(c.side===1?'LONG':'SHORT')+' 후보 · 방향 보장 없음]\n'+
   '비트겟 '+c.symbol+' · '+kst(at)+'\n'+
   '원래 예측 시각 '+kst(c.issued_ms)+'\n'+
   '예측 유효 종료 '+kst(c.expires_ms)+'\n'+
   '현재 최우선 매수/매도호가 '+fmt(quote.bid,8)+' / '+fmt(quote.ask,8)+' USDT\n'+
   '고정 모델의 미래 호가 검증 '+proof.observed_signals+'건 · 비용 차감 평균 '+fmt(proof.mean_net_pct)+'%\n'+
   '비용 가정 '+fmt(proof.cost_scenario_pct,2)+'% · 실제 계좌 수수료나 체결 수익률이 아님\n'+
   '반복 추격 대신 유효시간과 호가를 확인하세요. 과거·최근 성과는 다음 방향을 보장하지 않습니다. 자동주문 없음.';
}
async function v21CurrentQuote(c){
 if(c.venue==='bitget'){
   const r=await requestJson('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
   if(r?.code!=='00000'||!Array.isArray(r.data))return null;
   const x=r.data.find(z=>z.symbol===c.symbol);if(!x)return null;
   return {bid:v21Num(x.bidPr),ask:v21Num(x.askPr),at_ms:v21Num(x.ts)};
 }
 return null;
}
async function sendV21Forecasts(env,state,snap,now,capacity=1,options={}){
 const out={status:'INITIAL',sent:0,inspected:0,reasons:{},message_id:null,send_error:null,
   independent_forward_evidence_required:true,permanent_disable_switch:false};
 const reject=k=>{out.reasons[k]=(out.reasons[k]||0)+1;};
 if(!snap||snap.collector_status!=='PASS'){out.status='MARKET_NOT_READY';return out;}
 const clock=options.clock||Date.now;
 const read=options.readReport||((url)=>requestJson(url,{headers:{accept:'application/json'}},8500));
 let doc;
 try{doc=await readV21CurrentReport(read,clock,options.pause,options.waitForFresh!==false);}
 catch(e){out.status='FORECAST_REPORT_UNAVAILABLE';return out;}
 const published=Date.parse(doc?.at_utc||''),at=clock();
 if(doc?.version!=='IRYS_V21_SUPERVISED_PROSPECTIVE_V1'||doc.status!=='ACTIVE'||doc.source_status!=='PASS'){
   out.status='FORECAST_NOT_ACTIVE';return out;
 }
 // A quiet, recently refreshed research report is not a delivery failure.
 if(!Number.isFinite(published)||published>at||at-published>15*60000){out.status='STALE_REPORT';return out;}
 const list=Array.isArray(doc.delivery_candidates)?doc.delivery_candidates:[];
 if(!list.length){out.status='LEARNING_NO_ELIGIBLE_FORWARD_EVIDENCE';return out;}
 // Only the reviewed 5m model is eligible; require at least half its horizon left.
 if(at-published>5*60000/2){out.status='STALE_REPORT';return out;}
 if(capacity<=0){out.status='LEGACY_ALERT_CAPACITY_USED';return out;}
 state.v21LastSent=state.v21LastSent||{};
 const hour=Math.floor(at/3600000);
 if(state.v21Hour?.hour!==hour)state.v21Hour={hour,count:0};
 const send=options.send||telegram;
 const quoteRead=options.getQuote||v21CurrentQuote;
 for(const c of list.slice(0,12)){
  out.inspected++;
  if(out.sent>=1||out.sent>=capacity)break;
  if(state.v21Hour.count>=2){reject('DELIVERY_PACING');break;}
  if(c?.model_key!=='bitget_5'||c.model_sha256!==V21_MODEL_HASHES[c.model_key]||
      c.venue!=='bitget'||c.horizon_min!==5||![1,-1].includes(c.side)){
    reject('MODEL_IDENTITY_MISMATCH');continue;
  }
  if(!/^[A-Z0-9]{2,25}USDT$/.test(c.symbol||'')||typeof c.event_id!=='string'||c.event_id.length>100){reject('INVALID_IDENTITY');continue;}
  const asset=[...(snap.watchlist||[]),...(snap.early_pool||[])].find(x=>x?.venue==='bitget'&&x.symbol===c.symbol);
  if(!asset||asset.asset_identity!=='VERIFIED_CRYPTO'||
    (asset.contract_status!==undefined&&asset.contract_status!=='normal')){reject('INSTRUMENT_NOT_VERIFIED');continue;}
  const proof=doc.certificates?.[c.model_key]?.[String(c.side)];
  if(c.notification_eligible!==true||!v21ProofReady(proof)){reject('PROSP_EVIDENCE_NOT_READY');continue;}
  if(!Number.isSafeInteger(c.issued_ms)||!Number.isSafeInteger(c.expires_ms)||
      c.issued_ms>at||at-c.issued_ms>c.horizon_min*60000/2||c.expires_ms<=at||
      c.expires_ms!==c.issued_ms+c.horizon_min*60000||!v21QuoteOk(c.entry_quote)){
    reject('EXPIRED_OR_LATE_FORECAST');continue;
  }
  const key=c.model_key+':'+c.symbol+':'+c.side;
  const previous=state.v21LastSent[key];
  if(previous&&(previous.event_id===c.event_id||at-previous.at_ms<3600000)){
    reject('DUPLICATE_DIRECTION_EPISODE');continue;
  }
  let quote;
  try{quote=await quoteRead(c);}catch{reject('QUOTE_UNAVAILABLE');continue;}
  const checked=clock();
  if(!v21QuoteOk(quote)||quote.at_ms>checked||checked-quote.at_ms>60000){reject('QUOTE_NOT_FRESH');continue;}
  const oldPrice=c.side===1?c.entry_quote.ask:c.entry_quote.bid;
  const newPrice=c.side===1?quote.ask:quote.bid;
  const chase=Math.max(0,c.side*100*(newPrice/oldPrice-1));
  const oldSpread=100*(c.entry_quote.ask/c.entry_quote.bid-1);
  const newSpread=100*(quote.ask/quote.bid-1);
  if(chase+Math.max(0,newSpread-oldSpread)>=proof.lower_net_pct){
    reject('CONSERVATIVE_EDGE_CONSUMED_BY_PRICE_MOVE');continue;
  }
  try{
    const ack=await send(env,v21Message(c,proof,quote,checked));
    if(!Number.isSafeInteger(ack?.message_id)||ack.message_id<=0)throw Error('TELEGRAM_ACK_MISSING');
    const makeReceipt=options.receipt||recordReceipt;
    const persist=options.persist||persistReceiptEvent;
    const receipt=makeReceipt(state,'V21_PROSPECTIVE_FORECAST',c.symbol,checked,ack);
    receipt.kv_receipt_persisted=await persist(env,receipt,checked);
    state.v21LastSent[key]={event_id:c.event_id,at_ms:checked};state.v21Hour.count++;
    out.sent++;out.message_id=ack.message_id;
    state.v21LastMessage={event_id:c.event_id,model_sha256:c.model_sha256,
      symbol:c.symbol,side:c.side,issued_ms:c.issued_ms,sent_ms:checked,
      message_id:ack.message_id,quote_based_not_executed:true};
  }catch(e){
    out.status='TELEGRAM_ERROR';out.send_error=String(e?.message||'SEND_FAILED').replace(/bot[^\s/]+/g,'bot[REDACTED]').slice(0,120);break;
  }
 }
 for(const [key,val] of Object.entries(state.v21LastSent))if(at-val.at_ms>7*86400000)delete state.v21LastSent[key];
 if(!out.send_error)out.status=out.sent?'TELEGRAM_API_ACK':'NO_CURRENT_EXECUTABLE_QUALIFIED_FORECAST';
 return out;
}
export {sendV21Forecasts,v21ProofReady,v21Message};

/** Handle report publication just after Cron reads. No extra timer, dispatch or
 * model invocation. Retry only if the prior report already has eligible future
 * evidence; unqualified research never delays existing legacy monitoring. */
async function readV21CurrentReport(read,clock=Date.now,pause,waitForFresh=true){
 const sleep=pause||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 const deadline=clock()+90000;
 while(true){
  const current=clock();
  const doc=await read(V21_REPORT_URL+'?at='+current);
  const published=Date.parse(doc?.at_utc||'');
  const stale=Number.isFinite(published)&&current-published>5*60000/2;
  const ready=Object.values(doc?.certificates||{}).some(group=>
    Object.values(group||{}).some(p=>p?.ready===true));
  if(!waitForFresh||!stale||!ready||doc?.status!=='ACTIVE'||clock()>=deadline)return doc;
  await sleep(Math.min(15000,deadline-clock()));
 }
}
export {readV21CurrentReport};
