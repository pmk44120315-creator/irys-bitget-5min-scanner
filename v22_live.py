"""V22 complete-candidate quote learning and causal adaptive return forecasts.
Every valid candidate is measured, including abstentions and previous mistakes.
Telegram qualification uses separate future performance, not training success.
No account/trading/Telegram credentials are read or used by this program.
"""
from __future__ import annotations
import copy,datetime as dt,hashlib,json,pathlib,time
from v21_forecast_core import number
from v21_runtime import current_features,fetch_quotes,valid_quote,quote_return,certificate
from v21_clock import align_validation_clock
from v22_performance import enrich,decide
from v22_learning import initialize,predict,update,POLICY
from v22_tree import refresh as refresh_tree,forecast as forecast_tree,POLICY as TREE_POLICY
MIN=60000;COST=.20
ROOT=pathlib.Path(__file__).resolve().parent;DATA=ROOT/'data'
BUNDLE=ROOT/'research/v22_results/seeds.json'

def policy_hash(bundle):
    return hashlib.sha256(json.dumps({'seeds':bundle,'algorithm':POLICY,
        'tree_algorithm':TREE_POLICY,'features':'V22_ENRICH_V1','cost_scenario_pct':COST,'decision_margin':0.},sort_keys=True,separators=(',',':')).encode()).hexdigest()

def fresh(q,now):
    return valid_quote(q) and not isinstance(q['at_ms'],bool) and 0<=now-q['at_ms']<=MIN

def process(rows,quotes,old,bundle,now):
    if not isinstance(bundle,dict) or not bundle:raise ValueError('V22_MISSING_SEEDS')
    pid=policy_hash(bundle);reset=bool(old and old.get('policy_sha256')!=pid)
    state=copy.deepcopy(old or {}) if not reset else {}
    learners=state.get('learners') or {}
    for key,seed in bundle.items():
        if seed.get('venue') not in ('bitget','bithumb') or seed.get('horizon_min') not in (5,15):
            raise ValueError('V22_INVALID_VENUE_HORIZON')
        if seed.get('kind')!='hourly_tree' and key not in learners:learners[key]=initialize(seed)
    remaining=[];completed=list(state.get('completed') or []);unmeasured=list(state.get('unmeasured') or [])
    validation=list(state.get('validation') or [])
    tree_training=list(state.get('tree_training') or [])
    trees=dict(state.get('trees') or {})
    new_labels=0
    for r in state.get('pending') or []:
        key=r['model_key']
        if key not in bundle:continue
        target=r['issued_ms']+r['horizon_min']*MIN
        q=quotes.get((r['venue'],r['symbol']))
        if fresh(q,now) and target<=q['at_ms']<=target+150000:
            up=quote_return(r['entry_quote'],q,1);down=quote_return(r['entry_quote'],q,-1)
            midpoint=100*((q['bid']+q['ask'])/(r['entry_quote']['bid']+r['entry_quote']['ask'])-1)
            if bundle[key].get('kind')!='hourly_tree':
                learners[key]=update(learners[key],r['features'],midpoint,now,q['at_ms'],r['event_id'])
            signed=up if r['side']==1 else down if r['side']==-1 else 0.
            observed={**r,'closed_ms':q['at_ms'],'up_quote_return_pct':up,
                'down_quote_return_pct':down,'signed_quote_return_pct':signed,
                'ret':signed*r['side'],'midpoint_return_pct':midpoint,'exit_quote':q,
                'quote_based_not_execution':True}
            compact={k:v for k,v in observed.items() if k!='features'}
            compact['feature_sha256']=hashlib.sha256(json.dumps(r['features'],sort_keys=True).encode()).hexdigest()
            completed.append(compact)
            if r['side'] in (-1,1):validation.append(compact)
            if bundle[key].get('kind')=='hourly_tree':tree_training.append(observed)
            new_labels+=1
        elif now>target+150000:
            unmeasured.append({k:r[k] for k in ('model_key','side','issued_ms','event_id','symbol')})
        else:remaining.append(r)
    # Working window only; complete old records remain in immutable Git history.
    completed=completed[-1000:]
    validation=[r for r in validation if now-r['issued_ms']<=7*24*3600000]
    unmeasured=[r for r in unmeasured if now-r['issued_ms']<=7*24*3600000]
    tree_training=[r for r in tree_training if now-r['issued_ms']<=24*3600000]
    for key,seed in bundle.items():
        if seed.get('kind')=='hourly_tree':
            initial=trees.get(key) or {'model':seed['tree_model'],'fit_count':0}
            trees[key]=refresh_tree(initial,[r for r in tree_training if r['model_key']==key],now)
    certificates={}
    for key,seed in bundle.items():
        own=[r for r in validation if r['model_key']==key and r['side'] in (-1,1)]
        certificates[key]={str(s):certificate(own,seed['venue'],seed['horizon_min'],s,
           unmeasured=sum(r['model_key']==key and r['side']==s for r in unmeasured))
           for s in ((1,-1) if seed['venue']=='bitget' else (1,))}
        for proof in certificates[key].values():
            proof['evidence_type']='CAUSAL_PREQUENTIAL_ADAPTIVE_POLICY_QUOTE_RETURNS'
            proof['policy_sha256']=pid
            proof['model_weights_adapt_only_after_observed_outcomes']=True
    seen=dict(state.get('last_registered') or {});open_ids={(r['model_key'],r['symbol']) for r in remaining}
    registered=0;rejected_quotes=0;forecasts=[];deliverable=[];abstentions={}
    for row in rows:
      features=enrich(row['features'])
      for key,seed in bundle.items():
        if row['venue']!=seed['venue']:continue
        pair=(key,row['symbol']);identity=key+':'+row['symbol']
        if pair in open_ids or now-number(seen.get(identity),0)<seed['horizon_min']*MIN:continue
        q=quotes.get((row['venue'],row['symbol']))
        if not fresh(q,now):rejected_quotes+=1;continue
        predicted=forecast_tree(trees[key],features) if seed.get('kind')=='hourly_tree' else predict(learners[key],features)
        spread=100*(q['ask']/q['bid']-1)
        d=decide(predicted,row['venue'],COST,spread,0.)
        if seed.get('forecast_enabled') is False:d={**d,'side':0,'reason':'COMPARISON_MODEL_NOT_SELECTED'}
        event_id=hashlib.sha256((pid+':'+key+':'+row['symbol']+':'+str(now)).encode()).hexdigest()[:24]
        r={'event_id':event_id,'model_key':key,'model_sha256':pid,'venue':row['venue'],'symbol':row['symbol'],
           'side':d['side'],'issued_ms':now,'horizon_min':seed['horizon_min'],'entry_quote':q,
           'features':features,'expected_gross_pct':predicted,'expected_net_pct':d['expected_net_pct'],
           'learning_updates_before_prediction':trees[key].get('fit_count',0) if seed.get('kind')=='hourly_tree' else learners[key]['updates']}
        remaining.append(r);registered+=1;seen[identity]=now;open_ids.add(pair)
        if not d['side']:
            abstentions[d['reason']]=abstentions.get(d['reason'],0)+1;continue
        proof=certificates[key][str(d['side'])]
        f={k:v for k,v in r.items() if k!='features'}
        f.update({'expires_ms':now+seed['horizon_min']*MIN,'certificate':proof,
                  'notification_eligible':proof['ready'],'reason':proof['reason'],
                  'algorithm':TREE_POLICY if seed.get('kind')=='hourly_tree' else POLICY,'model_score_is_probability':False,'telegram_sent':False,'automatic_order':False})
        forecasts.append(f)
        if proof['ready']:deliverable.append(f)
    state.update({'policy_sha256':pid,'learners':learners,'trees':trees,'tree_training':tree_training,
                  'validation':validation,'total_completed':state.get('total_completed',0)+new_labels,
                  'pending':remaining,'completed':completed,
                  'unmeasured':unmeasured,'last_registered':seen})
    report={'version':'IRYS_V22_CAUSAL_ADAPTIVE_V1','status':'ACTIVE','at_utc':dt.datetime.fromtimestamp(now/1000,dt.timezone.utc).isoformat(),
       'policy_sha256':pid,'policy_reset':reset,'registered_examples':registered,
       'new_training_examples':new_labels,'completed_examples':state['total_completed'],'pending_count':len(remaining),
       'directional_predictions':len(forecasts),'forecasts':forecasts,'delivery_candidates':deliverable,
       'entry_quote_rejections':rejected_quotes,'abstention_reasons':abstentions,
       'unmeasured_outcomes':len(unmeasured),'certificates':certificates,
       'learner_updates':{k:v['updates'] for k,v in learners.items()},
       'tree_refits':{k:v.get('fit_count',0) for k,v in trees.items()},'cost_scenario_pct':COST,
       'full_candidate_labels_not_only_selected_signals':True,'actual_execution_verified':False,
       'higher_forecast_accuracy_verified':False,'no_orders':True,'telegram_sent':False}
    return report,state

