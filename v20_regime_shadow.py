"""Independent V20 forward-prediction calibration (Bitget USDT perpetuals).

Regime hypothesis discovered in retrospective data, deliberately SHADOW ONLY:
  first 5m reversal against previous 15m -> test continuation of the first turn
  no reversal (5m and 15m same) -> test price/flow exhaustion opposite to 5m

Real verified recent Bitget taker agreement is required to *measure* this
hypothesis, NOT to issue an order. No Telegram, auto trading, Cloudflare writes.
All validation prices are published AFTER the prediction was registered.
No 20-consecutive-1m bars or fixed turnover/price thresholds.
"""
import datetime as dt
import math

MIN=60_000
HORIZONS=(5,15,30,60)
UTC=dt.timezone.utc
def val(x):
    try:
        if x is None or isinstance(x,bool):return None
        f=float(x)
        return f if math.isfinite(f) else None
    except (TypeError,ValueError,OverflowError):return None
def side(x):
    return 1 if x>0 else -1 if x<0 else 0
def mark(return_pct):
    return 'RIGHT' if return_pct>=.15 else 'WRONG' if return_pct<=-.15 else 'FLAT'
def options(market,flow,now):
    valid={}
    for r in list(market.get('early_pool') or [])+list(market.get('watchlist') or []):
        if isinstance(r,dict) and r.get('venue')=='bitget' and r.get('asset_identity')=='VERIFIED_CRYPTO':
            valid[r.get('symbol')]=r
    for o in flow.get('observations') or []:
        sym=o.get('symbol')
        r=o.get('recent5_pressure_shift_research') or {}
        e=o.get('taker_flow_15m') or {}
        source=valid.get(sym)
        if not source or not isinstance(sym,str) or not sym.endswith('USDT'):continue
        p5=val(o.get('window_5m_price_pct'))
        p15=val(o.get('window_15m_price_pct'))
        net=val(r.get('recent_5m_net_taker_usdt'))
        at=o.get('price_context_end_ms')
        if (p5 is None or p15 is None or net is None or side(p5)==0 or
            side(p5)!=side(net) or
            o.get('price_context_status')!='ALIGNED_REAL_OFFICIAL_1M_CONTEXT' or
            e.get('verified') is not True or
            e.get('full_exchange_local_public_taker_flow_verified') is not True or
            e.get('completeness')!='COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED' or
            e.get('end_ms')!=at or not isinstance(at,int) or
            at>now+MIN or now-at>14*MIN or
            r.get('status')!='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10' or
            r.get('price_time_alignment_verified') is not True or
            r.get('recent_flow_price_same_sign') is not True):
            continue
        reversal=p5*p15<0
        prediction=side(p5) if reversal else -side(p5)
        yield {'symbol':sym,'issued_ms':now,'direction':prediction,
               'reference_5m_pct':p5,'reference_15m_pct':p15,
               'regime':'EARLY_REVERSAL' if reversal else 'TREND_EXHAUSTION_HYPOTHESIS',
               'price_source':'BITGET_REAL_OFFICIAL_COMPLETED_1M',
               'taker_evidence':'BITGET_RECONCILED_REAL_15M_FILLS_RECENT5',
               'entry':None,'future_results':{}}
def _summarize(rows,h):
    rr=[r['future_results'].get(str(h)) for r in rows]
    rr=[x for x in rr if isinstance(x,dict) and x.get('judgment') in ('RIGHT','WRONG','FLAT')]
    right=sum(x.get('judgment')=='RIGHT' for x in rr)
    wrong=sum(x.get('judgment')=='WRONG' for x in rr)
    flat=sum(x.get('judgment')=='FLAT' for x in rr)
    return {'horizon_min':h,'measured':len(rr),'right':right,'wrong':wrong,'flat':flat,
            'decisive_accuracy':round(right/(right+wrong),4) if right+wrong else None,
            'future_performance_is_not_validated':True}
