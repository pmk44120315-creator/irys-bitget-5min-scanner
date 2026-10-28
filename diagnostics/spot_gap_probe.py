"""Read-only Bithumb closed-minute candle-gap evidence probe. No keys or orders."""
import datetime as dt
import json
import urllib.parse
import urllib.request
from spot_flow import candles, window

def check(market, now_ms):
    query=urllib.parse.urlencode({'market':market,'count':150})
    url='https://api.bithumb.com/v1/candles/minutes/1?'+query
    req=urllib.request.Request(url,headers={'User-Agent':'IRYS-public-readonly-candle-gap-diagnostics/1'})
    with urllib.request.urlopen(req,timeout=20) as reply:
        raw=json.load(reply)
    rows=candles(raw,now_ms)
    end=now_ms//60000*60000
    missing=[dt.datetime.fromtimestamp((end-i*60000)/1000,dt.timezone.utc).strftime('%H:%M')
             for i in range(1,16) if end-i*60000 not in rows]
    actual=[end-i*60000 for i in range(1,16) if end-i*60000 in rows]
    current=[c.get('candle_date_time_utc') for c in raw[:4] if isinstance(c,dict)]
    return {'market':market,'raw_count':len(raw),'valid_bars':len(rows),
            'now_utc':dt.datetime.fromtimestamp(now_ms/1000,dt.timezone.utc).isoformat(),
            'last_four_api_minutes_utc':current,'missing_last15_utc_hhmm':missing,
            '1m':window(rows,now_ms,1) is not None,
            '5m':window(rows,now_ms,5) is not None,
            '15m':window(rows,now_ms,15) is not None}

if __name__=='__main__':
    now=dt.datetime.now(dt.timezone.utc)
    stamp=int(now.timestamp()*1000)
    for market in ('KRW-BTC','KRW-ETH','KRW-SOL','KRW-PENGU','KRW-NEAR','KRW-SUI'):
        try:print(json.dumps(check(market,stamp),ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'market':market,'error_type':type(e).__name__,'status':'UNVERIFIED'}))
