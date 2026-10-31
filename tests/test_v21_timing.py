import importlib
import unittest

class QuoteTargetTiming(unittest.TestCase):
    def mod(self):
        try:m=importlib.import_module('v21_clock')
        except ModuleNotFoundError:m=None
        self.assertIsNotNone(m,'quote-target clock is not implemented')
        return m

    def test_early_tick_waits_for_the_real_future_target(self):
        m=self.mod();time=[395000]
        def sleep(seconds):time[0]+=round(seconds*1000)
        now,wait=m.align_validation_clock([{'issued_ms':100000,'horizon_min':5}],395000,
            clock=lambda:time[0]/1000,sleeper=sleep)
        self.assertGreaterEqual(now,400000)
        self.assertGreaterEqual(wait,5000)
        self.assertLess(wait,6000)

    def test_overdue_target_is_observed_immediately(self):
        m=self.mod();called=[]
        now,wait=m.align_validation_clock([{'issued_ms':100000,'horizon_min':5}],405000,
            clock=lambda:405,sleeper=lambda x:called.append(x))
        self.assertEqual(wait,0);self.assertEqual(called,[])

    def test_far_future_or_empty_records_never_stall_current_inference(self):
        m=self.mod();called=[]
        _,wait=m.align_validation_clock([{'issued_ms':100000,'horizon_min':15}],110000,
            clock=lambda:110,sleeper=lambda x:called.append(x))
        self.assertEqual(wait,0);self.assertEqual(called,[])
        self.assertEqual(m.align_validation_clock([],110000,clock=lambda:110)[1],0)

if __name__=='__main__':unittest.main()
