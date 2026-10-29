"""Read-only official 1m/5m candle shape comparison for actual markets."""
import datetime as dt
import json
from collector import http_json, utc_now
from spot_flow import candles

M=60_000
F=5*M
now=utc_now()
ms=int(now.timestamp()*1000)
end=ms//M*M
anchor=ms//F*F
markets=['KRW-WLD','KRW-PUFFER','KRW-DATA','KRW-BIOT','KRW-EL','KRW-BTC']
for market in markets:
    try:
        one=candles(http_json('bithumb','/v1/candles/minutes/1',{'market':market,'count':100}),ms)
        native_raw=http_json('bithumb','/v1/candles/minutes/5',{'market':market,'count':30})
        five=candles(native_raw,ms)  # inspect timestamps; completed status checked below
        complete={k:v for k,v in five.items() if k%F==0 and k+F<=end}
        actual_20=sum(end-i*M in one for i in range(1,21))
        actual_15=sum(end-i*M in one for i in range(1,16))
        slots=[anchor-i*F for i in (1,2,3)]
        present=[x for x in slots if x in complete]
        recent=min((end-k)//M for k in one if end-5*M<=k<end) if any(end-5*M<=k<end for k in one) else None
        print('V14_SPARSE_NATIVE_PROBE',json.dumps({
            'market':market,'minute_at_utc':now.isoformat(),'last20_minute_bars':actual_20,
            'last15_minute_bars':actual_15,'completed_5m_of_last3':len(present),
            'native5m_start_utc':[dt.datetime.fromtimestamp(k/1000,dt.timezone.utc).isoformat() for k in present],
            'native15m_quote_krw':round(sum(complete[x][4] for x in present)),
            'native5m_latest_close':complete[present[0]][3] if present else None,
            'recent_actual_1m_age_minutes':recent,
            'no_filled_bars':True},ensure_ascii=False))
    except Exception as exc:
        print('V14_SPARSE_NATIVE_PROBE',json.dumps({'market':market,'status':'API_UNAVAILABLE','error_type':type(exc).__name__}))
