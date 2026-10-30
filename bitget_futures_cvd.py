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


def futures_orderbook_snapshot(symbol,now_ms,api):
    """Bitget official USDT futures top5 book; one snapshot is not absorption."""
    try:
        raw=api('bitget','/api/v2/mix/market/merge-depth',{
            'symbol':symbol,'productType':'USDT-FUTURES',
            'precision':'scale0','limit':'15'})
        if not isinstance(raw,dict):return None
        when=finite(raw.get('ts'))
        bids,asks=raw.get('bids'),raw.get('asks')
        if when is None or abs(now_ms-when)>120_000 or not isinstance(bids,list) or not isinstance(asks,list):
            return None
        if len(bids)<5 or len(asks)<5:return None
        def total(rows):
            n=0
            for row in rows[:5]:
                if not isinstance(row,(list,tuple)) or len(row)<2:return None
                price,qty=finite(row[0]),finite(row[1])
                if price is None or price<=0 or qty is None or qty<0:return None
                n+=price*qty
            return n
        bsum,asum=total(bids),total(asks)
        bp,ap=finite(bids[0][0]),finite(asks[0][0])
        if None in (bsum,asum,bp,ap) or bsum<=0 or asum<=0 or bp>=ap:return None
        return {'timestamp_ms':int(when),'bid_ask_top5_ratio':round(bsum/asum,5),
                'spread_pct':round(100*(ap-bp)/ap,5),
                'continuous_absorption_verified':False,
                'source':'Bitget USDT-FUTURES top5 public merge-depth scale0'}
    except Exception:return None


def paired_futures_books(sym,now_ms,api,memory):
    before=memory.get(sym) if isinstance(memory.get(sym),dict) else None
    current=futures_orderbook_snapshot(sym,now_ms,api)
    if current is None:return {'status':'FUTURES_BOOK_UNAVAILABLE','snapshots':[]}
    pair=[]
    if before:
        gap=current['timestamp_ms']-before.get('timestamp_ms',0)
        if 3*ONE_MIN<=gap<=9*ONE_MIN and before.get('continuous_absorption_verified') is False:
            pair=[before,current]
    memory[sym]=current
    return {'status':'TWO_DISTINCT_BOOK_SNAPSHOTS' if len(pair)==2 else 'WAIT_SECOND_BOOK',
            'snapshots':pair,'continuous_absorption_verified':False,
            'position_owner_verified':False}


