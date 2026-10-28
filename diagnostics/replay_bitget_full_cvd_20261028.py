"""Historical candidate replay using ONLY pre-event public 15m Bitget prints.
Read-only; directions here were prior sample hypotheses, NOT verified trades.
"""
import json
import datetime as dt
import time
import urllib.request, urllib.parse
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from bitget_futures_cvd import verify_taker_flow,classify_flow

EVENTS=[
  ("UNIUSDT","LONG","2026-10-28T01:58:26.973Z"),
  ("INJUSDT","SHORT","2026-10-28T02:53:24.784Z"),
  ("ARXUSDT","SHORT","2026-10-28T03:33:42.523Z"),
  ("BANKUSDT","SHORT","2026-10-28T04:08:23.834Z"),
  ("ARBUSDT","SHORT","2026-10-28T04:18:23.387Z"),
  ("UNIUSDT","LONG","2026-10-28T04:43:23.402Z"),
  ("AAVEUSDT","LONG","2026-10-28T06:18:25.033Z"),
]

def api(venue,path,opts):
    assert venue=="bitget"
    assert path in ("/api/v2/mix/market/candles","/api/v2/mix/market/fills-history")
    url="https://api.bitget.com"+path+"?"+urllib.parse.urlencode(opts)
    req=urllib.request.Request(url,headers={"User-Agent":"IRYS-no-lookahead-futures-CVD-history/1","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=17) as response: body=json.load(response)
    if body.get("code")!="00000" or not isinstance(body.get("data"),list):raise RuntimeError("INVALID_VENUE_DATA")
    return body["data"]

def main():
    for symbol,direction,iso in EVENTS:
        ms=int(dt.datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()*1000)
        x=verify_taker_flow(symbol,ms,api,max_pages=25)
        cls=classify_flow(x)
        consistent=(direction=="LONG" and cls=="SUSTAINED_FUTURES_TAKER_BUY_PRESSURE") or (direction=="SHORT" and cls=="SUSTAINED_FUTURES_TAKER_SELL_PRESSURE")
        print("BITGET_NO_LOOKAHEAD_FULL_CVD_REPLAY",json.dumps({
            "symbol":symbol,"sample_hypothesis":direction,"event_kst":(dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc)+dt.timedelta(hours=9)).isoformat(timespec="seconds"),
            "end_ms":x.get("end_ms"),"verified":x.get("verified",False),"reason":x.get("reason"),
            "flow_class":cls,"matches_initial_direction":consistent,
            "buy_share":x.get("buy_share"),"net_buy_usdt":x.get("net_buy_usdt"),
            "unique_trades":x.get("unique_trades"),"candle_relative_error":x.get("candle_relative_error"),
            "blocks":x.get("blocks"),
            "all_exchange_cvd":False,"position_owner_direction":False,
        }))
        time.sleep(.2)
if __name__=="__main__":main()
