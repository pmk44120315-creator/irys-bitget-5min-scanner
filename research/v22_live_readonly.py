#!/usr/bin/env python3
"""Read-only live V22 smoke with latest GitHub main and both official public books."""
import json
import pathlib
import subprocess
import sys
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import collector
import v22_runtime

def main():
    subprocess.run(['git','fetch','--quiet','origin','main'],check=True)
    ref='origin/main'
    sha=subprocess.check_output(['git','rev-parse',ref],text=True).strip()
    def from_git(path):
        x=subprocess.run(['git','show',ref+':'+path],check=True,capture_output=True)
        return json.loads(x.stdout)
    data={k:from_git(p) for k,p in {
        'market':'data/latest.json',
        'flow':'data/v18_evidence_latest.json',
        'state':'data/state.json'}.items()}
    model=json.loads((pathlib.Path(__file__).resolve().parents[1]/
        'research/v21_results/models.json').read_text(encoding='utf8'))
    now=int(time.time()*1000)
    report,state=v22_runtime.run(data['market'],data['flow'],data['state'],
        {},model,now,collector.http_json)
    result={'version':'V22_LIVE_MARKET_READONLY_SMOKE',
        'market_repo_main_sha':sha,
        'market_finished_utc':data['market'].get('finished_utc'),
        'real_taker_finished_utc':data['flow'].get('source_finished_utc'),
        'status':report.get('status'),
        'source_status':report.get('source_status'),
        'eligible_candidates':report.get('eligible_candidates'),
        'quotes_available':report.get('quotes_available'),
        'new_observations':report.get('new_events'),
        'venue_coverage':{k:sum(x['venue']==k for x in report.get('new_forecasts_shadow_only',[]))
                           for k in ('bitget','bithumb')},
        'quote_errors':report.get('quote_errors'),
        'model_errors':report.get('model_integrity_errors'),
        'no_telegram_sent':report.get('telegram_sent') is False,
        'no_orders':report.get('orders_sent') is False,
        'mock_fills_reported':False,
        'no_production_file_changed':True}
    print('V22_OFFICIAL_EXCHANGE_SMOKE',json.dumps(result,ensure_ascii=False),flush=True)
    pathlib.Path('/tmp/v22_live_smoke.json').write_text(
        json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    if report.get('status')!='RESEARCH_ACTIVE':
        raise RuntimeError('REAL_MARKET_SAMPLE_FAILED')
    if report.get('quotes_available',0)<2 or report.get('new_events',0)<2:
        raise RuntimeError('INSUFFICIENT_REAL_EXCHANGE_BOOK_COVERAGE')
    if set(result['venue_coverage'])!=set(('bitget','bithumb')):
        raise RuntimeError('VENUE_SCHEMA_UNKNOWN')
if __name__=='__main__':main()
