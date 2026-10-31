"""Pure V21 forecasting primitives. No network, Telegram, account or order I/O.
Features describe observations, not a fixed direction rule. Contradictory flow
remains a model input. Price labels are subsequent completed public prices,
explicitly NOT executable fills. Missing data never become verified zero flow.
"""
from __future__ import annotations
import bisect
import collections
import math
import random
import statistics

MIN=60_000

def number(x, default=None):
    try:
        if x is None or x == '' or isinstance(x,bool): return default
        n=float(x)
        return n if math.isfinite(n) else default
    except (TypeError,ValueError,OverflowError): return default

def clip(x, bound=30.0):
    return max(-bound,min(bound,number(x,0.0)))

def sign(x):
    return (x>0)-(x<0)

def logpos(x):
    return math.log1p(max(0.0,number(x,0.0)))

def futures_features(obs, item, now):
    w=item.get('windows') or {}; w5=w.get('5m') or {}; w15=w.get('15m') or {}
    p5=number(obs.get('window_5m_price_pct'),number(w5.get('price_change_pct')))
    p15=number(obs.get('window_15m_price_pct'),number(w15.get('price_change_pct')))
    if p5 is None or p15 is None: raise ValueError('MISSING_PRICE_CONTEXT')
    e=obs.get('taker_flow_15m') or {};r=obs.get('recent5_pressure_shift_research') or {}
    end=number(obs.get('price_context_end_ms'))
    aligned=(end is not None and end==number(e.get('end_ms')) and 0<=now-end<=14*MIN
        and obs.get('price_context_status')=='ALIGNED_REAL_OFFICIAL_1M_CONTEXT')
    rp=number(r.get('recent_5m_price_change_pct'))
    net=number(r.get('recent_5m_net_taker_usdt')); share=number(r.get('recent_5m_buy_share'))
    verified=bool(aligned and e.get('verified') is True
        and e.get('full_exchange_local_public_taker_flow_verified') is True
        and e.get('completeness')=='COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED'
        and r.get('status')=='REAL_15M_RECONCILED_RECENT5_VS_PRIOR10'
        and r.get('price_time_alignment_verified') is True
        and rp is not None and abs(rp-p5)<=.02
        and net is not None and share is not None and 0<=share<=1)
    bias=2*share-1 if verified else 0.0
    q=number(e.get('taker_turnover_usdt')) if verified else None
    blocks=e.get('blocks') or []
    recent_q=None
    if verified and len(blocks)==3:
        b=blocks[-1];bq=number(b.get('buy_usdt'));sq=number(b.get('sell_usdt'))
        recent_q=bq+sq if bq is not None and sq is not None else None
    flow_relative=net/q if verified and q and q>0 else 0.0
    book=obs.get('book_proof_v13') or {}; snapshots=book.get('snapshots') or []
    # Two point-in-time books are context, not continuous OFI/absorption.
    book_ok=(book.get('status')=='TWO_DISTINCT_BOOK_SNAPSHOTS' and len(snapshots)==2)
    ratio=number(snapshots[-1].get('bid_ask_top5_ratio')) if book_ok else None
    spread=number(snapshots[-1].get('spread_pct')) if book_ok else None
    location=number(r.get('actual_5m_close_location_in_range')) if aligned else None
    prices=[number(w5.get(k)) for k in ('close','high','low')]
    range_pct=(100*(prices[1]-prices[2])/prices[0]
        if all(x is not None for x in prices) and prices[0]>0 and prices[1]>=prices[2] else 0.0)
    out={
        'p1':clip((w.get('1m') or {}).get('price_change_pct')),
        'p5':clip(p5),'p15':clip(p15),'p60':clip((w.get('60m') or {}).get('price_change_pct'),100),
        'acceleration':clip(p5-p15/3),'reversal_5_vs_15':int(p5*p15<0),
        'range5':clip(range_pct),'close_location':location if location is not None else .5,
        'close_location_missing':int(location is None),
        'relative_volume5_log':logpos(w5.get('adjacent_ratio')),
        'relative_volume15_log':logpos(w15.get('adjacent_ratio')),
        'turnover5_log':logpos(w5.get('quote_turnover')),
        'flow_verified':int(verified),'recent_flow_missing':int(not verified),
        'recent_flow_bias':bias,'flow_change':clip(r.get('buy_share_delta'),1) if verified else 0.0,
        'flow_relative':clip(flow_relative,1),'price_flow_disagreement':int(verified and net*p5<0),
        'flow_x_price':clip(bias*p5),'flow_x_acceleration':clip(bias*(p5-p15/3)),
        'recent_trades_log':logpos(r.get('recent_5m_trades')) if verified else 0.0,
        'recent_vs_full_turnover':recent_q/q if q and recent_q is not None and q>0 else 0.0,
        'prior_flow_bias':2*number(r.get('prior_10m_buy_share'),.5)-1 if verified else 0.0,
        'book_verified':int(book_ok),'book_ratio_log':math.log(max(.01,ratio)) if ratio and ratio>0 else 0.0,
        'spread_pct':spread if spread is not None else 0.0,'spread_missing':int(spread is None),
        'oi_delta':clip(obs.get('oi_change_pct')),'funding':clip(number(obs.get('funding_rate'),0)*10000),
        'snapshot_age_min':max(0,(now-end)/MIN) if end is not None else 0.0,
    }
    if not all(math.isfinite(v) for v in out.values()):raise ValueError('NONFINITE_FEATURE')
    return out

