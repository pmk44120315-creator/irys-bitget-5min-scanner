"""Learn from existing as-of V22 market context; actual later bid/ask labels.
The model candidate set, chronological embargo and reserved-symbol rule are
identical to the first experiment. No search over held-out performance.
"""
import argparse,collections,hashlib,json,math,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research.v40_frozen_features import finite,time_split
from research.v40_direction_model import fit_preprocessor,transform,fit_candidates,predict_portable,choose,evaluate as base_evaluate,CANDIDATES
VERSION='V40_CONTEXT_DIRECTION_LEARNER_V1'

def evaluate(rows,p,venue):
    out=base_evaluate(rows,p,venue)
    out['direction_target']='ORIGINAL_MID_TO_ACTUAL_FUTURE_MID'
    return out

FIELDS=tuple('acceleration baseline_log baseline_missing book_ratio_log book_verified btc5 close_location close_location_missing eth5 flow_change flow_relative flow_verified flow_x_acceleration flow_x_price funding has_verified_local_cvd late_caution market_breadth market_context_missing market_median5 oi_delta p1 p15 p5 p5_abs p60 price_flow_disagreement prior_flow_bias range5 recent_flow_bias recent_flow_missing recent_trades_log recent_vs_full_turnover relative_to_market relative_volume15_log relative_volume5_log reversal_5_vs_15 sampled_2m_flow_available sampled_age_min sampled_book_log_ratio sampled_buy_bias sampled_net_signed_log sampled_recent_net_signed_log sampled_spread_pct snapshot_age_min spread_missing spread_pct turnover5_log turnover_log turnover_log_change turnover_x_price'.split())

def quote_valid(q):
    return isinstance(q,dict) and all(finite(q.get(k)) for k in ('bid','ask','at_ms')) and isinstance(q['at_ms'],int) and q['bid']>0 and q['ask']>=q['bid']

def signal_name(venue,p):
    return ('BUY' if p>=.5 else 'WAIT') if venue=='bithumb' else ('LONG' if p>=.5 else 'SHORT')

def context_label(e,h,asof):
    issue=e.get('issued_ms');a=e.get('entry_quote');o=e.get('outcomes',{}).get(str(h),{});b=o.get('exit_quote')
    if not isinstance(issue,int) or not quote_valid(a) or not 0<=issue-a['at_ms']<=60000:return None
    if h not in (5,15) or o.get('target_ms')!=issue+h*60000 or o.get('horizon_min')!=h:return None
    if o.get('both_sides_measured') is not True or o.get('actual_fills_verified') is not False or not quote_valid(b):return None
    if not issue+h*60000<=b['at_ms']<=min(asof,issue+h*60000+150000):return None
    mid=(a['ask']+a['bid'])/2;future=(b['ask']+b['bid'])/2;change=100*(future/mid-1)
    return {'direction':1 if change>1e-10 else -1 if change< -1e-10 else 0,
      'mid_to_future_mid_pct':change,'long_quote_proxy_pct':100*(b['bid']/a['ask']-1),
      'short_quote_proxy_pct':100*(a['bid']-b['ask'])/a['bid'],
      'label_available_ms':b['at_ms']+60000,'actual_execution_verified':False}

