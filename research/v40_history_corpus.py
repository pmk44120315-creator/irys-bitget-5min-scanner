"""Recover all available older V22 frozen ledgers without inventing features.
Uses a backward coverage walk through original GitHub commits, not a fixed
hand-picked sample of successful days. Conflicting immutable records excluded.
"""
import argparse,copy,datetime as dt,hashlib,json,os,time,urllib.parse,urllib.request
from pathlib import Path
REPO='pmk44120315-creator/irys-bitget-5min-scanner'

def merge_snapshots(snapshots):
    rows={};frozen={};bad_features=set();bad_labels=set();total=0
    encode=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
    for state in snapshots:
        for e in state.get('completed',[])+state.get('pending',[]):
            if not isinstance(e,dict) or not isinstance(e.get('issued_ms'),int):continue
            total+=1;k=(e.get('venue'),e.get('symbol'),e['issued_ms'])
            core={x:e.get(x) for x in ('venue','symbol','issued_ms','shadow_only','features','entry_quote','decisions','votes')}
            f=encode(core)
            if k in frozen and frozen[k]!=f:bad_features.add(k);continue
            if k not in rows:rows[k]=copy.deepcopy(e);frozen[k]=f;continue
            old=rows[k].setdefault('outcomes',{})
            for h,label in e.get('outcomes',{}).items():
                current=old.get(h)
                if current is None:old[h]=copy.deepcopy(label)
                elif label.get('both_sides_measured') is True:
                    if current.get('both_sides_measured') is True:
                        if encode(current)!=encode(label):bad_labels.add(k)
                    else:old[h]=copy.deepcopy(label)
    remove=bad_features|bad_labels
    result=sorted([r for k,r in rows.items() if k not in remove],key=lambda r:(r['issued_ms'],r['venue'],r['symbol']))
    return {'completed':result,'pending':[]},{'snapshot_rows':total,'unique_events':len(result),
      'conflicting_frozen_events':len(bad_features),'conflicting_measured_events':len(bad_labels),
      'conflict_ids':[':'.join(map(str,k)) for k in sorted(remove)]}

def collect(initial_path,initial_commit,out_dir):
    base='https://api.github.com/repos/'+REPO;token=os.environ.get('GITHUB_TOKEN')
    def get(url):
        headers={'User-Agent':'IRYS-v40-frozen-history-coverage','Accept':'application/json'}
        if token and url.startswith(base+'/'):headers['Authorization']='Bearer '+token
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=40) as r:raw=r.read()
        return json.loads(raw),hashlib.sha256(raw).hexdigest()
    raw=Path(initial_path).read_bytes();states=[json.loads(raw)];receipts=[{'sha':initial_commit,'sha256':hashlib.sha256(raw).hexdigest(),'kind':'PINNED_INITIAL'}]
    events=lambda d:d.get('completed',[])+d.get('pending',[])
    oldest=min(e['issued_ms'] for e in events(states[0]));used={initial_commit};finished=False;errors=[]
    bound=oldest+30*60000
    while True:
        until=dt.datetime.fromtimestamp(bound/1000,dt.timezone.utc).isoformat()
        try:commits,_=get(base+'/commits?'+urllib.parse.urlencode({'path':'data/v22_evidence_state.json','until':until,'per_page':1}))
        except Exception as e:errors.append({'stage':'COMMIT_LIST','error_type':type(e).__name__,'until_ms':bound});break
        if not commits:finished=True;break
        c=commits[0];sha=c['sha']
        if sha in used:
            if bound>=oldest:bound=oldest-1;continue
            errors.append({'stage':'REPEATED_COMMIT_WITHOUT_PROGRESS','sha':sha});break
        used.add(sha)
        try:d,digest=get('https://raw.githubusercontent.com/'+REPO+'/'+sha+'/data/v22_evidence_state.json')
        except Exception as e:errors.append({'stage':'STATE_READ','sha':sha,'error_type':type(e).__name__});break
        valid=[e['issued_ms'] for e in events(d) if isinstance(e.get('issued_ms'),int)]
        if not valid:
            published=int(dt.datetime.fromisoformat(c['commit']['committer']['date'].replace('Z','+00:00')).timestamp()*1000)
            receipts.append({'sha':sha,'sha256':digest,'events':0});bound=published-1;continue
        first,last=min(valid),max(valid)
        states.append(d);receipts.append({'sha':sha,'sha256':digest,'events':len(valid),'first_issued_ms':first,'last_issued_ms':last})
        print('V40_HISTORY_SNAPSHOT',json.dumps(receipts[-1]),flush=True)
        if first>=oldest:bound=oldest-1
        else:oldest=first;bound=oldest+30*60000
    state,diagnostics=merge_snapshots(states)
    diagnostics.update({'version':'V40_HISTORICAL_FROZEN_CORPUS_V1','initial_commit':initial_commit,
       'archive_beginning_reached':finished,'source_snapshots':receipts,'errors':errors,'read_only':True,
       'original_event_provenance':'EXISTING_V22_AS_OF_RECORDS_NOT_RECONSTRUCTED_EXCHANGE_TICKS',
       'created_at_ms':int(time.time()*1000),'first_issued_ms':state['completed'][0]['issued_ms'] if state['completed'] else None,
       'last_issued_ms':state['completed'][-1]['issued_ms'] if state['completed'] else None})
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    (out/'corpus.json').write_text(json.dumps(state,allow_nan=False))
    (out/'manifest.json').write_text(json.dumps(diagnostics,indent=2,allow_nan=False))
    print('V40_HISTORY_CORPUS',json.dumps({k:v for k,v in diagnostics.items() if k not in ('source_snapshots','conflict_ids')}),flush=True)
    if errors:raise RuntimeError('INCOMPLETE_HISTORY_EXTRACTION')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--initial',required=True);p.add_argument('--commit',required=True);p.add_argument('--out',required=True);a=p.parse_args();collect(a.initial,a.commit,a.out)
