/** IRYS V19 - independently verified rapid-flow candidate ranking, no orders.
 * Pure helper: all live I/O is owned by the existing Cloudflare Worker.
 */
const V19_SAMPLE_MAX_AGE_MS=14*60000;
function v19Number(x){
  if(x===null||x===undefined||x===''||typeof x==='boolean')return null;
  const n=Number(x);return Number.isFinite(n)?n:null;
}
function v19Sign(x){return x>0?1:x<0?-1:0}
function v19MarketLink(p,snap,venue){
  if(venue==='bitget')return [...(snap?.watchlist||[]),...(snap?.early_pool||[])]
    .find(x=>x?.symbol===p&&x?.venue==='bitget'&&x?.asset_identity==='VERIFIED_CRYPTO'&&
      x?.baseCoin===p.slice(0,-4)&&x?.quoteCoin==='USDT'&&
      x?.contract_status==='normal'&&x?.symbolType==='perpetual')||null;
  return null;
}
function v19FuturesCandidates(source,doc,now){
  const out={candidates:[],feedStatus:'UNAVAILABLE',verified:0,contrary:0,reversals:0,
    sourceMismatch:false};
  const last=Date.parse(doc?.at_utc||''),documentSource=Date.parse(doc?.source_finished_utc||''),
    snapshotAt=Date.parse(source?.finished_utc||'');
  if(doc?.version!=='V18_EVIDENCE_LIVE_V1'||doc?.status!=='PASS'||!Array.isArray(doc?.observations)||
      !Number.isFinite(last)||!Number.isFinite(documentSource)||
      !Number.isFinite(snapshotAt)||last>now+60000||
      now-last>V19_SAMPLE_MAX_AGE_MS||documentSource>last+60000||
      now-documentSource>V19_SAMPLE_MAX_AGE_MS||documentSource>snapshotAt+60000||
      snapshotAt-documentSource>10*60000){
    out.feedStatus='STALE_OR_UNMATCHED';
    return out;
  }
  out.feedStatus='PASS';
  out.sourceMismatch=documentSource!==snapshotAt;
  const seen=new Set();
  for(const obs of doc.observations){
    const symbol=obs?.symbol;
    if(typeof symbol!=='string'||!/^[A-Z0-9]{2,25}USDT$/.test(symbol)||seen.has(symbol))
      continue;
    seen.add(symbol);
    const contract=v19MarketLink(symbol,source,'bitget');
    if(!contract)continue;
    const e=obs.taker_flow_15m||{},r=obs.recent5_pressure_shift_research||{},
      p=v19Number(obs.window_5m_price_pct),
      p15=v19Number(obs.window_15m_price_pct),
      net=v19Number(r.recent_5m_net_taker_usdt),
      share=v19Number(r.recent_5m_buy_share),q=v19Number(e.taker_turnover_usdt),
      aligned=obs.price_context_status==='ALIGNED_REAL_OFFICIAL_1M_CONTEXT'&&
        Number.isSafeInteger(obs.price_context_end_ms)&&
        obs.price_context_end_ms===e.end_ms&&
        e.end_ms<=now+60000&&now-e.end_ms<=V19_SAMPLE_MAX_AGE_MS;
    if(p===null||p15===null||!Number.isFinite(q)||q<=0)continue;
    const verified=aligned&&e.verified===true&&
      e.symbol===symbol&&e.venue==='bitget'&&
      e.completeness==='COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED'&&
      e.full_exchange_local_public_taker_flow_verified===true&&
      r.status==='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10'&&
      r.price_time_alignment_verified===true&&
      net!==null&&share!==null&&share>=0&&share<=1&&
      v19Number(r.recent_5m_price_change_pct)!==null&&
      Math.abs(r.recent_5m_price_change_pct-p)<=0.02;
    if(verified)out.verified++;
    const opposite=verified&&v19Sign(net)!==0&&v19Sign(p)!==0&&
      v19Sign(net)!==v19Sign(p);
    if(opposite)out.contrary++;
    const reversal=p*p15<0;
    if(reversal)out.reversals++;
    const confirmed=verified&&!opposite&&v19Sign(net)!==0&&v19Sign(p)!==0&&
      v19Sign(net)===v19Sign(p)&&r.recent_flow_price_same_sign===true;
    const movement=v19Sign(p);
    const direction=confirmed?(movement>0?'LONG':'SHORT'):null;
    const acc=Math.abs(p-p15/3),bias=verified?Math.abs(share-.5)*2:0;
    const rangePosition=v19Number(r.actual_5m_close_location_in_range);
    const positionBonus=rangePosition===null?0:(movement>0?rangePosition:1-rangePosition);
    const ratio=v19Number(contract.windows?.['5m']?.adjacent_ratio);
    const score=1.8*acc+1.3*Math.log1p(Math.max(0,ratio||0))+
       Math.min(2,Math.abs(p))+.65*bias+(reversal?1.6:0)+
       (confirmed?3:0)+Math.min(1,Math.max(0,positionBonus));
    out.candidates.push({
      venue:'bitget',symbol,market:symbol,kind:confirmed?'DIRECTION':'WATCH',
      direction,price_change_5m:p,price_change_15m:p15,score,
      asof_ms:e.end_ms||obs.price_context_end_ms,
      verified,opposite,
      real_futures_net_5m:verified?net:null,
      aggressive_buy_share_5m:verified?share:null,
      real_execution_count_5m:verified?v19Number(r.recent_5m_trades):null,
      oi_change_pct:v19Number(obs.oi_change_pct),reversal,
      book_observed:obs.book_proof_v13?.status==='TWO_DISTINCT_BOOK_SNAPSHOTS',
      flow_shift:verified?v19Number(r.buy_share_delta):null,
      price_usdt:v19Number(contract.windows?.['5m']?.close),
      warning:opposite?'OPPOSING_SIGNED_TAKER':'NONE',
      instrument_crypto_verified:true
    });
  }
  out.candidates.sort((a,b)=>b.score-a.score);
  return out;
}
function v19SpotCandidates(spot,now){
  const out={candidates:[],scanned:spot?.preselected||0,verified:0,contrary:0};
  for(const c of spot?.observations||[]){
    if(c?.venue!=='bithumb'||!/^KRW-[A-Z0-9]+$/.test(c?.symbol||'')||
       c.spot_risk_status!=='OFFICIAL_NO_WARNING_NOW'||
       c.confirmed_market_risk_clear!==true)continue;
    const change=v19Number(c.price_change_snapshot_pct),
       turnover=v19Number(c.turnover5_est_krw),
       ratio=v19Number(c.relative_turnover),
       price=v19Number(c.price_krw),t=c.taker_2m||{},
       net=v19Number(t.net_taker_krw),recent=v19Number(t.recent_min_net_krw);
    if(change===null||change<=0||turnover===null||turnover<=0||price===null||price<=0)continue;
    const verified=t.coverage===true&&t.sampled_not_marketwide_cvd===true&&
      net!==null&&recent!==null;
    if(verified)out.verified++;
    const contrary=verified&&(net<0||recent<0);
    if(contrary)out.contrary++;
    const directional=verified&&net>0&&recent>0;
    const acceleration=v19Number(c.windows?.['1m']?.price_pct);
    const rank=Math.log1p(turnover/10000000)+1.3*Math.log1p(Math.max(0,ratio||0))+
      Math.min(3,change)+Math.max(0,(acceleration||0))+
      (directional?2:0)-(contrary?1:0);
    out.candidates.push({venue:'bithumb',symbol:c.symbol,market:c.market,
      kind:directional?'DIRECTION':'WATCH',
      direction:directional?'BUY':null,score:rank,
      price_change_5m:change,turnover5_est_krw:turnover,turnover_ratio:ratio,
      aggressive_buy_share_2m:verified?v19Number(t.buy_share):null,
      real_taker_net_2m:verified?net:null,
      verified,opposite:contrary,
      price_krw:price,current_price_krw:price,asof_ms:now,
      warning:contrary?'OPPOSING_SIGNED_TAKER':'NONE',
      official_risk_prechecked:true
    });
  }
  out.candidates.sort((a,b)=>b.score-a.score);
  return out;
}
function v19FastMessage(c,now){
  const stamp=new Date(now+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
  const n=(x,dp=2)=>x===null||x===undefined||!Number.isFinite(x)?'미확인':
    new Intl.NumberFormat('ko-KR',{maximumFractionDigits:dp}).format(x);
  const lead=c.kind==='DIRECTION'?
    (c.direction==='LONG'||c.direction==='BUY'?'🟢':'🔴')+
    ' [5분 실체결 수급 동행 · '+(c.direction==='BUY'?'빗썸 BUY':c.direction)+
    ' 관찰 · 진입 신호 아님]':
    '🔎 [5분 급등 초입 탐색 · WATCH · 방향 미확정]';
  if(c.venue==='bithumb')
    return lead+'\n빗썸 현물 '+c.symbol+' · '+stamp+
      '\n관측가 '+n(c.price_krw,8)+'원 · 구간 변화 +'+n(c.price_change_5m)+'%'+
      '\n5분 거래대금 추정 '+n(c.turnover5_est_krw,0)+'원 · 최근 평균 대비 '+n(c.turnover_ratio,2)+'배'+
      '\n2분 공격매수 비중 '+(c.verified?n(c.aggressive_buy_share_2m*100,1)+'%':'표본 미확인')+
      '\n'+(c.verified?'현물 체결 표본 분석 · 전체 현물 CVD 아님':'체결 방향 불충분 → 매수 판단 유보')+
      '\n⚠️ 현재 수급 관찰이지 미래 상승 확정·매수 지시가 아닙니다. 주문 없음.';
  return lead+'\n비트겟 USDT 선물 '+c.symbol+' · '+stamp+
    '\n공식 완료 5분 가격 '+n(c.price_change_5m)+'% · 15분 '+n(c.price_change_15m)+'%'+
    (c.reversal?'\n초기 방향 반전 후보: 최근 5분·이전 15분 방향 충돌':'')+
    '\n최근 5분 실제 순체결 '+(c.verified?n(c.real_futures_net_5m,0)+' USDT':'미검증')+
    ' · 공격매수 '+(c.verified?n(c.aggressive_buy_share_5m*100,1)+'%':'미확인')+
    '\nOI 변화 '+n(c.oi_change_pct)+'% (포지션 소유자 방향은 미확인)'+
    '\n'+(c.book_observed?'호가 서로 다른 시점 2회 관측 · 흡수 증거는 아님':
      '호가 연속성 미확인 · 신호 차단 대신 참고사항')+
    '\n⚠️ 거래소 내 체결·과거 가격 관측입니다. 미래 방향·수익 보장 또는 진입 지시 아님. 주문 없음.';
}
export {v19FuturesCandidates,v19SpotCandidates,v19FastMessage};
