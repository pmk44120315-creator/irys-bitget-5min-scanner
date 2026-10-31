"""V22 cost-aware forward return primitives. Pure functions, no external effects.
Scores are expected percentage price changes, NEVER calibrated win probabilities.
Labels explicitly exclude delayed-entry targets that differ from the live horizon.
"""
from __future__ import annotations
import math
from v21_forecast_core import forward_label, number

SOURCE_FEATURES=frozenset('acceleration book_ratio_log book_verified btc5 close_location close_location_missing eth5 flow_change flow_relative flow_verified flow_x_acceleration flow_x_price funding market_breadth market_context_missing market_median5 oi_delta p1 p15 p5 p60 price_flow_disagreement prior_flow_bias range5 recent_flow_bias recent_flow_missing recent_trades_log recent_vs_full_turnover relative_to_market relative_volume15_log relative_volume5_log reversal_5_vs_15 snapshot_age_min spread_missing spread_pct turnover5_log baseline_log baseline_missing has_verified_local_cvd late_caution p5_abs sampled_2m_flow_available sampled_age_min sampled_book_log_ratio sampled_buy_bias sampled_net_signed_log sampled_recent_net_signed_log sampled_spread_pct turnover_log turnover_log_change turnover_x_price'.split())

def enrich(features):
    """Preserve known measured/missingness fields; exclude all outcome fields."""
    out={k:number(v,0.) for k,v in features.items() if k in SOURCE_FEATURES}
    p=number(out.get('p5'),0.)
    scale=max(.1,abs(number(out.get('range5'),abs(p))))
    clamp=lambda v:max(-5.,min(5.,v))
    bias=number(out.get('recent_flow_bias'),number(out.get('sampled_buy_bias'),0.))
    out.update({
        'normalized_move':clamp(p/scale),
        'normalized_acceleration':clamp(number(out.get('acceleration'),0.)/scale),
        'price_flow_efficiency':clamp(p/scale)*bias,
        'price_flow_change':clamp(p/scale)*number(out.get('flow_change'),0.),
        'relative_move_normalized':clamp(number(out.get('relative_to_market'),p)/scale),
        'price_location_interaction':clamp(p/scale)*(2*number(out.get('close_location'),.5)-1),
        'oi_price_response':clamp(number(out.get('oi_delta'),0.))*clamp(p/scale),
    })
    return out

def aligned_label(tape,issued_ms,horizon_min):
    """Next recorded close within 60s; target measured from that same close.
    It remains a price proxy, not execution. Strict tolerance reduces the old
    up-to-10-minute training/live horizon mismatch without fabricating prices.
    """
    return forward_label(tape,issued_ms,horizon_min,max_entry_delay_min=1)

def regression_export_valid(model):
    if not isinstance(model,dict):return False
    try:
        names=model['features']
        if not names or len(set(names))!=len(names) or not all(isinstance(k,str) for k in names):return False
        if model['kind']=='return_ridge':
            arrays=[model[k] for k in ('mean','scale','coef')]
            if any(len(a)!=len(names) for a in arrays):return False
            return all(number(x) is not None for a in arrays for x in a) and all(x>0 for x in arrays[1]) and number(model['intercept']) is not None
        if model['kind']!='return_forest' or not model.get('trees'):return False
        for t in model['trees']:
            count=len(t['left'])
            if count<1 or any(len(t[k])!=count for k in ('right','feature','threshold','value')):return False
            if any(number(v) is None for k in ('threshold','value') for v in t[k]):return False
            for i,l in enumerate(t['left']):
                r=t['right'][i]
                if l==-1 and r==-1:continue
                if not (isinstance(l,int) and isinstance(r,int) and 0<=l<count and 0<=r<count and 0<=t['feature'][i]<len(names)):return False
        return True
    except (KeyError,TypeError,ValueError,OverflowError):return False

def return_prediction(model,features):
    if not regression_export_valid(model):raise ValueError('V22_MODEL_SCHEMA')
    x=[number(features.get(k),0.) for k in model['features']]
    if model['kind']=='return_ridge':
        return float(model['intercept']+sum(w*(v-m)/s for w,v,m,s in zip(model['coef'],x,model['mean'],model['scale'])))
    predicted=[]
    for tree in model['trees']:
        node=0;visited=set()
        while tree['left'][node]!=-1:
            if node in visited:raise ValueError('V22_TREE_CYCLE')
            visited.add(node)
            node=tree['left'][node] if x[tree['feature'][node]]<=tree['threshold'][node] else tree['right'][node]
        predicted.append(tree['value'][node])
    return sum(predicted)/len(predicted)

def decide(expected_return_pct,venue,cost_pct,spread_pct,margin_pct=0.):
    values=[number(v) for v in (expected_return_pct,cost_pct,spread_pct,margin_pct)]
    base={'side':0,'expected_net_pct':None,'expected_gross_pct':values[0],
          'score_is_win_probability':False}
    if venue not in ('bitget','bithumb') or any(v is None for v in values) or any(v<0 for v in values[1:]):
        return {**base,'reason':'INVALID_PRICE_COST_OR_MODEL_VALUE'}
    expected,cost,spread,margin=values
    if venue=='bithumb' and expected<=0:return {**base,'reason':'SPOT_DOWN_NOT_BUY'}
    net=abs(expected)-cost-spread
    if net<=margin:return {**base,'expected_net_pct':net,'reason':'EXPECTED_MOVE_BELOW_COSTS'}
    return {**base,'side':1 if expected>0 else -1,'expected_net_pct':net,
            'reason':'POSITIVE_ESTIMATED_EDGE_REQUIRES_FORWARD_VALIDATION'}
