"""V26 causal microstructure hypotheses, independent of the V24 live Worker.

Every input is a feature frozen at the original V22 quote/forecast issue time.
Direction hypotheses are not probabilities, trade permits, or Telegram alerts.
Unknown taker/structure is an abstention, never invented as a zero-valued trade.
"""
from __future__ import annotations
import math

MINUTE=60_000
HORIZONS=(5,15)
COST_SCENARIO_PCT=.20
METHODS=('v26_primary','verified_taker','price_impulse','price_fade',
         'flow_price_agree','price_with_flow_disagreement',
         'taker_with_price_disagreement','blended_momentum')

def number(value):
    if value is None or isinstance(value,bool):return None
    try:
        n=float(value)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError,OverflowError):
        return None

def sign(value):
    n=number(value)
    return 0 if n is None else (1 if n>0 else -1 if n<0 else 0)

def direction_hypotheses(features,venue,flag):
    """Produce predeclared, *simultaneous* alternatives using only issued features.

    A two-point orderbook imbalance is NOT continuous absorption. OI changes
    do NOT tell us who opened shorts or longs. Neither is a hard direction vote.
    PRICE_ONLY is scored for diagnosis but never labelled validated LONG/BUY.
    """
    f=features if isinstance(features,dict) else {}
    p5=number(f.get('p5'));p1=number(f.get('p1'))
    p15=number(f.get('p15'));rel=number(f.get('relative_to_market'))
    if p5 is None or venue not in ('bitget','bithumb'):
        return {'status':'PRICE_SOURCE_MISSING','votes':{k:0 for k in METHODS},
                'evidence_class':'UNKNOWN','strength_not_probability':0.0}
    price=sign(p5)
    verified=bool(venue=='bitget' and flag is True
        and number(f.get('flow_verified'))==1
        and number(f.get('recent_flow_missing'))==0)
    bias=number(f.get('recent_flow_bias')) if verified else None
    flow=sign(bias) if verified else 0
    # Price geometry vote is separate from flow and is always purely provisional.
    raw=(.80*math.tanh(p5/.8)
        +.40*math.tanh((p1 or 0)/.4)
        +.20*math.tanh((p15 or 0)/1.5)
        +.15*math.tanh((rel or 0)/.9))
    blended=sign(raw)
    agree=price!=0 and flow!=0 and price==flow
    disagree=price!=0 and flow!=0 and price!=flow
    primary=price if price!=0 else blended
    evidence_class='PRICE_ONLY'
    if agree:
        primary=price
        evidence_class='REAL_TAKER_PRICE_ALIGNED'
    elif disagree:
        # Aggressive sells + rising price can be absorption OR further liquidation;
        # impossible to distinguish from a two-point book snapshot.
        primary=0
        evidence_class='PRICE_TAKER_DISAGREEMENT_UNRESOLVED'
    elif verified and price==0 and flow!=0:
        primary=0
        evidence_class='FLOW_WITHOUT_PRICE_STRUCTURE'
    elif primary==0:
        evidence_class='NO_DIRECTIONAL_OBSERVATION'
    close=number(f.get('close_location'))
    close_observed=(number(f.get('close_location_missing'))==0 and
        close is not None and 0<=close<=1)
    quotes_spread=number(f.get('spread_pct')) if number(f.get('spread_missing'))==0 else None
    oi=number(f.get('oi_delta'))
    book=number(f.get('book_ratio_log')) if number(f.get('book_verified'))==1 else None
    votes={
      'v26_primary':primary,
      'verified_taker':flow,
      'price_impulse':price,
      'price_fade':-price,
      'flow_price_agree':price if agree else 0,
      'price_with_flow_disagreement':price if disagree else 0,
      'taker_with_price_disagreement':flow if disagree else 0,
      'blended_momentum':blended}
    return {'status':'EVALUATED','votes':votes,
        'evidence_class':evidence_class,
        'source_has_reconciled_15m_taker':verified,
        'flow_price_agree':agree,'flow_price_disagree':disagree,
        'taker_bias':round(bias,6) if bias is not None else None,
        'impulse_score_not_probability':round(raw,6),
        'strength_not_probability':round(abs(raw),6),
        'price_5m_pct':round(p5,7),
        'price_15m_pct':round(p15,7) if p15 is not None else None,
        'price_1m_pct':round(p1,7) if p1 is not None else None,
        'first_reversal_vs_15m':bool(price and sign(p15) and price!=sign(p15)),
        'close_location_observed':round(close,6) if close_observed else None,
        'top5_book_ratio_log_observed_not_absorption':round(book,6) if book is not None else None,
        'oi_change_observed_not_position_side':round(oi,6) if oi is not None else None,
        'spread_pct_observed':round(quotes_spread,6) if quotes_spread is not None else None,
        'future_direction_proven':False,'orders_allowed':False,'telegram_allowed':False}

