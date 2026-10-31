"""Reproducible initialization from reviewed public historic data, not live proof.
The two families were chosen after exploratory comparison; their new independent
prospective performance MUST start at zero. No historical result is a certificate.
"""
import gzip,hashlib,json,pathlib,sys
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from v22_performance import enrich
from v22_learning import initialize
from v22_tree import refresh
from v22_live import policy_hash
MIN=60000

def events_with_targets(events,raw,venue,h):
    tapes={r['symbol']:r['prices'] for r in raw['rows'] if r['venue']==venue};rows=[]
    for e in events:
        t=(e['issued_ms']//MIN+1)*MIN;prices=tapes.get(e['symbol'],{})
        p,q=prices.get(str(t)),prices.get(str(t+h*MIN))
        if not p or not q:continue
        rows.append({**e,'features':enrich(e['features']),'midpoint_return_pct':100*(q['open']/p['open']-1),
                     'closed_ms':t+(h+1)*MIN})
    end=max(r['closed_ms'] for r in rows)
    return [r for r in rows if r['issued_ms']>=end-24*3600000],end

def build(data,raw):
    bundle={};meta={}
    for venue,h in [('bitget',15),('bithumb',5)]:
        rows,end=events_with_targets(data['events'][venue],raw,venue,h)
        if len(rows)<100:raise ValueError('SEED_HISTORY_INSUFFICIENT_'+venue)
        common={'venue':venue,'horizon_min':h,'source_pin':data['pin'],'seed_rows':len(rows),
           'last_historical_label_ms':end,'historical_label_reference':'NEXT_MINUTE_OPEN_PROXY_NOT_ACTUAL_QUOTE',
           'prospective_evidence_not_inherited':True}
        key=venue+'_'+str(h)
        if venue=='bitget':
            tree=refresh({},rows,end+1)
            bundle[key]={**common,'kind':'hourly_tree','tree_model':tree['model']}
        else:
            names=sorted(rows[0]['features']);x=np.asarray([[r['features'].get(k,0.) for k in names] for r in rows])
            scaler=StandardScaler().fit(x);z=scaler.transform(x)
            reg=Ridge(alpha=30.).fit(z,np.clip([r['midpoint_return_pct'] for r in rows],-5,5))
            design=np.column_stack([np.ones(len(z)),z]);cov=np.linalg.inv(design.T@design+np.diag([0.]+[30.]*len(names)))
            seed={**common,'kind':'causal_rls','features':names,'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),
                  'coef':reg.coef_.tolist(),'intercept':float(reg.intercept_),'covariance':((cov+cov.T)/2).tolist()}
            initialize(seed);bundle[key]=seed
        meta[key]={k:common[k] for k in ('venue','horizon_min','seed_rows','last_historical_label_ms')}
    return bundle,meta
if __name__=='__main__':
    data=json.load(gzip.open(sys.argv[1],'rt'));a=json.load(gzip.open(sys.argv[2],'rt'));b=json.load(gzip.open(sys.argv[3],'rt'))
    if not (data['pin']==a['pin']==b['pin']):raise ValueError('ARCHIVE_PINS_DIFFER')
    raw={**a,'rows':[r for r in a['rows'] if r['venue']=='bitget']+[r for r in b['rows'] if r['venue']=='bithumb']}
    bundle,meta=build(data,raw);out=ROOT/'research/v22_results';out.mkdir(exist_ok=True)
    (out/'seeds.json').write_text(json.dumps(bundle,sort_keys=True,separators=(',',':')))
    audit={'policy_sha256':policy_hash(bundle),'models':meta,'no_live_accuracy_claim':True,
           'input_sha256':{label:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for label,p in zip(('features','bitget_targets','bithumb_targets'),sys.argv[1:4])},
           'source_pin':data['pin'],'scientific_status':'EXPLORATORY_SELECTION_REQUIRES_NEW_FORWARD_VALIDATION'}
    (out/'seed_receipt.json').write_text(json.dumps(audit,indent=2))
    print('V22_INITIALIZED_MODELS',json.dumps(audit))
