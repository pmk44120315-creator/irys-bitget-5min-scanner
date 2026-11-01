"""V22 prequential, quote-aware direction research. Pure functions, no network.

Predict CURRENT direction using only CURRENT price/flow/market features and
past completed outcomes. Compare both possible sides at the same market
timestamp; do not invert a losing side and call it profitable.
Every candidate is research-visible even if none is eligible for Telegram.
"""
from __future__ import annotations
import collections
import math
import random
import statistics

COST_PCT=0.20  # disclosed scenario beyond public best bid/ask crossing
MIN=60_000
HORIZONS=(5,15)
EXPERTS=('momentum5','countertrend5','first_reversal_else_reversion',
         'price_acceleration','relative_market','taker_bias',
         'price_flow_disagreement','prior_trend','v21_frozen')
LR=.24

def finite(x):
    try:
        if x is None or isinstance(x,bool):return None
        y=float(x)
        return y if math.isfinite(y) else None
    except (TypeError,ValueError,OverflowError):return None

def sign(v):
    if v is None:return 0
    return 1 if v>0 else -1 if v<0 else 0

def is_quote(q):
    if not isinstance(q,dict):return False
    bid=finite(q.get('bid'));ask=finite(q.get('ask'))
    return (bid is not None and ask is not None and
        bid>0 and ask>=bid and isinstance(q.get('at_ms'),int) and
        not isinstance(q.get('at_ms'),bool))

def quote_returns(entry,exit):
    """Assumed immediate aggressive long and short fills at best public quotes.

    Long buys entry ask, sells exit bid. Short sells entry bid, buys exit ask.
    These are quote proxies, NOT actual obtainable fills or account P&L.
    """
    if not is_quote(entry) or not is_quote(exit):
        raise ValueError('QUOTE_PAIR_INVALID')
    return {
      '1':100*(exit['bid']/entry['ask']-1),
      '-1':100*(entry['bid']-exit['ask'])/entry['bid'],
    }

def expert_votes(f,model=None):
    """Return named votes -1/0/1. Zero means unknown/abstain, not data=0."""
    p5=finite(f.get('p5'));p15=finite(f.get('p15'))
    p1=finite(f.get('p1'));rel=finite(f.get('relative_to_market'))
    acc=finite(f.get('acceleration'))
    if p5 is None:raise ValueError('CANNOT_INFER_WITHOUT_PRICE')
    m=sign(p5);out={key:0 for key in EXPERTS}
    out['momentum5']=m
    out['countertrend5']=-m
    if p15 is not None:
        out['first_reversal_else_reversion']=m if p5*p15<0 else -m
        out['prior_trend']=sign(p15)
    out['price_acceleration']=sign(acc)
    out['relative_market']=sign(rel)
    if f.get('flow_verified')==1 and f.get('recent_flow_missing')!=1:
        bias=finite(f.get('recent_flow_bias'))
        if bias is not None:
            out['taker_bias']=sign(bias)
            if f.get('price_flow_disagreement')==1:
                # A price/flow disagreement is evidence to examine, not
                # proof that hidden buyers/sellers must win.
                out['price_flow_disagreement']=m
    if model is not None:
        up=finite(model.get('up'));down=finite(model.get('down'))
        if up is not None and down is not None and up>=0 and down>=0:
            out['v21_frozen']=sign(up-down)
    return out

def prior_weights(state):
    a=(state or {}).get('log_weights',{})
    if not isinstance(a,dict):a={}
    return {name:max(-15.,min(15.,finite(a.get(name)) or 0.0)) for name in EXPERTS}

def choose(votes,weights):
    scores={name:math.exp(weights.get(name,0)) for name in EXPERTS}
    den=sum(scores[n] for n in EXPERTS if votes.get(n))
    if den<=0:return {'direction':0,'ensemble_score_not_probability':0.0,
                       'expert_agreement':0,'votes_used':0}
    score=sum(scores[n]*votes[n] for n in EXPERTS if votes.get(n))/den
    return {'direction':sign(score),'ensemble_score_not_probability':round(score,6),
            'expert_agreement':sum(votes.get(n)==sign(score) for n in EXPERTS
                if votes.get(n)),'votes_used':sum(bool(votes.get(n)) for n in EXPERTS)}

