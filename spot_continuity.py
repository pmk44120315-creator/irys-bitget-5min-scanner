"""Fail-closed evidence checks for 5-minute Bithumb spot observations.

Read-only public APIs. Multi-snapshot books are NOT continuous absorption proof.
A single 2-minute taker sample is NEVER a verified early-buy signal.
"""
from __future__ import annotations

import math

FIVE_MIN = 300_000
ONE_MIN = 60_000
CVD_MINUTES = 15
MAX_CVD_PAGES = 18  # 9,000 latest ticks, capped to bound REST work
MAX_MARKET_HISTORY = 6
MAX_TRACKED_MARKETS = 32


def val(x):
    try:
        n = float(x)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError, OverflowError):
        return None


def book_snapshot(market, now_ms, api):
    """One public order-book snapshot, never a claim of matched absorption."""
    try:
        data = api('bithumb', '/v1/orderbook', {'markets': market})
        if not isinstance(data, list) or len(data) != 1:
            return None
        obj = data[0]
        if obj.get('market') != market:
            return None
        when = val(obj.get('timestamp'))
        if when is None or abs(now_ms - when) > 120_000:
            return None
        units = obj.get('orderbook_units')
        if not isinstance(units, list) or len(units) < 5:
            return None
        units = units[:5]
        bids, asks = [], []
        for u in units:
            bp, ap = val(u.get('bid_price')), val(u.get('ask_price'))
            bq, aq = val(u.get('bid_size')), val(u.get('ask_size'))
            # Bithumb legitimately publishes zero-size levels; reject negative sizes only.
            if None in (bp, ap, bq, aq) or bp <= 0 or ap <= 0 or bq < 0 or aq < 0:
                return None
            bids.append((bp, bq))
            asks.append((ap, aq))
        if bids[0][0] >= asks[0][0]:
            return None
        bid_krw = sum(p * q for p, q in bids)
        ask_krw = sum(p * q for p, q in asks)
        if bid_krw <= 0 or ask_krw <= 0:
            return None
        return {
            'timestamp_ms': int(when),
            'spread_pct': 100 * (asks[0][0] - bids[0][0]) / asks[0][0],
            'bid_top5_krw': round(bid_krw, 2),
            'ask_top5_krw': round(ask_krw, 2),
            'bid_ask_top5_ratio': round(bid_krw / ask_krw, 4),
            'continuous_absorption_verified': False,
        }
    except Exception:
        return None


