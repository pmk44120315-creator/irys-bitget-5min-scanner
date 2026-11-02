/** V28 all-market buildup ledger. Observed structure, never a future trade permit.
 * All historical points were available at their stated time. No .70% admission
 * floor, invented candles, net-buy inference from turnover, or probability score.
 */
const V28_VERSION='IRYS_V28_BUILDUP_LEDGER_V1';
const V28_MAX_POINTS=36; // storage bound only; never a required observation streak
const V28_MIN_GAP=168000,V28_MAX_GAP=540000,V28_FRESH=150000,V28_EPS=1e-9;
function v28N(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const y=Number(x);return Number.isFinite(y)?y:null;}
function v28Median(a){const s=a.filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:0;}
function v28Rank(value,population){if(!Number.isFinite(value)||!population.length)return 0;const less=population.filter(x=>x<value-V28_EPS).length,equal=population.filter(x=>Math.abs(x-value)<=V28_EPS).length;return (less+equal/2)/population.length;}
function v28TradeMs(r){
 const d=r?.trade_date,t=r?.trade_time;
 if(typeof d==='string'&&/^\d{8}$/.test(d)&&typeof t==='string'&&/^\d{6}$/.test(t)){
  const iso=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}Z`,n=Date.parse(iso);
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===iso.slice(0,19)?n:null;
 }
 return v28N(r?.trade_timestamp??r?.timestamp);
}
function v28Risks(market,ticker,warnings,now){
 const risks=[];
 if(market.market_warning!=='NONE')risks.push({type:market.market_warning==='CAUTION'?'DESIGNATED_CAUTION':'IDENTITY_STATUS_UNKNOWN',step:'CAUTION'});
 if(ticker.is_trading_suspended===true||ticker.delisting_date||ticker.market_state&&ticker.market_state!=='ACTIVE')risks.push({type:'TRADING_NOT_ACTIVE',step:'DANGER'});
 for(const w of warnings){if(w.market!==market.market)continue;
  const until=typeof w.end_date==='string'?Date.parse(w.end_date.replace(' ','T')+'+09:00'):NaN;
  if(Number.isFinite(until)&&until<now)continue;
  risks.push({type:String(w.warning_type||'UNKNOWN_WARNING'),step:String(w.warning_step||'UNKNOWN'),end_kst:w.end_date||null});
 }
 return risks;
}
function v28Discover(old={},feeds,now,priorTape={}){
 const empty=(status)=>({next:old,rows:[],candidates:[],leaders:[],summary:{version:V28_VERSION,status,tracked:Object.keys(old.assets||{}).length}});
 const markets=feeds?.bithumb_markets,tickers=feeds?.bithumb_tickers,warnings=feeds?.bithumb_warnings;
 if(!Array.isArray(markets)||!Array.isArray(tickers)||!Array.isArray(warnings)||!Number.isSafeInteger(now))return empty('SOURCE_UNAVAILABLE');
 const known=new Map(markets.filter(x=>/^KRW-[A-Z0-9]{1,25}$/.test(x?.market||'')).map(x=>[x.market,x]));
 const validTicks=new Map(tickers.filter(x=>known.has(x?.market)).map(x=>[x.market,x]));
 if(known.size<100||validTicks.size<known.size*.95)return empty('SOURCE_UNAVAILABLE');
 if(Number.isSafeInteger(old.at_ms)&&now-old.at_ms<V28_MIN_GAP)return empty('DUPLICATE_UNCHANGED');
 const assets={},rows=[],deltas=[];
 for(const [symbol,m] of known){
  const raw=validTicks.get(symbol),saved=old.assets?.[symbol]||{};
  if(!raw){if(old.assets?.[symbol])assets[symbol]=saved;rows.push({symbol,stage:'TICKER_UNAVAILABLE',alert_eligible:false,risks:[]});continue;}
  const price=v28N(raw.trade_price),cum=v28N(raw.acc_trade_price),trade=v28TradeMs(raw),day=v28N(raw.signed_change_rate);
  if(price===null||price<=0||cum===null||cum<0){if(old.assets?.[symbol])assets[symbol]=saved;rows.push({symbol,stage:'INVALID_TICKER',alert_eligible:false,risks:[]});continue;}
  let points=(Array.isArray(saved.points)?saved.points:[]).filter(p=>Array.isArray(p)&&p.length>=3&&Number.isSafeInteger(p[0])&&p[0]<now&&v28N(p[1])>0&&v28N(p[2])>=0).map(p=>p.slice(0,3));
  if(!points.length){const before=priorTape.spot?.[symbol],at=v28N(priorTape.spot_at_ms??priorTape.at_ms);
   if(Array.isArray(before)&&v28N(before[0])>0&&v28N(before[1])>=0&&Number.isSafeInteger(at)&&now-at>=V28_MIN_GAP&&now-at<=V28_MAX_GAP)points=[[at,Number(before[0]),Number(before[1])]];
  }
  const last=points.at(-1),gap=last?now-last[0]:null;
  const fresh=Number.isSafeInteger(trade)&&trade<=now+1000&&now-trade<=V28_FRESH;
  const comparable=fresh&&last&&gap>=V28_MIN_GAP&&gap<=V28_MAX_GAP;
  const risks=v28Risks(m,raw,warnings,now);
  const row={venue:'bithumb',symbol,price,price_timestamp_ms:trade,day_pct:day===null?null:100*day,
   risks,alert_eligible:risks.length===0&&fresh,stage:!fresh?'STALE_TRADE':comparable?'OBSERVING':'BASELINE_ONLY',
   move_pct:comparable?100*(price/last[1]-1):null,interval_minutes:comparable?gap/60000:null,
   baseline_price:comparable?last[1]:null,turnover_delta:comparable&&cum>=last[2]?cum-last[2]:null,
   flow_status:!comparable?'NO_COMPARABLE_INTERVAL':cum<last[2]?'COUNTER_RESET':'OBSERVED_TRADED_VALUE_NOT_NET_BUY',
   relative_step_pct:null,relative_run_pct:0,build_gain_pct:null,money_share:null,money_share_delta:null,
   identity_verified:true,warning_checked:true,price_only_not_future_direction:true,future_direction_proven:false,forecast_direction:null,
   _saved:saved,_points:points,_cum:cum,_comparable:!!comparable,_gap:gap};
  if(comparable){row._norm=100*Math.log(price/last[1])*300000/gap;deltas.push(row._norm);}
  rows.push(row);
 }
 const flowRows=rows.filter(r=>r._comparable&&Number.isFinite(r.turnover_delta));
 const flowUniverse=flowRows.map(r=>r.symbol).sort().join(',');
 const sameFlowUniverse=old.flow_universe===flowUniverse;
 const benchmark=v28Median(deltas),marketFlow=flowRows.reduce((s,r)=>s+r.turnover_delta*300000/r._gap,0);
 for(const r of rows){
  if(!r._saved){continue;}
  const saved=r._saved;let points=r._points,run=null,episode=saved.episode?{...saved.episode}:null;
  if(r._comparable){
   const last=points.at(-1);r.relative_step_pct=(r._norm-benchmark)*r._gap/300000;
   const prevRun=saved.run&&Number.isFinite(saved.run.value)&&now-saved.run.anchor_at<=3*3600000?saved.run:null;
   const value=(prevRun?.value||0)+r.relative_step_pct;
   run=value>V28_EPS?{value,anchor_at:prevRun?.anchor_at??last[0],anchor_price:prevRun?.anchor_price??last[1]}:null;
   r.relative_run_pct=run?100*Math.expm1(run.value/100):0;
   r.baseline_price=run?.anchor_price??last[1];r.build_gain_pct=100*(r.price/r.baseline_price-1);
   r.build_minutes=run?(now-run.anchor_at)/60000:0;
   const flow=r.turnover_delta===null?null:r.turnover_delta*300000/r._gap;
   r.money_share=flow!==null&&marketFlow>0?flow/marketFlow:null;
   r.money_share_delta=sameFlowUniverse&&r.money_share!==null&&v28N(saved.last_share)!==null?r.money_share-saved.last_share:null;
   if(episode&&now-episode.first_at>3*3600000)episode=null;
   if(episode&&saved.last_stage==='ANCHOR_BROKEN'&&r.relative_step_pct>V28_EPS&&r.move_pct>0)episode=null;
   const high=Math.max(...points.map(p=>p[1])),low=Math.min(...points.map(p=>p[1]));
   const walk=points.slice(1).reduce((s,p,i)=>s+Math.abs(Math.log(p[1]/points[i][1])),0)+Math.abs(Math.log(r.price/last[1]));
   r.path_efficiency=walk>0?Math.min(1,Math.abs(Math.log(r.price/points[0][1]))/walk):0;
   r.from_observed_peak_pct=100*(r.price/high-1);
   if(episode&&r.price<episode.anchor_price)r.stage='ANCHOR_BROKEN';
   else if(r.move_pct<0)r.stage=episode&&r.price>=episode.detected_price?'PULLBACK_HOLD':'WEAKENING';
   else if(r.relative_step_pct>V28_EPS&&r.build_gain_pct>0){
    r.stage=episode&&['PULLBACK_HOLD','WEAKENING'].includes(saved.last_stage)?'REACCELERATING':r.price>high?'EXPANDING':'BUILDING';
   }else if((r.money_share_delta??0)>0&&r.price>=last[1])r.stage='CAPITAL_BUILDING';
   else r.stage='OBSERVING';
   r.side_observed=r.move_pct>=0?'UP':'DOWN';
   r.turnover5_est_krw=flow===null?null:Math.round(flow);
   r.turnover_ratio=null;r.price_acceleration_pct=null;
   r._candidate=r.alert_eligible&&r.stage!=='ANCHOR_BROKEN'&&r.move_pct>=0&&
       ((r.relative_step_pct>V28_EPS&&r.build_gain_pct>0)||(r.money_share_delta>0&&r.relative_step_pct>=-V28_EPS));
  }else if(r.stage==='BASELINE_ONLY'){points=[];episode=null;}
  if(r.stage!=='STALE_TRADE')points.push([now,r.price,r._cum]);
  if(episode){episode.peak_price=Math.max(episode.peak_price,r.price);r.since_detection_pct=100*(r.price/episode.detected_price-1);r.first_detected_at=episode.first_at;}
  assets[r.symbol]={points:points.slice(-V28_MAX_POINTS),run,episode,last_share:r.money_share,last_stage:r.stage};
 }
 const comp=rows.filter(r=>r._comparable),steps=comp.map(r=>r.relative_step_pct),runs=comp.map(r=>r.relative_run_pct),shares=comp.map(r=>r.money_share_delta).filter(Number.isFinite);
 for(const r of comp){
  r.relative_rank=v28Rank(r.relative_step_pct,steps);r.buildup_rank=v28Rank(r.relative_run_pct,runs);r.money_rank=v28Rank(r.money_share_delta,shares);
  r.priority=4*r.relative_rank+3*r.buildup_rank+2*r.money_rank+(r.path_efficiency||0);
  r.discovery_reason=r.stage==='CAPITAL_BUILDING'?'MONEY_SHARE_BEFORE_PRICE':r.build_minutes>r.interval_minutes?'CUMULATIVE_RELATIVE_BUILDUP':'CURRENT_RELATIVE_ADVANCE';
 }
 const eligible=rows.filter(r=>r._candidate),selected=new Map();
 for(const key of ['relative_step_pct','relative_run_pct','money_share_delta']){
  for(const r of [...eligible].filter(x=>Number.isFinite(x[key])&&x[key]>V28_EPS).sort((a,b)=>b[key]-a[key]||b.priority-a.priority).slice(0,4))selected.set(r.symbol,r);
 }
 for(const r of [...eligible].sort((a,b)=>b.priority-a.priority)){if(selected.size>=12)break;selected.set(r.symbol,r);}
 const candidates=[...selected.values()].sort((a,b)=>b.priority-a.priority||a.symbol.localeCompare(b.symbol));
 for(const r of candidates){const a=assets[r.symbol];if(!a.episode){a.episode={first_at:now,detected_price:r.price,anchor_price:r.baseline_price,peak_price:r.price};r.first_detected_at=now;r.since_detection_pct=0;}}
 const clean=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('_')));
 const visible=rows.map(clean),candidateRows=candidates.map(clean);
 const leaders=[...visible].filter(r=>Number.isFinite(r.day_pct)).sort((a,b)=>b.day_pct-a.day_pct||a.symbol.localeCompare(b.symbol)).slice(0,15).map((r,i)=>({...r,day_rank:i+1,discovery_selected:selected.has(r.symbol),nonselection_reason:selected.has(r.symbol)?null:r.risks?.length?'RISK_OBSERVATION_ONLY':r.stage==='STALE_TRADE'?'OLD_LAST_TRADE':r.move_pct===null?'NO_CONTIGUOUS_BASELINE':r.move_pct<0?'CURRENTLY_WEAKENING':'NOT_TOP_BUILDUP_CANDIDATE'}));
 const next={version:V28_VERSION,at_ms:now,assets,flow_universe:flowUniverse};
 return {next,rows:visible,candidates:candidateRows,leaders,summary:{version:V28_VERSION,status:'OBSERVED',listed:known.size,tickers:validTicks.size,tracked:Object.keys(assets).length,compared:comp.length,flow_comparison_members:flowRows.length,flow_share_migration_comparable:sameFlowUniverse,market_median_log_return_pct:benchmark,warning_visible:rows.filter(r=>r.risks?.length).length,stale:rows.filter(r=>r.stage==='STALE_TRADE').length,candidates:candidates.length,sub_070_candidates:candidates.filter(r=>r.move_pct<.7).length,price_only_not_future_direction:true}};
}
function v28ChooseBundle(candidates,max=3){
 const sorted=[...candidates].sort((a,b)=>b.priority-a.priority),chosen=sorted.slice(0,max);
 if(max<2)return chosen;
 for(const venue of ['bithumb','bitget']){if(chosen.some(x=>x.venue===venue))continue;const c=sorted.find(x=>x.venue===venue);if(c&&chosen.length){chosen[chosen.length-1]=c;}}
 return chosen;
}
function v28Brief(row){
 const stage={EXPANDING:'상승 확장',BUILDING:'상승 형성',REACCELERATING:'재가속 관찰',CAPITAL_BUILDING:'거래대금 점유율 유입',PULLBACK_HOLD:'고점 뒤 지지 관찰',WEAKENING:'상승 약화',ANCHOR_BROKEN:'형성 기준 이탈',BASELINE_ONLY:'초기 관찰',STALE_TRADE:'최근 체결 부족',OBSERVING:'변화 관찰'};
 return {symbol:row.symbol,day_pct:row.day_pct??null,stage:row.stage,stage_ko:stage[row.stage]||'현재 상승 관찰',move_pct:row.move_pct??null,build_gain_pct:row.build_gain_pct??null,relative_run_pct:row.relative_run_pct??null,money_share_delta:row.money_share_delta??null,since_detection_pct:row.since_detection_pct??null,risks:row.risks||[],discovery_selected:row.discovery_selected??null,nonselection_reason:row.nonselection_reason??null,future_direction_proven:false};
}
export {V28_VERSION,v28Discover,v28ChooseBundle,v28Brief,v28TradeMs};