def update(market,flow,source_prices,state,now):
    if not isinstance(state,dict):state={}
    pending=state.get('pending') if isinstance(state.get('pending'),list) else []
    outcomes=state.get('outcomes') if isinstance(state.get('outcomes'),list) else []
    last=state.get('last_by_symbol') if isinstance(state.get('last_by_symbol'),dict) else {}
    entered=0;verified=0;future_evaluations=0;bad_clock=0
    open_rows=[]
    for row in pending:
        if not isinstance(row,dict) or not isinstance(row.get('issued_ms'),int):continue
        symbol=row.get('symbol')
        point=source_prices.get(symbol)
        now_price=point[1] if isinstance(point,(list,tuple)) and len(point)==2 else None
        now_stamp=point[0] if isinstance(point,(list,tuple)) and len(point)==2 else None
        if not isinstance(now_stamp,int) or not (val(now_price) or 0)>0:
            if now-row['issued_ms']<3*3600*1000:open_rows.append(row)
            continue
        entry=row.get('entry')
        if entry is None and now_stamp>row['issued_ms'] and now_stamp-row['issued_ms']<=9*MIN:
            row['entry']=[now_stamp,now_price]
            entry=row['entry'];entered+=1
        if not isinstance(entry,list) or len(entry)!=2:
            if now-row['issued_ms']<=15*MIN:open_rows.append(row)
            else:bad_clock+=1
            continue
        all_passed=True
        for h in HORIZONS:
            if str(h) in row.get('future_results',{}):continue
            target=entry[0]+h*MIN
            if now_stamp<target:
                all_passed=False;continue
            # An exact official completed timestamp, not a stale last price.
            if 0<=now_stamp-target<=3*MIN and now>=now_stamp:
                signed=100*(now_price/entry[1]-1)*row['direction']
                row.setdefault('future_results',{})[str(h)]={
                   'judgment':mark(signed),'signed_pct':round(signed,6),
                   'completed_candle_ms':now_stamp,'not_execution_price':True}
                future_evaluations+=1
            else:
                row.setdefault('future_results',{})[str(h)]={
                    'judgment':'UNAVAILABLE_EXACT_COMPLETED_PRICE',
                    'completed_candle_ms':now_stamp,'not_execution_price':True}
        if len(row.get('future_results',{}))<len(HORIZONS):
            all_passed=False
        if not all_passed:
            open_rows.append(row)
        else:
            outcomes.append(row)
            verified+=1
    open_keys={r['symbol'] for r in open_rows if 'symbol' in r}
    issued=[]
    for candidate in options(market,flow,now):
        sym=candidate['symbol']
        prev=last.get(sym)
        if sym in open_keys or isinstance(prev,int) and now-prev<90*MIN:
            continue
        open_rows.append(candidate)
        open_keys.add(sym);last[sym]=now
        issued.append({'symbol':sym,'regime':candidate['regime'],
            'research_direction':'UP' if candidate['direction']==1 else 'DOWN',
            'telegram_sent':False,'automatic_order':False})
    rows=outcomes[-400:]
    report={
      'version':'V20_CAUSAL_REGIME_FORWARD_EVALUATION',
      'status':'RESEARCH_ACTIVE_NEVER_SENDS_ALERT',
      'registered_now':len(issued),'new_research_predictions':issued[:12],
      'newly_completed_60m':verified,'new_future_price_labels':future_evaluations,
      'missing_price_reference':bad_clock,'still_pending':len(open_rows),
      'outcomes':{str(h):_summarize(rows,h) for h in HORIZONS},
      'venue':'bitget','real_orders':False,'telegram_sent':False,
      'hypothesis_selected_after_retrospective_audit':True,
      'independent_future_proof_pending':True,
    }
    history={'pending':open_rows[-150:],'outcomes':rows,
      'last_by_symbol':{k:v for k,v in last.items()
                        if isinstance(v,int) and now-v<7*24*3600000}}
    return report,history
