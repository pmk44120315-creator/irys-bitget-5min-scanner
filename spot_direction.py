"""Independent evidence-driven Bithumb directional review (never creates orders).

An early ticker/turnover pulse starts a watch, NOT a Telegram alert. A direction
is not accepted unless subsequent nonoverlapping real taker samples, two fresh
orderbook snapshots, actual completed 5m price context, and complete venue-local 15m
candle-reconciled taker flow agree. Missing evidence is explicitly rejected.
"""
from __future__ import annotations

import datetime as dt
import math

from spot_flow import candles, trade_sample
from spot_native_structure import native_market_structure, parse_native_five
from spot_continuity import book_snapshot, cvd_15m

MINUTE = 60_000
MAX_TRACKED = 24
MAX_CHECKED = MAX_TRACKED  # An existing watch no longer waits behind a four-symbol API queue.
MAX_CVD_PER_RUN = 1


def finite(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError, OverflowError):
        return None


def market_structure(rows, now_ms, native=None):
    """Use real completed exchange-native 5m, not an invented run of 20 one-minute bars."""
    return native_market_structure(rows, native if isinstance(native,dict) else {}, now_ms)

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
    # A large prior move is counter-evidence, not grounds to skip looking at
    # live trades, real books or CVD and assume the future direction.
    result['late_chase_caution'] = seed.get('risk_class') == 'LATE_CHASE_CAUTION'
    try:
        # Independent public data streams must not falsely turn a 5m outage
        # into an unavailable taker or book. Missing price remains WAIT.
        try:
            raw = api('bithumb', '/v1/candles/minutes/1', {'market': market, 'count': 80})
        except Exception as exc:
            raw = []
            result['one_minute_api_error'] = type(exc).__name__
        try:
            native_raw = api('bithumb', '/v1/candles/minutes/5',
                             {'market': market, 'count': 24})
        except Exception as exc:
            native_raw = []
            result['native_five_minute_api_error'] = type(exc).__name__
        bars = candles(raw, now_ms)
        native = parse_native_five(native_raw, now_ms)
        structure = market_structure(bars, now_ms, native)
        result['structure'] = structure
        # Keep early proof independent of turnover multiplier from tiny EMA bases.
        baseline = max(5_000_000, finite(seed.get('five_minute_prior_ema_krw')) or 0)
        quote = finite(seed.get('five_minute_equivalent_turnover_krw')) or 0
        result['normalized_early_turnover_ratio_floor5m'] = round(quote / baseline, 3)
        # Preserve independent taker/book samples even with sparse price history;
        # no blanket abort before checking actual execution evidence.
        flow = trade_sample(market, now_ms, api)
        book = book_snapshot(market, now_ms, api)
        result['taker_diagnostics'] = {
            'count':flow.get('count'),
            'coverage':flow.get('coverage') is True,
            'reasons':flow.get('coverage_reasons', []),
            'early_minute_trade_count':flow.get('early_minute_trade_count'),
            'recent_minute_trade_count':flow.get('recent_minute_trade_count'),
            'pages_read':flow.get('pages_read')}
        if book is not None:
            result['book_observation'] = book
        if book is None and not flow.get('coverage'):
            result['status'] = 'BOOK_AND_RECENT_TAKER_UNAVAILABLE'
            return result
        if book is None:
            result['status'] = 'BOOK_UNAVAILABLE'
            return result
        if not flow.get('coverage'):
            result['status'] = 'RECENT_TAKER_INCOMPLETE'
            return result
        sample = {'time_ms': now_ms, 'book': book,
                  'buy_share': flow.get('buy_share'),
                  'net_buy_krw': flow.get('net_buy_krw'),
                  'recent_net_buy_krw': flow.get('recent_net_buy_krw'),
                  'trades': flow.get('count'),
                  'close': structure.get('close')}
        result['sample'] = sample
        result['recent_taker_sample'] = {
            'coverage': True, 'count': flow.get('count'),
            'buy_share': flow.get('buy_share'),
            'net_buy_krw': round(flow.get('net_buy_krw') or 0),
            'recent_net_buy_krw': round(flow.get('recent_net_buy_krw') or 0),
            'partial_sample_not_full_cvd': True}
        if structure['status'] != 'PASS':
            result['status'] = structure['status']
            return result
        spot_price = finite(seed.get('price_krw'))
        if spot_price is not None and spot_price > 0:
            result['ticker_vs_closed_candle_pct'] = round(
                100 * (structure['close'] / spot_price - 1), 4)
            # Historical ticker and a later true completed candle can differ.
            # Record that divergence rather than treating it as market-data
            # corruption and discarding independently verified flow.
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
        # The exact 15m quote total comes from three completed native 5m
        # buckets ending at anchor_end_ms. It MUST match paginated real trades.
        cvd = cvd_15m(market, structure['anchor_end_ms'],
                      structure['closed_15m_turnover_krw'], api)
        result['cvd_status'] = 'PASS' if cvd.get('verified') is True else cvd.get('reason', 'UNVERIFIED')
        if cvd.get('verified') is True:
            structure['closed_15m_turnover_verified_by_taker'] = True
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
                      'late_chase_caution':result['late_chase_caution'],
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
    # The initial turnover prescreen and its daily-price caps are NOT a
    # prerequisite for actual Bithumb flow review. Merge the existing early
    # watch with ranked ticker observations; keep official risk blocked.
    ranked = spot.get('direction_review_seeds', [])
    if not isinstance(ranked, list):
        ranked = []
    watch = list(spot['early_watch_observations'][:MAX_CHECKED]) + ranked[:8]
    for raw in watch:
        if not isinstance(raw, dict) or not isinstance(raw.get('market'), str):
            continue
        market = raw['market']
        if market in candidates:
            continue
        # Ranking only authorizes independent evidence collection, never a BUY.
        candidates[market] = raw
        if market not in memory:
            memory[market] = {'first_ms': now_ms, 'seed': raw}
    for market, old in list(memory.items()):
        if not isinstance(old, dict) or not 0 <= now_ms - old.get('first_ms', 0) <= 15 * MINUTE:
            memory.pop(market, None)
            continue
        if market not in candidates:
            candidates[market] = old.get('seed', {})
    warning_now = {x.get('market') for x in spot.get('rally_watch_only', [])
                   if x.get('reason') == 'OFFICIAL_WARNING'}
    # API scheduling is NOT an entry condition. Complete real second samples
    # first, then the original early watch, then ranked price-only research.
    # The latter was mostly mean-reverting in saved 5m replay; do not let it
    # starve evidence-backed candidates or treat it as a directional signal.
    def review_priority(item):
        market, seed = item
        old = memory.get(market, {})
        if isinstance(old, dict) and isinstance(old.get('sample'), dict):
            return (0, old.get('first_ms', now_ms), market)
        if seed.get('source_channel') != 'RANKED_PRICE_TURNOVER_REVIEW_ONLY':
            return (1, old.get('first_ms', now_ms), market)
        score = finite(seed.get('review_priority_score')) or 0
        return (3 if seed.get('risk_class') == 'LATE_CHASE_CAUTION' else 2,
                -score, market)
    ordered = sorted(candidates.items(), key=review_priority)
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
        # Even a real book sampled with sparse trades is persisted for
        # next-scan continuity diagnostics, but NEVER qualifies a direction.
        if isinstance(res.get('book_observation'), dict):
            observations=[x for x in old.get('book_history_v15', [])
                          if isinstance(x, dict) and
                          0 <= now_ms-int(x.get('timestamp_ms') or 0) <= 15*MINUTE]
            book=res['book_observation']
            if not any(x.get('timestamp_ms')==book.get('timestamp_ms') for x in observations):
                observations.append(book)
            old['book_history_v15']=observations[-3:]
            memory[market]=old
        out['diagnostics'].append({
            'market': market, 'status': res['status'],
            'candidate_source': seed.get('source_channel', 'EARLY_MOMENTUM_WATCH'),
            'direction': res.get('direction'),
            'normalized_turnover_ratio_floor5m': res.get('normalized_early_turnover_ratio_floor5m'),
            'cvd_status': res.get('cvd_status'),
            'closed_20m_candles': res.get('structure', {}).get('closed_20m_candles', False),
            'price_source':res.get('structure', {}).get('source'),
            'native_5m_buckets':res.get('structure', {}).get('native_15m_buckets_observed'),
            'real_taker_sample_saved':res.get('sample') is not None,
            'taker_count':(res.get('taker_diagnostics') or {}).get('count'),
            'taker_coverage_reasons':(res.get('taker_diagnostics') or {}).get('reasons', []),
            'orderbook_observed':res.get('book_observation') is not None,
            'historical_real_book_reads':len(old.get('book_history_v15', [])),
            'late_chase_caution':res.get('late_chase_caution', False)})
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
