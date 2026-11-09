"""Read exact owned GitHub artifacts for an explicit time window; no live writes.
All runs in the selected window are inventoried, including failures/missing data.
Authenticated requests stop at api.github.com; redirected blobs receive no token.
"""
import argparse,datetime as dt,hashlib,io,json,os,sys,tempfile,urllib.error,urllib.parse,urllib.request,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from research.v44_stream_backtest import ingest_session,study
REPO='pmk44120315-creator/irys-bitget-5min-scanner'
API='https://api.github.com/repos/'+REPO
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def api_get(path,token):
 if not path.startswith(API+'/'):raise ValueError('UNAPPROVED_REPOSITORY')
 req=urllib.request.Request(path,headers={'User-Agent':'IRYS-V44-causal-audit','Accept':'application/vnd.github+json','Authorization':'Bearer '+token})
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)

def artifact_bytes(artifact,token):
 url=API+'/actions/artifacts/'+str(int(artifact['id']))+'/zip'
 req=urllib.request.Request(url,headers={'User-Agent':'IRYS-V44-causal-audit','Authorization':'Bearer '+token})
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=30) as r:payload=r.read()
 except urllib.error.HTTPError as e:
  if e.code not in (301,302,303,307,308):raise
  redirect=e.headers.get('Location','');u=urllib.parse.urlsplit(redirect)
  if u.scheme!='https' or not u.hostname or not (u.hostname.endswith('.blob.core.windows.net') or u.hostname.endswith('.githubusercontent.com') or u.hostname.endswith('.actions.githubusercontent.com')):raise ValueError('UNAPPROVED_ARTIFACT_REDIRECT')
  with urllib.request.urlopen(urllib.request.Request(redirect,headers={'User-Agent':'IRYS-V44-causal-audit'}),timeout=60) as r:payload=r.read()
 want=artifact.get('digest')
 if not isinstance(want,str) or want!='sha256:'+hashlib.sha256(payload).hexdigest():raise ValueError('ARTIFACT_DIGEST_MISMATCH')
 return payload

def unpack(payload,folder):
 allowed={'session.json','raw_frames.jsonl.gz','frozen_features.jsonl.gz'}
 with zipfile.ZipFile(io.BytesIO(payload)) as z:
  if z.testzip() is not None:raise ValueError('ARTIFACT_CRC_FAILED')
  files={}
  for item in z.infolist():
   p=Path(item.filename)
   if p.is_absolute() or '..' in p.parts or (item.external_attr>>16)&0o170000==0o120000:raise ValueError('UNSAFE_ARTIFACT_PATH')
   if p.name in allowed:
    if p.name in files:raise ValueError('DUPLICATE_SESSION_MEMBER')
    files[p.name]=item
  if set(files)!=allowed:raise ValueError('SESSION_FILES_MISSING')
  for name,item in files.items():(folder/name).write_bytes(z.read(item))

def collect(start,end,out):
 token=os.environ.get('GITHUB_TOKEN')
 if not token:raise ValueError('READ_ONLY_REPO_TOKEN_REQUIRED')
 parse=lambda x:int(dt.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()*1000)
 start_ms,end_ms=parse(start),parse(end)
 if end_ms<=start_ms:raise ValueError('WINDOW_ORDER')
 out=Path(out);out.mkdir(parents=True,exist_ok=True)
 inventory=[];rows=[];quotes=[];receipts=[];failures=[];page=1
 while True:
  query=urllib.parse.urlencode({'per_page':100,'page':page,'branch':'main','created':start+'..'+end})
  doc=api_get(API+'/actions/workflows/v43-observation.yml/runs?'+query,token)
  batch=doc.get('workflow_runs',[])
  inventory+=batch
  if len(batch)<100:break
  page+=1
 for run in sorted(inventory,key=lambda r:r['created_at']):
  entry={'id':run['id'],'created_at':run['created_at'],'conclusion':run['conclusion'],'head_sha':run['head_sha']}
  try:
   artifacts=[];page=1
   while True:
    d=api_get(API+'/actions/runs/'+str(run['id'])+'/artifacts?per_page=100&page='+str(page),token)
    artifacts+=d.get('artifacts',[])
    if len(d.get('artifacts',[]))<100:break
    page+=1
   selected=[a for a in artifacts if a['name'].startswith('v43-observation-')]
   if not selected:raise ValueError('ORIGINAL_OBSERVATION_ARTIFACT_MISSING')
   a=sorted(selected,key=lambda x:(x['created_at'],x['id']))[0]
   if a.get('expired'):raise ValueError('ORIGINAL_ARTIFACT_EXPIRED')
   b=artifact_bytes(a,token)
   with tempfile.TemporaryDirectory() as tmp:
    unpack(b,Path(tmp));fs,qs,receipt=ingest_session(tmp)
   rows.extend(x for x in fs if start_ms<=x.get('feature',{}).get('asof_ms',0)<=end_ms)
   quotes.extend(x for x in qs if start_ms<=x['at_ms'] and x['received_at_ms']<=end_ms)
   receipt.update(artifact_id=a['id'],artifact_digest=a['digest'],original_run_conclusion=run['conclusion'])
   receipts.append(receipt);entry.update(status='ORIGINAL_SOURCE_VERIFIED',artifact_id=a['id'],features=len(fs),quotes=len(qs))
  except Exception as e:
   entry.update(status='UNAVAILABLE',error_type=type(e).__name__,reason=str(e)[:120]);failures.append(entry)
  print('V44_SOURCE_SESSION',json.dumps(entry),flush=True)
  (out/'source_inventory.json').write_text(json.dumps({'start':start,'end':end,'available':receipts,'failures':failures,'run_count':len(inventory)},indent=2))
 if not rows or not quotes:raise ValueError('NO_VERIFIED_FROZEN_BACKDATA')
 report,paired=study(rows,quotes,end_ms)
 report['source_sessions']=receipts;report['window_start_utc']=start;report['window_end_utc']=end
 report['missing_source_sessions']=failures;report['source_run_count']=len(inventory)
 (out/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False))
 import gzip
 with gzip.open(out/'paired_rows.jsonl.gz','wt') as f:
  for row in paired:f.write(json.dumps(row,allow_nan=False)+'\n')
 summary={'runs':len(inventory),'verified_sessions':len(receipts),'missing_sessions':len(failures),'frozen_rows':len(rows),'original_quotes_sampled':len(quotes),'comparison_scope':report['comparison_scope'],'live_model_changed':False,
 'horizons':{h:{v:{p:d['later_time_block'][p] for p in ('price_momentum','taker_flow','visible_depth','flow_price_agreement','counterflow_price_response','always_up')} for v,d in data['venues'].items()} for h,data in report['horizons'].items()}}
 print('V44_BACKDATA_REPORT',json.dumps(summary,allow_nan=False),flush=True)
 if failures:print('V44_INCOMPLETE_SOURCE_COVERAGE',len(failures),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--start',required=True);p.add_argument('--end',required=True);p.add_argument('--out',required=True);a=p.parse_args();collect(a.start,a.end,a.out)
