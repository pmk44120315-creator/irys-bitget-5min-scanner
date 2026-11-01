"""Bitget verified-crypto fast public price-only source for Cloudflare 403 fallback.

Triggered by REQUEST of the existing five-minute scan, not its completion.
Uses standard documented public Bitget HTTP from the GitHub runner. No keys,
accounts, orders, Telegram or fake CVD. Keeps full-market identity in V2+V3.
"""
from __future__ import annotations
import datetime as dt
import json
import math
import pathlib
import time

import collector

BASE=pathlib.Path(__file__).resolve().parent
OUT=BASE/'data/v24_bitget_fast_latest.json'
VERSION='IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1'
MAX_SOURCE_AGE_MS=120_000
MIN_GAP_MS=168_000
MAX_GAP_MS=540_000

def num(x):
    if x is None or isinstance(x,bool):return None
    try:
        f=float(x)
        return f if math.isfinite(f) else None
    except (ValueError,TypeError,OverflowError):return None

def digest(items,prev,now):
    if not isinstance(items,dict) or any(k not in items for k in ('instruments','contracts','tickers')):
        raise ValueError('PUBLIC_PROVIDER_DATA_INCOMPLETE')
    v3=items['instruments'];v2=items['contracts'];ticks=items['tickers']
    if any(not isinstance(x,list) or len(x)<100 for x in (v3,v2,ticks)):
        raise ValueError('PUBLIC_MARKET_UNIVERSE_INCOMPLETE')
    crypto={x.get('symbol') for x in v3 if isinstance(x,dict)
        and str(x.get('symbolType','')).lower()=='crypto'
        and str(x.get('instrumentType','')).lower()=='crypto'}
    active={x.get('symbol') for x in v2 if isinstance(x,dict)
        and x.get('symbolStatus')=='normal'
        and x.get('symbolType')=='perpetual'
        and x.get('quoteCoin')=='USDT'}
    eligible=crypto&active
    if len(eligible)<100:raise ValueError('NO_VERIFIED_ACTIVE_CRYPTO')
    oldAt=prev.get('at_ms') if isinstance(prev,dict) else None
    elapsed=now-oldAt if isinstance(oldAt,int) and oldAt<=now else None
    comparable=elapsed is not None and MIN_GAP_MS<=elapsed<=MAX_GAP_MS
    prices={};watch=[];seen=set();rejected_stale=0
    for x in ticks:
        if not isinstance(x,dict):continue
        s=x.get('symbol')
        if s not in eligible or not isinstance(s,str) or not s.endswith('USDT') or s in seen:
            continue
        seen.add(s)
        p=num(x.get('lastPr'));bid=num(x.get('bidPr'));ask=num(x.get('askPr'))
        at=num(x.get('ts'));v24=num(x.get('usdtVolume'))
        if p is None or p<=0 or bid is None or bid<=0 or ask is None or ask<bid or at is None:
            continue
        if at>now+60_000 or now-at>MAX_SOURCE_AGE_MS:
            rejected_stale+=1;continue
        spread_pct=100*(ask/bid-1)
        if spread_pct>1.5:continue
        old=prev.get('prices',{}).get(s) if isinstance(prev,dict) else None
        prior=num(old[0]) if isinstance(old,list) and old else None
        change=100*(p/prior-1) if comparable and prior and prior>0 else None
        prices[s]=[p,change if change is not None else 0,at]
        if change is None or change<=0:continue  # the alert target is an upward first impulse
        older_move=num(old[1]) if isinstance(old,list) and len(old)>1 else None
        acceleration=change-(older_move if older_move is not None else 0)
        score=1.7*change+.4*math.log1p(max(0,v24 or 0)/100_000)+.35*max(-3,min(3,acceleration))-.7*spread_pct
        if change>=.7:
            watch.append({
              'venue':'bitget','symbol':s,'move_pct':round(change,4),
              'price':p,'spread_pct':round(spread_pct,5),
              'price_acceleration_pct':round(acceleration,4),
              'quote_24h_usdt':v24,
              'price_timestamp_ms':int(at),
              'priority':round(score,4),
              'identity_verified_v3_crypto':True,
              'active_contract_verified_v2':True,
              'source':'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST',
              'price_only_not_future_direction':True})
    watch.sort(key=lambda r:(-r['priority'],r['symbol']))
    status='MARKET_COMPARISON_PASS' if comparable else 'BASELINE_WARMING_OR_TIME_GAP'
    if len(prices)<100:raise ValueError('PUBLIC_TICKER_VALID_COVERAGE_TOO_LOW')
    return {'version':VERSION,'status':status,
        'at_utc':dt.datetime.fromtimestamp(now/1000,dt.timezone.utc).isoformat(),
        'at_ms':now,'producer':'GITHUB_ACTIONS_REQUESTED_ON_ORIGINAL_5M_SCAN',
        'venue':'bitget','source_identity':'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO',
        'active_verified_crypto_count':len(eligible),
        'actual_official_tickers_count':len(prices),
        'rejected_stale_tickers':rejected_stale,
        'comparison_gap_minutes':round(elapsed/60_000,3) if elapsed is not None else None,
        'candidates':watch[:20],'candidate_count':len(watch),
        'prices':prices,'trade_data_included':False,
        'not_full_orderbook_or_marketwide_cvd':True,
        'not_profitable_future_direction_proof':True,
        'telegram_sent':False,'orders_sent':False}

def main():
    raw={}
    try:raw=json.loads(OUT.read_text('utf-8'))
    except (FileNotFoundError,json.JSONDecodeError):pass
    inputs={
       'instruments':collector.http_json('bitget','/api/v3/market/instruments',{'category':'USDT-FUTURES'}),
       'contracts':collector.http_json('bitget','/api/v2/mix/market/contracts',{'productType':'USDT-FUTURES'}),
       'tickers':collector.http_json('bitget','/api/v2/mix/market/tickers',{'productType':'USDT-FUTURES'})}
    out=digest(inputs,raw,int(time.time()*1000))
    collector.write_json_atomic(OUT,out)
    print('V24_BITGET_OFFICIAL_FAST_SOURCE',json.dumps({k:out[k] for k in (
       'status','at_utc','active_verified_crypto_count','actual_official_tickers_count',
       'rejected_stale_tickers','comparison_gap_minutes','candidate_count')},ensure_ascii=False))
if __name__=='__main__':main()
