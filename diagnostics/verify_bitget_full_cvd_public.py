"""Read only: verify full 15m public futures trades against closed candles, no credentials."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from bitget_futures_cvd import verify_taker_flow,classify_flow

BASE="https://api.bitget.com"
def public_api(venue,path,params):
    assert venue=="bitget"
    assert path in ("/api/v2/mix/market/candles","/api/v2/mix/market/fills-history")
    url=BASE+path+"?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={"accept":"application/json",
        "User-Agent":"IRYS-Official-Bitget-Futures-ReadOnly-Research/1"})
    with urllib.request.urlopen(req,timeout=18) as response:
        body=json.load(response)
    if body.get("code")!="00000" or not isinstance(body.get("data"),list):
        raise RuntimeError("PUBLIC_VENUE_BAD_ENVELOPE")
    return body["data"]

def main():
    now=int(time.time()*1000)
    results=[]
    for sym in ["BANKUSDT","UNIUSDT","AAVEUSDT","BTCUSDT"]:
        x=verify_taker_flow(sym,now,public_api,max_pages=25)
        row={"symbol":sym,"verified":x.get("verified",False),
            "reason":x.get("reason"),"pages":x.get("pages"),
            "unique_trades":x.get("unique_trades"),
            "closed_candles":x.get("closed_candles"),
            "relative_error":x.get("candle_relative_error"),
            "flow_class":classify_flow(x),
            "net_buy_usdt":x.get("net_buy_usdt"),
            "blocks":x.get("blocks"),
            "still_no_position_owner_proof":not x.get("position_owner_long_short_verified",False)}
        print("BITGET_FULL_CVD_VERIFICATION",json.dumps(row))
        results.append(row)
        time.sleep(.2)
    if not any(x["verified"] for x in results):
        raise SystemExit("NO_VERIFIED_MARKETS")

if __name__=="__main__": main()
