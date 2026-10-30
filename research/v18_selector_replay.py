#!/usr/bin/env python3
"""Read-only V17 vs V18 futures evidence coverage on all historical snapshots.
Not a directional win-rate study. V18 selection picks targets to measure,
not to send trade alerts. Never claims an unobserved taker fill is verified.
"""
import collections,json,math
from v18_flow_selector import select_v18_evidence_targets,n
from v18_data_audit import git
def old_candidates(latest,limit=6):
    by={}
    for item in (latest.get('watchlist') or [])+(latest.get('early_pool') or []):
        if not isinstance(item,dict):continue
        symbol=item.get('symbol');w=item.get('windows') or {}
        five=w.get('5m') or {};fifteen=w.get('15m') or {}
        p5=n(five.get('price_change_pct'));p15=n(fifteen.get('price_change_pct'))
        q15=n(fifteen.get('quote_turnover'))
        if (item.get('venue')!='bitget' or not isinstance(symbol,str) or
            item.get('asset_identity')!='VERIFIED_CRYPTO' or item.get('isRwa')!='NO' or
            item.get('symbolType','perpetual')!='perpetual' or
            item.get('contract_status','normal')!='normal' or
            p5 is None or p15 is None or q15 is None or
            abs(p5)<.1 or abs(p15)<.15 or p5*p15<=0 or q15<15000):
            continue
        if symbol not in by:by[symbol]=(q15,item)
    return [x[1] for x in sorted(by.values(),key=lambda x:-x[0])[:limit]]
def main():
    hashes=git('log','refs/remotes/origin/main','--format=%H','--','data/latest.json').decode().splitlines()
    counter=collections.Counter()
    late_recent=[]
    for i,sha in enumerate(reversed(hashes)):
        try:d=json.loads(git('show',sha+':data/latest.json'))
        except Exception:counter['unreadable']+=1;continue
        if d.get('collector_status')!='PASS':continue
        t=d.get('finished_utc')
        if not isinstance(t,str):continue
        import datetime as dt
        ms=int(dt.datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()*1000)
        original=old_candidates(d)
        v18=select_v18_evidence_targets(d,ms,state={},limit=6)
        new=v18['selected']
        orig_symbols={x['symbol'] for x in original}
        new_symbols={x['symbol'] for x in new}
        counter['snapshots']+=1
        counter['old_requests']+=len(orig_symbols)
        counter['v18_requests']+=len(new_symbols)
        counter['new_not_in_old']+=len(new_symbols-orig_symbols)
        counter['old_not_in_new']+=len(orig_symbols-new_symbols)
        counter['reversals_reaching_new']+=v18.get('reversal_selected',0)
        counter['reversals_eligible']+=v18.get('reversal_eligible',0)
        counter['eligible_new']+=v18.get('eligible',0)
        verified={x.get('symbol'):x for x in (d.get('futures_flow') or {}).get('observations',[])
                  if isinstance(x,dict) and x.get('taker_flow_15m',{}).get('verified') is True}
        counter['old_actual_15m_verified_reconciled']+=sum(sym in verified for sym in orig_symbols)
        counter['new_intersection_historic_verified']+=sum(sym in verified for sym in new_symbols)
        for x in new:
            w=x.get('windows') or {};q=n((w.get('15m') or {}).get('quote_turnover'))
            if q is not None and q<15000:counter['new_below_old_turnover_floor']+=1
            five=n((w.get('5m') or {}).get('price_change_pct'))
            fifteen=n((w.get('15m') or {}).get('price_change_pct'))
            if five is not None and fifteen is not None and five*fifteen<0:
                counter['opposing_5m_15m_new']+=1
        if len(late_recent)<10:
            late_recent.append({'sampled_snapshot':t,
              'old':sorted(orig_symbols),'new':sorted(new_symbols),
              'reversal_eligible':v18.get('reversal_eligible',0)})
    print('IRYS_V18_SOURCE_RECALL_COMPARISON',json.dumps({
      'metrics':counter,'examples':late_recent[:3],
      'strict_limits':['V18 historical alternate target has NO historical taker data if old pipeline did not collect it.',
       'V18 candidate coverage is NOT direction accuracy or an executable trade signal.',
       'No model inputs are fabricated, no APIs requested by replay.'],
      'no_existing_worker_edited':True,'no_telegram_sent':True},
      ensure_ascii=False,default=dict))
if __name__=='__main__':main()
