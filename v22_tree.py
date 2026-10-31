"""Hourly shallow return-tree refresh from only fully observed public quotes.
Fixed model family, no parameter search, no network or trading effects.
"""
from __future__ import annotations
import copy,math
from v21_forecast_core import number
from v22_performance import return_prediction
POLICY='V22_HOURLY_SHALLOW_EXTRA_TREES_W24_H12_96_D4_L35_V1'

def mature_rows(rows,now):
    return [r for r in rows if isinstance(r.get('closed_ms'),int) and r['closed_ms']<=now
      and isinstance(r.get('issued_ms'),int) and now-24*3600000<=r['issued_ms']<r['closed_ms']
      and number(r.get('midpoint_return_pct')) is not None and isinstance(r.get('features'),dict)]

def export(model,names):
    trees=[]
    for estimator in model.estimators_:
        t=estimator.tree_;trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),
          'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'value':t.value[:,0,0].tolist()})
    return {'kind':'return_forest','features':names,'trees':trees}

def refresh(old,rows,now):
    state=copy.deepcopy(old or {});hour=now//3600000
    if state.get('last_fit_hour')==hour:return state
    samples=mature_rows(rows,now)
    # Training sample support for a 35-row minimum leaf, not a market-entry condition.
    if len(samples)<100:return state
    import numpy as np
    from sklearn.ensemble import ExtraTreesRegressor
    names=sorted(samples[0]['features'])
    X=np.asarray([[number(r['features'].get(k),0.) for k in names] for r in samples])
    y=np.clip([r['midpoint_return_pct'] for r in samples],-5,5)
    weight=np.asarray([math.exp(-math.log(2)*(now-r['closed_ms'])/(12*3600000)) for r in samples])
    model=ExtraTreesRegressor(n_estimators=96,max_depth=4,min_samples_leaf=35,max_features=.8,random_state=221101,n_jobs=2)
    model.fit(X,y,sample_weight=weight)
    state.update({'model':export(model,names),'last_fit_hour':hour,'fit_count':state.get('fit_count',0)+1,
       'training_rows':len(samples),'last_label_ms':max(r['closed_ms'] for r in samples),'policy':POLICY})
    return state

def forecast(state,features):
    if not state.get('model'):raise ValueError('V22_TREE_MODEL_MISSING')
    return return_prediction(state['model'],features)
