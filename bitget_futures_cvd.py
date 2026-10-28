"""Read-only Bitget USDT futures 15m public taker flow reconciled to 15 closed 1m candles.

This does not prove long/short POSITION owners, spot flow, continuous absorption, or returns.
Evidence is fail-closed: missing minutes, truncated history or quote mismatch cannot signal.
"""
from __future__ import annotations
import math

ONE_MIN = 60_000
FIVE_MIN = 300_000
LIMIT = 1000
MAX_PAGES = 25
QUOTE_ERROR_LIMIT = 0.005


def finite(value):
    try:
        number=float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def verify_taker_flow(symbol, now_ms, api, page_limit=LIMIT, max_pages=MAX_PAGES):
    def fail(reason, **details):
        return {"verified": False, "reason": reason, **details}
    if not isinstance(symbol,str) or not symbol.endswith("USDT") or not symbol[:-4].isalnum():
        return fail("INVALID_INSTRUMENT")
    if not isinstance(now_ms,int) or now_ms<1_600_000_000_000:
        return fail("INVALID_AS_OF_TIME")
    if not isinstance(page_limit,int) or not 1<=page_limit<=1000 or not isinstance(max_pages,int) or not 1<=max_pages<=100:
        return fail("INVALID_PAGE_BOUNDS")
    end=(now_ms//ONE_MIN)*ONE_MIN
    start=end-15*ONE_MIN
    opts={"symbol": symbol,"productType":"USDT-FUTURES","granularity":"1m",
          "startTime":str(start-ONE_MIN),"endTime":str(end+ONE_MIN),"limit":"50"}
    try:
        candles=api("bitget","/api/v2/mix/market/candles",opts)
    except Exception:
        return fail("CANDLE_API_FAILED")
    if not isinstance(candles,list):
        return fail("INVALID_CANDLE_RESPONSE")
    closed={}
    for row in candles:
        if not isinstance(row,list) or len(row)<7:
            return fail("INVALID_CANDLE_ROW")
        try:
            stamp=int(row[0])
        except (ValueError,TypeError,OverflowError):
            return fail("INVALID_CANDLE_TIME")
        if not start<=stamp<end:
            continue
        quote=finite(row[6])
        if stamp%ONE_MIN or quote is None or quote<0 or stamp in closed:
            return fail("INVALID_OR_DUPLICATE_CANDLE")
        closed[stamp]=quote
    if len(closed)!=15 or any(start+i*ONE_MIN not in closed for i in range(15)):
        return fail("CLOSED_15M_CANDLE_GAP",closed=len(closed))
    expected=sum(closed.values())
    if expected<=0:
        return fail("NO_CANDLE_TURNOVER")
    page=None
    seen_ids={}
    past_cursors=set()
    blocks=[{"buy":0.,"sell":0.,"trades":0} for _ in range(3)]
    page_count=0
    complete=False
    for _ in range(max_pages):
        query={"symbol":symbol,"productType":"USDT-FUTURES",
               "startTime":str(start),"endTime":str(end),"limit":str(page_limit)}
        if page is not None:
            query["idLessThan"]=page
        try:
            ticks=api("bitget","/api/v2/mix/market/fills-history",query)
        except Exception:
            return fail("TRADE_HISTORY_API_FAILED",pages=page_count)
        if not isinstance(ticks,list):
            return fail("INVALID_HISTORY_RESPONSE")
        if not ticks:
            complete=True
            break
        page_count+=1
        for event in ticks:
            if not isinstance(event,dict):
                return fail("INVALID_TRADE_RECORD")
            trade_id=event.get("tradeId")
            if not isinstance(trade_id,str) or not trade_id.isdigit():
                return fail("INVALID_TRADE_ID")
            try:
                ts=int(event.get("ts"))
            except (ValueError,TypeError,OverflowError):
                return fail("INVALID_TRADE_TIMESTAMP")
            side=str(event.get("side","")).lower()
            price,amount=finite(event.get("price")),finite(event.get("size"))
            if not start<=ts<end or side not in ("buy","sell") or price is None or price<=0 or amount is None or amount<=0 or event.get("symbol")!=symbol:
                return fail("INVALID_TRADE_FIELDS_OR_WINDOW")
            fingerprint=(ts,side,price,amount)
            if trade_id in seen_ids:
                if seen_ids[trade_id]!=fingerprint:
                    return fail("AMBIGUOUS_EXECUTION_ID")
                continue
            seen_ids[trade_id]=fingerprint
            bucket=(ts-start)//FIVE_MIN
            if bucket not in (0,1,2):
                return fail("BAD_TRADE_INTERVAL")
            block=blocks[bucket]
            block[side]+=price*amount
            block["trades"]+=1
        if len(ticks)<page_limit:
            complete=True
            break
        last=ticks[-1].get("tradeId")
        if not isinstance(last,str) or not last.isdigit() or last==page or last in past_cursors:
            return fail("CURSOR_NOT_ADVANCING")
        past_cursors.add(last)
        page=last
    if not complete:
        return fail("HISTORY_PAGINATION_INCOMPLETE",pages=page_count)
    total_buy=sum(b["buy"] for b in blocks)
    total_sell=sum(b["sell"] for b in blocks)
    total=total_buy+total_sell
    relative=abs(total-expected)/expected
    if relative>QUOTE_ERROR_LIMIT:
        return fail("TICKS_CANDLE_TURNOVER_MISMATCH",error=round(relative,6),pages=page_count)
    if any(b["trades"]<10 for b in blocks):
        return fail("INSUFFICIENT_EACH_FIVE_MIN_TRADES",counts=[b["trades"] for b in blocks])
    result=[]
    for b in blocks:
        t=b["buy"]+b["sell"]
        result.append({
            "trades":b["trades"],
            "buy_usdt":round(b["buy"],4),"sell_usdt":round(b["sell"],4),
            "net_buy_usdt":round(b["buy"]-b["sell"],4),
            "buy_share":round(b["buy"]/t,5) if t else None,
        })
    return {
        "verified":True,"venue":"bitget","category":"USDT-FUTURES",
        "symbol":symbol,"start_ms":start,"end_ms":end,"pages":page_count,
        "unique_trades":len(seen_ids),"closed_candles":len(closed),
        "candle_turnover_usdt":round(expected,4),
        "taker_turnover_usdt":round(total,4),
        "candle_relative_error":round(relative,7),
        "buy_share":round(total_buy/total,5),"net_buy_usdt":round(total_buy-total_sell,4),
        "blocks":result,
        "completeness":"COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED",
        "full_exchange_local_public_taker_flow_verified":True,
        "marketwide_all_exchanges_cvd_verified":False,
        "position_owner_long_short_verified":False,
        "continuous_orderbook_absorption_verified":False,
        "observation_only":True,
    }


def classify_flow(evidence):
    """Describe verified taker side; never claim a future direction."""
    if evidence.get("verified") is not True:
        return "UNVERIFIED"
    b=evidence.get("blocks") or []
    if len(b)!=3:
        return "UNVERIFIED"
    if (evidence.get("net_buy_usdt",0)>0 and evidence.get("buy_share",0)>=.62
        and all(x["net_buy_usdt"]>0 and x["buy_share"]>=.58 for x in b)):
        return "SUSTAINED_FUTURES_TAKER_BUY_PRESSURE"
    if (evidence.get("net_buy_usdt",0)<0 and evidence.get("buy_share",1)<=.38
        and all(x["net_buy_usdt"]<0 and x["buy_share"]<=.42 for x in b)):
        return "SUSTAINED_FUTURES_TAKER_SELL_PRESSURE"
    return "MIXED_OR_INTERMITTENT_FUTURES_FLOW"


def collect_futures_flow_observations(latest, now_ms, api, limit=6):
    """Supplemental verified public-futures evidence. Never creates Telegram or BUY/SHORT signals."""
    if not isinstance(latest,dict) or latest.get("collector_status")!="PASS":
        return {"status":"SKIPPED_SOURCE_NOT_PASS","observations":[],
                "alert_eligible":False,"observation_only":True}
    items=[]
    seen=set()
    for o in list(latest.get("watchlist") or [])+list(latest.get("early_pool") or []):
        if not isinstance(o,dict):
            continue
        sym=o.get("symbol")
        w=o.get("windows") or {}
        five,fifteen=w.get("5m") or {},w.get("15m") or {}
        p5,p15=finite(five.get("price_change_pct")),finite(fifteen.get("price_change_pct"))
        q15=finite(fifteen.get("quote_turnover"))
        if (o.get("venue")!="bitget" or not isinstance(sym,str) or
            o.get("asset_identity")!="VERIFIED_CRYPTO" or o.get("isRwa")!="NO" or
            o.get("symbolType","perpetual")!="perpetual" or
            o.get("contract_status","normal")!="normal" or sym in seen or
            p5 is None or p15 is None or q15 is None or
            abs(p5)<.1 or abs(p15)<.15 or p5*p15<=0 or q15<15_000):
            continue
        seen.add(sym)
        items.append((q15,sym,o))
    items.sort(key=lambda x:(-x[0],x[1]))
    selected=items[:limit] if isinstance(limit,int) and 1<=limit<=10 else items[:6]
    out={"status":"NO_CANDIDATES" if not selected else "EVALUATED",
         "observation_only":True,"alert_eligible":False,
         "source":"Bitget official public futures historical fills pages + exact 15 closed 1m candles",
         "markets_evaluated":len(selected),"markets_eligible_for_proof":len(items),
         "verified_count":0,"rejected_count":0,"classifications":{},
         "observations":[]}
    for _rank,sym,meta in selected:
        evidence=verify_taker_flow(sym,now_ms,api,max_pages=10)
        flow=classify_flow(evidence)
        if evidence.get("verified"):out["verified_count"]+=1
        else:out["rejected_count"]+=1
        out["classifications"][flow]=out["classifications"].get(flow,0)+1
        # Raw verification data remain explicit; no claim about long/short positions.
        out["observations"].append({
            "symbol":sym,"observed_ms":(now_ms//ONE_MIN)*ONE_MIN,
            "window_5m_price_pct":meta.get("windows",{}).get("5m",{}).get("price_change_pct"),
            "window_15m_price_pct":meta.get("windows",{}).get("15m",{}).get("price_change_pct"),
            "oi_change_pct":(meta.get("oi") or {}).get("change_pct_from_previous_run"),
            "funding_rate":meta.get("funding_rate"),
            "flow_class":flow,
            "taker_flow_15m":evidence,
            "observation_only":True,"send_allowed":False,
            "position_direction_verified":False,
        })
    return out
