"""READ-ONLY historical price outcome audit for four user-confirmed Telegram alerts.

Price references are the 'recent price' shown in a screenshot, NOT executions.
Bithumb official completed 1m candle after the alert is used for 5/15/30/60m.
An absent candle or horizon in the future is UNVERIFIED; no imputation.
"""
from __future__ import annotations
import datetime as dt
import json
import urllib.parse
import urllib.request

KST=dt.timezone(dt.timedelta(hours=9))
UTC=dt.timezone.utc
NOW=dt.datetime.now(UTC)
CASES=[
    ('KRW-BIOT','2026-10-28T22:45:00+09:00',.3981),
    ('KRW-SHIB','2026-10-28T22:55:00+09:00',.0067),
    ('KRW-DOGE','2026-10-28T23:05:00+09:00',107.0),
    ('KRW-REQ','2026-10-29T00:15:00+09:00',70.53),
]
HORIZONS=[5,15,30,60]


def get_candles(sym,at):
    end=min(NOW, at.astimezone(UTC)+dt.timedelta(minutes=75))
    to=end.astimezone(KST).strftime('%Y-%m-%d %H:%M:%S')
    url='https://api.bithumb.com/v1/candles/minutes/1?'+urllib.parse.urlencode(
        {'market':sym,'count':180,'to':to})
    req=urllib.request.Request(url,headers={'Accept':'application/json',
                                            'User-Agent':'IRYS-post-alert-readonly-audit'})
    with urllib.request.urlopen(req,timeout=20) as resp:
        raw=json.load(resp)
    if not isinstance(raw,list):
        raise RuntimeError('UNEXPECTED_CANDLE_SCHEMA')
    out={}
    for bar in raw:
        try:
            stamp=dt.datetime.fromisoformat(bar['candle_date_time_utc']).replace(tzinfo=UTC)
            close=float(bar['trade_price'])
            high=float(bar['high_price'])
            low=float(bar['low_price'])
            if stamp.minute < 0 or close<=0 or high<low:
                continue
            out[stamp]=dict(close=close,high=high,low=low)
        except (KeyError,TypeError,ValueError):
            pass
    return out


def outcome(rows,at,price,horizon):
    target=at.astimezone(UTC)+dt.timedelta(minutes=horizon)
    target_min=target.replace(second=0,microsecond=0)
    if target>target_min:
        target_min+=dt.timedelta(minutes=1)
    if NOW < target_min:
        return {'status':'PENDING_FUTURE_HORIZON'}
    candle=rows.get(target_min-dt.timedelta(minutes=1))
    if not candle:
        return {'status':'NO_COMPLETE_ONE_MIN_CANDLE_AT_TARGET'}
    pct=100*(candle['close']/price-1)
    direction='UP' if pct>=.15 else 'DOWN' if pct<=-.15 else 'FLAT'
    return {'status':'VERIFIED_CLOSED_1M_VS_SCREENSHOT_REFERENCE',
            'target_candle_utc':(target_min-dt.timedelta(minutes=1)).isoformat(),
            'price_krw':candle['close'],'return_pct':round(pct,4),
            'actual_direction':direction,
            'source':'Bithumb public completed one-minute candles'}


def main():
    report=[]
    for sym,time,price in CASES:
        at=dt.datetime.fromisoformat(time)
        try:
            rows=get_candles(sym,at)
            results={str(h):outcome(rows,at,price,h) for h in HORIZONS}
            report.append({'symbol':sym,'telegram_time_kst':time,'screenshot_recent_price':price,
              'not_an_execution_price':True,'completed_candle_count':len(rows),
              'outcomes':results})
        except Exception as ex:
            report.append({'symbol':sym,'status':'OFFICIAL_PRICE_LOOKUP_UNVERIFIED',
                           'exception_type':type(ex).__name__})
    print('IRYS_4_ALERT_POST_DELIVERY_PRICE_AUDIT',json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    main()
