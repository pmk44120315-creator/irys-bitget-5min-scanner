"""NO-DEPLOY causal replay of *actual saved* futures fills/books and later prices.

Objective: compare old 15m uniform-direction hard gate with early last-5m
pressure that is independently supported by native price and *two distinct
book snapshots*. This is an audit, NOT a trading policy or Telegram engine.
No random thresholds, no fabricated candles, no orders, no look-ahead features.
"""
import bisect
import collections
import datetime as dt
import json
import math
import statistics
import subprocess

HORIZONS=(5,15,30,60)
KST=dt.timezone(dt.timedelta(hours=9))
MIN=60000

def run_git(*args):
    return subprocess.run(["git",*args],capture_output=True,text=True,check=True).stdout

def num(x):
    try:
        n=float(x)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError,OverflowError):
        return None

def read_all():
    shas=run_git("log","--format=%H","--","data/latest.json").splitlines()
    states={}
    invalid=0
    for sha in reversed(shas):
        try:
            j=json.loads(run_git("show",sha+":data/latest.json"))
        except (subprocess.CalledProcessError,json.JSONDecodeError):
            invalid+=1
            continue
        if j.get("collector_status")!="PASS":
            invalid+=1
            continue
        tstr=j.get("finished_utc")
        try:stamp=int(dt.datetime.fromisoformat(tstr.replace("Z","+00:00")).timestamp()*1000)
        except (ValueError,TypeError,AttributeError):
            invalid+=1;continue
        prices={}
        for x in (j.get("watchlist") or [])+(j.get("early_pool") or [])+(j.get("comparison_symbols") or []):
            if not isinstance(x,dict) or x.get("venue")!="bitget":continue
            sym=x.get("symbol")
            w=x.get("windows") or {}
            price=num((w.get("1m") or {}).get("close"))
            if price is None or price<=0:price=num((w.get("5m") or {}).get("close"))
            if isinstance(sym,str) and price and price>0:prices[sym]=price
        key=(j.get("collector_utc"), j.get("finished_utc"))
        states[key]={"t":stamp,"prices":prices,"flows":j.get("futures_flow") or {},
                     "instruments":{x.get("symbol"):x
                           for x in (j.get("watchlist") or [])+(j.get("early_pool") or [])
                           if isinstance(x,dict) and x.get("symbol")}}
    timeline=sorted(states.values(),key=lambda x:x["t"])
    return timeline,len(shas),invalid

def book_two(o,side,now):
    data=o.get("book_proof_v13") or {}
    p=data.get("snapshots") or []
    if data.get("status")!="TWO_DISTINCT_BOOK_SNAPSHOTS" or len(p)!=2:
        return False
    a,b=p
    t0,t1=num(a.get("timestamp_ms")),num(b.get("timestamp_ms"))
    ratio0,ratio1=num(a.get("bid_ask_top5_ratio")),num(b.get("bid_ask_top5_ratio"))
    spread0,spread1=num(a.get("spread_pct")),num(b.get("spread_pct"))
    if None in (t0,t1,ratio0,ratio1,spread0,spread1):return False
    if not 3*MIN<=t1-t0<=9*MIN or now-t1>12*MIN or t1>now+MIN:return False
    if max(spread0,spread1)>.8 or min(spread0,spread1)<0:return False
    return min(ratio0,ratio1)>=1 if side=="LONG" else max(ratio0,ratio1)<=1

def evidence_sign(snapshot,o):
    if o.get("taker_flow_15m",{}).get("verified") is not True:return None
    contract=snapshot["instruments"].get(o.get("symbol"))
    if not isinstance(contract,dict) or contract.get("asset_identity")!="VERIFIED_CRYPTO" or contract.get("isRwa")!="NO":return None
    if contract.get("contract_status")!="normal" or contract.get("symbolType")!="perpetual":return None
    w=contract.get("windows") or {}
    p5=num((w.get("5m") or {}).get("price_change_pct"))
    p15=num((w.get("15m") or {}).get("price_change_pct"))
    latest=num((w.get("5m") or {}).get("close"))
    e=o["taker_flow_15m"]
    blocks=e.get("blocks")
    if p5 is None or p15 is None or not latest or not isinstance(blocks,list) or len(blocks)!=3:return None
    b=blocks[2]
    recent_net=num(b.get("net_buy_usdt"))
    recent_share=num(b.get("buy_share"))
    if recent_net is None or recent_share is None:return None
    if recent_net>0 and recent_share>=.62 and p5>0:side="LONG"
    elif recent_net<0 and recent_share<=.38 and p5<0:side="SHORT"
    else:return None
    all15=(side=="LONG" and e.get("net_buy_usdt",0)>0 and e.get("buy_share",0)>=.62 and
           all(x.get("net_buy_usdt",0)>0 and x.get("buy_share",0)>=.58 for x in blocks)) or (
           side=="SHORT" and e.get("net_buy_usdt",0)<0 and e.get("buy_share",1)<=.38 and
           all(x.get("net_buy_usdt",0)<0 and x.get("buy_share",1)<=.42 for x in blocks))
    return {"symbol":o["symbol"],"side":side,"price":latest,
            "all15":all15,"p15_align":p15>0 if side=="LONG" else p15<0,
            "book":book_two(o,side,snapshot["t"]),
            "blocks":blocks,"now":snapshot["t"],
            "last_quote":num(b.get("buy_usdt"))+num(b.get("sell_usdt"))
                if num(b.get("buy_usdt")) is not None and num(b.get("sell_usdt")) is not None else None}

