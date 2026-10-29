"""Causal Bithumb price context from authentic completed native 5-minute bars.

Never fill missing 1-minute candles with synthetic close, volume, timestamps,
or candles. The exchange-native 5m aggregates are independently sourced and
the 15m quote total is NOT marked verified until paginated real trades reconcile.
"""
from __future__ import annotations
import datetime as dt
import math

ONE_MINUTE=60_000
FIVE_MINUTES=5*ONE_MINUTE
KST=dt.timezone(dt.timedelta(hours=9))


def number(x):
    try:
        value=float(x)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError, OverflowError):
        return None


def parse_native_five(raw, asof_ms):
    """Return only real, fully completed 5m OHLC/quote from Bithumb API."""
    complete={}
    end=(int(asof_ms)//ONE_MINUTE)*ONE_MINUTE
    for item in raw if isinstance(raw,list) else []:
        if not isinstance(item,dict):continue
        try:
            when=dt.datetime.fromisoformat(item['candle_date_time_utc'])
            if when.tzinfo is None:when=when.replace(tzinfo=dt.timezone.utc)
            stamp=int(when.timestamp()*1000)
        except (ValueError, TypeError, KeyError, OverflowError):
            continue
        fields=[number(item.get(k)) for k in (
            'opening_price','high_price','low_price','trade_price','candle_acc_trade_price')]
        if (stamp%FIVE_MINUTES or stamp+FIVE_MINUTES>end or
            any(v is None for v in fields)):
            continue
        op,high,low,close,quote=fields
        if (op<=0 or low<=0 or close<=0 or quote<0 or
            high<max(op,close) or low>min(op,close)):
            continue
        complete[stamp]={'open':op,'high':high,'low':low,
                          'close':close,'quote_krw':quote,
                          'timestamp_ms':stamp,'completed_end_ms':stamp+FIVE_MINUTES}
    return complete


def native_market_structure(recent_one, native, asof_ms):
    """Price direction with authentic 5m baselines and fresh closed trade prices.

    Prior ranges are informational, not an arbitrary price-breakout hard gate.
    One-minute gaps are disclosed; they do not prevent taker or orderbook reads.
    The 15m quote amount spans the last exact three completed exchange 5m
    periods; a missing native bucket contributes no invented zero candle.
    A complete real-trade reconciliation is still mandatory for an alert.
    """
    end=(int(asof_ms)//ONE_MINUTE)*ONE_MINUTE
    anchor=end//FIVE_MINUTES*FIVE_MINUTES
    newest_one=max(
        ((ts,bar) for ts,bar in recent_one.items()
         if isinstance(ts,int) and end-5*ONE_MINUTE<=ts<end),
        default=None,key=lambda p:p[0])
    latest_price=number(newest_one[1][3]) if newest_one else None
    last3=[native.get(anchor-i*FIVE_MINUTES) for i in (3,2,1)]
    present=[bar for bar in last3 if bar is not None]
    prior=[native.get(anchor-i*FIVE_MINUTES) for i in (6,5,4,3,2)]
    prior=[bar for bar in prior if bar is not None]
    observed_last20=sum(end-i*ONE_MINUTE in recent_one for i in range(1,21))
    base={
        'status':'WAIT_NATIVE_5M_CONTEXT','source':'BITHUMB_OFFICIAL_COMPLETED_NATIVE_5M_AND_TRADE_1M',
        'anchor_end_ms':anchor,'observed_at_ms':int(asof_ms),
        'closed_20m_candles':observed_last20==20,
        'observed_1m_bars_of_last20':observed_last20,
        'native_15m_buckets_observed':len(present),
        'native_15m_missing_buckets':[anchor-i*FIVE_MINUTES for i in (3,2,1)
                                       if native.get(anchor-i*FIVE_MINUTES) is None],
        'missing_1m_not_zero_filled':True,'native_missing_5m_not_zero_filled':True,
        'no_future_data':True,
        'closed_15m_turnover_krw':sum(bar['quote_krw'] for bar in present),
        'closed_15m_turnover_verified_by_taker':False,
        'latest_closed_1m_ms':newest_one[0] if newest_one else None,
        'structure_limit':'Observed price/flow context, not proven BOS, absorption or future direction',
    }
    if not present:
        return base
    latest_native=present[-1]
    if latest_price is None:
        # We can retain real native evidence for later review, but cannot claim
        # a current directional price without an actual recent minute close.
        return {**base,'status':'WAIT_RECENT_CLOSED_1M_PRICE'}
    if not prior:
        return {**base,'status':'WAIT_PRIOR_NATIVE_5M_PRICE'}
    if (latest_native['completed_end_ms']>anchor or
        newest_one[0]+ONE_MINUTE>end):
        return {**base,'status':'INVALID_ASOF_WINDOW'}
    prior_high=max(x['high'] for x in prior)
    prior_low=min(x['low'] for x in prior)
    native_last_change=100*(latest_native['close']/latest_native['open']-1)
    observed15_change=100*(latest_price/present[0]['open']-1)
    spread=latest_native['high']-latest_native['low']
    upper=max(0, latest_native['high']-max(latest_native['open'],latest_native['close']))/spread if spread>0 else 0
    lower=max(0, min(latest_native['open'],latest_native['close'])-latest_native['low'])/spread if spread>0 else 0
    # This is a sign/coherence test, not another arbitrary % gain/volume cap.
    up=(native_last_change>0 and observed15_change>0 and
        latest_price>=latest_native['close'])
    down=(native_last_change<0 and observed15_change<0 and
          latest_price<=latest_native['close'])
    return {
        **base,'status':'PASS','close':latest_price,
        'price_5m_pct':round(native_last_change,5),
        'price_15m_pct':round(observed15_change,5),
        'previous_15m_high':prior_high,'previous_15m_low':prior_low,
        'upper_wick_5m_ratio':round(upper,5),'lower_wick_5m_ratio':round(lower,5),
        'up_structure':up,'down_structure':down,
        'recent_break_above_prior_high':latest_price>prior_high,
        'recent_break_below_prior_low':latest_price<prior_low,
        'native_latest_5m_start_ms':latest_native['timestamp_ms'],
        'native_latest_completed_5m_close':latest_native['close'],
        'native_recent_to_1m_price_change_pct':round(
            100*(latest_price/latest_native['close']-1),5),
    }
