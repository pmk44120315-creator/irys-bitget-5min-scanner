"""Data-clock regressions, with virtual time (no sleeps/network in unit tests)."""
import copy
import unittest
from unittest.mock import patch
from v22_direction_core import evaluate_outcome
try:
    from v41_quote_capture import capture_outcomes, outcome_key
except ModuleNotFoundError:
    capture_outcomes = outcome_key = None

T = 1794000000000


def quote(at, bid=100.0, ask=100.1):
    return {'at_ms': at, 'bid': bid, 'ask': ask, 'source': 'OFFICIAL_TEST_QUOTE'}


def event(issued=T, venue='bitget', symbol='AAAUSDT', outcomes=None):
    return {'venue': venue, 'symbol': symbol, 'issued_ms': issued,
            'entry_quote': quote(issued-100), 'outcomes': outcomes or {},
            'votes': {'5': {'momentum5': 1}, '15': {'momentum5': 1}},
            'decisions': {'5': {'direction': 1}, '15': {'direction': 1}},
            'features': {'p5': 1.}, 'shadow_only': True}


class Clock:
    def __init__(self, now): self.now = now; self.waits = []
    def __call__(self): return self.now
    def sleep(self, seconds): self.waits.append(seconds); self.now += round(seconds*1000)


class CaptureTests(unittest.TestCase):
    def capture(self, rows, now, reader=None, first=None):
        self.assertIsNotNone(capture_outcomes, 'target-aware sampler not implemented')
        clock = Clock(now)
        pairs = {(r['venue'], r['symbol']) for r in rows}
        initial = first if first is not None else {p: quote(now-100) for p in pairs}
        if reader is None: reader = lambda pairs, stamp: ({p: quote(stamp-50, 101, 101.1) for p in pairs}, [])
        out = capture_outcomes(rows, initial, pairs, now, read=reader, clock_ms=clock, sleeper=clock.sleep)
        return out, clock

    def test_root_cause_old_early_and_next_late_quotes_both_fail(self):
        e = event(); target = T+300000
        self.assertIsNone(evaluate_outcome(e['entry_quote'], quote(target-100), T, 5, target-50))
        self.assertIsNone(evaluate_outcome(e['entry_quote'], quote(target+300000), T, 5, target+300001))

    def test_near_future_target_is_reread_after_target(self):
        e = event(); out, clock = self.capture([e], T+298000)
        lab = out['outcomes'][outcome_key(e, 5)]
        self.assertGreaterEqual(lab['exit_quote']['at_ms'], T+300000)
        self.assertLessEqual(lab['exit_quote']['at_ms'], T+450000)
        self.assertEqual(out['receipt']['initial_measured'], 0)
        self.assertEqual(out['receipt']['recovered_after_reread'], 1)
        self.assertGreater(len(clock.waits), 0)
        self.assertFalse(lab['actual_fills_verified'])

    def test_quote_slightly_early_even_when_wall_clock_due_is_refetched(self):
        e=event(); out,_=self.capture([e],T+300050, first={('bitget','AAAUSDT'):quote(T+299999)})
        self.assertGreaterEqual(out['outcomes'][outcome_key(e,5)]['exit_quote']['at_ms'],T+300000)

    def test_mature_label_frozen_before_waiting_for_different_target(self):
        a,b=event(),event(T+80000,symbol='BBBUSDT')
        first={('bitget','AAAUSDT'):quote(T+300100,100.2,100.3),('bitget','BBBUSDT'):quote(T+300100)}
        out,clock=self.capture([a,b],T+300200, first=first)
        self.assertEqual(out['outcomes'][outcome_key(a,5)]['exit_quote'],first[('bitget','AAAUSDT')])
        self.assertGreaterEqual(out['outcomes'][outcome_key(b,5)]['exit_quote']['at_ms'],T+380000)
        self.assertGreater(clock.now,T+360200)
        self.assertEqual(out['receipt']['initial_measured'],1)

    def test_initial_valid_outcome_does_not_wait_for_distant_horizon(self):
        e=event();out,clock=self.capture([e],T+301000)
        self.assertEqual(len(clock.waits),0)
        self.assertEqual(out['receipt']['recovered_after_reread'],0)
        self.assertEqual(len(out['outcomes']),1)

    def test_distant_target_not_blocking_current_scan(self):
        e=event();out,clock=self.capture([e],T+100000)
        self.assertEqual(out['outcomes'],{})
        self.assertEqual(clock.waits,[])

    def test_old_expired_target_not_filled_with_current_price(self):
        e=event();out,clock=self.capture([e],T+600000)
        self.assertNotIn(outcome_key(e,5),out['outcomes'])
        self.assertEqual(clock.waits,[])

    def test_unavailable_source_stops_at_original_label_deadline_without_fake_label(self):
        e=event();out,clock=self.capture([e],T+449000,reader=lambda *_:({},['PROVIDER_UNAVAILABLE']),first={})
        self.assertNotIn(outcome_key(e,5),out['outcomes'])
        self.assertTrue(out['receipt']['errors'])
        self.assertGreaterEqual(clock.now,T+450000)

    def test_provider_timestamp_lag_requires_later_original_snapshot(self):
        e=event();out,clock=self.capture([e],T+299000,reader=lambda pairs,stamp:({p:quote(stamp-3000) for p in pairs},[]))
        lab=out['outcomes'][outcome_key(e,5)]
        self.assertEqual(lab['exit_quote']['at_ms'],lab['received_at_ms']-3000)
        self.assertGreaterEqual(lab['exit_quote']['at_ms'],T+300000)

    def test_completed_horizon_is_never_measured_twice(self):
        e=event(outcomes={'5':{'status':'UNMEASURED_AFTER_TARGET'}})
        out,clock=self.capture([e],T+300000)
        self.assertEqual(out['outcomes'],{})
        self.assertEqual(clock.waits,[])

    def test_mutation_of_input_or_source_quote_forbidden(self):
        e=event();q={('bitget','AAAUSDT'):quote(T+301000)}
        original=copy.deepcopy((e,q));out,_=self.capture([e],T+301100,first=q)
        out['outcomes'][outcome_key(e,5)]['exit_quote']['bid']=999
        self.assertEqual((e,q),original)

    def test_new_proposal_pair_keeps_latest_reread_not_old_initial_quote(self):
        e=event();out,clock=self.capture([e],T+298000)
        self.assertGreaterEqual(out['quotes'][('bitget','AAAUSDT')]['at_ms'],T+300000)
        self.assertGreaterEqual(out['sampled_at_ms'],out['quotes'][('bitget','AAAUSDT')]['at_ms'])

    def test_bithumb_and_bitget_never_cross_at_same_symbol(self):
        a=event();b=event(venue='bithumb',symbol='KRW-AAA')
        out,_=self.capture([a,b],T+298000)
        self.assertEqual(len(out['outcomes']),2)
        self.assertNotEqual(outcome_key(a,5),outcome_key(b,5))

    def test_bad_entry_or_future_issue_not_authorized(self):
        a=event();a['entry_quote']['at_ms']=T+1
        b=event(T+1000000,symbol='BBBUSDT')
        out,clock=self.capture([a,b],T+299000)
        self.assertEqual(out['outcomes'],{})
        self.assertEqual(clock.waits,[])

    def test_conflicting_same_event_excluded_without_first_copy_bias(self):
        a=event();b=copy.deepcopy(a);b['entry_quote']['ask']=120
        out,_=self.capture([a,b],T+301000)
        self.assertEqual(out['outcomes'],{})
        self.assertGreater(out['receipt']['conflicting_events'],0)

    def test_nonadvancing_clock_raises_instead_of_endless_sleep_or_fake_time(self):
        self.assertIsNotNone(capture_outcomes)
        e=event();now=T+299000
        with self.assertRaisesRegex(RuntimeError,'CLOCK_NOT_ADVANCING'):
            capture_outcomes([e],{('bitget','AAAUSDT'):quote(now)}, {('bitget','AAAUSDT')},now,
                read=lambda p,t:({k:quote(t) for k in p},[]),clock_ms=lambda:now,sleeper=lambda s:None)

if __name__ == '__main__': unittest.main()