def update_weights(weights,votes,returns,cost_pct=COST_PCT):
    """Hedge expert updates only on a newly matured real later quote outcome."""
    w=dict(weights)
    for name in EXPERTS:
        side=votes.get(name,0)
        if side not in (-1,1):continue
        val=finite(returns.get(str(side)))
        if val is None:continue
        reward=max(-3.,min(3.,val-cost_pct))
        w[name]=max(-15.,min(15.,w.get(name,0)+LR*reward))
    # Constant shift keeps exp() stable without modifying relative priors.
    offset=max(w.values())
    return {n:round(w[n]-offset,9) for n in EXPERTS}

def evaluate_outcome(entry,future,issued,horizon,now,after_tolerance_ms=150_000):
    """An outcome exists only if the next real quote is at the target clock."""
    if not is_quote(entry) or not is_quote(future):return None
    if horizon not in HORIZONS:return None
    target=issued+horizon*MIN;at=future['at_ms']
    if not target<=at<=target+after_tolerance_ms or at>now or now-at>MIN:
        return None
    signed=quote_returns(entry,future)
    return {'horizon_min':horizon,'target_ms':target,'exit_quote':future,
      'signed_quote_returns':{k:round(v,7) for k,v in signed.items()},
      'both_sides_measured':True,'actual_fills_verified':False,
      'delay_ms':at-target}

def metrics(rows,horizon,venue,side):
    """Hour clustered bootstrap for all observations, not only model wins."""
    own=[r for r in rows if r.get('venue')==venue and str(horizon) in r.get('outcomes',{})
        and (venue=='bitget' or side==1)]
    chosen=[];last_by_symbol={}
    for r in sorted(own,key=lambda x:(x['issued_ms'],x['symbol'])):
        key=(r['symbol'],horizon)
        prior=last_by_symbol.get(key)
        if prior is not None and r['issued_ms']-prior<horizon*MIN:continue
        last_by_symbol[key]=r['issued_ms']
        ret=finite(r['outcomes'][str(horizon)].get('signed_quote_returns',{}).get(str(side)))
        if ret is not None:chosen.append((r,ret-COST_PCT))
    if not chosen:return {'count':0,'mean_net_pct':None,'net_win_rate':None,
      'hour_blocks':0,'lower_95_pct':None}
    vals=[x[1] for x in chosen]
    blocks=collections.defaultdict(list)
    for r,v in chosen:blocks[r['issued_ms']//3_600_000].append(v)
    lower=None
    if len(blocks)>=8:
        rng=random.Random(22011)
        combos=[(sum(x),len(x)) for x in blocks.values()]
        boot=[]
        for _ in range(800):
            sample=[rng.choice(combos) for _ in combos]
            boot.append(sum(z[0] for z in sample)/sum(z[1] for z in sample))
        lower=round(sorted(boot)[19],6)
    return {'count':len(vals),'mean_net_pct':round(statistics.fmean(vals),6),
       'net_win_rate':round(sum(x>0 for x in vals)/len(vals),5),
       'hour_blocks':len(blocks),'lower_95_pct':lower,
       'proxy_not_executable_trade':True,'cost_scenario_pct':COST_PCT}

def prequential_summary(rows,horizon,venue):
    """Evaluate fixed experts using their pre-issued votes, not hindsight rules."""
    out={}
    for expert in EXPERTS+('online_ensemble',):
        selected=[]
        for r in rows:
            if r.get('venue')!=venue:continue
            vote=(r.get('decisions',{}).get(str(horizon),{}).get('direction',0)
                  if expert=='online_ensemble' else
                  r.get('votes',{}).get(str(horizon),{}).get(expert,0))
            if vote not in (-1,1) or venue=='bithumb' and vote==-1:continue
            outcome=r.get('outcomes',{}).get(str(horizon))
            if not isinstance(outcome,dict):continue
            ret=finite(outcome.get('signed_quote_returns',{}).get(str(vote)))
            if ret is None:continue
            selected.append({**r,'outcomes':{str(horizon):{
              'signed_quote_returns':{str(vote):ret}}},'expert_side':vote})
        unique=[];last={}
        for r in sorted(selected,key=lambda x:(x['issued_ms'],x['symbol'])):
            before=last.get(r['symbol'])
            if before is not None and r['issued_ms']-before<horizon*MIN:continue
            last[r['symbol']]=r['issued_ms'];unique.append(r)
        net=[r['outcomes'][str(horizon)]['signed_quote_returns'][str(r['expert_side'])]-COST_PCT
             for r in unique]
        out[expert]={'n':len(net),'mean_net_pct':round(statistics.fmean(net),6) if net else None,
                    'net_win_count':sum(x>0 for x in net),'net_loss_count':sum(x<=0 for x in net)}
    return out
