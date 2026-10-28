"""Independent evidence-driven Bithumb directional review (never creates orders).

An early ticker/turnover pulse starts a watch, NOT a Telegram alert. A direction
is not accepted unless subsequent nonoverlapping real taker samples, two fresh
orderbook snapshots, closed price structure, and complete venue-local 15m
candle-reconciled taker flow agree. Missing evidence is explicitly rejected.
"""
from __future__ import annotations

import datetime as dt
import math

from spot_flow import candles, window, trade_sample
from spot_continuity import book_snapshot, cvd_15m

MINUTE = 60_000
MAX_TRACKED = 24
MAX_CHECKED = 4
MAX_CVD_PER_RUN = 1


def finite(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError, OverflowError):
        return None


def market_structure(rows, now_ms):
    """Only closed, consecutive candles; no future prices or fabricated gap fills."""
    end = now_ms // MINUTE * MINUTE
    required = [rows.get(end - i * MINUTE) for i in range(1, 21)]
    if any(b is None for b in required):
        return {'status': 'CLOSED_20M_CANDLE_GAP'}
    w5 = window(rows, now_ms, 5)
    w15 = window(rows, now_ms, 15)
    if w5 is None or w15 is None:
        return {'status': 'CLOSED_15M_CANDLE_GAP'}
    previous = required[5:20]
    previous_high = max(x[1] for x in previous)
    previous_low = min(x[2] for x in previous)
    close = w5['close']
    p5 = w5['price_change_pct']
    p15 = w15['price_change_pct']
    if close <= 0 or previous_high <= 0 or previous_low <= 0:
        return {'status': 'INVALID_CLOSED_PRICE'}
    upper = w5['upper_wick_ratio']
    lower = max(0, min(w5['open'], close) - w5['low']) / (w5['high'] - w5['low']) if w5['high'] > w5['low'] else 0
    up = (.15 <= p5 <= 3.8 and .25 <= p15 <= 6.5
          and close >= previous_high * .996 and upper <= .42)
    down = (-3.8 <= p5 <= -.15 and -6.5 <= p15 <= -.25
            and close <= previous_low * 1.004 and lower <= .42)
    return {
        'status': 'PASS', 'close': close, 'price_5m_pct': round(p5, 4),
        'price_15m_pct': round(p15, 4),
        'previous_15m_high': previous_high, 'previous_15m_low': previous_low,
        'upper_wick_5m_ratio': round(upper, 4),
        'lower_wick_5m_ratio': round(lower, 4),
        'up_structure': up, 'down_structure': down,
        'closed_20m_candles': True, 'closed_15m_turnover_krw': w15['quote_krw'],
        'structure_limit': 'Near prior 15m high/low is NOT proven BOS or guaranteed breakout',
    }


def verified_local_cvd(e, direction):
    """Read the independently reconciled public Bithumb 15-minute taker flow."""
    if not isinstance(e, dict) or e.get('verified') is not True:
        return False
    if e.get('marketwide_cvd_verified') is not False:
        return False
    if finite(e.get('candle_relative_error')) is None or e['candle_relative_error'] > .005:
        return False
    blocks = e.get('blocks')
    if not isinstance(blocks, list) or len(blocks) != 3:
        return False
    net, share = finite(e.get('net_buy_krw')), finite(e.get('buy_share'))
    if net is None or share is None:
        return False
    for b in blocks:
        if not isinstance(b, dict) or int(b.get('trades', 0)) < 10:
            return False
        bn, bs = finite(b.get('net_buy_krw')), finite(b.get('buy_share'))
        if bn is None or bs is None:
            return False
        if direction == 'UP' and (bn <= 0 or bs < .56):
            return False
        if direction == 'DOWN' and (bn >= 0 or bs > .44):
            return False
    return (net >= 6_000_000 and share >= .62) if direction == 'UP' else (net <= -6_000_000 and share <= .38)


