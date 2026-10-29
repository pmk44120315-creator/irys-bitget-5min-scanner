"""Full available Git-history replay of ticker-only Bithumb prescreen cohorts.

READ ONLY, NO DEPLOY, NO ORDERS, NO TELEGRAM. A ranked ticker observation
does not establish venue-local taker CVD or future directional accuracy.
Use the full accessible history; no artificial test-count/time cap.
"""
from __future__ import annotations
import bisect
import datetime as dt
import json
import math
import statistics
import subprocess
from collections import defaultdict

M = 60_000
HORIZONS = (5, 15, 30, 60)
KST = dt.timezone(dt.timedelta(hours=9))


def git_out(*cmd):
    return subprocess.run(["git", *cmd], capture_output=True, text=True, check=True).stdout


def repo_json(sha, path):
    try:
        return json.loads(git_out("show", f"{sha}:{path}"))
    except (subprocess.CalledProcessError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def positive(v):
    try:
        x=float(v)
        return x if math.isfinite(x) and x > 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def load_history():
    commits=git_out("log", "--format=%H", "--", "data/state.json").splitlines()
    timeline={}
    invalid=0
    for sha in reversed(commits):
        state=repo_json(sha, "data/state.json")
        latest=repo_json(sha, "data/latest.json")
        fast=state.get("spot_fast", {}) if isinstance(state,dict) else {}
        if not isinstance(latest,dict) or latest.get("collector_status")!="PASS":
            invalid+=1
            continue
        t=fast.get("time_ms")
        prices=fast.get("prices")
        if (not isinstance(t,int) or not isinstance(prices,dict)
                or len(prices)<100):
            invalid+=1
            continue
        # The collector_utc field marks the START of a 2-3 minute run.
        # spot_fast.time_ms is stamped near its END during spot_flow reads.
        # Compare equal-stage clocks, otherwise almost every valid 5m run
        # is falsely thrown away as a "stale" replay snapshot.
        spot=latest.get("spot_flow",{})
        if not isinstance(spot,dict) or spot.get("status")!="PASS":
            invalid+=1
            continue
        stamp=spot.get("observed_utc")
        try:
            actual=int(dt.datetime.fromisoformat(stamp).timestamp()*1000)
        except (ValueError,TypeError,AttributeError):
            invalid+=1
            continue
        if abs(actual-t)>90_000:
            # A duplicate under-2m read may reuse the previous comparison anchor.
            # Do not pretend it is an independent sample.
            invalid+=1
            continue
        clean={}
        for symbol, row in prices.items():
            if not isinstance(row,list) or len(row)<2:continue
            price,quote=positive(row[0]),positive(row[1])
            if price is not None and quote is not None:
                clean[symbol]=(price,quote)
        if len(clean)<100:
            invalid+=1
            continue
        spot=latest.get("spot_flow", {})
        if not isinstance(spot,dict):spot={}
        timeline[t]={"t":t,"sha":sha,"day":fast.get("kst_day"),
                     "prices":clean,
                     "details":[x.get("market") for x in spot.get("detail_diagnostics",[])
                                if isinstance(x,dict) and isinstance(x.get("market"),str)],
                     "early":[x.get("market") for x in spot.get("early_watch_observations",[])
                              if isinstance(x,dict) and isinstance(x.get("market"),str)],
                     "rally":[{"market":x.get("market"),"reason":x.get("reason")}
                              for x in spot.get("rally_watch_only",[])
                              if isinstance(x,dict) and isinstance(x.get("market"),str)]}
    return [timeline[k] for k in sorted(timeline)], len(commits), invalid


def ranked_candidates(previous, current):
    gap=(current["t"]-previous["t"])/M
    if not 2<=gap<=8 or current["day"]!=previous["day"]:
        return []
    items=[]
    for sym, (price, cumulative) in current["prices"].items():
        before=previous["prices"].get(sym)
        if not before:
            continue
        old_price,old_cumulative=before
        if cumulative<=old_cumulative:
            continue
        move=100*(price/old_price-1)
        quote=(cumulative-old_cumulative)*5/gap
        if move>0 and quote>0:
            score=move*math.log1p(quote/10_000_000)
            items.append((score,sym))
    items.sort(key=lambda x:(-x[0],x[1]))
    # Same finite API review budget as the proposed source; this is NOT
    # an entry threshold and ignores missing official risk in historical state.
    return [sym for _score,sym in items[:8]]


def nearest_return(history, times, origin, symbol, horizon):
    target=origin["t"]+horizon*M
    index=bisect.bisect_left(times,target)
    if index>=len(history) or times[index]-target>8*M:
        return None
    price=history[index]["prices"].get(symbol)
    old=origin["prices"].get(symbol)
    if not price or not old:return None
    return 100*(price[0]/old[0]-1)


def summarise(group, events, history, times):
    all_h={str(h):[] for h in HORIZONS}
    examples=[]
    for index,sym in events:
        src=history[index]
        one={}
        for h in HORIZONS:
            val=nearest_return(history,times,src,sym,h)
            if val is not None:
                all_h[str(h)].append(val)
                one[str(h)]=round(val,4)
        if "60" in one:
            examples.append({"symbol":sym,"at_kst":dt.datetime.fromtimestamp(
                src["t"]/1000, KST).isoformat(timespec="minutes"),"return_60m_pct":one["60"]})
    metrics={}
    for h, values in all_h.items():
        n=len(values)
        metrics[h+"m"]={"measured":n,
            "up":sum(v>=.15 for v in values),
            "down":sum(v<=-.15 for v in values),
            "flat":sum(-.15<v<.15 for v in values),
            "mean_pct":round(statistics.mean(values),4) if n else None,
            "median_pct":round(statistics.median(values),4) if n else None}
    best=sorted(examples,key=lambda x:x["return_60m_pct"])
    return {"distinct_episodes":len(events),"horizons":metrics,
            "examples_worst60":best[:3],"examples_best60":best[-3:]}


def replay():
    history, commits, invalid=load_history()
    times=[x["t"] for x in history]
    last_seen={}
    events=defaultdict(list)
    comparisons=0
    for i,row in enumerate(history):
        if i==0:continue
        ranked=ranked_candidates(history[i-1],row)
        if not ranked:continue
        comparisons+=1
        early=set(row["early"])
        detail=set(row["details"])
        cohorts={
            "historical_early_watch":early,
            "historical_strict_detail":detail,
            "ranked_ticker_review_all":set(ranked),
            "ranked_newly_visible_no_old_watch":set(ranked)-early-detail,
        }
        for watch in row["rally"]:
            reason=watch["reason"]
            if reason in ("PRICE_ABOVE_EARLY_ENTRY_LIMIT",
                          "DAILY_MOVE_LIMIT","VOLUME_RATIO_BELOW_EARLY_ENTRY"):
                cohorts.setdefault("rally_previously_blocked_"+reason,set()).add(watch["market"])
        for group, symbols in cohorts.items():
            for sym in symbols:
                if sym not in row["prices"]:continue
                key=(group,sym)
                # Independent 60m event episodes avoid counting the same pump
                # once every 5 minutes as many statistically independent wins.
                if row["t"]-last_seen.get(key,-10**20)<60*M:
                    continue
                last_seen[key]=row["t"]
                events[group].append((i,sym))
    return {
      "status":"HISTORICAL_TICKER_SCREEN_REPLAY_COMPLETED",
      "source":"Actual git snapshots of state.json / latest.json; Bithumb ticker sampled prices",
      "commit_history_examined":commits, "valid_distinct_snapshots":len(history),
      "invalid_or_unsynchronised":invalid, "comparable_intervals":comparisons,
      "earliest_kst":dt.datetime.fromtimestamp(times[0]/1000,KST).isoformat() if times else None,
      "latest_kst":dt.datetime.fromtimestamp(times[-1]/1000,KST).isoformat() if times else None,
      "groups":{k:summarise(k,v,history,times) for k,v in sorted(events.items())},
      "limitations":["Historical ticker snapshots are not actual Telegram entry prices.",
                     "Prices are sampled about every five minutes, not exact horizon candle closes or highs/lows.",
                     "Historical official warning membership was not persisted for every ticker; reconstructed ranked set is pre-risk-check only.",
                     "No saved complete contemporaneous CVD/books for every ticker; this cannot prove alert hit rate.",
                     "Never treat time-overlapping candidate observations as independent trades or wins."]}


if __name__=="__main__":
    print("IRYS_PRESCREEN_FULL_GIT_REPLAY "+json.dumps(replay(),ensure_ascii=False,separators=(",",":")))
