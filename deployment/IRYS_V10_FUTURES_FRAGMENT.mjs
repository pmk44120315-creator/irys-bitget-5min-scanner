// V10 verified futures evidence. Pure market assertions; no LLM or orders.
const FUT_MAX_AGE_MS=12*60000,FUT_CHECKS_MS=8*60000,FUT_COOLDOWN_MS=2*3600000;
function futuresSnapshotProof(snapshot,o,now){
  if(!snapshot||snapshot.collector_status!=='PASS')return null;
  const sym=o?.symbol;
  if(typeof sym!=='string'||!/^[A-Z0-9]{2,25}USDT$/.test(sym)||
     o.observation_only!==true||o.send_allowed!==false||
     o.position_direction_verified!==false)return null;
  const contract=[...(snapshot.watchlist||[]),...(snapshot.early_pool||[])]
    .find(z=>z?.symbol===sym&&z.venue==='bitget');
  if(!contract||contract.asset_identity!=='VERIFIED_CRYPTO'||contract.isRwa!=='NO'||
     contract.contract_status!=='normal'||contract.symbolType!=='perpetual'||
     contract.quoteCoin!=='USDT')return null;
  const e=o.taker_flow_15m,flow=o.flow_class;
  if(!e||e.verified!==true||e.observation_only!==true||
     e.full_exchange_local_public_taker_flow_verified!==true||
     e.marketwide_all_exchanges_cvd_verified!==false||
     e.position_owner_long_short_verified!==false||
     e.continuous_orderbook_absorption_verified!==false||
     e.completeness!=='COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED'||
     e.venue!=='bitget'||e.category!=='USDT-FUTURES'||
     e.symbol!==sym||e.closed_candles!==15||
     !Number.isInteger(e.pages)||e.pages<1||e.pages>10||
     !Number.isInteger(e.unique_trades)||e.unique_trades<80||
     !Number.isSafeInteger(e.start_ms)||!Number.isSafeInteger(e.end_ms)||
     e.start_ms%60000!==0||e.end_ms%60000!==0||
     e.end_ms-e.start_ms!==15*60000||e.end_ms>now+60000||
     now-e.end_ms>FUT_MAX_AGE_MS||o.observed_ms!==e.end_ms)return null;
  const f=contract.windows?.['5m'],q=contract.windows?.['15m'],hour=contract.windows?.['60m'];
  const oi=contract.oi,oiAt=val(oi?.timestamp_ms),oiDelta=val(oi?.change_pct_from_previous_run);
  const oiElapsed=val(oi?.elapsed_min_since_previous_snapshot),fund=val(contract.funding_rate);
  if(!f||!q||!hour||f.coverage!==1||q.coverage!==1||hour.coverage!==1||
     f.baseline_coverage!==1||q.baseline_coverage!==1||
     !oi||oi.status!=='OK'||oiAt===null||oiDelta===null||oiElapsed===null||
     oiElapsed<3||oiElapsed>9||oiAt>now+60000||now-oiAt>FUT_MAX_AGE_MS||
     oiDelta<-.05||oiDelta>12||fund===null||Math.abs(fund)>.001)return null;
  const blocks=e.blocks,total=val(e.taker_turnover_usdt),candle=val(e.candle_turnover_usdt);
  const relative=val(e.candle_relative_error),net=val(e.net_buy_usdt),share=val(e.buy_share);
  const q5=val(f.quote_turnover),q15=val(q.quote_turnover);
  if(!Array.isArray(blocks)||blocks.length!==3||total===null||total<30000||
     candle===null||candle<=0||relative===null||relative<0||relative>.005||
     Math.abs(total-candle)/candle>.005||q5===null||q15===null||net===null||share===null||
     q15<=0||Math.abs(q15-total)/total>.30||
     blocks.some(b=>val(b.buy_usdt)===null||val(b.sell_usdt)===null||
       !Number.isInteger(b.trades)||b.trades<10||
       val(b.buy_share)===null||val(b.net_buy_usdt)===null))return null;
  const newest=blocks[2],lastQuote=val(newest.buy_usdt)+val(newest.sell_usdt);
  if(lastQuote<5000)return null;
  const pct5=val(f.price_change_pct),pct15=val(q.price_change_pct),pct60=val(hour.price_change_pct);
  const open5=val(f.open),close=val(f.close),high5=val(f.high),low5=val(f.low);
  const open15=val(q.open),close15=val(q.close),high15=val(q.high),low15=val(q.low);
  if([pct5,pct15,pct60,open5,close,high5,low5,open15,close15,high15,low15].some(x=>x===null)||
     close<=0||high5<=low5||high15<=low15||Math.abs(pct60)>7||
     pct15< -4||pct15>4)return null;
  const topWick=(high5-Math.max(open5,close))/(high5-low5);
  const bottomWick=(Math.min(open5,close)-low5)/(high5-low5);
  const top15=(high15-Math.max(open15,close15))/(high15-low15);
  const bottom15=(Math.min(open15,close15)-low15)/(high15-low15);
  const longGood=flow==='SUSTAINED_FUTURES_TAKER_BUY_PRESSURE'&&
    pct5>=.12&&pct5<=1.8&&pct15>=.25&&pct15<=3.5&&share>=.62&&net>4000&&
    blocks.every(b=>b.net_buy_usdt>0&&b.buy_share>=.58)&&
    newest.net_buy_usdt>=2500&&newest.buy_share>=.62&&topWick<=.38&&top15<=.43;
  const shortGood=flow==='SUSTAINED_FUTURES_TAKER_SELL_PRESSURE'&&
    pct5<=-.12&&pct5>=-1.8&&pct15<=-.25&&pct15>=-3.5&&share<=.38&&net< -4000&&
    blocks.every(b=>b.net_buy_usdt<0&&b.buy_share<=.42)&&
    newest.net_buy_usdt<=-2500&&newest.buy_share<=.38&&bottomWick<=.38&&bottom15<=.43;
  if(!longGood&&!shortGood)return null;
  return {symbol:sym,direction:longGood?'LONG':'SHORT',asof_ms:e.end_ms,
    price:close,pct5,pct15,oi_delta_pct:oiDelta,funding:fund,share,
    net_usdt:net,quote15:total,recent5_quote:lastQuote,
    recent5_net:newest.net_buy_usdt,recent5_share:newest.buy_share,
    trades:e.unique_trades,relative_error:relative};
}
function evaluateFutures(state,snap,now){
  const flow=snap?.futures_flow,results={
    status:'FUTURES_NO_VERIFIED_PROOF',inspected:0,qualified:0,confirmed:0,
    signals:[],reasons:{},window:'15m venue public fills, 3x5m, two distinct snapshots'};
  if(!state.futuresProofV10||typeof state.futuresProofV10!=='object')
    state.futuresProofV10={};
  const prev=state.futuresProofV10;
  const reject=k=>results.reasons[k]=(results.reasons[k]||0)+1;
  if(flow?.status!=='EVALUATED'||flow.observation_only!==true||
     flow.alert_eligible!==false||!Array.isArray(flow.observations)){
    results.status='FUTURES_SOURCE_NOT_READY';return results;
  }
  const seen=new Set();
  for(const obs of flow.observations.slice(0,10)){
    results.inspected++;
    const proof=futuresSnapshotProof(snap,obs,now);
    if(!proof){reject('CONTRACT_OR_DATA_OR_DIRECTION_NOT_VERIFIED');continue;}
    if(seen.has(proof.symbol)){reject('DUPLICATE_SYMBOL');continue;}
    seen.add(proof.symbol);results.qualified++;
    const p=prev[proof.symbol];
    if(p?.asof_ms===proof.asof_ms)continue;
    if(p&&p.direction===proof.direction&&
       proof.asof_ms-p.asof_ms>=4*60000&&proof.asof_ms-p.asof_ms<=FUT_CHECKS_MS&&
       proof.oi_delta_pct+p.oi_delta_pct>=.12&&
       proof.oi_delta_pct>=0&&p.oi_delta_pct>=0&&
       (proof.direction==='LONG'?
           proof.price/p.price>=1.00035&&proof.price/p.price<=1.020:
           proof.price/p.price<=.99965&&proof.price/p.price>=.980)){
      results.signals.push({...proof,checks:2,distinct_recent_5m:true,
        evidence_type:'VERIFIED_15M_FUTURES_TAKER_PRESSURE_2_SNAPSHOTS',
        position_owners_verified:false,all_exchanges_verified:false,
        direction_accuracy_verified:false});
    }
    prev[proof.symbol]=proof;
  }
  for(const [key,p] of Object.entries(prev))
    if(!p||!Number.isFinite(p.asof_ms)||now-p.asof_ms>30*60000)delete prev[key];
  const sorted=Object.entries(prev).sort((a,b)=>b[1].asof_ms-a[1].asof_ms);
  state.futuresProofV10=Object.fromEntries(sorted.slice(0,32));
  results.confirmed=results.signals.length;
  results.status=results.confirmed?'FUTURES_VERIFIED_DIRECTIONAL_PRESSURE':'WAIT_MORE_FUTURES_EVIDENCE';
  return results;
}
function futuresMessage(p,now){
  const isLong=p.direction==='LONG';
  return (isLong?'🟢':'🔴')+' [비트겟 선물 '+(isLong?'롱':'숏')+' 수급 우위] '+p.symbol+'\n'+
    '🕒 '+kst(now)+' (체결 근거 종료 '+kst(p.asof_ms)+')\n'+
    '가격 '+fmt(p.price,7)+' USDT · 5분 '+fmt(p.pct5,2)+'% · 15분 '+fmt(p.pct15,2)+'%\n'+
    '실제 체결 '+fmt(p.trades,0)+'건 · 15분 거래대금 '+fmt(p.quote15,0)+' USDT\n'+
    '공격적 '+(isLong?'매수':'매도')+' '+fmt((isLong?p.share:1-p.share)*100,1)+'% · 5분 3구간 지속 · 다른 5분 시각에서 재확인\n'+
    '15분 체결 순'+(isLong?'매수':'매도')+' '+fmt(Math.abs(p.net_usdt),0)+' USDT · 최근 OI 증감 '+fmt(p.oi_delta_pct,2)+'%\n'+
    '⚠️ 현물 유입·실제 롱/숏 포지션 소유·미래 방향 적중은 미확인. 진입 지시·자동매매 아님.\n'+
    '출처: 비트겟 공식 선물 체결·분봉·OI / GitHub 5분 수집';
}
// END V10