def evaluate_market(seed, previous, now_ms, api, permit_cvd=True):
    market = seed.get('market')
    result = {'market': market, 'direction': 'WAIT', 'status': 'INITIAL',
              'observation_only': True, 'is_buy_signal': False,
              'order_allowed': False, 'validated_direction': False,
              'proof': None, 'sample': None}
    if not isinstance(market, str) or not market.startswith('KRW-'):
        result['status'] = 'INVALID_MARKET'
        return result
    if seed.get('risk_class') == 'LATE_CHASE_CAUTION':
        result['status'] = 'LATE_CHASE_NOT_DIRECTIONAL'
        return result
    try:
        raw = api('bithumb', '/v1/candles/minutes/1', {'market': market, 'count': 80})
        bars = candles(raw, now_ms)
        structure = market_structure(bars, now_ms)
        result['structure'] = structure
        # Keep early proof independent of turnover multiplier from tiny EMA bases.
        baseline = max(5_000_000, finite(seed.get('five_minute_prior_ema_krw')) or 0)
        quote = finite(seed.get('five_minute_equivalent_turnover_krw')) or 0
        result['normalized_early_turnover_ratio_floor5m'] = round(quote / baseline, 3)
        if structure['status'] != 'PASS':
            result['status'] = structure['status']
            return result
        spot_price = finite(seed.get('price_krw'))
        if spot_price is not None and spot_price > 0 and abs(structure['close'] / spot_price - 1) > .04:
            result['status'] = 'TICKER_AND_CLOSED_CANDLE_DIVERGED'
            return result
        flow = trade_sample(market, now_ms, api)
        book = book_snapshot(market, now_ms, api)
        if not flow.get('coverage') or book is None:
            result['status'] = 'RECENT_TAKER_OR_BOOK_INCOMPLETE'
            return result
        sample = {'time_ms': now_ms, 'book': book,
                  'buy_share': flow.get('buy_share'),
                  'net_buy_krw': flow.get('net_buy_krw'),
                  'recent_net_buy_krw': flow.get('recent_net_buy_krw'),
                  'trades': flow.get('count'),
                  'close': structure['close']}
        result['sample'] = sample
        result['recent_taker_sample'] = {
            'coverage': True, 'count': flow.get('count'),
            'buy_share': flow.get('buy_share'),
            'net_buy_krw': round(flow.get('net_buy_krw') or 0),
            'recent_net_buy_krw': round(flow.get('recent_net_buy_krw') or 0),
            'partial_sample_not_full_cvd': True}
        if not isinstance(previous, dict) or not isinstance(previous.get('sample'), dict):
            result['status'] = 'WAIT_SECOND_DISTINCT_FLOW_AND_BOOK'
            return result
        old = previous['sample']
        gap = now_ms - int(old.get('time_ms') or 0)
        if not 3 * MINUTE <= gap <= 9 * MINUTE:
            result['status'] = 'NONINDEPENDENT_OR_STALE_SAMPLE'
            return result
        oldbook = old.get('book')
        if not isinstance(oldbook, dict) or not 3 * MINUTE <= book['timestamp_ms'] - oldbook.get('timestamp_ms', 0) <= 9 * MINUTE:
            result['status'] = 'BOOK_SNAPSHOTS_NOT_DISTINCT'
            return result
        direction = None
        oldshare, share = finite(old.get('buy_share')), finite(flow.get('buy_share'))
        oldnet, net = finite(old.get('net_buy_krw')), finite(flow.get('net_buy_krw'))
        oldbookratio = finite(oldbook.get('bid_ask_top5_ratio'))
        bookratio = finite(book.get('bid_ask_top5_ratio'))
        if None in (oldshare, share, oldnet, net, oldbookratio, bookratio):
            result['status'] = 'TWO_SAMPLE_FIELDS_INCOMPLETE'
            return result
        if book['spread_pct'] > .8 or oldbook['spread_pct'] > .8:
            result['status'] = 'BOOK_SPREAD_TOO_WIDE'
            return result
        if (structure['up_structure'] and oldshare >= .58 and share >= .61
            and oldnet >= 2_000_000 and net >= 2_000_000
            and (finite(flow.get('recent_net_buy_krw')) or 0) > 0
            and oldbookratio >= 1.0 and bookratio >= 1.05):
            direction = 'UP'
        elif (structure['down_structure'] and oldshare <= .42 and share <= .39
              and oldnet <= -2_000_000 and net <= -2_000_000
              and (finite(flow.get('recent_net_buy_krw')) or 0) < 0
              and oldbookratio <= 1.0 and bookratio <= .95):
            direction = 'DOWN'
        if direction is None:
            result['status'] = 'TWO_PERIOD_FLOW_BOOK_PRICE_DISAGREE'
            return result
        if not permit_cvd:
            result['status'] = 'CVD_API_BUDGET_RESERVED'
            return result
        cvd = cvd_15m(market, now_ms, structure['closed_15m_turnover_krw'], api)
        result['cvd_status'] = 'PASS' if cvd.get('verified') is True else cvd.get('reason', 'UNVERIFIED')
        if not verified_local_cvd(cvd, direction):
            result['status'] = 'CVD_15M_NOT_VERIFIED_OR_CONTRADICTS_DIRECTION'
            return result
        result.update({
            'direction': direction,
            'validated_direction': True,
            'status': 'QUALIFIED_VENUE_LOCAL_MULTI_EVIDENCE',
            'proof': {'venue': 'bithumb', 'market': market,
                      'direction': direction, 'observed_ms': now_ms,
                      'price_krw': structure['close'],
                      'structure': structure, 'taker_flow_15m': cvd,
                      'flow_snapshots': [old, sample],
                      'orderbook_absorption_verified': False,
                      'other_exchange_identity_verified': False,
                      'future_direction_accuracy_verified': False,
                      'source': 'Official Bithumb closed 1m candles, historical trade ticks and two REST books'}}
        )
        return result
    except Exception as exc:
        result['status'] = 'EVIDENCE_API_ERROR'
        result['error_type'] = type(exc).__name__
        return result