def load(path):
    try:
        value=json.loads(path.read_text(encoding='utf8'))
        if not isinstance(value,dict):raise ValueError('V22_JSON_OBJECT_REQUIRED')
        return value
    except FileNotFoundError:return {}

def main():
    import collector
    now=int(time.time()*1000);old=load(DATA/'v22_state.json')
    now,waited=align_validation_clock(old.get('pending') or [],now)
    market=load(DATA/'latest.json');flow=load(DATA/'v18_evidence_latest.json');market_state=load(DATA/'state.json')
    rows,previous,source_status=current_features(market,flow,market_state,old.get('previous_prices') or {},now)
    pairs={(r['venue'],r['symbol']) for r in rows+list(old.get('pending') or [])}
    quotes,errors=fetch_quotes(pairs,collector.http_json,now);finished=max(now,int(time.time()*1000))
    report,state=process(rows,quotes,old,load(BUNDLE),finished)
    if source_status=='PASS':state['previous_prices']=previous
    report.update({'source_status':source_status,'source_finished_utc':market.get('finished_utc'),
                   'quote_errors':errors,'quote_markets_available':len(quotes),'validation_clock_wait_ms':waited})
    if source_status!='PASS':report['status']='SOURCE_NOT_READY'
    elif pairs and not quotes:report['status']='QUOTE_FEED_UNAVAILABLE'
    collector.write_json_atomic(DATA/'v22_latest.json',report)
    collector.write_json_atomic(DATA/'v22_state.json',state)
    print('V22_LIVE_PERFORMANCE',json.dumps({k:report[k] for k in (
         'status','source_status','registered_examples','new_training_examples','completed_examples',
         'pending_count','directional_predictions','learner_updates','quote_errors')},ensure_ascii=False))
    return 0 if report['status']=='ACTIVE' else 2
if __name__=='__main__':raise SystemExit(main())
