"""One-shot 75s stability comparison: official public Bithumb WebSocket only.
No secrets, order endpoints, Telegram, or production state mutations.
"""
import asyncio
import json
import time
import uuid

import websockets

WS="wss://ws-api.bithumb.com/websocket/v1"
async def main():
    start=time.monotonic();counts={"trade":0,"orderbook":0,"heartbeat":0,"other":0}
    close_code=None;close_reason=None
    async with websockets.connect(WS,ping_interval=15,ping_timeout=15,open_timeout=12,close_timeout=5,max_size=3_000_000) as ws:
        await ws.send(json.dumps([
            {"ticket":"irys-readonly-stability-"+uuid.uuid4().hex},
            {"type":"trade","codes":["KRW-BTC"],"isOnlyRealtime":True},
            {"type":"orderbook","codes":["KRW-BTC"],"isOnlyRealtime":True},
            {"format":"DEFAULT"}]))
        deadline=start+75
        next_heartbeat=start+10
        while time.monotonic()<deadline:
            if time.monotonic()>=next_heartbeat:
                await ws.send("PING")
                next_heartbeat=time.monotonic()+10
            try:
                raw=await asyncio.wait_for(ws.recv(),timeout=min(0.5,max(.01,deadline-time.monotonic())))
                obj=json.loads(raw)
                typ=obj.get("type") if isinstance(obj,dict) else None
                if isinstance(obj,dict) and obj.get("status")=="UP":counts["heartbeat"]+=1
                elif typ in ("trade","orderbook") and obj.get("code")=="KRW-BTC":counts[typ]+=1
                else:counts["other"]+=1
            except asyncio.TimeoutError:pass
            except websockets.ConnectionClosed as e:
                close_code=e.code;close_reason=str(e.reason)[:100];break
    elapsed=time.monotonic()-start
    print(json.dumps({"result":"BITHUMB_INDEPENDENT_75S_WS_COMPARISON","elapsed_seconds":round(elapsed,2),
                      "counts":counts,"closed_early_code":close_code,"closed_early_reason":close_reason,
                      "duration_verified":elapsed>=74 and counts["orderbook"]>=10}))
    if elapsed<74 or counts["orderbook"]<10:
        raise RuntimeError("WEBSOCKET_STABILITY_UNVERIFIED")
if __name__=="__main__":asyncio.run(main())
