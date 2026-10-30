/** V19 fast alert transport. Inline into current Worker at release build time.
 * Used only on scheduled scans; no side effects on Worker GET requests.
 */
const V19_EVIDENCE_URL='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v18_evidence_latest.json';
const V19_EARLY_COOLOFF_MS=45*60000;
const V19_DIRECTION_COOLOFF_MS=90*60000;
const V19_PER_HOUR_DELIVERY_CAP=8; // Transport anti-spam, not a market proof rule.
function v19DeliveryKey(c){
  return 'V19:'+(c.kind==='DIRECTION'?'DIRECTION':'WATCH')+':'+c.venue+':'+c.symbol;
}
function v19AlreadyRecentlyAlerted(c,state,now){
  const last=state.lastAlert||{},prior=v19Number(last[v19DeliveryKey(c)])||0;
  if(now-prior<(c.kind==='DIRECTION'?V19_DIRECTION_COOLOFF_MS:V19_EARLY_COOLOFF_MS))return true;
  const other=c.venue==='bitget'?'FUTURES:'+c.symbol:'SPOT:'+c.symbol;
  if(now-(v19Number(last[other])||0)<25*60000)return true;
  if(c.venue==='bithumb'&&now-(v19Number(last['DIR13:'+c.symbol+':UP'])||0)<25*60000)
    return true;
  return false;
}
/** Candidate discovery independent of the Workers AI daily neuron quota.
 * WATCH labels never claim confirmed future direction. Proven trade-price
 * agreement is a directional *observation*, not a reliable buy/sell order.
 */
async function v19SendFastAlerts(env,state,spot,snap,now,capacity=1,options={}){
  const out={status:'INITIAL',sent:0,spot_sent:0,futures_sent:0,watch_sent:0,
    direction_sent:0,source_status:'NOT_ATTEMPTED',source_error:null,
    futures_candidates:0,spot_candidates:0,verified_futures:0,
    future_contradictions:0,spot_contradictions:0,reversal_candidates:0,
    skipped_cooldown:0,skipped_rate:0,skipped_risk:0,send_error:null};
  if(!snap||snap.collector_status!=='PASS'){out.status='MARKET_NOT_PASS';return out;}
  let doc=null;
  try{
    const read=options.readEvidence||requestJson;
    doc=await read(V19_EVIDENCE_URL+'?at='+Math.floor(now/300000),
      {headers:{accept:'application/json'}},8500);
  }catch(e){out.source_error=String(e?.message||'UNAVAILABLE').slice(0,95);}
  const futures=v19FuturesCandidates(snap,doc,now),spotSignals=v19SpotCandidates(spot,now);
  out.source_status=futures.feedStatus;
  out.futures_candidates=futures.candidates.length;
  out.spot_candidates=spotSignals.candidates.length;
  out.verified_futures=futures.verified;
  out.future_contradictions=futures.contrary;
  out.spot_contradictions=spotSignals.contrary;
  out.reversal_candidates=futures.reversals;
  if(capacity<=0){out.status='EXISTING_PRIORITY_ALERTS_USED_CAPACITY';return out;}
  const hour=new Date(now+9*3600000).toISOString().slice(0,13);
  const ledger=state.v19FastHour?.hour===hour?state.v19FastHour:{hour,count:0};
  state.v19FastHour=ledger;
  const selected=[...futures.candidates,...spotSignals.candidates]
    .filter(x=>!x.opposite)
    .sort((a,b)=>{
      const priority=x=>(x.kind==='DIRECTION'?10:0)+Math.min(8,x.score||0);
      return priority(b)-priority(a);
    });
  if(!selected.length){out.status='NO_FRESH_EARLY_EVIDENCE';return out;}
  const send=options.send||telegram,risk=options.riskCheck||officialAiSpotRiskCheck;
  const preferred=state.v19LastVenue;
  if(selected.some(c=>c.venue!==preferred)){
    const x=selected.findIndex(c=>c.venue!==preferred&&c.kind===selected[0].kind);
    if(x>0){const [item]=selected.splice(x,1);selected.unshift(item);}
  }
  for(const c of selected){
    if(out.sent>=capacity||out.sent>=1)break; // Reserve next slot for legacy high-confidence paths.
    if(ledger.count>=V19_PER_HOUR_DELIVERY_CAP){out.skipped_rate++;break;}
    if(v19AlreadyRecentlyAlerted(c,state,now)){out.skipped_cooldown++;continue;}
    if(c.venue==='bithumb'){
      try{
        const current=await risk({market:c.market,price_krw:c.price_krw});
        if(current===null||!Number.isFinite(current)||current<=0){out.skipped_risk++;continue;}
        c.current_price_krw=current;
      }catch(e){out.skipped_risk++;continue;}
    }
    try{
      const ack=await send(env,v19FastMessage(c,now));
      state.lastAlert[v19DeliveryKey(c)]=now;
      state.v19LastVenue=c.venue;
      ledger.count++;
      const channel=c.kind==='DIRECTION'?'V19_REAL_FLOW_DIRECTION':'V19_EARLY_NEUTRAL_WATCH';
      const receipt=recordReceipt(state,channel,c.symbol,now,ack);
      receipt.kv_receipt_persisted=await persistReceiptEvent(env,receipt,now);
      out.sent++;
      if(c.venue==='bitget')out.futures_sent++;else out.spot_sent++;
      if(c.kind==='DIRECTION'){
        out.direction_sent++;
        if(c.venue==='bitget'){
          addFuturesOutcome(state,{symbol:c.symbol,direction:c.direction,
            price:c.price_usdt},now,ack);
        }else{
          addSpotOutcome(state,{market:c.market,direction:'UP',
            price_krw:c.price_krw,current_price_krw:c.current_price_krw},now,ack);
        }
      }else out.watch_sent++;
    }catch(e){
      out.send_error=String(e?.message||'TELEGRAM_DELIVERY_FAILED').slice(0,140);
      out.status='TELEGRAM_SEND_FAILED';break;
    }
  }
  if(!out.send_error)out.status=out.sent?'TELEGRAM_API_ACK':'NO_UNIQUE_EARLY_SIGNAL';
  return out;
}
export {v19DeliveryKey,v19AlreadyRecentlyAlerted,v19SendFastAlerts};
