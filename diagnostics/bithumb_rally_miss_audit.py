"""Bithumb top-gainer missed-signal diagnostic. Official public REST only. No orders or alerts."""
import datetime as dt
import json
import statistics
import time
import urllib.parse
import urllib.request

BASE="https://api.bithumb.com"
KST=dt.timezone(dt.timedelta(hours=9))
def read(path,params):
    url=BASE+path+"?"+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={"User-Agent":"IRYS-readonly-rally-audit/1","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=20) as resp:
        if resp.status!=200:raise RuntimeError(f"HTTP_{resp.status}")
        return json.load(resp)
def val(x):
    try:
        n=float(x)
        return n if n==n and abs(n)<float("inf") else None
    except (TypeError,ValueError,OverflowError):return None
def mini(sym,now):
    raw=read("/v1/candles/minutes/1",{"market":sym,"count":120})
    end=now//60000*60000
    bar={}
    for r in raw if isinstance(raw,list) else []:
        try:
            stamp=int(dt.datetime.fromisoformat(r["candle_date_time_utc"]).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
            if stamp>=end:continue
            bar[stamp]=r
        except (KeyError,ValueError,TypeError):continue
    closed=lambda n:[bar.get(end-i*60000) for i in range(n,0,-1)]
    five=closed(5);fifteen=closed(15);hour=closed(60)
    fturn=sum(val(z.get("candle_acc_trade_price")) or 0 for z in five if z)
    quiet=[]
    for k in range(2,13):
        part=[bar.get(end-i*60000) for i in range(5*k,5*k-5,-1)]
        if all(part):quiet.append(sum(val(z.get("candle_acc_trade_price")) or 0 for z in part))
    prevmed=statistics.median(quiet) if len(quiet)>=8 else None
    cp=lambda z: 100*(val(z[-1].get("trade_price"))/val(z[0].get("opening_price"))-1) if all(z) and val(z[0].get("opening_price")) else None
    return {
      "closed_1m_15":sum(1 for z in fifteen if z),"closed_1m_60":sum(1 for z in hour if z),
      "last5m_quote_krw":round(fturn),"recent5m_complete":all(five),
      "last5m_pct":round(cp(five),3) if cp(five) is not None else None,
      "last15m_pct":round(cp(fifteen),3) if cp(fifteen) is not None else None,
      "prior_valid_5m_buckets":len(quiet),
      "last5m_volume_ratio":round(fturn/prevmed,2) if prevmed else None,
      "blocked_recent_candle_gap":not all(fifteen),
    }
def main():
    now=int(time.time()*1000)
    stamp=dt.datetime.fromtimestamp(now/1000,KST).isoformat(timespec="seconds")
    markets=read("/v1/market/all",{"isDetails":"true"})
    listed={m["market"]:m for m in markets if str(m.get("market","")).startswith("KRW-")}
    tickers=[]
    names=list(listed)
    for i in range(0,len(names),120):
        part=read("/v1/ticker",{"markets":",".join(names[i:i+120])})
        if not isinstance(part,list):raise RuntimeError("TICKER_NOT_ARRAY")
        tickers.extend(part)
        time.sleep(.12)
    ranked=[]
    for t in tickers:
        market=t.get("market")
        if market not in listed:continue
        ch=val(t.get("signed_change_rate"))
        turnover=val(t.get("acc_trade_price_24h"))
        if ch is None:continue
        ranked.append({"market":market,"pct_24h":round(ch*100,2),
            "price_krw":val(t.get("trade_price")),
            "turnover_24h_krw":round(turnover) if turnover is not None else None,
            "warning":listed[market].get("market_warning"),
            "suspended":t.get("is_trading_suspended")})
    ranked.sort(key=lambda x:(-x["pct_24h"],-float(x["turnover_24h_krw"] or 0)))
    print("OFFICIAL_BITHUMB_TOP_GAINERS",json.dumps({"checked_kst":stamp,
       "krw_market_count":len(listed),"tickers_received":len(tickers),
       "top20_24h":ranked[:20]},ensure_ascii=False))
    for t in ranked[:12]:
        market=t["market"]
        try: 
            d=mini(market,now)
            print("BITHUMB_GAINER_CANDLE_AUDIT",json.dumps({**t,**d,"checked_kst":stamp},ensure_ascii=False))
        except Exception as e:
            print("BITHUMB_GAINER_CANDLE_AUDIT",json.dumps({"market":market,"status":"UNVERIFIED","error_type":type(e).__name__}))
        time.sleep(.14)
if __name__=="__main__":main()
