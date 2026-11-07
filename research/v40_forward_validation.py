"""Untuned later-period verification of an already serialized model.
Later-period retrospective replay is not pre-issued live prediction or profit.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research.v40_context_learning import prepare_rows,evaluate,bootstrap_lift
from research.v40_direction_model import transform,predict_portable

def forward(models,state,asof,cutoff):
    rows,diagnostics=prepare_rows(state,asof,5)
    rows=[r for r in rows if r['issued_at_ms']>=cutoff+5*60000]
    out={'version':'V40_FROZEN_MODEL_NEW_PERIOD_V1','cutoff_ms':cutoff,'asof_ms':asof,
      'data':diagnostics,'retrained':False,'actual_execution_verified':False,'live_approved':False,
      'evaluation_kind':'SEPARATE_LATER_PERIOD_RETROSPECTIVE_REPLAY_NOT_LIVE_SIGNALS','venues':{}}
    for venue,b in models.items():
        if b['train_max_label_ms']>cutoff:raise ValueError('MODEL_TRAINED_AFTER_FROZEN_CUTOFF')
        own=[r for r in rows if r['venue']==venue]
        if not own:out['venues'][venue]={'status':'NO_LATER_OBSERVATIONS'};continue
        names=b['features'];x=np.array([[r['features'].get(n) if r['features'].get(n) is not None else np.nan for n in names] for r in own],dtype=float)
        p=predict_portable(transform(x,b['preprocessor']),b['model'])
        baseline=np.array([r['features']['candidate_side'] for r in own])
        online=[i for i,r in enumerate(own) if r['existing_online_direction'] in (-1,1)]
        out['venues'][venue]={'status':'EVALUATED','first_issued_ms':min(r['issued_at_ms'] for r in own),
          'last_issued_ms':max(r['issued_at_ms'] for r in own),'model':evaluate(own,p,venue),
          'momentum':evaluate(own,(baseline==1).astype(float),venue),
          'always_up':evaluate(own,np.ones(len(own)),venue),'always_down_direction':evaluate(own,np.zeros(len(own)),venue),
          'online_same_cases':evaluate([own[i] for i in online],np.array([1. if own[i]['existing_online_direction']==1 else 0. for i in online]),venue),
          'model_on_online_cases':evaluate([own[i] for i in online],p[online],venue),
          'paired_lift_ci':bootstrap_lift(own,p,baseline)}
    return out

def main():
    a=argparse.ArgumentParser();a.add_argument('--models',required=True);a.add_argument('--state',required=True);a.add_argument('--asof-ms',type=int,required=True);a.add_argument('--cutoff-ms',type=int,required=True);a.add_argument('--out',required=True);s=a.parse_args()
    mb=Path(s.models).read_bytes();db=Path(s.state).read_bytes();r=forward(json.loads(mb),json.loads(db),s.asof_ms,s.cutoff_ms)
    r['model_sha256']=hashlib.sha256(mb).hexdigest();r['data_sha256']=hashlib.sha256(db).hexdigest()
    Path(s.out).parent.mkdir(parents=True,exist_ok=True);Path(s.out).write_text(json.dumps(r,indent=2,allow_nan=False))
    print('V40_NEW_PERIOD_FROZEN_MODEL',json.dumps(r,allow_nan=False))
if __name__=='__main__':main()
