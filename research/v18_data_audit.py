#!/usr/bin/env python3
"""READ-ONLY V18 archive feasibility study. No secret, order, Worker or Telegram IO.

Replay immutable historical Git main data/latest.json commits, in time order.
An entry is anchored to the first officially stored full-market closed price
AFTER the archive snapshot finished. No contemporaneous feature can see future
price data. A target needs the exact +5/+15/+30/+60 minute closed-time record.
"""
import bisect
import collections
import datetime as dt
import json
import math
import statistics
import subprocess
import sys

UTC = dt.timezone.utc
def finite(x):
    try:
        f = float(x)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError, OverflowError):
        return None
def as_ms(s):
    try:
        z=dt.datetime.fromisoformat(s.replace("Z","+00:00"))
        return round(z.timestamp()*1000)
    except (TypeError, ValueError, AttributeError):
        return None
def git(*args):
    r=subprocess.run(["git",*args],check=False,capture_output=True)
    if r.returncode: raise RuntimeError("GIT_"+str(args[:2])+" "+r.stderr.decode("utf8","replace")[:120])
    return r.stdout

def main():
    hashes=git("log","refs/remotes/origin/main","--format=%H","--","data/latest.json").decode().splitlines()
    coverage=collections.Counter()
    price_by_time=collections.defaultdict(dict)
    evidence=[]
    versions=collections.Counter()
    observed_times=set()
    for index,sha in enumerate(reversed(hashes)):
        try:
            d=json.loads(git("show",sha+":data/latest.json"))
        except Exception as ex:
            coverage["bad_blob"]+=1
            continue
        if d.get("collector_status")!="PASS":
            coverage["nonpass"]+=1
            continue
        finished=as_ms(d.get("finished_utc"))
        if finished is None:
            coverage["missing_finish"]+=1
            continue
        observed_times.add(finished)
        versions[d.get("schema_version","UNKNOWN")]+=1
        for symbol,p in (d.get("verified_crypto_futures_closed_prices") or {}).items():
            if not isinstance(p,dict):continue
            at=p.get("closed_end_ms")
            close=finite(p.get("close_usdt"))
            if isinstance(at,int) and close and close>0 and symbol.endswith("USDT"):
                price_by_time[at][symbol]=close
        by_symbol={}
        for r in d.get("early_pool") or []:
            if isinstance(r,dict) and r.get("asset_identity")=="VERIFIED_CRYPTO":
                if isinstance(r.get("symbol"),str):by_symbol[r["symbol"]]=r
        for r in d.get("watchlist") or []:
            if isinstance(r,dict) and r.get("asset_identity")=="VERIFIED_CRYPTO":
                if isinstance(r.get("symbol"),str):by_symbol[r["symbol"]]=r
        verified_flow={x.get("symbol"):x for x in
            (d.get("futures_flow") or {}).get("observations",[])
            if isinstance(x,dict) and isinstance(x.get("symbol"),str)}
        for sym,item in by_symbol.items():
            windows=item.get("windows") or {}
            w5=windows.get("5m") or {}
            close=finite(w5.get("close"))
            close_time=w5.get("end_utc_ms")
            if not (close and close>0 and isinstance(close_time,int)):
                coverage["bad_candidate_clock"]+=1
                continue
            evidence.append({
                "symbol":sym,"published_ms":finished,"asof_ms":close_time,
                "price_close":close,"pct5m":finite(w5.get("price_change_pct")),
                "pct15m":finite((windows.get("15m") or {}).get("price_change_pct")),
                "flow_verified":(verified_flow.get(sym) or {}).get("taker_flow_15m",{}).get("verified") is True
            })
        coverage["pass_snapshots"]+=1
        if (index+1)%250==0: print("V18_ARCHIVE_PROGRESS",index+1,"/",len(hashes),flush=True)
    timeline=sorted(price_by_time)
    coverage["history_commits"]=len(hashes)
    coverage["distinct_market_price_times"]=len(timeline)
    coverage["unlabelled_candidate_observations"]=len(evidence)
    label_counts=collections.Counter()
    anchors=[];rows=[]
    for r in evidence:
        i=bisect.bisect_right(timeline,r["published_ms"])
        if i>=len(timeline):continue
        anchor=timeline[i]
        delay=(anchor-r["published_ms"])/60000
        if delay>7: label_counts["anchor_too_late"]+=1;continue
        init=price_by_time[anchor].get(r["symbol"])
        if not init:label_counts["anchor_instrument_missing"]+=1;continue
        h={}
        for minutes in (5,15,30,60):
            future=price_by_time.get(anchor+minutes*60000,{}).get(r["symbol"])
            if future and future>0:
                h[minutes]=100*(future/init-1)
                label_counts[str(minutes)+"m"]+=1
        if 15 in h:
            anchors.append(delay)
            rows.append((r,h))
        else:label_counts["no_exact_15m"]+=1
    naive=collections.Counter()
    for r,h in rows:
        direction=1 if (r["pct5m"] or 0)>0 else -1 if (r["pct5m"] or 0)<0 else 0
        if direction and abs(h[15])>=.15:
            naive["15m_naive_evaluated"]+=1
            if direction*h[15]>.15:naive["15m_naive_correct"]+=1
            else:naive["15m_naive_wrong"]+=1
        elif direction:naive["15m_naive_flat"]+=1
        if r["flow_verified"]:naive["verified_taker_available"]+=1
    print("V18_HISTORIC_REPLAY_FEASIBILITY",json.dumps({
        "coverage":coverage,"versions":versions,"outcomes":label_counts,
        "anchor_delay_median_min":statistics.median(anchors) if anchors else None,
        "anchor_delay_max_min":max(anchors) if anchors else None,
        "first_market_asof_ms":timeline[0] if timeline else None,
        "last_market_asof_ms":timeline[-1] if timeline else None,
        "naive":naive,
        "definitions":{
            "signal_available_at":"snapshot.finished_utc",
            "entry_proxy":"first stored full-market official complete candle ending strictly AFTER published time",
            "future_horizon":"exact matching official closed candle minute after entry proxy",
            "symbol_coverage":"early_pool and watchlist verified crypto futures only",
            "training_or_model":"NONE - discovery audit only",
            "outcome_proxy":"not an actual trade execution; excludes slippage/fees"},
        "no_worker_mutations":True,"no_bot_messages":True},ensure_ascii=False,default=dict))
if __name__=="__main__":main()
