"""Target-aware public quote capture for the existing V22 research pipeline.

Capture actual provider snapshots after each pre-issued target; never relabel
an early quote, widen the existing 150s horizon window, or replace old results.
The 90s near-target observation window matches v21_clock. It is sampling policy,
not a limit on tests, experiments or development iterations. Read-only callbacks;
no order, Telegram, Cloudflare or account APIs.
"""
from __future__ import annotations
import copy
import json
import time
from v22_direction_core import HORIZONS, MIN, evaluate_outcome, is_quote

VERSION = 'V41_TARGET_CLOCK_CAPTURE_V1'
AFTER_TOLERANCE_MS = 150_000  # Unchanged V22 outcome contract.
NEAR_TARGET_MS = 90_000       # Existing v21_clock near-target policy.
POLL_MS = 5_000               # Pace original provider requests, not timestamp edits.
SETTLE_MS = 250               # First request just after target, still validate provider ts.


def outcome_key(row, horizon):
    return (row.get('venue'), row.get('symbol'), row.get('issued_ms'), horizon)


def _valid_row(row, now):
    if not isinstance(row, dict):
        return False
    issued = row.get('issued_ms'); venue = row.get('venue'); symbol = row.get('symbol')
    entry = row.get('entry_quote')
    return (type(issued) is int and 0 <= issued <= now and
            venue in ('bitget', 'bithumb') and isinstance(symbol, str) and bool(symbol) and
            isinstance(row.get('outcomes', {}), dict) and is_quote(entry) and
            0 <= issued-entry['at_ms'] <= MIN)


def capture_outcomes(pending, initial_quotes, pairs, now, *, read,
                     clock_ms=None, sleeper=None):
    """Return immutable measured labels and newest real quotes for new decisions.

    read(pairs, requested_at_ms) -> (quotes_by_(venue,symbol), explicit_errors).
    A label is checked at its own receipt clock, then frozen. A subsequent read
    for another target must not invalidate or overwrite that valid measurement.
    Poll only pending outcomes whose target is near this invocation. Provider
    failure remains missing; polling ends at the original target's deadline.
    """
    if type(now) is not int or now < 0 or not isinstance(initial_quotes, dict):
        raise ValueError('INVALID_CAPTURE_INPUT')
    clock_ms = clock_ms or (lambda: int(time.time()*1000))
    sleeper = sleeper or time.sleep
    current = max(now, int(clock_ms()))
    quotes = copy.deepcopy(initial_quotes)
    all_pairs = set(pairs)
    receipt = {'version': VERSION, 'started_at_ms': current, 'initial_measured': 0,
               'recovered_after_reread': 0, 'read_batches': 0, 'wait_ms': 0,
               'invalid_rows': 0, 'conflicting_events': 0, 'pending_targets': 0,
               'unresolved_near_targets': 0, 'errors': [],
               'after_tolerance_ms': AFTER_TOLERANCE_MS,
               'near_target_ms': NEAR_TARGET_MS, 'future_quote_required': True,
               'telegram_sent': False, 'orders_sent': False}
    unique = {}; conflicts = set()
    for row in pending:
        if not _valid_row(row, current):
            receipt['invalid_rows'] += 1; continue
        key = outcome_key(row, 0)
        fingerprint = json.dumps({'entry': row['entry_quote'],
                                  'outcomes': row.get('outcomes', {})}, sort_keys=True)
        if key in unique and unique[key][0] != fingerprint:
            conflicts.add(key)
        else:
            unique[key] = (fingerprint, row)
    receipt['conflicting_events'] = len(conflicts)
    targets = {}
    for key, (_, row) in unique.items():
        if key in conflicts:
            continue
        for horizon in HORIZONS:
            if str(horizon) not in row.get('outcomes', {}):
                targets[outcome_key(row, horizon)] = (row, row['issued_ms']+horizon*MIN)
    receipt['pending_targets'] = len(targets)
    measured = {}

    def consume(batch, received_at, initial):
        for pair, q in batch.items():
            if pair not in all_pairs or not is_quote(q) or not 0 <= received_at-q['at_ms'] <= MIN:
                continue
            previous = quotes.get(pair)
            if not is_quote(previous) or q['at_ms'] >= previous['at_ms']:
                quotes[pair] = copy.deepcopy(q)
        for key, (row, target) in targets.items():
            if key in measured:
                continue
            q = batch.get((row['venue'], row['symbol']))
            label = evaluate_outcome(row['entry_quote'], q, row['issued_ms'], key[3],
                                     received_at, after_tolerance_ms=AFTER_TOLERANCE_MS)
            if label is not None:
                label = copy.deepcopy(label)
                label.update({'received_at_ms': received_at, 'capture_version': VERSION,
                              'capture_kind': 'INITIAL_BATCH' if initial else 'TARGET_REREAD'})
                measured[key] = label
                receipt['initial_measured' if initial else 'recovered_after_reread'] += 1

    consume(initial_quotes, current, True)
    near = {key for key, (_, target) in targets.items()
            if key not in measured and current-AFTER_TOLERANCE_MS <= target <= current+NEAR_TARGET_MS}
    while True:
        active = {key for key in near if key not in measured and
                  current < targets[key][1]+AFTER_TOLERANCE_MS}
        if not active:
            break
        next_target = min(targets[key][1] for key in active)
        deadline = min(targets[key][1]+AFTER_TOLERANCE_MS for key in active)
        wake = min(deadline, next_target+SETTLE_MS if next_target > current else current+POLL_MS)
        before = current
        sleeper(max(0.001, (wake-current)/1000))
        current = int(clock_ms())
        if current <= before:
            raise RuntimeError('CLOCK_NOT_ADVANCING')
        receipt['wait_ms'] += current-before
        try:
            batch, errors = read(all_pairs, current)
            if not isinstance(batch, dict) or not isinstance(errors, list):
                raise ValueError('INVALID_QUOTE_BATCH_SCHEMA')
            receipt['errors'].extend(str(e) for e in errors)
        except Exception as exc:
            batch = {}
            receipt['errors'].append('REREAD_'+type(exc).__name__)
        current = max(current, int(clock_ms()))
        receipt['read_batches'] += 1
        consume(batch, current, False)
    receipt['unresolved_near_targets'] = len(near-set(measured))
    receipt['errors'] = sorted(set(receipt['errors']))
    receipt['finished_at_ms'] = current
    return {'outcomes': measured, 'quotes': quotes, 'sampled_at_ms': current, 'receipt': receipt}