def prepare_rows(state,asof,h=5):
    events=state.get('completed',[])+state.get('pending',[]);fingerprints={};conflicts=set()
    key=lambda e:(e.get('venue'),e.get('symbol'),e.get('issued_ms'))
    for e in events:
        k=key(e);fp=json.dumps(e,sort_keys=True,separators=(',',':'))
        if k in fingerprints and fp!=fingerprints[k]:conflicts.add(k)
        else:fingerprints[k]=fp
    seen=set();rows=[];diagnostics={'input':len(events),'invalid':0,'duplicate':0,'conflicting_duplicate':0,'unmeasured':0}
    for e in events:
        k=key(e)
        if k in conflicts:diagnostics['conflicting_duplicate']+=1;continue
        if k in seen:diagnostics['duplicate']+=1;continue
        seen.add(k);t=e.get('issued_ms');q=e.get('entry_quote');v=e.get('venue');f=e.get('features')
        if e.get('shadow_only') is not True or v not in ('bitget','bithumb') or not isinstance(t,int) or t>asof or not quote_valid(q) or not 0<=t-q['at_ms']<=60000 or not isinstance(f,dict):
            diagnostics['invalid']+=1;continue
        fs={name:float(f[name]) if finite(f.get(name)) else None for name in FIELDS}
        if not f.get('flow_verified'):
            for name in ('prior_flow_bias','recent_flow_bias','flow_change','flow_relative','flow_x_acceleration','flow_x_price','price_flow_disagreement'):fs[name]=None
        if not f.get('book_verified'):fs['book_ratio_log']=None
        if f.get('market_context_missing'):
            for name in ('btc5','eth5','market_median5','market_breadth','relative_to_market'):fs[name]=None
        p5=f.get('p5');p15=f.get('p15')
        side=1 if v=='bithumb' else (1 if (p5 if finite(p5) and p5!=0 else p15 if finite(p15) else 0)>=0 else -1)
        fs['candidate_side']=float(side)
        lab=context_label(e,h,asof)
        if lab is None:diagnostics['unmeasured']+=1
        rows.append({'id':':'.join(map(str,k)),'venue':v,'symbol':e['symbol'],'issued_at_ms':t,'features':fs,'label':lab,
          'label_available_ms':lab['label_available_ms'] if lab else t+h*60000+210000,
          'existing_online_direction':e.get('decisions',{}).get(str(h),{}).get('direction')})
    return sorted(rows,key=lambda r:(r['issued_at_ms'],r['id'])),diagnostics

