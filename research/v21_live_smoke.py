"""Read-only live validation. No branch/main data mutations, no Telegram.
Reads a single current main commit plus actual public exchange quotes; writes
only /tmp smoke report for GitHub artifact inspection.
"""
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import collector
from v21_runtime import run,load,fetch_quotes,MODELS,verified_models,probabilities


def gitfile(commit,path):
    p=subprocess.run(['git','show',commit+':'+path],check=True,capture_output=True)
    return json.loads(p.stdout)


def main():
    root=subprocess.check_output(['git','rev-parse','refs/remotes/origin/main'],text=True).strip()
    market=gitfile(root,'data/latest.json')
    flow=gitfile(root,'data/v18_evidence_latest.json')
    old=gitfile(root,'data/state.json')
    now=int(time.time()*1000)
    quotes,errors=fetch_quotes({('bitget','BTCUSDT'),('bithumb','KRW-BTC')},collector.http_json,now)
    models=load(MODELS)
    valid,bad=verified_models(models)
    if bad or not valid:raise RuntimeError('MODEL_INTEGRITY_FAILED '+str(bad))
    # All trained model JSON exports must compute finite normalized probabilities.
    for key,p in valid.items():
        q=probabilities(p['model'],{x:0 for x in p['model']['features']})
        if abs(sum(q.values())-1)>1e-9:raise RuntimeError('EXPORTED_MODEL_INFERENCE_MISMATCH '+key)
    report,state=run(market,flow,old,{},models,int(time.time()*1000),collector.http_json)
    result={'version':'V21_READONLY_LIVE_SMOKE','source_main_commit':root,
       'market_finished':market.get('finished_utc'),'evidence_source':flow.get('source_finished_utc'),
       'actual_public_quote_checks':[{'venue':v,'symbol':s,**q} for (v,s),q in quotes.items()],
       'quote_read_errors':errors,'runtime':report,'state_pending':len(state.get('pending',[])),
       'no_telegram_sent':True,'no_production_files_written':True}
    path=pathlib.Path('/tmp/v21_live_smoke.json');path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print('V21_REAL_PUBLIC_QUOTE_PROBE',json.dumps({
       'quotes':len(quotes),'errors':errors,'source_main_commit':root,
       'runtime_status':report['status'],'model_status':report['model_status'],
       'forecast_count':report['forecast_count'],'pending':report['pending_count'],
       'source_status':report['source_status'],'model_errors':report['model_integrity_errors']},ensure_ascii=False))
    if len(quotes)!=2:raise RuntimeError('BOTH_PUBLIC_QUOTE_STREAMS_NOT_VERIFIED')
    if report['status']!='ACTIVE':raise RuntimeError('ACTUAL_RUNTIME_NOT_ACTIVE '+report['status'])

if __name__=='__main__':main()
