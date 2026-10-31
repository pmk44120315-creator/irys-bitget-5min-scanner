"""Read-only integration smoke: never writes repository data or sends messages."""
import hashlib,json,os,pathlib,subprocess,sys,tempfile,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import v22_live
REPO='pmk44120315-creator/irys-bitget-5min-scanner'

def read(url,auth=False):
    headers={'Accept':'application/json','User-Agent':'IRYS-V22-public-read-smoke'}
    if auth:headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=20) as r:return r.read()

def main():
    original=subprocess.check_output(['git','show','9ae70155bf019c4c72bef70319f8fde9bcdedd4d:.github/workflows/v18-shadow-pipeline.yml'])
    current=(ROOT/'.github/workflows/v18-shadow-pipeline.yml').read_bytes()
    assert current.startswith(original),'ORIGINAL_WORKFLOW_CHANGED'
    commits=json.loads(read('https://api.github.com/repos/'+REPO+'/commits?sha=main&path=data/v18_evidence_latest.json&per_page=1',True))
    pin=commits[0]['sha']
    with tempfile.TemporaryDirectory(prefix='v22-public-smoke-') as directory:
        tmp=pathlib.Path(directory)
        for name in ('latest.json','state.json','v18_evidence_latest.json'):
            data=read('https://raw.githubusercontent.com/'+REPO+'/'+pin+'/data/'+name)
            (tmp/name).write_bytes(data)
        v22_live.DATA=tmp
        status=v22_live.main()
        report=json.loads((tmp/'v22_latest.json').read_text())
        report['smoke_source_commit']=pin
        report['isolated_public_quote_test']=True
        report['original_workflow_byte_prefix_preserved']=True
        print('V22_PUBLIC_RUNTIME_SMOKE',json.dumps({k:report.get(k) for k in ('status','source_status','registered_examples','directional_predictions','quote_errors','quote_markets_available','policy_sha256','smoke_source_commit')}))
        target=pathlib.Path('/tmp/v22-smoke');target.mkdir(exist_ok=True)
        (target/'report.json').write_text(json.dumps(report,indent=2))
        assert status==0 and report['source_status']=='PASS','ACTUAL_PUBLIC_RUNTIME_FAILED'
        assert report['registered_examples']>0 and report['quote_markets_available']>0,'REAL_QUOTES_NOT_EXERCISED'
        assert not report['delivery_candidates'] and report['telegram_sent'] is False
if __name__=='__main__':main()
