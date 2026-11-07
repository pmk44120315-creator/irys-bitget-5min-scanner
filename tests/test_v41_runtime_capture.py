import copy
import unittest
from unittest.mock import patch
import v22_runtime as runtime
from test_v41_quote_capture import Clock, T, event, quote

class RuntimeCaptureTests(unittest.TestCase):
    def run_with_clock(self, old, clock):
        def books(pairs,api,now):return {key:quote(clock.now-100,101.,101.1) for key in pairs},[]
        with patch.object(runtime,'build_candidates',return_value=([],{},'PASS',0)), \
             patch.object(runtime,'verified_models',return_value=({},{})), \
             patch.object(runtime,'fetch_quotes',side_effect=books), \
             patch.object(runtime.time,'time',side_effect=lambda:clock.now/1000), \
             patch.object(runtime.time,'sleep',side_effect=clock.sleep):
            return runtime.run({}, {}, {}, old, {}, clock.now, lambda *_: None)
    def test_running_pipeline_recovers_early_target(self):
        old={'pending':[event()]};before=copy.deepcopy(old);c=Clock(T+298000)
        report,state=self.run_with_clock(old,c)
        self.assertEqual(report['newly_completed_quotes'],1)
        self.assertEqual(report['new_unmeasured_labels'],0)
        self.assertEqual(report['target_quote_capture']['recovered_after_reread'],1)
        first=next(x for x in state['pending'] if x['issued_ms']==T)
        self.assertGreaterEqual(first['outcomes']['5']['exit_quote']['at_ms'],T+300000)
        self.assertEqual(old,before)
        self.assertFalse(report['telegram_sent']);self.assertFalse(report['orders_sent'])
    def test_next_cycle_does_not_relearn_captured_horizon(self):
        c=Clock(T+298000);r,s=self.run_with_clock({'pending':[event()]},c)
        learning=copy.deepcopy(s['learning']);c.now+=1000
        r2,s2=self.run_with_clock(s,c)
        self.assertEqual(r['newly_completed_quotes'],1)
        self.assertEqual(r2['newly_completed_quotes'],0)
        self.assertEqual(s2['learning'],learning)
if __name__=='__main__':unittest.main()
