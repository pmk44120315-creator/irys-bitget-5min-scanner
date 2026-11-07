"""Actual supervised direction learner, not a replacement for live V35.1.
Predeclared low-complexity candidates, past-only preprocessing, embargoed
validation selection, untouched final period, reserved-symbol generalization.
No model is automatically promoted. Portable JSON inference avoids pickle.
"""
import argparse,hashlib,json,math,time,sys
from pathlib import Path
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import balanced_accuracy_score,log_loss,brier_score_loss
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research.v40_frozen_features import labels,time_split,finite
VERSION='V40_FROZEN_DIRECTION_LEARNER_V1'
CANDIDATES=('ridge_0.03','ridge_0.3','ridge_3','forest_depth3')

def fit_preprocessor(x):
    x=np.asarray(x,dtype=float)
    if x.ndim!=2 or not len(x):raise ValueError('EMPTY_TRAINING_FEATURES')
    med=[];low=[];high=[]
    for j in range(x.shape[1]):
        observed=x[np.isfinite(x[:,j]),j]
        med.append(float(np.median(observed)) if len(observed) else 0.)
        low.append(float(np.quantile(observed,.01)) if len(observed) else 0.)
        high.append(float(np.quantile(observed,.99)) if len(observed) else 0.)
    imputed=np.where(np.isfinite(x),x,med);imputed=np.clip(imputed,low,high)
    scale=imputed.std(axis=0);scale=np.where(scale>1e-12,scale,1.)
    return {'median':med,'lower':low,'upper':high,'center':imputed.mean(axis=0).tolist(),'scale':scale.tolist()}

def transform(x,p):
    x=np.asarray(x,dtype=float);missing=~np.isfinite(x)
    v=np.where(missing,p['median'],x);v=np.clip(v,p['lower'],p['upper'])
    return np.concatenate([(v-p['center'])/p['scale'],missing.astype(float)],axis=1)

def fit_candidates(x,y):
    result={}
    for name in CANDIDATES:
        if name.startswith('ridge'):
            model=LogisticRegression(C=float(name.split('_')[1]),solver='lbfgs',max_iter=3000,random_state=714)
        else:model=RandomForestClassifier(n_estimators=128,max_depth=3,min_samples_leaf=20,max_features=.7,random_state=714,n_jobs=1)
        model.fit(x,y)
        if len(model.classes_)!=2 or list(model.classes_)!=[-1,1]:raise ValueError('TWO_DIRECTIONS_REQUIRED')
        if name.startswith('ridge'):
            bundle={'kind':'logistic','coefficients':model.coef_[0].tolist(),'intercept':float(model.intercept_[0])}
        else:
            trees=[]
            for estimator in model.estimators_:
                t=estimator.tree_;v=t.value[:,0,:];den=v.sum(axis=1)
                trees.append({'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),
                              'left':t.children_left.tolist(),'right':t.children_right.tolist(),
                              'p_up':(v[:,1]/np.where(den>0,den,1.)).tolist()})
            bundle={'kind':'forest','trees':trees}
        result[name]=(model,bundle)
    return result

def predict_portable(x,bundle):
    x=np.asarray(x,dtype=float)
    if x.ndim!=2 or not np.isfinite(x).all():raise ValueError('FINITE_TRANSFORMED_FEATURES_REQUIRED')
    if bundle['kind']=='logistic':
        z=np.clip(x@np.asarray(bundle['coefficients'])+bundle['intercept'],-700,700)
        return 1/(1+np.exp(-z))
    if bundle['kind']!='forest':raise ValueError('UNKNOWN_MODEL')
    out=np.zeros(len(x))
    for tree in bundle['trees']:
        for i,row in enumerate(x):
            node=0
            while tree['left'][node]!=-1:
                node=tree['left'][node] if row[tree['feature'][node]]<=tree['threshold'][node] else tree['right'][node]
            out[i]+=tree['p_up'][node]
    return out/len(bundle['trees'])

def choose(validation):
    if not validation:raise ValueError('NO_CANDIDATES')
    return min(validation,key=lambda k:(-validation[k]['balanced_accuracy'],validation[k]['logloss'],k))