def collect_spot_directional(spot, state, now_ms, api):
    out = {'status': 'UNAVAILABLE', 'observed_ms': now_ms, 'reviewed': 0,
           'qualified': 0, 'signals': [], 'diagnostics': [],
           'caveat': 'No future accuracy claim, no order; missing data cannot become a directional alert.'}
    if spot.get('status') != 'PASS' or not isinstance(spot.get('early_watch_observations'), list):
        return out
    memory = state.setdefault('spot_direction_tracking_v13', {})
    if not isinstance(memory, dict):
        memory = {}
        state['spot_direction_tracking_v13'] = memory
    # The initial momentum pulse can disappear on the next scan. Continue
    # evaluating its already-observed first impulse for 15 minutes, causally.
    now_ms = int(now_ms)
    candidates = {}
    for raw in spot['early_watch_observations'][:MAX_CHECKED]:
        if isinstance(raw, dict) and isinstance(raw.get('market'), str):
            candidates[raw['market']] = raw
            if raw['market'] not in memory:
                memory[raw['market']] = {'first_ms': now_ms, 'seed': raw}
    for market, old in list(memory.items()):
        if not isinstance(old, dict) or not 0 <= now_ms - old.get('first_ms', 0) <= 15 * MINUTE:
            memory.pop(market, None)
            continue
        if market not in candidates:
            candidates[market] = old.get('seed', {})
    warning_now = {x.get('market') for x in spot.get('rally_watch_only', [])
                   if x.get('reason') == 'OFFICIAL_WARNING'}
    # Matured watches get their second independent check before new pulses
    # can crowd them out. All 489 markets are still prescreened upstream.
    ordered = sorted(candidates.items(), key=lambda item: (
        0 if state['spot_direction_tracking_v13'].get(item[0], {}).get('first_ms', now_ms) < now_ms else 1,
        item[0]))
    out['queued_for_next_scan'] = max(0, len(ordered) - MAX_CHECKED)
    cvd_consumed = 0
    for market, seed in ordered[:MAX_CHECKED]:
        if market in warning_now:
            out['diagnostics'].append({'market': market, 'status': 'OFFICIAL_WARNING_BLOCKED'})
            memory.pop(market, None)
            continue
        old = memory.get(market, {})
        res = evaluate_market(seed, old, now_ms, api, cvd_consumed < MAX_CVD_PER_RUN)
        out['reviewed'] += 1
        if res['status'] in ('CVD_15M_NOT_VERIFIED_OR_CONTRADICTS_DIRECTION',
                             'QUALIFIED_VENUE_LOCAL_MULTI_EVIDENCE'):
            cvd_consumed += 1
        out['diagnostics'].append({
            'market': market, 'status': res['status'],
            'direction': res.get('direction'),
            'normalized_turnover_ratio_floor5m': res.get('normalized_early_turnover_ratio_floor5m'),
            'cvd_status': res.get('cvd_status'),
            'closed_20m_candles': res.get('structure', {}).get('closed_20m_candles', False)})
        if res.get('sample') is not None:
            old['sample'] = res['sample']
            old['seed'] = seed
            memory[market] = old
        if res['validated_direction']:
            out['signals'].append(res['proof'])
    if len(memory) > MAX_TRACKED:
        for market in sorted(memory, key=lambda m: memory[m].get('first_ms', 0))[:-MAX_TRACKED]:
            del memory[market]
    out['qualified'] = len(out['signals'])
    out['status'] = 'EVALUATED'
    return out
