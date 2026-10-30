#!/usr/bin/env python3
"""READ-ONLY: verify whether the existing Bithumb ticker snapshots can
provide forward labels for AI spot BUY prediction, without fabricated candles."""
import bisect, collections, json, statistics
from v18_data_audit import git, as_ms, finite
from datetime import datetime,timezone

def main():
    hashes=git("log","refs/remotes/origin/main","--format=%H","--","data/latest.json").decode().splitlines()
    price_by_t={};events=[];clock_lag=[]
    count=collections.Counter()
    for sha in reversed(hashes):
        try: d=json.loads(git("show",sha+":data/latest.json"))
        except Exception: count["snapshot_read_failed"]+=1;continue
        if d.get("collector_status")!="PASS":continue
        published=as_ms(d.get("finished_utc"))
        if not published:continue
        try: st=json.loads(git("show",sha+":data/state.json"))
        except Exception:count["state_read_failed"]+=1;continue
        fast=(st.get("spot_fast") or {})
        timestamp=fast.get("time_ms")
        if not isinstance(timestamp,int) or timestamp<=0:continue
        prices={}
        for symbol,item in (fast.get("prices") or {}).items():
            value=finite(item[0]) if isinstance(item,list) and item else None
            if value and value>0 and isinstance(symbol,str) and symbol.startswith("KRW-"):prices[symbol]=value
        if len(prices)<100:continue
        price_by_t[timestamp]=prices
        count["valid_state_snapshots"]+=1
        seeds=(d.get("spot_flow") or {}).get("direction_review_seeds") or []
        mapped={}
        for x in seeds:
            if isinstance(x,dict) and isinstance(x.get("market"),str):mapped[x["market"]]=x
        for symbol,seed in mapped.items():
            event_price=finite(seed.get("price_krw"))
            if event_price and event_price>0:
                events.append((symbol,published,timestamp,seed))
                count["candidate_events"]+=1
        clock_lag.append((published-timestamp)/60000)
    times=sorted(price_by_t)
    delays=[];measured=[];unavailable=collections.Counter()
    for sym,published,seen,seed in events:
        idx=bisect.bisect_right(times,published)
        if idx>=len(times):unavailable["no_future_anchor"]+=1;continue
        t0=times[idx]
        if t0-published>7*60000:unavailable["anchor_late"]+=1;continue
        p0=price_by_t[t0].get(sym)
        if not p0:unavailable["symbol_missing"]+=1;continue
        target=t0+15*60000
        j=bisect.bisect_left(times,target)
        candidates=[times[k] for k in (j-1,j,j+1) if 0<=k<len(times) and abs(times[k]-target)<=150000]
        found=next(((t,price_by_t[t].get(sym)) for t in sorted(candidates,key=lambda x:abs(x-target)) if price_by_t[t].get(sym)),None)
        if found:
            measured.append((sym,100*(found[1]/p0-1),seed))
            delays.append((t0-published)/60000)
        else:unavailable["missing_target_approx_15m"]+=1
    signs=[((1 if (finite(seed.get("observed_5m_price_change_pct")) or 0)>0 else -1),r)
      for sym,r,seed in measured if (finite(seed.get("observed_5m_price_change_pct")) or 0)!=0]
    decisive=[(d,r) for d,r in signs if abs(r)>=.15]
    correct=sum(d*r>0 for d,r in decisive)
    print("V18_SPOT_TICKER_FORWARD_FEASIBILITY",json.dumps({
       "records":len(hashes),"ticker_snapshots":count["valid_state_snapshots"],
       "candidate_observations":len(events),"approx_15m_matched":len(measured),
       "full_market_price_times":len(times),
       "price_time_range_utc":[datetime.fromtimestamp(x/1000,timezone.utc).isoformat() for x in (times[0],times[-1])] if times else None,
       "median_asof_lag_min":statistics.median(clock_lag) if clock_lag else None,
       "median_first_postpublication_entry_delay_min":statistics.median(delays) if delays else None,
       "unavailable":unavailable,
       "naive_spot_15m":{"decisive":len(decisive),"correct":correct,"accuracy":correct/len(decisive) if decisive else None},
       "important":"Bithumb snapshot ticker prices, NOT a continuous completed candle and NOT executable bid/ask; 15m label target plus/minus 2.5min",
       "no_deployment":True,"no_orders":True},ensure_ascii=False,default=dict))
if __name__=="__main__":main()
