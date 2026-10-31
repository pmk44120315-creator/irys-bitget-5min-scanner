"""Causal recursive least squares for expected percentage return, not win odds.
Only a fully observed later quote outcome can update coefficients. Parameters
are part of an immutable policy; each issued forecast retains its prior value.
Pure standard-library implementation, with no network/order/notification I/O.
"""
from __future__ import annotations
import copy,math
from v21_forecast_core import number
REGULARIZATION=30.
HALF_LIFE_MS=12*3600000
POLICY='V22_CAUSAL_RLS_RETURN_H12_A30_V1'

def initialize(seed):
    names=list(seed['features']);d=len(names)+1
    if not names or len(set(names))!=len(names):raise ValueError('V22_EMPTY_OR_DUPLICATE_FEATURES')
    for k in ('mean','scale','coef'):
        if len(seed[k])!=len(names) or any(number(v) is None for v in seed[k]):raise ValueError('V22_SEED_DIMENSION')
    if any(v<=0 for v in seed['scale']) or number(seed['intercept']) is None:raise ValueError('V22_SEED_SCALE')
    return {'policy':POLICY,'features':names,'mean':list(seed['mean']),'scale':list(seed['scale']),
            'weights':[float(seed['intercept'])]+list(seed['coef']),
            'covariance':[[1/REGULARIZATION if i==j else 0. for j in range(d)] for i in range(d)],
            'updates':0,'last_update_ms':None,'seen_outcomes':[],'absolute_error_ema':.5}

def vector(state,features):
    names=state['features']
    if state.get('policy')!=POLICY or len(state.get('weights',[]))!=len(names)+1:raise ValueError('V22_POLICY_STATE_MISMATCH')
    return [1.]+[max(-8.,min(8.,(number(features.get(k),0.)-m)/s))
                 for k,m,s in zip(names,state['mean'],state['scale'])]

def predict(state,features):
    result=sum(a*b for a,b in zip(vector(state,features),state['weights']))
    if not math.isfinite(result):raise ValueError('V22_NONFINITE_PREDICTION')
    return result

def update(state,features,return_pct,now_ms,label_known_ms,event_id):
    if (not isinstance(now_ms,int) or not isinstance(label_known_ms,int) or
        label_known_ms>now_ms or number(return_pct) is None or not isinstance(event_id,str)):
        raise ValueError('V22_UNOBSERVED_OR_INVALID_OUTCOME')
    if event_id in state.get('seen_outcomes',[]):return state
    s=copy.deepcopy(state);x=vector(s,features);d=len(x)
    if len(s['covariance'])!=d or any(len(row)!=d for row in s['covariance']):raise ValueError('V22_COVARIANCE_DIMENSION')
    elapsed=max(0,now_ms-(s.get('last_update_ms') or now_ms))
    forgetting=max(.25,math.exp(-math.log(2)*elapsed/HALF_LIFE_MS))
    p=[[v/forgetting for v in row] for row in s['covariance']]
    px=[sum(p[i][j]*x[j] for j in range(d)) for i in range(d)]
    denom=1.+sum(a*b for a,b in zip(x,px))
    if not math.isfinite(denom) or denom<=0:raise ValueError('V22_INVALID_COVARIANCE')
    prediction=sum(a*b for a,b in zip(s['weights'],x));residual=return_pct-prediction
    # Robust learning bounds outlier influence, but outcome accounting retains full actual return.
    cap=max(.5,3*float(s.get('absolute_error_ema',.5)))
    robust=max(-cap,min(cap,residual));gain=[v/denom for v in px]
    s['weights']=[w+k*robust for w,k in zip(s['weights'],gain)]
    nextp=[[p[i][j]-px[i]*px[j]/denom for j in range(d)] for i in range(d)]
    for i in range(d):
        nextp[i][i]=max(1e-12,nextp[i][i])
        for j in range(i):nextp[i][j]=nextp[j][i]=(nextp[i][j]+nextp[j][i])/2
    if any(not math.isfinite(v) for row in nextp for v in row):raise ValueError('V22_NUMERIC_UPDATE_FAILURE')
    s['covariance']=nextp;s['updates']+=1;s['last_update_ms']=now_ms
    s['absolute_error_ema']=.98*s['absolute_error_ema']+.02*min(10.,abs(residual))
    s['seen_outcomes']=(s.get('seen_outcomes',[])+[event_id])[-8000:]
    return s
