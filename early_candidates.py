"""Compact public Bitget crypto-only early-volume candidates. Not trading advice."""
import math

def _f(v):
    try:
        v=float(v)
        return v if math.isfinite(v) else None
    except (TypeError,ValueError,OverflowError):
        return None

def build_early_pool(observations,limit=80):
    scored=[]
    for x in observations:
        if x.get('venue')!='bitget' or x.get('asset_identity')!='VERIFIED_CRYPTO':continue
        sym=str(x.get('symbol') or '')
        if not sym.endswith('USDT') or not sym.isascii() or not sym.isalnum():continue
        w=x.get('windows') or {}
        a=w.get('5m') or {};b=w.get('15m') or {};h=w.get('60m') or {}
        q=_f(a.get('quote_turnover'));r5=_f(a.get('adjacent_ratio'))
        r15=_f(b.get('adjacent_ratio'));p5=_f(a.get('price_change_pct'))
        p60=_f(h.get('price_change_pct'));wick=_f(b.get('upper_wick_ratio'))
        if None in (q,p5,p60,wick) or q<5000 or p5>4.5 or p60>9 or p60< -6 or wick>0.7:continue
        if any(_f(v.get('coverage'))!=1 for v in (a,b,h)):continue
        if _f(a.get('baseline_coverage'))!=1:continue
        if max(r5 or 0,r15 or 0)<1.7:continue
        score=min(max(r5 or 0,r15 or 0),40)*math.log10(1+q/5000)
        if not math.isfinite(score):continue
        oi=x.get('oi') or {}
        compact={'venue':'bitget','symbol':sym,'baseCoin':x.get('baseCoin'),
                 'asset_identity':'VERIFIED_CRYPTO','funding_rate':x.get('funding_rate'),
                 'oi':{'status':oi.get('status'),'change_pct_from_previous_run':oi.get('change_pct_from_previous_run'),
                       'elapsed_min_since_previous_snapshot':oi.get('elapsed_min_since_previous_snapshot')},
                 'windows':{k:w[k] for k in ('1m','5m','15m','60m') if k in w},
                 'observation_only':True,'early_volume_rank':round(score,5)}
        scored.append(compact)
    scored.sort(key=lambda x:(-x['early_volume_rank'],x['symbol']))
    return scored[:max(0,min(80,int(limit)))]
