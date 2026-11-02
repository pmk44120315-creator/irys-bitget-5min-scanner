"""Actual Telegram aftermath using official candles, NOT model-shadow or fills.
Reference: open of the first full minute starting after recorded send time.
Missing bars remain missing. Neutral WATCH has no direction-accuracy score.
"""
from __future__ import annotations
import datetime as dt
import math
MIN=60_000
HORIZONS=(5,15,30,60)
def number(x):
    if x is None or isinstance(x,bool):return None
    try:
        n=float(x)
        return n if math.isfinite(n) else None
    except (ValueError,TypeError,OverflowError):return None

def parse_bars(raw,venue,asof_ms):
    if not isinstance(raw,list):return []
    result={};conflicts=set()
    for b in raw:
        try:
            if venue=='bithumb':
                t=dt.datetime.fromisoformat(b['candle_date_time_utc'])
                if t.tzinfo is None:t=t.replace(tzinfo=dt.timezone.utc)
                stamp=int(t.timestamp()*1000)
                o,h,l,c=(number(b[k]) for k in ('opening_price','high_price','low_price','trade_price'))
            else:
                stamp=int(b[0]);o,h,l,c=(number(x) for x in b[1:5])
            if stamp%MIN or stamp+MIN>asof_ms or any(x is None or x<=0 for x in (o,h,l,c)):continue
            if not l<=min(o,c)<=max(o,c)<=h:continue
            row={'start_ms':stamp,'open':o,'high':h,'low':l,'close':c}
            if stamp in result and result[stamp]!=row:conflicts.add(stamp)
            result[stamp]=row
        except (ValueError,TypeError,KeyError,IndexError,OverflowError):continue
    return [result[k] for k in sorted(result) if k not in conflicts]

def evaluate(receipt,bars,horizon,now_ms):
    if horizon not in HORIZONS:raise ValueError('UNSUPPORTED_HORIZON')
    event=receipt.get('event_ms')
    if not isinstance(event,int) or isinstance(event,bool):return {'status':'INVALID_RECEIPT_TIME'}
    ref=(event//MIN+1)*MIN;end=ref+horizon*MIN
    base={'reference_start_ms':ref,'reference_delay_ms':ref-event,'target_end_ms':end,
        'basis':'FIRST_FULL_POST_RECORDED_SEND_MINUTE_OPEN_TO_TARGET_CLOSE',
        'actual_execution_verified':False,'alert_exact_price_available':False}
    if end>now_ms:return dict(base,status='PENDING_HORIZON')
    by={b['start_ms']:b for b in bars}
    if ref not in by:return dict(base,status='MISSING_POST_ALERT_REFERENCE')
    if end-MIN not in by:return dict(base,status='MISSING_TARGET_CANDLE')
    entry=number(by[ref].get('open'));exit=number(by[end-MIN].get('close'))
    if entry is None or entry<=0 or exit is None or exit<=0:return dict(base,status='INVALID_PRICE')
    change=100*(exit/entry-1)
    path=[by[t] for t in range(ref,end,MIN) if t in by]
    complete=len(path)==horizon
    direction=receipt.get('direction')
    is_watch='WATCH' in str(receipt.get('channel',''))
    if is_watch:direction=None
    signed=change if direction in ('UP','LONG','BUY') else -change if direction in ('DOWN','SHORT') else None
    realized='UP' if change>=.15 else 'DOWN' if change<=-.15 else 'FLAT'
    right=None if signed is None or abs(change)<.15 else signed>0
    return dict(base,status='MEASURED',reference_price=entry,final_price=exit,
        return_pct=round(change,6),signed_return_pct=round(signed,6) if signed is not None else None,
        actual_direction=realized,direction_right=right,
        measurement_kind='WATCH_AFTERMATH' if is_watch else 'DIRECTIONAL' if signed is not None else 'DIRECTION_UNKNOWN',
        full_path_coverage=complete,path_minutes_observed=len(path),
        up_excursion_pct=round(100*(max(b['high'] for b in path)/entry-1),6) if complete else None,
        down_excursion_pct=round(100*(min(b['low'] for b in path)/entry-1),6) if complete else None)
