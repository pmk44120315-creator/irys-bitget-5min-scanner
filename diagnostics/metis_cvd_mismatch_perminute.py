"""Read-only minute-by-minute forensic for Bitget METIS 15.67% CVD mismatch."""
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict

SYMBOL="METISUSDT"
END=int(dt.datetime(2026,10,28,6,58,tzinfo=dt.timezone.utc).timestamp()*1000)
START=END-15*60000
def api(path,opts):
    url="https://api.bitget.com"+path+"?"+urllib.parse.urlencode(opts)
    req=urllib.request.Request(url,headers={"accept":"application/json",
        "User-Agent":"IRYS-mismatch-rootcause-read-only/1"})
    with urllib.request.urlopen(req,timeout=19) as response:j=json.load(response)
    if j.get("code")!="00000" or not isinstance(j.get("data"),list):
        raise RuntimeError("EXCHANGE_RESPONSE_"+str(j.get("code")))
    return j["data"]
base={"symbol":SYMBOL,"productType":"USDT-FUTURES"}
candles=api("/api/v2/mix/market/candles",{
    **base,"granularity":"1m",
    "startTime":str(START-60000),"endTime":str(END+60000),"limit":"50"})
expect={}
for row in candles:
    if isinstance(row,list) and len(row)>=7:
        ts=int(row[0])
        if START<=ts<END:expect[ts]={"quote":float(row[6]),"base_volume":float(row[5])}
rows=[];cursor=None;past=set()
for i in range(25):
    raw=api("/api/v2/mix/market/fills-history",{
        **base,"startTime":str(START),"endTime":str(END),
        "limit":"1000",**({"idLessThan":cursor} if cursor else {})})
    rows.extend(raw)
    if len(raw)<1000:break
    next_cursor=str(raw[-1].get("tradeId") or "")
    if not next_cursor or next_cursor==cursor or next_cursor in past:break
    past.add(next_cursor);cursor=next_cursor
    time.sleep(.15)
by_min=defaultdict(lambda:{"quote":0,"base_volume":0,"count":0})
seen={};collisions=0;unexpected=0;side_counts=defaultdict(int);trade_times=[]
for x in rows:
    ts=int(x.get("ts") or 0);k=x.get("tradeId")
    fp=(ts,x.get("side"),x.get("price"),x.get("size"))
    if k in seen:
        if seen[k]!=fp:collisions+=1
        continue
    seen[k]=fp
    if ts<START or ts>=END:unexpected+=1;continue
    key=ts//60000*60000
    a=by_min[key]
    price=float(x["price"]);size=float(x["size"])
    a["quote"]+=price*size
    a["base_volume"]+=size
    a["count"]+=1
    side_counts[x["side"]]+=1
    trade_times.append(ts)
details=[]
for i in range(15):
    ts=START+i*60000
    q=by_min[ts];e=expect.get(ts,{"quote":None,"base_volume":None})
    diff=q["quote"]-e["quote"] if e["quote"] is not None else None
    details.append({
        "minute_utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).strftime("%H:%M"),
        "trade_count":q["count"],"trade_quote":round(q["quote"],4),
        "candle_quote":round(e["quote"],4) if e["quote"] is not None else None,
        "diff_quote":round(diff,4) if diff is not None else None,
        "trade_base":round(q["base_volume"],4),
        "candle_base":e["base_volume"]
    })
total_trades=sum(q["quote"] for q in by_min.values())
total_candles=sum(q["quote"] for q in expect.values())
print("BITGET_METIS_DISCREPANCY_ROOT_CAUSE",json.dumps({
    "market":SYMBOL,"timeframe_utc":"2026-10-28T06:43:00Z_to_06:58:00Z",
    "trade_pages_records":len(rows),"unique_id_records":len(seen),
    "id_collision_distinct_payloads":collisions,"out_of_interval":unexpected,
    "candle_minutes":len(expect),"trade_quote_sum":round(total_trades,4),
    "candle_quote_sum":round(total_candles,4),
    "relative_error":round(abs(total_trades-total_candles)/total_candles,7) if total_candles>0 else None,
    "sides":dict(side_counts),"first_trade_ms":min(trade_times) if trade_times else None,
    "last_trade_ms":max(trade_times) if trade_times else None,
    "per_minute":details},ensure_ascii=False))
