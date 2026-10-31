#!/usr/bin/env python3
"""V21 actual supervised forecast study. Isolated public-market Git history.
No exchange orders/Telegram/Cloudflare mutation. Pins the archival source SHA.
Runs a small declared model family ONCE; final test never selects a model.
All metrics are completed-price proxies, not fill-level realized profit.
"""
from __future__ import annotations
import bisect, collections, datetime as dt, hashlib, json, math, os, pathlib, statistics, subprocess, sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from v21_forecast_core import (futures_features,spot_features,forward_label,
    temporal_partition,evaluate_predictions,number,sign,clip,logpos)

MIN=60000
PIN=os.environ.get('V21_ARCHIVE_REF','e240a447a9c5ea3b034c5e6f9549bd2d80276f0c')
OUT=pathlib.Path(os.environ.get('V21_OUTPUT','/tmp/irys-v21'))
COST=.20  # disclosed scenario, NOT the user's actual account fee or slippage
THRESHOLDS=(.50,.60,.70)

def git(*args):
    p=subprocess.run(['git',*args],capture_output=True,check=True)
    return p.stdout.decode('utf8')

def ms(s):
    try:return int(dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp()*1000)
    except (ValueError,TypeError):return None

class Blobs:
    def __init__(self):
        self.p=subprocess.Popen(['git','cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    def get(self,sha,path):
        self.p.stdin.write((sha+':'+path+'\n').encode());self.p.stdin.flush()
        header=self.p.stdout.readline().decode().strip().split()
        if len(header)!=3 or header[-1]=='missing':return None
        size=int(header[2]);body=self.p.stdout.read(size);self.p.stdout.read(1)
        try:return json.loads(body)
        except (ValueError,UnicodeError):return None
    def close(self):
        self.p.stdin.close();self.p.wait()

def history(path):
    return [(s.split()[0],int(s.split()[1])*1000+1000) for s in
      git('log',PIN,'--format=%H %ct','--',path).splitlines()][::-1]

def spot_tape_label(tape,issued,h):
    if not tape:return None
    times=[r[0] for r in tape];i=bisect.bisect_right(times,issued)
    if i>=len(tape) or times[i]-issued>10*MIN:return None
    at,p,k=tape[i];target=at+h*MIN;j=bisect.bisect_left(times,target)
    # Irregular ticker timestamps are disclosed as approximate labels, never candles.
    options=[q for q in (j-1,j) if i<q<len(tape) and abs(times[q]-target)<=150000]
    if not options:return None
    z=min(options,key=lambda q:abs(times[q]-target));t1,p1,k1=tape[z]
    if p<=0 or p1<=0:return None
    return {'entry_ms':at,'future_ms':t1,'available_ms':max(k,k1),
      'entry_delay_ms':at-issued,'return_pct':100*(p1/p-1),
      'future_timing_error_ms':t1-target,'actual_execution_verified':False}

def context(prices,previous):
    rets={}
    for sym,p in prices.items():
        old=previous.get(sym)
        if old and 3*MIN<=p[0]-old[0]<=8*MIN and old[1]>0:
            rets[sym]=100*(p[1]/old[1]-1)
    vals=list(rets.values())
    return {'market_median5':statistics.median(vals) if vals else 0,
       'market_breadth':sum(v>0 for v in vals)/len(vals) if vals else .5,
       'btc5':rets.get('BTCUSDT',0),'eth5':rets.get('ETHUSDT',0),
       'market_context_missing':int(not vals)}

def spot_sample_features(state,symbol,now):
    sample=((state.get('spot_direction_tracking_v13') or {}).get(symbol) or {}).get('sample') or {}
    time=number(sample.get('time_ms'));share=number(sample.get('buy_share'))
    ok=time is not None and 0<=now-time<=9*MIN and share is not None and 0<=share<=1
    book=sample.get('book') or {};ratio=number(book.get('bid_ask_top5_ratio'))
    net=number(sample.get('net_buy_krw'),0);recent=number(sample.get('recent_net_buy_krw'),0)
    return {'sampled_2m_flow_available':int(ok),'sampled_buy_bias':2*share-1 if ok else 0,
      'sampled_net_signed_log':sign(net)*logpos(abs(net)) if ok else 0,
      'sampled_recent_net_signed_log':sign(recent)*logpos(abs(recent)) if ok else 0,
      'sampled_book_log_ratio':math.log(ratio) if ok and ratio and ratio>0 else 0,
      'sampled_spread_pct':number(book.get('spread_pct'),0) if ok else 0,
      'sampled_age_min':(now-time)/MIN if ok else 0}

def archive():
    b=Blobs();price_versions=history('data/latest.json');flow_versions=history('data/v18_evidence_latest.json')
    prices={'bitget':collections.defaultdict(dict),'bithumb':collections.defaultdict(dict)}
    nodes={};events={'bitget':[],'bithumb':[]};prev={};counts=collections.Counter();seen_spot=set()
    for index,(commit,known) in enumerate(price_versions):
        d=b.get(commit,'data/latest.json')
        if not isinstance(d,dict) or d.get('collector_status')!='PASS':continue
        finished=ms(d.get('finished_utc'))
        if not finished:continue
        published=max(known,finished);current={}
        for sym,v in (d.get('verified_crypto_futures_closed_prices') or {}).items():
            p=number(v.get('close_usdt'));t=v.get('closed_end_ms')
            if not isinstance(t,int) or p is None or p<=0 or t>published:continue
            current[sym]=(t,p)
            if t not in prices['bitget'][sym]:prices['bitget'][sym][t]=(p,published)
        ctx=context(current,prev);prev.update(current)
        items={x.get('symbol'):x for x in list(d.get('early_pool') or [])+list(d.get('watchlist') or [])
          if isinstance(x,dict) and x.get('asset_identity')=='VERIFIED_CRYPTO' and x.get('venue')=='bitget'}
        compact={sym:{'windows':x.get('windows') or {}} for sym,x in items.items()}
        nodes[d['finished_utc']]={'known':published,'items':compact,'context':ctx}
        st=b.get(commit,'data/state.json') or {};tape=st.get('spot_fast') or {};at=tape.get('time_ms')
        if isinstance(at,int) and at<=published:
            for sym,v in (tape.get('prices') or {}).items():
                p=number(v[0]) if isinstance(v,list) and v else None
                if p and p>0 and at not in prices['bithumb'][sym]:prices['bithumb'][sym][at]=(p,published)
        for seed in (d.get('spot_flow') or {}).get('direction_review_seeds') or []:
            sym=seed.get('market');key=(sym,finished)
            if not isinstance(sym,str) or not sym.startswith('KRW-') or key in seen_spot:continue
            try:x=spot_features(seed,ctx)
            except ValueError:continue
            x.update(spot_sample_features(st,sym,published))
            events['bithumb'].append({'symbol':sym,'issued_ms':published,'features':x})
            seen_spot.add(key)
        counts['price_snapshots']+=1
        if (index+1)%250==0:print('V21_ARCHIVE_PRICE_PROGRESS',index+1,flush=True)
    seen=set()
    for index,(commit,known) in enumerate(flow_versions):
        d=b.get(commit,'data/v18_evidence_latest.json')
        if not isinstance(d,dict) or d.get('status')!='PASS':continue
        node=nodes.get(d.get('source_finished_utc'));observed=ms(d.get('at_utc'))
        if not node or not observed:counts['missing_matching_snapshot']+=1;continue
        issued=max(known,observed,node['known'])
        for o in d.get('observations') or []:
            sym=o.get('symbol');key=(sym,observed);item=node['items'].get(sym)
            if item is None or key in seen:continue
            try:x=futures_features(o,item,issued)
            except (ValueError,TypeError):counts['unusable_futures_feature']+=1;continue
            x.update(node['context']);x['relative_to_market']=clip(x['p5']-x['market_median5'])
            events['bitget'].append({'symbol':sym,'issued_ms':issued,'features':x})
            seen.add(key);counts['contradictory_samples_retained']+=x['price_flow_disagreement']
        counts['flow_snapshots']+=1
        if (index+1)%250==0:print('V21_ARCHIVE_FLOW_PROGRESS',index+1,flush=True)
    b.close()
    tapes={venue:{sym:[(t,p,k) for t,(p,k) in sorted(ps.items())] for sym,ps in records.items()}
           for venue,records in prices.items()}
    print('V21_REAL_DATA_COVERAGE',json.dumps({'counts':dict(counts),
      'events':{k:len(v) for k,v in events.items()},'archive_ref':PIN}),flush=True)
    return events,tapes,dict(counts)

def labeled(events,tapes,venue,h):
    rows=[]
    for e in events:
        fn=forward_label if venue=='bitget' else spot_tape_label
        target=fn(tapes.get(e['symbol'],[]),e['issued_ms'],h)
        if target is None:continue
        rows.append({**e,'ret':target['return_pct'],'label_known_ms':target['available_ms'],
             'entry_delay_ms':target['entry_delay_ms'],'future_ms':target['future_ms']})
    return rows

def model_export(model,names,kind):
    if kind=='logistic':
        scaler=model.named_steps['scale'];clf=model.named_steps['model']
        return {'kind':kind,'features':names,'classes':[int(x) for x in clf.classes_],
           'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),
           'coef':clf.coef_.tolist(),'intercept':clf.intercept_.tolist()}
    clf=model
    trees=[]
    for est in clf.estimators_:
        t=est.tree_
        trees.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),
          'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),
          'value':[x[0].tolist() for x in t.value]})
    return {'kind':kind,'features':names,'classes':[int(x) for x in clf.classes_],'trees':trees}

