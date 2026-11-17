// V11 separate early-momentum NOT-BUY channel. One fast observation; no 15m taker proof claimed.
const EARLY_COOLDOWN_MS=3*3600000,EARLY_WINDOW_HOUR=3600000,EARLY_HOURLY_CAP=3;
function earlyCandidateProof(o,now,observedMs){
  if(!o||o.observation_only!==true||o.is_buy_signal!==false||
     o.order_allowed!==false||o.notify_observation_eligible!==true||
     o.official_warning_checked!==true||
     o.risk_status!=='NO_OFFICIAL_WARNING_AT_COLLECTION'||
     !/^KRW-[A-Z0-9]{2,25}$/.test(o.market||'')||
     !['EARLY_MOMENTUM_WATCH','LATE_CHASE_CAUTION'].includes(o.risk_class)||
     !Number.isFinite(observedMs)||observedMs>now+60000||
     now-observedMs>10*60000)return null;
  const price=val(o.price_krw),minutes=val(o.interval_minutes);
  const pct=val(o.interval_price_change_pct),quote=val(o.five_minute_equivalent_turnover_krw);
  const baseline=val(o.five_minute_prior_ema_krw),ratio=val(o.turnover_ratio_prior_ema);
  const dayPct=val(o.day_price_change_pct);
  if([price,minutes,pct,quote,baseline,ratio,dayPct].some(x=>x===null)||
     price<=0||minutes<2||minutes>8||pct<.9||pct>30||
     quote<30000000||baseline<=0||ratio<2.5||
     Math.abs(quote/baseline-ratio)/ratio>.02)return null;
  if(o.source!=='Bithumb public KRW ticker/market/official-warning snapshots')return null;
  return {market:o.market,price,minutes,pct,quote,baseline,ratio,dayPct,
    risk_class:o.risk_class,observedMs};
}
async function recheckEarlyMarkets(items){
  if(!items.length)return [];
  const [all,warnings,tickers]=await Promise.all([
    requestJson(allBithumbMarkets()),
    requestJson(riskBithumbMarkets()),
    requestJson(tickerBithumbMarkets(items.map(x=>x.market)))
  ]);
  if(!Array.isArray(all)||all.length<100||!Array.isArray(warnings)||
     !Array.isArray(tickers))throw Error('EARLY_OFFICIAL_RISK_DATA_NOT_READY');
  const listed=new Map(all.map(x=>[x.market,x]));
  const cautions=new Set(warnings.map(x=>x?.market));
  const quotes=new Map(tickers.map(x=>[x.market,x]));
  return items.flatMap(item=>{
    const listing=listed.get(item.market),current=quotes.get(item.market);
    if(!listing||listing.market_warning!=='NONE'||cautions.has(item.market)||
       !current||current.is_trading_suspended===true||
       current.delisting_date||current.market_state&&!['ACTIVE'].includes(current.market_state))
      return [];
    const nowPrice=val(current.trade_price);
    if(nowPrice===null||nowPrice<=0||
       nowPrice/item.price<.95||nowPrice/item.price>1.20)return [];
    return [{...item,current_price_krw:nowPrice,
      current_since_candidate_pct:100*(nowPrice/item.price-1)}];
  });
}
function earlyMessage(o,now){
  return '🚨 [빗썸 빠른 급등 움직임 포착 · 매수신호 아님] '+o.market+'\n'+
   '관측 '+kst(o.observedMs)+' · 알림 '+kst(now)+'\n'+
   '가격 '+fmt(o.price,8)+'원 → 최근 '+fmt(o.current_price_krw,8)+'원\n'+
   '관측 '+fmt(o.minutes,2)+'분 '+fmt(o.pct,2)+'% 상승 · 거래대금 약 '+
      fmt(o.quote,0)+'원(5분 환산 추정)\n'+
   '직전 EMA 대비 거래대금 '+fmt(o.ratio,2)+'배 · 거래소 당일등락 '+fmt(o.dayPct,2)+'%\n'+
   (o.risk_class==='LATE_CHASE_CAUTION'?
    '⚠️ 이미 크게 움직인 종목: 늦은 추격·급락 위험이 높음.\n':
    '⚠️ 5분 가격·거래대금 급변만 관측한 초기 경보.\n')+
   '완전한 현물 CVD·실제 매수우위·호가흡수·방향 적중은 미검증. 진입 지시가 아니며, 매수 결정은 별도 근거 필요.\n'+
   '출처: 빗썸 공식 원화마켓 티커/상장 상태/위험경보 및 5분 GitHub 수집';
}
async function sendEarlyWatch(env,state,spot,now,capacity){
  const record={status:'NO_EARLY_CANDIDATES',observed:0,qualified:0,risk_passed:0,
    sent:0,blocked_cooldown:0,blocked_hourly_limit:0,send_error:null};
  if(!spot||spot.status!=='PASS'||!Array.isArray(spot.early_watch_observations)){
    record.status='EARLY_SOURCE_NOT_READY';return record;
  }
  const at=Date.parse(spot.observed_utc||'');
  const proofs=spot.early_watch_observations.slice(0,8)
    .map(x=>earlyCandidateProof(x,now,at)).filter(Boolean);
  record.observed=spot.early_watch_observations.length;
  record.qualified=proofs.length;
  if(!proofs.length)return record;
  if(capacity<=0){record.status='GLOBAL_SCAN_ALERT_LIMIT';return record;}
  const fresh=Array.isArray(state.earlyAlertHistory)?
    state.earlyAlertHistory.filter(x=>Number.isFinite(x)&&now-x>=0&&now-x<EARLY_WINDOW_HOUR):[];
  state.earlyAlertHistory=fresh.slice(-EARLY_HOURLY_CAP);
  if(fresh.length>=EARLY_HOURLY_CAP){
    record.blocked_hourly_limit=proofs.length;record.status='EARLY_HOURLY_CAP';return record;
  }
  let checked;
  try{checked=await recheckEarlyMarkets(proofs);}
  catch(e){record.status='EARLY_RISK_CHECK_UNAVAILABLE';record.send_error=clean(e?.message,120);return record;}
  record.risk_passed=checked.length;
  // Prefer first impulse instead of after-pump; only one observation alert per scan.
  for(const s of checked){
    if(record.sent>=1||record.sent>=capacity)break;
    const key='EARLY:'+s.market;
    const old=Math.max(val(state.lastAlert[key])||0,val(state.lastAlert['SPOT:'+s.market])||0);
    if(now-old<EARLY_COOLDOWN_MS){record.blocked_cooldown++;continue;}
    try{
      await telegram(env,earlyMessage(s,now));
      state.lastAlert[key]=now;state.earlyAlertHistory.push(now);record.sent++;
    }catch(e){record.send_error=clean(e?.message,150);break;}
  }
  record.status=record.send_error?'EARLY_TELEGRAM_ERROR':
    record.sent?'EARLY_OBSERVATION_SENT':
    checked.length?'EARLY_CANDIDATE_SUPPRESSED':'EARLY_RISK_BLOCKED';
  return record;
}
// END V11