def cvd_15m(market, now_ms, candle_turnover_krw, api, max_pages=MAX_CVD_PAGES):
    """Reconcile 15 closed candle minutes with cursor-paged public trade ticks.

    This is VENUE-LOCAL taker flow, NOT an all-exchange CVD or an on-chain feed.
    If pagination or candle reconciliation fails, the result is NOT usable.
    """
    close_ms = now_ms // ONE_MIN * ONE_MIN
    start_ms = close_ms - CVD_MINUTES * ONE_MIN
    expected = val(candle_turnover_krw)
    if expected is None or expected <= 0:
        return {'verified': False, 'reason': 'INVALID_CANDLE_TURNOVER'}
    if not isinstance(max_pages, int) or max_pages < 1:
        return {'verified': False, 'reason': 'INVALID_PAGE_LIMIT'}
    pages = 0
    cursor = None
    past_cursors = set()
    seen = set()
    buckets = [{'buy_krw': 0.0, 'sell_krw': 0.0, 'count': 0} for _ in range(3)]
    reached_start = False
    for _ in range(max_pages):
        opts = {'market': market, 'count': 500}
        if cursor is not None:
            opts['cursor'] = cursor
        try:
            raw = api('bithumb', '/v1/trades/ticks', opts)
        except Exception:
            return {'verified': False, 'reason': 'TICKS_API_FAILED'}
        if not isinstance(raw, list) or not raw:
            return {'verified': False, 'reason': 'EMPTY_OR_INVALID_TICKS'}
        pages += 1
        minimum = None
        for event in raw:
            if not isinstance(event, dict):
                return {'verified': False, 'reason': 'INVALID_TRADE_RECORD'}
            stamp = val(event.get('trade_timestamp', event.get('timestamp')))
            price, qty = val(event.get('trade_price')), val(event.get('trade_volume'))
            side = event.get('ask_bid')
            ident = event.get('sequential_id')
            if stamp is None or price is None or qty is None or price <= 0 or qty <= 0 or side not in ('BID', 'ASK') or ident is None:
                return {'verified': False, 'reason': 'INVALID_TRADE_FIELDS'}
            minimum = int(stamp) if minimum is None else min(minimum, int(stamp))
            # Real Bithumb data can reuse sequential_id for fills within one ms.
            # A different timestamp/side/price/quantity is still a distinct fill.
            ident = (str(ident), int(stamp), side, price, qty)
            if ident in seen:
                continue  # Normal overlapping cursor boundaries, never count twice.
            seen.add(ident)
            if not start_ms <= stamp < close_ms:
                continue
            bucket = int((stamp - start_ms) // FIVE_MIN)
            if bucket not in (0, 1, 2):
                return {'verified': False, 'reason': 'BAD_TIME_BUCKET'}
            b = buckets[bucket]
            b['buy_krw' if side == 'BID' else 'sell_krw'] += price * qty
            b['count'] += 1
        if minimum is None:
            return {'verified': False, 'reason': 'MISSING_TRADE_TIME'}
        if minimum <= start_ms:
            reached_start = True
            break
        if len(raw) < 500:
            break
        tail = raw[-1].get('sequential_id')
        cursor = str(tail) if tail is not None else None
        if not cursor or not cursor.isdigit() or cursor in past_cursors:
            return {'verified': False, 'reason': 'CURSOR_NOT_ADVANCING'}
        past_cursors.add(cursor)
    if not reached_start:
        return {'verified': False, 'reason': 'TICKS_HISTORY_INCOMPLETE', 'pages': pages}
    turnover = sum(b['buy_krw'] + b['sell_krw'] for b in buckets)
    deviation = abs(turnover - expected) / expected
    if deviation > 0.005:
        return {'verified': False, 'reason': 'TICKS_CANDLE_MISMATCH',
                'pages': pages, 'relative_error': round(deviation, 5)}
    if any(b['count'] < 10 or b['buy_krw'] + b['sell_krw'] <= 0 for b in buckets):
        return {'verified': False, 'reason': 'INSUFFICIENT_EACH_5M_TRADES'}
    results = []
    for b in buckets:
        total = b['buy_krw'] + b['sell_krw']
        results.append({'buy_krw': round(b['buy_krw'], 2),
                        'sell_krw': round(b['sell_krw'], 2),
                        'net_buy_krw': round(b['buy_krw'] - b['sell_krw'], 2),
                        'buy_share': round(b['buy_krw'] / total, 4),
                        'trades': b['count']})
    net = sum(b['buy_krw'] - b['sell_krw'] for b in buckets)
    bought = sum(b['buy_krw'] for b in buckets)
    return {'verified': True, 'start_ms': start_ms, 'end_ms': close_ms,
            'pages': pages, 'unique_trades_seen': len(seen),
            'candle_relative_error': round(deviation, 5),
            'buy_share': round(bought / turnover, 4),
            'net_buy_krw': round(net, 2),
            'blocks': results,
            'source': 'Bithumb public paginated trades ticks cross-checked with 1m candle turnover',
            'marketwide_cvd_verified': False}


def verify_continuity(candidate, now_ms, state, api):
    """One new 5m observation -> confirmed only after 4 nonoverlapping runs.

    Mutable state persists on data/state.json at each successful scan.
    Replaying the same period does not advance the streak.
    """
    market = candidate.get('market', '')
    if not isinstance(market, str) or not market.startswith('KRW-'):
        return None, 'INVALID_MARKET'
    records = state.setdefault('spot_candidate_checks', {})
    current_end = now_ms // ONE_MIN * ONE_MIN
    last = records.get(market) if isinstance(records.get(market), dict) else {}
    history = last.get('history') if isinstance(last.get('history'), list) else []
    history = [x for x in history[-MAX_MARKET_HISTORY:]
               if isinstance(x, dict) and 0 <= current_end - x.get('end_ms', 0) <= 35 * ONE_MIN]
    if history:
        step = current_end - history[-1]['end_ms']
        if step == 0:
            return None, 'DUPLICATE_OBSERVATION'
        if step != FIVE_MIN:
            history = []  # No claim of continuous independent windows after a gap.
    book = book_snapshot(market, now_ms, api)
    five = candidate.get('windows', {}).get('5m') or {}
    quote = val(five.get('quote_krw'))
    flow = candidate.get('spot_taker_sample_2m') or {}
    rec = {'end_ms': current_end, 'quote_krw': quote,
           'taker_net_2m_krw': val(flow.get('net_buy_krw')),
           'taker_buy_share_2m': val(flow.get('buy_share')),
           'book': book}
    history.append(rec)
    history = history[-MAX_MARKET_HISTORY:]
    records[market] = {'history': history, 'last_alert_ms': last.get('last_alert_ms', 0)}
    # Keep state bounded if too many different coins briefly pass the preliminary filter.
    if len(records) > MAX_TRACKED_MARKETS:
        for key in sorted(records, key=lambda k: records[k].get('history', [{}])[-1].get('end_ms', 0))[:-MAX_TRACKED_MARKETS]:
            records.pop(key, None)
    if len(history) < 4:
        return None, 'WAIT_4_CONSECUTIVE_5M_CHECKS'
    sequence = history[-4:]
    if any(b['end_ms'] - a['end_ms'] != FIVE_MIN for a, b in zip(sequence, sequence[1:])):
        return None, 'NOT_CONSECUTIVE'
    if any(x['book'] is None or x['book']['spread_pct'] > 0.8
           or x['book']['bid_ask_top5_ratio'] < 0.8 for x in sequence):
        return None, 'BOOK_NOT_PERSISTENT_OR_UNKNOWN'
    amounts = [x['quote_krw'] for x in sequence]
    if any(q is None or q < 25_000_000 for q in amounts) or amounts[-1] < .5 * max(amounts):
        return None, 'VOLUME_FADED_OR_INSUFFICIENT'
    if any(x['taker_net_2m_krw'] is None or x['taker_net_2m_krw'] <= 0
           or x['taker_buy_share_2m'] is None or x['taker_buy_share_2m'] < .6
           for x in sequence):
        return None, 'INTERMITTENT_SHORT_TAKER_FLOW'
    cvd = cvd_15m(market, now_ms, candidate['windows'].get('15m', {}).get('quote_krw'), api)
    if not cvd['verified']:
        return None, cvd['reason']
    if (cvd['net_buy_krw'] < 10_000_000 or cvd['buy_share'] < .6
            or any(block['net_buy_krw'] <= 0 or block['buy_share'] < .55 for block in cvd['blocks'])):
        return None, 'CVD_NOT_SUSTAINED'
    prev_alert = val(last.get('last_alert_ms')) or 0
    if now_ms - prev_alert < 45 * ONE_MIN:
        return None, 'DUPLICATE_ALERT_COOLDOWN'
    records[market]['last_alert_ms'] = now_ms
    verified = dict(candidate)
    verified['verification'] = {
        'independent_5m_checks': 4,
        'elapsed_minutes': 15,
        'candle_reconciled_15m_spot_taker': cvd,
        'book_snapshots': [x['book'] for x in sequence],
        'continuous_orderbook_absorption_verified': False,
        'all_exchange_inout_verified': False,
        'token_unlock_verified': False,
        'alert_classification': 'SUSTAINED_EARLY_SPOT_OBSERVATION_ONLY',
    }
    verified['direction'] = 'SUSTAINED_BUY_OBSERVATION'
    return verified, 'SUSTAINED_SPOT_FLOW_VERIFIED'