def candidates(model,rows,names,threshold,venue):
    if not rows:return []
    import numpy as np
    prob=model.predict_proba(np.asarray([[x['features'].get(k,0) for k in names] for x in rows],dtype=float))
    classes=list(model.classes_);out=[]
    for row,ps in zip(rows,prob):
        up=float(ps[classes.index(1)]) if 1 in classes else 0
        down=float(ps[classes.index(-1)]) if -1 in classes else 0
        side=1 if up>=threshold and up>down else (-1 if down>=threshold and down>up and venue=='bitget' else 0)
        out.append({**row,'side':side,'p_up':up,'p_down':down})
    return out

def score_selection(metric):
    if metric['signals']==0:return -1e9
    lower=metric['hour_block_bootstrap_lower_95_pct']
    # A lower-bound score is not a market threshold. Validate uncertainty in blocks.
    return lower if lower is not None else metric['mean_net_pct']-1

def fit_one(events,tapes,venue,h):
    import numpy as np
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    rows=labeled(events,tapes,venue,h)
    times=sorted({x['issued_ms'] for x in rows})
    if len(times)<12:return {'status':'INSUFFICIENT_TEMPORAL_COVERAGE','rows':len(rows)},None
    first=times[int(.50*len(times))];second=times[int(.75*len(times))]
    train,valid,test=temporal_partition(rows,first,second,(h+10)*MIN)
    if min(len(train),len(valid),len(test))<30:
        return {'status':'INSUFFICIENT_PURGED_SPLIT','counts':[len(train),len(valid),len(test)]},None
    names=sorted(train[0]['features'])
    X=np.asarray([[r['features'][k] for k in names] for r in train],dtype=float)
    y=np.asarray([1 if r['ret']>COST else -1 if r['ret']<-COST else 0 for r in train])
    if len(set(y))<2:return {'status':'INSUFFICIENT_TARGET_CLASSES'},None
    models={
      'logistic':Pipeline([('scale',StandardScaler()),('model',LogisticRegression(C=.2,max_iter=1000,random_state=21031))]),
      'forest':RandomForestClassifier(n_estimators=64,max_depth=4,min_samples_leaf=25,
          max_features=.8,random_state=21031,n_jobs=2)}
    selections=[];fitted={}
    for kind,model in models.items():
        model.fit(X,y);fitted[kind]=model
        for threshold in THRESHOLDS:
            pred=candidates(model,valid,names,threshold,venue)
            metric=evaluate_predictions(pred,COST,venue,h)
            selections.append({'kind':kind,'threshold':threshold,'metric':metric})
    selections.sort(key=lambda z:score_selection(z['metric']),reverse=True)
    chosen=selections[0];model=fitted[chosen['kind']]
    # FREEZE model/threshold BEFORE any final holdout targets are evaluated.
    chosen_json=model_export(model,names,chosen['kind'])
    frozen_id=hashlib.sha256(json.dumps(chosen_json,sort_keys=True).encode()).hexdigest()
    pred=candidates(model,test,names,chosen['threshold'],venue)
    metrics={str(c):evaluate_predictions(pred,c,venue,h) for c in (.10,.20,.40)}
    baselines={}
    for name in ('momentum','reversion','v20_regime'):
        out=[]
        for r in test:
            p=r['features']['p5'];s=sign(p)
            if name=='reversion':s=-s
            if name=='v20_regime':s=s if r['features'].get('reversal_5_vs_15') else -s
            out.append({**r,'side':s})
        baselines[name]=evaluate_predictions(out,COST,venue,h)
    side_metrics={}
    for side,label in ((1,'BUY_LONG'),(-1,'SHORT')):
        side_metrics[label]=evaluate_predictions([x for x in pred if x['side']==side],COST,venue,h)
    report={'status':'TIME_SEPARATED_TEST_COMPLETE_NOT_LIVE_PROFIT_PROOF','venue':venue,'horizon_min':h,
        'label_reference':'first later completed price, not actual entry fill',
        'spot_future_tolerance_seconds':150 if venue=='bithumb' else 0,
        'rows':len(rows),'partitions':{'train':len(train),'validation':len(valid),'test':len(test)},
        'time_cuts_utc':[dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat() for t in (first,second)],
        'label_publication_purge':True,'model':chosen['kind'],'threshold':chosen['threshold'],
        'model_sha256':frozen_id,'choices_predeclared':len(selections),
        'validation':chosen['metric'],'test_cost_scenarios':metrics,
        'test_sides':side_metrics,'test_baselines':baselines,
        'entry_delay_median_minutes':statistics.median(x['entry_delay_ms']/MIN for x in test),
        'source_span_hours':(times[-1]-times[0])/3600000,
        'requires_independent_prospective_validation':True,
        'production_ready':False}
    payload={'schema':'IRYS_V21_SUPERVISED_MODEL_V1','venue':venue,'horizon_min':h,
        'model_sha256':frozen_id,'model':chosen_json,'threshold':chosen['threshold'],
        'frozen_before_test':True,'training_label_cutoff_ms':first,'source_pin':PIN,
        'prospective_validation_start_ms':int(dt.datetime.now(dt.timezone.utc).timestamp()*1000),
        'research_metrics':report,'notification_eligible':False,
        'notification_reason':'NEEDS_REAL_PROSPECTIVE_EVIDENCE_AND_FRESH_QUOTE'}
    return report,payload

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    events,tapes,counts=archive();results={};models={}
    for venue in ('bitget','bithumb'):
        for h in (5,15):
            name=venue+'_'+str(h)
            report,model=fit_one(events[venue],tapes[venue],venue,h)
            results[name]=report
            if model is not None:models[name]=model
            print('V21_MODEL_RESULT',json.dumps(report,sort_keys=True),flush=True)
    manifest={'version':'V21_CAUSAL_LEARNED_FORECAST_EXPERIMENT','archive_ref':PIN,
       'coverage':counts,'models':results,'production_signals_sent':0,
       'independent_future_performance_not_yet_proven':True}
    (OUT/'report.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'models.json').write_text(json.dumps(models,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print('V21_STUDY_FINISHED',json.dumps({'archive_ref':PIN,'fitted':len(models),
        'output_dir':str(OUT),'live_signals_sent':0}),flush=True)

if __name__=='__main__':main()
