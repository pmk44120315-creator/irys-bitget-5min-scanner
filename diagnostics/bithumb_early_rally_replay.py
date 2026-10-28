"""Historical Bithumb 1m candle-only replay of historical shortlist gates. Never proves taker/AI alerts."""
import json, urllib.parse, urllib.request, datetime as dt, time, statistics
from collections import Counter
from math import isfinite
END=dt.datetime(2026,10,28,15,9,tzinfo=dt.timezone(dt.timedelta(hours=9)))
BEG=dt.datetime(2026,10,28,0,0,tzinfo=dt.timezone(dt.timedelta(hours=9)))
def n(x):
    try:
        k=float(x);return k if isfinite(k) else None
    except (ValueError,TypeError):return None
def read(s,to=None):
    params={'market':s,'count':200}
    if to:params['to']=to
    u='https://api.bithumb.com/v1/candles/minutes/1?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(u,headers={'User-Agent':'IRYS-offline-miss-gate-analysis/1','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as res:return json.load(res)
def collect(s):
    out={}
    end=int(END.timestamp()*1000)
    target=int((BEG-dt.timedelta(hours=1)).timestamp()*1000)
    to=None;attempts=[]
    for idx in range(7):
        rows=read(s,to)
        if not isinstance(rows,list) or not rows:break
        oldest=None
        for x in rows:
            try:
                ts=int(dt.datetime.fromisoformat(x['candle_date_time_utc']).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
                if oldest is None or ts<oldest:oldest=ts
                if ts>=end or ts<target:continue
                vals=[n(x.get(k)) for k in ('opening_price','high_price','low_price','trade_price','candle_acc_trade_price')]
                if None not in vals and vals[0]>0 and vals[4]>=0:out[ts]=vals
            except Exception:continue
        attempts.append({'page':idx,'count':len(rows),'oldest':oldest})
        if oldest is None or oldest<=target or len(rows)<200:break
        next_to=dt.datetime.fromtimestamp(oldest/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
        if next_to==to:break
        to=next_to
        time.sleep(.2)
    return out,attempts
def summarize(s,bars):
    M=60000; step=5*M
    start=((int(BEG.timestamp()*1000)+14*M)//step+1)*step
    end=(int(END.timestamp()*1000)//step)*step
    checks=Counter();events=[];significant=[]
    for boundary in range(start,end+1,step):
        bucket=lambda mins:[bars.get(t) for t in range(boundary-mins*M,boundary,M)]
        five=bucket(5);fifteen=bucket(15);prior=bucket(60)[:55]
        if not all(five) or not all(fifteen):
            checks['MISSING_RECENT_15M']+=1;continue
        f_open,f_end=five[0][0],five[-1][3]
        if f_open<=0:continue
        five_pct=100*(f_end/f_open-1);v5=sum(z[4] for z in five)
        m_range=100*(max(z[1] for z in five)-min(z[2] for z in five))/f_open
        fif_hi=max(z[1] for z in fifteen);fif_lo=min(z[2] for z in fifteen)
        fif_pct=100*(fifteen[-1][3]/fifteen[0][0]-1)
        wick5=(max(z[1] for z in five)-max(five[0][0],f_end))/(max(z[1] for z in five)-min(z[2] for z in five)) if max(z[1] for z in five)>min(z[2] for z in five) else 0
        wick15=(fif_hi-max(fifteen[0][0],fifteen[-1][3]))/(fif_hi-fif_lo) if fif_hi>fif_lo else 0
        ret=100*(fif_hi-f_end)/fif_hi
        vols=[]
        for k in range(2,13):
            v=[bars.get(t) for t in range(boundary-k*5*M,boundary-(k-1)*5*M,M)]
            if all(v):vols.append(sum(z[4] for z in v))
        base=statistics.median(vols) if len(vols)>=8 else None
        ratio=v5/base if base and base>0 else None
        at=dt.datetime.fromtimestamp(boundary/1000,dt.timezone(dt.timedelta(hours=9))).strftime("%m-%d %H:%M")
        ev={'when_kst':at,'five_pct':round(five_pct,2),'five_krw_million':round(v5/1e6,1),
            'five_ratio':round(ratio,2) if ratio else None,'wick5':round(wick5,2),
            'fifteen_pct':round(fif_pct,2),'wick15':round(wick15,2),'high_retrace_pct':round(ret,2),
            'price':f_end}
        if five_pct>=2 or five_pct<=-2 or v5>=200_000_000:significant.append(ev)
        if v5<25e6:checks['LOW_VOLUME']+=1;continue
        if base is None:checks['INSUFFICIENT_BASELINE']+=1;continue
        if ratio<3:checks['LOW_MULTIPLE']+=1;continue
        if not .12<=five_pct<=3.8:checks['PRICE_OUTSIDE_EARLY_RANGE']+=1;continue
        if fif_pct>6.5 or wick5>.38 or wick15>.43 or ret>1.6:checks['OVEREXTENDED_WICK_RETRACE']+=1;continue
        if len(prior)<50 or any(v is None for v in prior):checks['MISSING_55M_QUIET']+=1;continue
        op=prior[0][0]
        prange=100*(max(z[1] for z in prior)-min(z[2] for z in prior))/op
        pdrift=100*(prior[-1][3]/op-1)
        if prange>6 or abs(pdrift)>4:checks['NOT_QUIET']+=1;continue
        checks['CANDLE_ONLY_POSSIBLE']+=1;events.append(ev)
    return {'market':s,'bar_count':len(bars),'date_range':[min(bars) if bars else None,max(bars) if bars else None],
        'checks':dict(checks),'candle_only_possible':events[:14],
        'notable_5m_moves':sorted(significant,key=lambda e:abs(e['five_pct']),reverse=True)[:16],
        'range_high':max(z[1] for z in bars.values()) if bars else None}
def main():
  for sym in ['KRW-XAN','KRW-PONS','KRW-BFC','KRW-SHELL']:
    try:
      bars,attempts=collect(sym)
      print('HISTORICAL_RALLY_CANDLE_REPLAY',json.dumps({**summarize(sym,bars),'pages':len(attempts),'last_page':attempts[-1] if attempts else None},ensure_ascii=False))
    except Exception as e:print('HISTORICAL_RALLY_CANDLE_REPLAY',json.dumps({'market':sym,'status':'UNVERIFIED','error_type':type(e).__name__,'message':str(e)[:130]}))
if __name__=='__main__':main()
