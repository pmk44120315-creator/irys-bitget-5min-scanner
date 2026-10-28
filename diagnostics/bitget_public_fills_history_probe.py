"""Verify official Bitget public futures historical trades REST pagination.
Research-only; print aggregated metadata, no trading endpoints, no credentials.
"""
import datetime as dt
import json
import time
import urllib.parse
import urllib.request

BASE = "https://api.bitget.com/api/v2/mix/market/fills-history"
SYMBOLS = ["BANKUSDT", "UNIUSDT", "AAVEUSDT", "BTCUSDT"]
MAX_PAGES = 4
PAGE_LIMIT = 1000

def request(symbol, start, end, cursor=None):
    args={"symbol":symbol,"productType":"USDT-FUTURES",
          "startTime":str(start),"endTime":str(end),"limit":str(PAGE_LIMIT)}
    if cursor:args["idLessThan"]=cursor
    req=urllib.request.Request(BASE+"?"+urllib.parse.urlencode(args),
        headers={"accept":"application/json","User-Agent":"IRYS-public-futures-proof-only/1"})
    with urllib.request.urlopen(req,timeout=17) as response:return json.load(response)

def main():
    now=int(time.time()*1000)
    window_end=now//60000*60000
    start=window_end-15*60000
    for sym in SYMBOLS:
        cursor=None;all_ids=set();min_time=None;max_time=None
        pages=[];error=None;start_reached=False
        for i in range(MAX_PAGES):
            try:
                j=request(sym,start,window_end,cursor)
                data=j.get("data")
                if j.get("code")!="00000" or not isinstance(data,list):raise RuntimeError("EXCHANGE_ENVELOPE_"+str(j.get("code")))
                if not data:
                    pages.append({"count":0});break
                ids=[str(x.get("tradeId","")) for x in data]
                ts=[int(x.get("ts",0)) for x in data]
                if any(not x.isdigit() for x in ids) or any(not x for x in ts):
                    raise RuntimeError("TRADE_ID_OR_TIME_INVALID")
                unique_count=sum(1 for x in ids if x not in all_ids)
                all_ids.update(ids)
                minimum=min(ts);maximum=max(ts)
                min_time=minimum if min_time is None else min(min_time,minimum)
                max_time=maximum if max_time is None else max(max_time,maximum)
                pages.append({"count":len(data),"unique_new":unique_count,
                    "oldest_utc":dt.datetime.fromtimestamp(minimum/1000,dt.timezone.utc).isoformat(),
                    "latest_utc":dt.datetime.fromtimestamp(maximum/1000,dt.timezone.utc).isoformat(),
                    "side_example":str(data[0].get("side")),"fields":sorted(list(data[0]))[:14]})
                if minimum<=start:start_reached=True;break
                if len(data)<PAGE_LIMIT:break
                next_cursor=ids[-1]
                if next_cursor==cursor:raise RuntimeError("NO_CURSOR_PROGRESS")
                cursor=next_cursor
                time.sleep(.2)
            except Exception as exc:
                error=f"{type(exc).__name__}: {str(exc)[:110]}";break
        print("BITGET_FILLS_HISTORY_PROBE",json.dumps({
            "symbol":sym,"start_utc":dt.datetime.fromtimestamp(start/1000,dt.timezone.utc).isoformat(),
            "end_utc":dt.datetime.fromtimestamp(window_end/1000,dt.timezone.utc).isoformat(),
            "pages":pages,"unique_trades":len(all_ids),"reached_interval_start":start_reached,
            "error":error
        },ensure_ascii=False))
        time.sleep(.15)

if __name__ == "__main__":
    main()