def bootstrap_lift(rows,p,baseline):
    groups=collections.defaultdict(list)
    for r,s,b in zip(rows,np.where(np.asarray(p)>=.5,1,-1),baseline):
        lab=r.get('label')
        if not lab or lab['direction']==0:continue
        groups[r['issued_at_ms']//3600000].append(int(s==lab['direction'])-int(b==lab['direction']))
    if len(groups)<2:return {'hour_blocks':len(groups),'ci95':None}
    stats=np.array([(sum(v),len(v)) for v in groups.values()]);rng=np.random.default_rng(714)
    index=rng.integers(0,len(stats),size=(2000,len(stats)))
    sampled=stats[index].sum(axis=1);vals=sampled[:,0]/sampled[:,1]
    return {'hour_blocks':len(groups),'ci95':[float(np.quantile(vals,.025)),float(np.quantile(vals,.975))],
      'caveat':'Hour-cluster bootstrap; small number of blocks and one-day scope, not proof of generalization.'}

def experiment(state,asof,h=5):
    rows,diagnostics=prepare_rows(state,asof,h);split=time_split(rows,60)
    report={'version':VERSION,'horizon_minutes':h,'asof_ms':asof,'data':diagnostics,
      'candidate_models':list(CANDIDATES),'validation_start_ms':split['cut_validation_ms'],'test_start_ms':split['cut_test_ms'],
      'embargo_minutes':60,'source':'EXISTING_AS_OF_V22_FEATURES_AND_LATER_REAL_PUBLIC_BID_ASK',
      'dataset_contamination_caveat':'Legacy features stored before outcomes by existing V22 runner; not individually re-downloaded original snapshots.',
      'actual_execution_verified':False,'independent_multi_day_efficacy_proven':False,'live_model_changed':False,'venues':{}}
    bundles={};predictions=[]
    for venue in ('bitget','bithumb'):
        reserved=lambda r:int(hashlib.sha256((venue+':'+r['symbol']).encode()).hexdigest()[:8],16)%5==0
        tr=[rows[i] for i in split['train'] if rows[i]['venue']==venue and not reserved(rows[i]) and rows[i]['label'] and rows[i]['label']['direction']!=0]
        va=[rows[i] for i in split['validation'] if rows[i]['venue']==venue and not reserved(rows[i]) and rows[i]['label'] and rows[i]['label']['direction']!=0]
        te=[rows[i] for i in split['test'] if rows[i]['venue']==venue]
        if not tr or not va or len({r['label']['direction'] for r in tr})!=2 or len({r['label']['direction'] for r in va})!=2:
            report['venues'][venue]={'status':'INSUFFICIENT_BLOCKS','train':len(tr),'validation':len(va),'test':len(te)};continue
        names=sorted(tr[0]['features'])
        mat=lambda rr:np.array([[r['features'].get(n) if r['features'].get(n) is not None else np.nan for n in names] for r in rr],dtype=float)
        pp=fit_preprocessor(mat(tr));models=fit_candidates(transform(mat(tr),pp),np.array([r['label']['direction'] for r in tr]))
        validation={name:evaluate(va,predict_portable(transform(mat(va),pp),b),venue) for name,(m,b) in models.items()}
        winner=choose(validation);_,bundle=models[winner]
        probs=predict_portable(transform(mat(te),pp),bundle);baseline=np.array([r['features']['candidate_side'] for r in te])
        majority=1 if sum(r['label']['direction']==1 for r in tr)>=len(tr)/2 else -1
        existing=[i for i,r in enumerate(te) if r['existing_online_direction'] in (-1,1)]
        unseen=[i for i,r in enumerate(te) if reserved(r)]
        rr=evaluate(te,probs,venue);rr['direction_target']='ORIGINAL_MID_TO_ACTUAL_FUTURE_MID'
        report['venues'][venue]={'status':'EVALUATED','selected':winner,'training':len(tr),'validation_cases':len(va),'validation':validation,'test':rr,
          'momentum_baseline':evaluate(te,(baseline==1).astype(float),venue),
          'train_majority':evaluate(te,np.full(len(te),1. if majority==1 else 0.),venue),
          'original_online_policy':evaluate([te[i] for i in existing],np.array([1. if te[i]['existing_online_direction']==1 else 0. for i in existing]),venue),
          'learner_on_online_cases':evaluate([te[i] for i in existing],probs[existing],venue),
          'reserved_symbol_test':evaluate([te[i] for i in unseen],probs[unseen],venue),
          'paired_accuracy_lift_ci':bootstrap_lift(te,probs,baseline),
          'live_approved':False,'reason':'TIME_HOLDOUT_NOT_MULTI_DAY_PROSPECTIVE_LIVE_PROOF'}
        bundles[venue]={'version':VERSION,'venue':venue,'features':names,'preprocessor':pp,'model':bundle,'name':winner,
          'train_max_issue_ms':max(r['issued_at_ms'] for r in tr),'train_max_label_ms':max(r['label_available_ms'] for r in tr),
          'selected_at_data_boundary_ms':split['cut_test_ms'],'live_approved':False,'score_calibrated':False}
        for r,p in zip(te,probs):predictions.append({'id':r['id'],'venue':venue,'symbol':r['symbol'],'issued_at_ms':r['issued_at_ms'],
          'p_up_uncalibrated':float(p),'prediction':signal_name(venue,p),'label':r['label'],
          'baseline_side':r['features']['candidate_side'],'online_side':r['existing_online_direction'],'reserved_symbol':reserved(r)})
    return report,bundles,predictions

def main():
    p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--out',required=True);p.add_argument('--asof-ms',type=int,required=True);a=p.parse_args()
    raw=Path(a.state).read_bytes();report,bundles,predictions=experiment(json.loads(raw),a.asof_ms)
    report['state_sha256']=hashlib.sha256(raw).hexdigest();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    for n,d in [('report.json',report),('models.json',bundles),('test_predictions.json',predictions)]: (out/n).write_text(json.dumps(d,indent=2,allow_nan=False))
    print('V40_CONTEXT_LEARNING',json.dumps({'data':report['data'],'venues':{k:{n:v.get(n) for n in ('status','selected','training','validation_cases','test','momentum_baseline','original_online_policy','learner_on_online_cases','train_majority','reserved_symbol_test','paired_accuracy_lift_ci')} for k,v in report['venues'].items()},'live_model_changed':False}))
if __name__=='__main__':main()