def later_price(timeline,times,idx,sym,horizon):
    base=timeline[idx]["t"]+horizon*MIN
    k=bisect.bisect_left(times,base)
    while k<len(timeline) and timeline[k]["t"]-base<=8*MIN:
        v=timeline[k]["prices"].get(sym)
        if v and v>0:return v,timeline[k]["t"]
        k+=1
    return None,None

def outcomes(group,entries,timeline,times):
    kept=[];seen={}
    for idx,e in entries:
        key=e["symbol"]  # Different signals on the same symbol are one independent 60m episode.
        if timeline[idx]["t"]-seen.get(key,-10**18)<60*MIN:continue
        seen[key]=timeline[idx]["t"]
        kept.append((idx,e))
    horizons={}
    examples=[]
    for horizon in HORIZONS:
        records=[]
        for idx,e in kept:
            later,at=later_price(timeline,times,idx,e["symbol"],horizon)
            if not later:continue
            raw=(later/e["price"]-1)*100
            signed=raw if e["side"]=="LONG" else -raw
            records.append((signed,e,at))
        vals=[r[0] for r in records]
        horizons[str(horizon)+"m"]={
            "observed":len(vals),"direction_correct":sum(x>=.15 for x in vals),
            "direction_wrong":sum(x<=-.15 for x in vals),
            "flat":sum(-.15<x<.15 for x in vals),
            "signed_mean_pct":round(statistics.mean(vals),4) if vals else None,
            "signed_median_pct":round(statistics.median(vals),4) if vals else None}
        if horizon==60:
            records.sort(key=lambda x:x[0])
            def ex(r):
                x,e,t=r
                return {"symbol":e["symbol"],"side":e["side"],"signed_60m_pct":round(x,3),
                  "at_kst":dt.datetime.fromtimestamp(e["now"]/1000,KST).isoformat(timespec="minutes")}
            examples=[ex(x) for x in records[:3]]+[ex(x) for x in records[-3:]]
    return {"events":len(kept),"horizons":horizons,"outcome_examples":examples}

def main():
    timeline,count,invalid=read_all()
    times=[x["t"] for x in timeline]
    cases=collections.defaultdict(list)
    counters=collections.Counter()
    for i,snap in enumerate(timeline):
        flow=snap["flows"]
        if flow.get("status")!="EVALUATED":continue
        for o in flow.get("observations") or []:
            counters["observations"]+=1
            if (o.get("taker_flow_15m") or {}).get("verified") is True:
                counters["15m_fills_reconciled"]+=1
            if (o.get("book_proof_v13") or {}).get("status")=="TWO_DISTINCT_BOOK_SNAPSHOTS":
                counters["two_books"]+=1
            e=evidence_sign(snap,o)
            if not e:continue
            counters["latest5_flow_and_price_agree"]+=1
            cases["latest5_flow_price_only"].append((i,e))
            if e["all15"]:
                counters["15m_all3_uniform"]+=1
                cases["strict_15m_uniform_price"].append((i,e))
            if e["p15_align"]:
                cases["latest5_plus_15m_price_align"].append((i,e))
            if e["book"]:
                counters["latest5_two_books_aligned"]+=1
                cases["latest5_two_books_aligned"].append((i,e))
                if not e["all15"]:
                    cases["5m_turning_pressure_not_15m_uniform"].append((i,e))
                if e["p15_align"]:
                    cases["latest5_books_15m_price_align"].append((i,e))
                if e["all15"]:
                    cases["strict_15m_uniform_plus_books"].append((i,e))
    result={"status":"REAL_SAVED_FUTURES_EVIDENCE_SHADOW_REPLAY",
            "commits_examined":count,"valid_snapshots":len(timeline),"invalid":invalid,
            "earliest_kst":dt.datetime.fromtimestamp(times[0]/1000,KST).isoformat() if times else None,
            "latest_kst":dt.datetime.fromtimestamp(times[-1]/1000,KST).isoformat() if times else None,
            "counters":dict(counters),"scenarios":{key:outcomes(key,arr,timeline,times)
                 for key,arr in sorted(cases.items())},
            "limitations":["Saved 1m snapshot closes, NOT exact alert executions or independent all-market price feed.",
              "If a symbol leaves the recorded watchlist/early_pool, future price coverage is missing and unmeasured.",
              "No survival bias correction and no fees/slippage: do not call this a trading win rate.",
              "Candidate feature comparisons use only contemporaneous snapshots. Future prices are labels, never features.",
              "One independent time-bucket per symbol per 60-minute episode."]}
    print("IRYS_V15_SHADOW_REPLAY "+json.dumps(result,ensure_ascii=False,separators=(",",":")))

if __name__=="__main__":
    main()
