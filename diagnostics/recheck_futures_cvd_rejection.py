"""Independent read-only repeat of formerly rejected 15m Bitget proof after data settles."""
import datetime as dt,json,urllib.parse,urllib.request,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from bitget_futures_cvd import verify_taker_flow,classify_flow

RECHECK=int(dt.datetime(2026,10,28,6,58,0,tzinfo=dt.timezone.utc).timestamp()*1000)
def read(venue,path,opts):
 assert venue=="bitget"
 assert path in ("/api/v2/mix/market/fills-history","/api/v2/mix/market/candles")
 u="https://api.bitget.com"+path+"?"+urllib.parse.urlencode(opts)
 req=urllib.request.Request(u,headers={"Accept":"application/json","User-Agent":"IRYS-futures-reconciliation-diagnostic/1"})
 with urllib.request.urlopen(req,timeout=20) as f:data=json.load(f)
 if data.get("code")!="00000" or not isinstance(data.get("data"),list):raise RuntimeError("VENUE_DATA_UNAVAILABLE")
 return data["data"]
for sym in ["METISUSDT","SKYAIUSDT","PONSUSDT"]:
 x=verify_taker_flow(sym,RECHECK,read,max_pages=12)
 print("BITGET_RECONCILIATION_RECHECK",json.dumps({
    "symbol":sym,"asof_utc":"2026-10-28T06:58:00Z",
    "verified":x.get("verified"),"reason":x.get("reason"),
    "relative_error":x.get("error",x.get("candle_relative_error")),
    "trades":x.get("unique_trades"),"pages":x.get("pages"),
    "counts":x.get("counts"),"block_counts":[b["trades"] for b in x.get("blocks",[])],
    "flow_class":classify_flow(x)
 }))
 time.sleep(.3)