def spot_features(seed, context=None):
    p=number(seed.get('observed_5m_price_change_pct'))
    q=number(seed.get('five_minute_equivalent_turnover_krw'))
    b=number(seed.get('five_minute_prior_ema_krw'))
    if p is None or q is None or q<0 or b is None or b<0:raise ValueError('MISSING_SPOT_CONTEXT')
    rel=math.log1p(q)-math.log1p(b)
    c=context or {}
    return {'p5':clip(p),'p5_abs':min(abs(p),30),'turnover_log':logpos(q),
        'baseline_log':logpos(b),'turnover_log_change':clip(rel),
        'turnover_x_price':clip(rel*p),'baseline_missing':int(b==0),
        'late_caution':int(seed.get('risk_class')=='LATE_CHASE_CAUTION'),
        'market_median5':clip(c.get('market_median5')),
        'market_breadth':number(c.get('market_breadth'),.5),
        'relative_to_market':clip(p-number(c.get('market_median5'),0)),
        'has_verified_local_cvd':0}

def forward_label(tape, issued_ms, horizon_min, max_entry_delay_min=10):
    # Each tuple: exchange completed timestamp, price, first-publication time.
    if not tape:return None
    times=[x[0] for x in tape]
    pos=bisect.bisect_right(times,issued_ms)
    if pos>=len(tape):return None
    t0,p0,k0=tape[pos]
    if p0<=0 or t0-issued_ms>max_entry_delay_min*MIN:return None
    end=t0+horizon_min*MIN;j=bisect.bisect_left(times,end)
    if j>=len(tape) or tape[j][0]!=end:return None
    t1,p1,k1=tape[j]
    if p1<=0 or k0<t0 or k1<t1:return None
    return {'entry_ms':t0,'future_ms':t1,'available_ms':max(k0,k1),
        'entry_delay_ms':t0-issued_ms,'return_pct':100*(p1/p0-1),
        'actual_execution_verified':False}

def temporal_partition(rows, train_cut, validation_cut, embargo_ms):
    if not train_cut<validation_cut:raise ValueError('TIME_CUTS_REVERSED')
    train=[r for r in rows if r['issued_ms']<train_cut-embargo_ms and r['label_known_ms']<train_cut]
    valid=[r for r in rows if train_cut+embargo_ms<=r['issued_ms']<validation_cut-embargo_ms
           and r['label_known_ms']<validation_cut]
    test=[r for r in rows if r['issued_ms']>=validation_cut+embargo_ms]
    return train,valid,test

def nonoverlap(rows,horizon_min):
    last={};out=[]
    for r in sorted(rows,key=lambda x:(x['issued_ms'],x['symbol'])):
        previous=last.get(r['symbol'])
        if previous is not None and r['issued_ms']-previous<horizon_min*MIN:continue
        out.append(r);last[r['symbol']]=r['issued_ms']
    return out

def evaluate_predictions(rows,cost_pct,venue,horizon_min):
    if cost_pct<0:raise ValueError('NEGATIVE_COST')
    eligible=[x for x in rows if x['side'] in (-1,1) and (venue!='bithumb' or x['side']==1)]
    selected=nonoverlap(eligible,horizon_min)
    net=[x['side']*x['ret']-cost_pct for x in selected]
    gross=[x['side']*x['ret'] for x in selected]
    blocks=collections.defaultdict(list)
    for row,value in zip(selected,net):blocks[row['issued_ms']//3600000].append(value)
    lower=None
    # Whole-hour blocks, not thousands of correlated coins treated as independent.
    if len(blocks)>=8:
        pairs=[(sum(x),len(x)) for x in blocks.values()]
        rng=random.Random(21031);boot=[]
        for _ in range(1000):
            draw=[rng.choice(pairs) for j in pairs]
            boot.append(sum(x[0] for x in draw)/sum(x[1] for x in draw))
        lower=sorted(boot)[24]
    n=len(selected)
    return {'signals':n,'buy_count':sum(x['side']==1 for x in selected),
        'short_count':sum(x['side']==-1 for x in selected),
        'gross_direction_accuracy_all_rows':sum(x>0 for x in gross)/n if n else None,
        'net_wins':sum(x>0 for x in net),'net_losses':sum(x<0 for x in net),
        'mean_net_pct':statistics.fmean(net) if net else None,
        'mean_gross_pct':statistics.fmean(gross) if gross else None,
        'median_net_pct':statistics.median(net) if net else None,
        'hour_blocks':len(blocks),'hour_block_bootstrap_lower_95_pct':lower,
        'cost_scenario_pct':cost_pct,'actual_execution_verified':False,
        'unique_symbols':len({x['symbol'] for x in selected}),
        'flat_observations_included':True}