def collect_futures_flow_observations(latest, now_ms, api, limit=6, state=None, v18_select=False):
    """Supplemental verified public-futures evidence. Never creates Telegram or BUY/SHORT signals."""
    if not isinstance(latest,dict) or latest.get("collector_status")!="PASS":
        return {"status":"SKIPPED_SOURCE_NOT_PASS","observations":[],
                "alert_eligible":False,"observation_only":True}
    book_memory=state.setdefault('futures_book_snapshots_v13',{}) if isinstance(state,dict) else {}
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
    cap=limit if isinstance(limit,int) and 1<=limit<=10 else 6
    # A prior real book needs one more independent snapshot. Rank it ahead
    # of a fresh volume spike IF it is still valid in today's price/flow
    # preselection. Otherwise rotating top-volume lists never complete proof.
    # No extra entry threshold, API budget, alert, or synthetic data added.
    pending=[];new=[]
    for item in items:
        saved=book_memory.get(item[1])
        gap=(now_ms-int(saved.get('timestamp_ms',0))) if isinstance(saved,dict) else None
        if gap is not None and 3*ONE_MIN<=gap<=9*ONE_MIN:
            pending.append(item)
        else:
            new.append(item)
    selected=(pending+new)[:cap]
    out={"status":"NO_CANDIDATES" if not selected else "EVALUATED",
         "observation_only":True,"alert_eligible":False,
         "source":"Bitget official public futures historical fills pages + exact 15 closed 1m candles",
         "markets_evaluated":len(selected),"markets_eligible_for_proof":len(items),
         "pending_second_book_count":len(pending),
         "pending_second_book_selected":min(len(pending),len(selected)),
         "verified_count":0,"rejected_count":0,"classifications":{},
         "observations":[]}
    if v18_select:
        # V18 is OFF by default: this opt-in changes EVIDENCE TARGET DISCOVERY
        # only. Verified fills, price alignment, real book persistence, and
        # no-order/no-Telegram output contract are unchanged.
        from research.v18_flow_selector import select_v18_evidence_targets
        choice=select_v18_evidence_targets(latest,now_ms,state=state,limit=limit)
        # Keep part of the established volume-based targets while opening
        # the other half of the existing six-request budget to reversals.
        # Finish pending second-book observations first. No additional API budget.
        old_selected=list(selected)
        new_selected=[(float(len(choice.get('selected') or [])-i),x['symbol'],x)
                      for i,x in enumerate(choice.get('selected') or [])]
        old_quota=max(1,cap//2)
        new_quota=max(1,cap-old_quota)
        joined=[];chosen=set()
        def append_unique(candidates,quota):
            added=0
            for candidate in candidates:
                if len(joined)>=cap or added>=quota:break
                if candidate[1] in chosen:continue
                joined.append(candidate);chosen.add(candidate[1]);added+=1
        # Both previous-candidate and new-candidate book continuity preserved.
        def has_pending(candidate):
            old=book_memory.get(candidate[1])
            if not isinstance(old,dict):return False
            t=old.get('timestamp_ms')
            return isinstance(t,int) and 3*ONE_MIN<=now_ms-t<=9*ONE_MIN
        for candidate in old_selected+new_selected:
            if has_pending(candidate) and candidate[1] not in chosen and len(joined)<cap:
                joined.append(candidate);chosen.add(candidate[1])
        append_unique(new_selected,new_quota)
        append_unique(old_selected,old_quota)
        append_unique(new_selected,cap)
        append_unique(old_selected,cap)
        selected=joined[:cap]
        actual_new={x[1] for x in new_selected}
        selected_reversals=sum(
           ((finite((x[2].get('windows') or {}).get('5m',{}).get('price_change_pct')) or 0)*
            (finite((x[2].get('windows') or {}).get('15m',{}).get('price_change_pct')) or 0)<0)
           for x in selected)
        out.update({
            'status':'EVALUATED' if selected else 'NO_CANDIDATES',
            'selector_version':'V18_BLENDED_BASELINE_PLUS_REVERSAL_REAL_FLOW',
            'markets_evaluated':len(selected),
            'markets_eligible_for_proof':choice.get('eligible',0),
            'pending_second_book_count':choice.get('pending_book_selected',0),
            'pending_second_book_selected':sum(has_pending(x) for x in selected),
            'candidate_reversals_visible':choice.get('reversal_eligible',0),
            'selected_reversal_evidence_targets':selected_reversals,
            'selected_old_evidence_targets':sum(x[1] in {y[1] for y in old_selected} for x in selected),
            'selected_new_evidence_targets':sum(x[1] in actual_new for x in selected),
            'old_v17_selector_preserved_in_blend':True,
            'observation_only':True,'alert_eligible':False,
        })
        if isinstance(state,dict):
            checked=state.setdefault('v18_evidence_last_checked_ms',{})
            if not isinstance(checked,dict):
                checked={};state['v18_evidence_last_checked_ms']=checked
            for _rank,sym,_meta in selected:checked[sym]=now_ms
            state['v18_evidence_last_checked_ms']={
               k:v for k,v in checked.items() if isinstance(v,int) and
               0<=now_ms-v<=24*3600000}
    for _rank,sym,meta in selected:
        evidence=verify_taker_flow(sym,now_ms,api,max_pages=10)
        flow=classify_flow(evidence)
        book=paired_futures_books(sym,now_ms,api,book_memory)
        if evidence.get("verified"):out["verified_count"]+=1
        else:out["rejected_count"]+=1
        out["classifications"][flow]=out["classifications"].get(flow,0)+1
        # Measure actual RECENT 5m pressure and its change from the prior 10m.
        # This is a read-only numerical feature, NOT another hard condition,
        # orderbook absorption proof or an independently validated LONG/SHORT.
        pressure=None
        if evidence.get("verified") and len(evidence.get("blocks") or [])==3:
            blocks=evidence["blocks"]
            recent=blocks[2]
            prior_buy=sum(finite(b.get("buy_usdt")) or 0 for b in blocks[:2])
            prior_sell=sum(finite(b.get("sell_usdt")) or 0 for b in blocks[:2])
            previous_total=prior_buy+prior_sell
            recent_buy=finite(recent.get("buy_usdt")) or 0
            recent_sell=finite(recent.get("sell_usdt")) or 0
            current_total=recent_buy+recent_sell
            if previous_total>0 and current_total>0:
                previous_share=prior_buy/previous_total
                current_share=recent_buy/current_total
                recent_net=recent_buy-recent_sell
                prior_net=prior_buy-prior_sell
                p5=finite((meta.get("windows") or {}).get("5m",{}).get("price_change_pct"))
                five=(meta.get("windows") or {}).get("5m") or {}
                high,low,close=(finite(five.get(k)) for k in ("high","low","close"))
                range_pos=(close-low)/(high-low) if (None not in (high,low,close)
                                                  and high>low and low<=close<=high) else None
                book_reads=(book.get("snapshots") or []) if isinstance(book,dict) else []
                book_delta=None
                if len(book_reads)==2:
                    r0=finite(book_reads[0].get("bid_ask_top5_ratio"))
                    r1=finite(book_reads[1].get("bid_ask_top5_ratio"))
                    if r0 is not None and r1 is not None:
                        book_delta=round(r1-r0,6)
                pressure={
                    "status":"REAL_15M_RECONCILED_RECENT5_VS_PRIOR10",
                    "recent_5m_buy_share":round(current_share,6),
                    "prior_10m_buy_share":round(previous_share,6),
                    "buy_share_delta":round(current_share-previous_share,6),
                    "recent_5m_net_taker_usdt":round(recent_net,4),
                    "prior_10m_net_taker_usdt":round(prior_net,4),
                    "recent_5m_trades":recent.get("trades"),
                    "recent_5m_price_change_pct":p5,
                    "recent_flow_price_same_sign":(
                        (recent_net>0 and p5>0) or (recent_net<0 and p5<0))
                        if p5 is not None else None,
                    "signed_price_response_pct":round(
                        p5 if recent_net>0 else -p5,6) if p5 is not None else None,
                    "actual_5m_close_location_in_range":(
                        round(range_pos,6) if range_pos is not None else None),
                    "two_book_top5_ratio_change":book_delta,
                    "book_measurement_is_absorption_proof":False,
                    "direction_signal":False,"observation_only":True}
        # Raw verification data remain explicit; no claim about long/short positions.
        out["observations"].append({
            "symbol":sym,"observed_ms":(now_ms//ONE_MIN)*ONE_MIN,
            "window_5m_price_pct":meta.get("windows",{}).get("5m",{}).get("price_change_pct"),
            "window_15m_price_pct":meta.get("windows",{}).get("15m",{}).get("price_change_pct"),
            "oi_change_pct":(meta.get("oi") or {}).get("change_pct_from_previous_run"),
            "funding_rate":meta.get("funding_rate"),
            "flow_class":flow,
            "recent5_pressure_shift_research":pressure,
            "taker_flow_15m":evidence,
            "book_proof_v13":book,
            "observation_only":True,"send_allowed":False,
            "position_direction_verified":False,
        })
    if len(book_memory)>50:
        selected_symbols={s for _,s,_ in selected}
        evict=sorted(((key,row.get('timestamp_ms',0)) for key,row in book_memory.items()
            if key not in selected_symbols),key=lambda x:x[1])
        for key,_ in evict[:max(0,len(book_memory)-50)]:
            del book_memory[key]
    return out