def evaluate(rows,probability,venue):
    ps=np.asarray(probability);pred=np.where(ps>=.5,1,-1)
    measured=[];flat=unknown=0;proxy=[];base_proxy=[];signals=0;wins=0
    for i,(r,p) in enumerate(zip(rows,pred)):
        label=r.get('label')
        signal=venue=='bitget' or p==1
        signals+=int(signal)
        if label is None:unknown+=1;continue
        if label['direction']==0:flat+=1
        else:measured.append(i)
        if signal:
            v=label['long_quote_proxy_pct'] if p==1 else label['short_quote_proxy_pct']
            proxy.append(v);wins+=int(v>0)
            b=r['features']['candidate_side']
            base_proxy.append(label['long_quote_proxy_pct'] if b==1 else label['short_quote_proxy_pct'])
    y=np.array([rows[i]['label']['direction'] for i in measured]);pr=pred[measured]
    base=np.array([rows[i]['features']['candidate_side'] for i in measured])
    return {'cases':len(rows),'direction_measured':len(measured),'flat':flat,'unmeasured':unknown,
      'correct':int(np.sum(pr==y)),'wrong':int(np.sum(pr!=y)),
      'accuracy':float(np.mean(pr==y)) if len(y) else None,
      'balanced_accuracy':float(balanced_accuracy_score(y,pr)) if len(set(y))==2 else None,
      'baseline_correct_same_cases':int(np.sum(base==y)),
      'baseline_accuracy_same_cases':float(np.mean(base==y)) if len(y) else None,
      'entry_signals':signals,'measured_entry_signals':len(proxy),'quote_proxy_positive':wins,
      'mean_quote_proxy_pct':float(np.mean(proxy)) if proxy else None,
      'mean_baseline_quote_proxy_same_entries_pct':float(np.mean(base_proxy)) if base_proxy else None,
      'mean_after_assumed_0_20pct_cost':float(np.mean(proxy)-.2) if proxy else None,
      'logloss':float(log_loss(y,np.clip(ps[measured],1e-9,1-1e-9),labels=[-1,1])) if len(y) else None,
      'brier':float(brier_score_loss((y==1).astype(int),ps[measured])) if len(y) else None,
      'distinct_symbols':len({r['symbol'] for r in rows}),
      'distinct_30m_blocks':len({r['issued_at_ms']//1800000 for r in rows}),
      'direction_target':'FROZEN_MID_TO_FUTURE_CLOSED_TRADE_PRICE_PROXY',
      'quote_return_is_not_execution':True,'score_is_not_calibrated_probability':True}

def experiment(feature_doc,state,asof,horizon=5):
    by={e['id']:e for e in state['events']};rows=[]
    for r in feature_doc['records']:
        e=by.get(r['id'])
        if not e or e['issued_at_ms']!=r['issued_at_ms'] or r['source_commit_time_ms']>e['issued_at_ms']:continue
        row={**r,'label':labels(e,horizon,asof),'label_available_ms':e['issued_at_ms']+(horizon+1)*60000}
        rows.append(row)
    rows.sort(key=lambda r:(r['issued_at_ms'],r['id']))
    parts=time_split(rows,60)
    names=sorted(rows[0]['features'])
    report={'version':VERSION,'horizon_minutes':horizon,'asof_ms':asof,'features':names,'candidate_models':list(CANDIDATES),
      'eligible_events':feature_doc['eligible_events'],'recovered_events':len(rows),'recovery_errors':feature_doc['errors'],
      'validation_start_ms':parts['cut_validation_ms'],'test_start_ms':parts['cut_test_ms'],'embargo_minutes':60,
      'price_direction_definition':'Sign of future closed-trade-bar price minus frozen quote midpoint; NOT future midpoint or fills',
      'live_model_changed':False,'telegram_sent':False,'orders_sent':False,'auto_promote':False,
      'independent_multi_day_efficacy_proven':False,'venues':{}}
    bundles={};predictions=[]
    for venue in ('bitget','bithumb'):
        reserved=lambda r:int(hashlib.sha256((venue+':'+r['symbol']).encode()).hexdigest()[:8],16)%5==0
        tr=[rows[i] for i in parts['train'] if rows[i]['venue']==venue and not reserved(rows[i]) and rows[i]['label'] and rows[i]['label']['direction']!=0]
        va=[rows[i] for i in parts['validation'] if rows[i]['venue']==venue and not reserved(rows[i]) and rows[i]['label'] and rows[i]['label']['direction']!=0]
        te=[rows[i] for i in parts['test'] if rows[i]['venue']==venue]
        if not tr or not va or len({r['label']['direction'] for r in tr})<2 or len({r['label']['direction'] for r in va})<2:
            report['venues'][venue]={'status':'INSUFFICIENT_SEPARATE_DIRECTIONAL_BLOCKS','train':len(tr),'validation':len(va),'test':len(te)};continue
        matrix=lambda rr:np.array([[r['features'][name] if r['features'][name] is not None else np.nan for name in names] for r in rr],dtype=float)
        pp=fit_preprocessor(matrix(tr));tx=transform(matrix(tr),pp);vx=transform(matrix(va),pp)
        models=fit_candidates(tx,np.array([r['label']['direction'] for r in tr]))
        validation={name:evaluate(va,predict_portable(vx,b),venue) for name,(m,b) in models.items()}
        selected=choose(validation);model,bundle=models[selected]
        test_probability=predict_portable(transform(matrix(te),pp),bundle)
        test_metrics=evaluate(te,test_probability,venue)
        base_probability=np.array([1. if r['features']['candidate_side']==1 else 0. for r in te])
        majority=1. if np.mean([r['label']['direction']==1 for r in tr])>=.5 else 0.
        unseen=[i for i,r in enumerate(te) if reserved(r)]
        report['venues'][venue]={'status':'EVALUATED','selected_by_validation_only':selected,'training_cases':len(tr),'validation_cases':len(va),
          'train_label_latest_ms':max(r['label_available_ms'] for r in tr),'validation':validation,
          'test':test_metrics,'baseline_test':evaluate(te,base_probability,venue),
          'train_majority_test':evaluate(te,np.full(len(te),majority),venue),
          'symbol_reserved_test':evaluate([te[i] for i in unseen],test_probability[unseen],venue),
          'qualified_for_live_promotion':False,
          'promotion_reason':'ONE_DAY_BACKTEST_AND_UNVERIFIED_EXECUTION_NOT_SUFFICIENT_FOR_LIVE_CLAIM'}
        bundles[venue]={'version':VERSION,'venue':venue,'features':names,'preprocessor':pp,'model':bundle,'name':selected,
          'train_max_issue_ms':max(r['issued_at_ms'] for r in tr),'train_max_label_ms':max(r['label_available_ms'] for r in tr),
          'validation_selection_cutoff_ms':parts['cut_test_ms'],'model_selected_without_test_outcomes':True,
          'live_approved':False,'score_calibrated':False}
        for r,p in zip(te,test_probability):predictions.append({'id':r['id'],'venue':venue,'issued_at_ms':r['issued_at_ms'],'symbol':r['symbol'],
          'p_up_uncalibrated':float(p),'prediction':('BUY' if p>=.5 else 'WAIT') if venue=='bithumb' else ('LONG' if p>=.5 else 'SHORT'),
          'label':r['label'],'baseline_side':r['features']['candidate_side'],'reserved_symbol':reserved(r)})
    return report,bundles,predictions

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--features',required=True);ap.add_argument('--state',required=True);ap.add_argument('--out',required=True);ap.add_argument('--asof-ms',type=int,required=True);a=ap.parse_args()
    fb=Path(a.features).read_bytes();sb=Path(a.state).read_bytes();doc=json.loads(fb);state=json.loads(sb)
    if hashlib.sha256(sb).hexdigest()!=doc['state_sha256']:raise ValueError('SOURCE_STATE_HASH_MISMATCH')
    report,bundles,predictions=experiment(doc,state,a.asof_ms,5)
    report['feature_sha256']=hashlib.sha256(fb).hexdigest();report['state_sha256']=hashlib.sha256(sb).hexdigest()
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    for name,obj in [('report.json',report),('models.json',bundles),('test_predictions.json',predictions)]:
        (out/name).write_text(json.dumps(obj,indent=2,allow_nan=False))
    print('V40_DIRECTION_LEARNING',json.dumps({'version':VERSION,'eligible':report['eligible_events'],'recovered':report['recovered_events'],
      'venues':{k:{key:v.get(key) for key in ('status','selected_by_validation_only','training_cases','validation_cases','test','baseline_test','train_majority_test','symbol_reserved_test')} for k,v in report['venues'].items()},'live_model_changed':False},allow_nan=False))
if __name__=='__main__':main()
