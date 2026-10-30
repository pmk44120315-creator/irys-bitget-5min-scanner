"""V18 exploratory futures evidence target selection, pure and read-only.

Old selector silently removed reversals (p5*p15 <= 0), modest moves, and
markets below a fixed quote threshold BEFORE any real taker evidence.
This selector preserves identity and candle integrity but ranks ALL eligible
crypto perpetuals for official taker/book evidence, including early reversal.
No Telegram or order actions, no arbitrary 20-consecutive-1m requirement.
"""
from __future__ import annotations
import math
MINUTE=60000
def n(v):
    try:
        if v is None or isinstance(v,bool):return None
        x=float(v)
        return x if math.isfinite(x) else None
    except (TypeError,ValueError,OverflowError):
        return None
def curve(x):
    return math.log1p(max(0.,x))
def early_information_score(x):
    w=x.get('windows') or {}
    b=w.get('5m') or {};c=w.get('15m') or {};a=w.get('1m') or {}
    p1=n(a.get('price_change_pct')) or 0.
    p5=n(b.get('price_change_pct')) or 0.
    p15=n(c.get('price_change_pct')) or 0.
    q5=n(b.get('quote_turnover')) or 0.
    q15=n(c.get('quote_turnover')) or 0.
    ratio=n(b.get('adjacent_ratio')) or 0.
    # Regime change is not a "bad" symbol: highest information gain can be
    # disagreement between present minute and earlier 15-minute movement.
    acceleration=abs(p5-p15/3.)
    mini_reversal=abs(p1-p5/5.)
    amplitude=abs(p5)+abs(p15)/3.
    turnover=curve(q5)/curve(10000.)
    continuity=curve(q15)/curve(50000.)
    abnormal=curve(min(max(0.,ratio),1000.))/curve(10.)
    oi=x.get('oi') or {}
    delta=n(oi.get('change_pct_from_previous_run')) or 0.
    return ((1+acceleration+mini_reversal+0.3*amplitude)
            * (0.4+0.4*turnover+0.2*continuity)
            +0.25*abnormal+0.15*min(5,abs(delta)))
def select_v18_evidence_targets(latest, now_ms, state=None, limit=6):
    """Output original market objects in ranked order, plus audit diagnostics.
    Uses the existing API request budget limit=6 and existing 2-book continuity.
    The pure selection never sends Telegram, fetches APIs or trades.
    """
    if not isinstance(latest,dict) or latest.get('collector_status')!='PASS':
        return {'status':'SOURCE_UNVERIFIED','selected':[],
          'eligible':0,'reversal_eligible':0,'previously_seen':0}
    if not isinstance(now_ms,int) or now_ms<1_600_000_000_000:
        return {'status':'INVALID_ASOF','selected':[],
          'eligible':0,'reversal_eligible':0,'previously_seen':0}
    if not isinstance(limit,int) or not 1<=limit<=10:
        return {'status':'INVALID_API_BUDGET','selected':[],
          'eligible':0,'reversal_eligible':0,'previously_seen':0}
    prev=(state or {}).get('futures_book_snapshots_v13') or {}
    recently=(state or {}).get('v18_evidence_last_checked_ms') or {}
    dedup={}
    for item in list(latest.get('watchlist') or [])+list(latest.get('early_pool') or []):
        if not isinstance(item,dict):continue
        sym=item.get('symbol')
        if (not isinstance(sym,str) or not sym.endswith('USDT') or
            not sym[:-4].isalnum() or item.get('venue')!='bitget' or
            item.get('asset_identity')!='VERIFIED_CRYPTO' or
            item.get('symbolType','perpetual')!='perpetual' or
            item.get('contract_status','normal')!='normal'):
            continue
        w=item.get('windows') or {}
        b=w.get('5m') or {}
        c=w.get('15m') or {}
        price=n(b.get('close'))
        p5=n(b.get('price_change_pct'))
        p15=n(c.get('price_change_pct'))
        quote=n(b.get('quote_turnover'))
        if price is None or price<=0 or p5 is None or p15 is None or quote is None or quote<0:
            continue
        if n(b.get('coverage'))!=1:continue
        # Prefer the richer watchlist object if the same market appears twice.
        if sym not in dedup or ('recent_trades_sample' in item and
                                'recent_trades_sample' not in dedup[sym]):
            dedup[sym]=item
    ranked=[]
    reversal_count=0
    seen=0
    for sym,item in dedup.items():
        w=item['windows'];p5=n(w['5m']['price_change_pct'])
        p15=n((w.get('15m') or {}).get('price_change_pct'))
        p1=n((w.get('1m') or {}).get('price_change_pct'))
        reversal=(p5*p15<0 or p1 is not None and p1*p5<0)
        reversal_count+=bool(reversal)
        old=prev.get(sym)
        pending=False
        if isinstance(old,dict):
            ts=old.get('timestamp_ms')
            if isinstance(ts,int):pending=3*MINUTE<=now_ms-ts<=9*MINUTE
        last=recently.get(sym) if isinstance(recently,dict) else None
        elapsed=(now_ms-last)/MINUTE if isinstance(last,int) and now_ms>=last else None
        novelty=1.0 if elapsed is None else 1+min(0.25,max(0,elapsed)/60.)
        seen+=elapsed is not None
        value=early_information_score(item)*novelty
        ranked.append((pending,value,sym,item,reversal))
    # Finish an actual earlier book pair before rotating to new evidence.
    ranked.sort(key=lambda x:(not x[0],-x[1],x[2]))
    chosen=ranked[:limit]
    return {'status':'ELIGIBLE' if chosen else 'NO_ACTIVE_CRYPTO',
        'selected':[x[3] for x in chosen],
        'selected_symbols':[x[2] for x in chosen],
        'eligible':len(dedup),'reversal_eligible':reversal_count,
        'reversal_selected':sum(x[4] for x in chosen),
        'pending_book_selected':sum(x[0] for x in chosen),
        'previously_seen':seen,
        'continuity_rule':'ONLY_2_DIFFERENT_ACTUAL_BOOK_TIMES_ARE_PAIRED',
        'no_additional_directional_hard_threshold':True};
