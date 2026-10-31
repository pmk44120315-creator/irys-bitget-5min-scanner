"""Official public minute-price targets for archived events. No trades or Telegram."""
import concurrent.futures,datetime as dt,gzip,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from collector import http_json,parse_bitget_candles,parse_bithumb_candles
from research.v21_train_causal_models import archive,PIN
MIN=60000

def get_one(venue,symbol,needed):
    outstanding=set(needed);found={};requests=0;errors=[]
    while outstanding:
        target=max(outstanding)
        try:
            if venue=='bitget':
                raw=http_json(venue,'/api/v2/mix/market/history-candles',{
                  'symbol':symbol,'productType':'USDT-FUTURES','granularity':'1m',
                  'endTime':str(target+MIN),'limit':'200'})
                rows=parse_bitget_candles(raw)
            else:
                stamp=dt.datetime.fromtimestamp((target+MIN)/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                raw=http_json(venue,'/v1/candles/minutes/1',{'market':symbol,'to':stamp,'count':200})
                rows=parse_bithumb_candles(raw)
            requests+=1
            rows=[r for r in rows if r['ts']<=target and r['open']>0 and r['high']>=r['low']]
            if not rows:errors.append('EMPTY_HISTORICAL_RESPONSE');break
            first=min(r['ts'] for r in rows)
            if first>target:errors.append('NONADVANCING_PAGE');break
            for r in rows:
                if r['ts'] in outstanding:
                    found[str(r['ts'])]={'open':r['open'],'close':r['close'],'timestamp_ms':r['ts']}
            prior=len(outstanding)
            outstanding={t for t in outstanding if t<first}
            if len(outstanding)>=prior:errors.append('NONADVANCING_PAGE');break
        except Exception as exc:
            errors.append(type(exc).__name__+': '+str(exc)[:160]);break
    return {'venue':venue,'symbol':symbol,'requested':len(needed),'found':len(found),
            'requests':requests,'errors':errors,'prices':found}

def main():
    events,_,counts=archive();groups={}
    for venue,items in events.items():
        for e in items:
            t=((e['issued_ms']//MIN)+1)*MIN
            groups.setdefault((venue,e['symbol']),set()).update((t,t+5*MIN,t+15*MIN))
    print('V22_EXACT_PRICE_PLAN',json.dumps({'pin':PIN,'markets':len(groups),'target_stamps':sum(map(len,groups.values()))}),flush=True)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(get_one,v,s,t) for (v,s),t in sorted(groups.items())]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if len(results)%50==0:
                print('V22_EXACT_PRICE_PROGRESS',len(results),'/',len(futures),'requests',sum(r['requests'] for r in results),flush=True)
    out=pathlib.Path('/tmp/v22-exact');out.mkdir(exist_ok=True)
    payload={'pin':PIN,'retrieved_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
       'endpoint_type':'OFFICIAL_PUBLIC_HISTORICAL_1M_CANDLES',
       'target_reference':'next minute open strictly after publication and exact 5/15m open; not fills',
       'rows':results,'no_orders':True,'no_telegram':True}
    with gzip.open(out/'exact-prices.json.gz','wt') as f:json.dump(payload,f,separators=(',',':'))
    print('V22_EXACT_PRICE_COVERAGE',json.dumps({v:{'markets':sum(r['venue']==v for r in results),
      'wanted':sum(r['requested'] for r in results if r['venue']==v),
      'found':sum(r['found'] for r in results if r['venue']==v),
      'requests':sum(r['requests'] for r in results if r['venue']==v),
      'failed_markets':sum(bool(r['errors']) for r in results if r['venue']==v)} for v in events}),flush=True)
if __name__=='__main__':main()