def quote_ok(q):
    if not isinstance(q,dict):return False
    bid=number(q.get('bid'));ask=number(q.get('ask'))
    at=q.get('at_ms')
    return bool(bid is not None and ask is not None and bid>0 and ask>=bid
        and isinstance(at,int) and not isinstance(at,bool))

def label_from_v22(event,horizon,now_ms):
    """Use only a later real quote labeled by existing V22, not price guesses.

    A V22 outcome must be at h minutes .. h minutes + 150sec from
    original issue. Failing or missing data NEVER counts as a success.
    """
    if horizon not in HORIZONS:return None
    issued=event.get('issued_ms');entry=event.get('entry_quote')
    out=(event.get('outcomes') or {}).get(str(horizon))
    if (not isinstance(issued,int) or isinstance(issued,bool) or
        not isinstance(out,dict) or out.get('both_sides_measured') is not True):
        return None
    exit_q=out.get('exit_quote')
    if not quote_ok(entry) or not quote_ok(exit_q):return None
    if abs(entry['at_ms']-issued)>MINUTE:return None
    target=issued+horizon*MINUTE
    if (not target<=exit_q['at_ms']<=target+150_000
        or exit_q['at_ms']>now_ms):return None
    returned=out.get('signed_quote_returns') or {}
    expected_long=100*(number(exit_q['bid'])/number(entry['ask'])-1)
    expected_short=100*(number(entry['bid'])-number(exit_q['ask']))/number(entry['bid'])
    long=number(returned.get('1'));short=number(returned.get('-1'))
    if (long is None or short is None or
        abs(long-expected_long)>0.0001 or abs(short-expected_short)>0.0001):
        return None
    entry_mid=(number(entry['bid'])+number(entry['ask']))/2
    exit_mid=(number(exit_q['bid'])+number(exit_q['ask']))/2
    move=100*(exit_mid/entry_mid-1)
    return {'status':'ACTUAL_DELAYED_BID_ASK_MEASURED',
      'horizon_min':horizon,'quote_at_ms':exit_q['at_ms'],
      'quote_delay_ms':exit_q['at_ms']-target,
      'long_quote_return_pct':round(long,7),
      'short_quote_return_pct':round(short,7),
      'midprice_change_pct':round(move,7),
      'midprice_direction':sign(move),
      'actual_fill_verified':False}

def evaluate_records(records,horizon,venue,method):
    rows=[]
    for r in records:
        if r.get('venue')!=venue:continue
        side=(r.get('votes') or {}).get(method,0)
        if side not in (-1,1) or venue=='bithumb' and side==-1:continue
        outcome=(r.get('labels') or {}).get(str(horizon)) or {}
        if outcome.get('status')!='ACTUAL_DELAYED_BID_ASK_MEASURED':continue
        proxy=(outcome['long_quote_return_pct'] if side==1
            else outcome['short_quote_return_pct'])
        rows.append((r,side,proxy-COST_SCENARIO_PCT,
                     outcome['midprice_direction']==side))
    if not rows:
        return {'measured':0,'mean_net_quote_proxy_pct':None,
            'cost_adjusted_quote_wins':0,'cost_adjusted_quote_losses':0,
            'direction_match_fraction':None,'hour_blocks':0,
            'real_execution_verified':False}
    nets=[r[2] for r in rows]
    return {'measured':len(rows),
      'cost_adjusted_quote_wins':sum(v>0 for v in nets),
      'cost_adjusted_quote_losses':sum(v<=0 for v in nets),
      'mean_net_quote_proxy_pct':round(sum(nets)/len(nets),6),
      'direction_match_fraction':round(sum(x[3] for x in rows)/len(rows),6),
      'hour_blocks':len({x[0]['issued_ms']//3_600_000 for x in rows}),
      'unique_symbols':len({x[0]['symbol'] for x in rows}),
      'real_execution_verified':False}
