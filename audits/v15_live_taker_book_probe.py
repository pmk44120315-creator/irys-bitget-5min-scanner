"""Read-only current public market evidence diagnostics: no orders, no alerts, no secrets."""
import datetime as dt
import json
import time
from pathlib import Path
from collector import http_json
from spot_flow import trade_sample, candles
from spot_continuity import book_snapshot
from spot_native_structure import parse_native_five, native_market_structure

def api(name,path,opts=None):
    return http_json(name,path,opts)

def one_market(market):
    now=int(time.time()*1000)
    try:
        recent=trade_sample(market,now,api)
    except Exception as exc:
        recent={"error":type(exc).__name__,"coverage":False}
    try:
        book=book_snapshot(market,int(time.time()*1000),api)
    except Exception as exc:
        book={"error":type(exc).__name__}
    try:
        first=api("bithumb","/v1/trades/ticks",{"market":market,"count":500})
        ts=[int(x.get("timestamp") or x.get("trade_timestamp") or 0) for x in first]
        now2=int(time.time()*1000)
        age=[now2-t for t in ts if t>0]
        latest_stats={"count":len(first),"newest_age_seconds":round(min(age)/1000,1) if age else None,
                      "oldest_age_seconds":round(max(age)/1000,1) if age else None,
                      "first_record_has_timestamp":bool(first and "timestamp" in first[0]),
                      "first_record_has_trade_timestamp":bool(first and "trade_timestamp" in first[0])}
    except Exception as exc:
        latest_stats={"error":type(exc).__name__}
    return {"symbol":market,"recent":{k:recent.get(k) for k in
        ["coverage","count","buy_share","net_buy_krw","early_buy_share","recent_buy_share","recent_net_buy_krw","error"]},
      "book":book,"raw_tick_window":latest_stats}
def main():
    j=json.loads(Path("data/latest.json").read_text(encoding="utf8"))
    src=(j.get("spot_directional") or {}).get("diagnostics") or []
    syms=[x.get("market") for x in src if isinstance(x.get("market"),str)]
    extras=[x.get("market") for x in (j.get("spot_flow") or {}).get("direction_review_seeds",[])
            if isinstance(x.get("market"),str)]
    for symbol in extras:
        if symbol not in syms and len(syms)<8:syms.append(symbol)
    results=[one_market(s) for s in syms]
    print("IRYS_V15_LIVE_PUBLIC_PROBE "+json.dumps(
        {"probe_kst":dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(),
         "reference_snapshot_kst":j.get("collector_kst"),
         "status":"PUBLIC_APIS_READ_ONLY","observations":results},ensure_ascii=False,separators=(",",":")))
if __name__=="__main__":main()
