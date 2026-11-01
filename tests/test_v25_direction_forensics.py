import unittest
from diagnostics.v25_direction_forensics import observations,run

def record(issued,venue='bitget',sym='TESTUSDT',side=1,verified=True):
    entry={'bid':99.,'ask':101.,'at_ms':issued}
    future={'bid':103.,'ask':105.,'at_ms':issued+5*60000}
    return {'venue':venue,'symbol':sym,'issued_ms':issued,
     'entry_quote':entry,'real_taker_verified':verified,
     'features':{'p5':1.2},
     'votes':{'5':{'momentum5':1,'countertrend5':-1,'taker_bias':1,'v21_frozen':1}},
     'decisions':{'5':{'direction':side}},
     'outcomes':{'5':{'both_sides_measured':True,'exit_quote':future,
       'signed_quote_returns':{'1':100*(103/101-1),'-1':100*(99-105)/99}}}}

class ForensicsCausality(unittest.TestCase):
    def test_actual_quote_crossing_and_cost_counted(self):
        at=1793520000000
        rows,c=observations({'completed':[record(at)]},5)
        e=next(x for x in rows if x['model']=='online_ensemble')
        self.assertGreater(e['net_pct'],1.7)
        self.assertLess(e['net_pct'],2)
        self.assertTrue(e['mid_correct'])
        short=next(x for x in rows if x['model']=='countertrend5')
        self.assertLess(short['net_pct'],-6)
        self.assertFalse(short['mid_correct'])
        self.assertEqual(c['rows_with_missing_or_unmeasured'],0)
    def test_overlap_prevents_event_path_reuse(self):
        at=1793520000000
        rows,c=observations({'completed':[record(at),record(at+60000)]},5)
        self.assertEqual(c['rows_skipped_as_overlapping'],1)
        self.assertEqual(sum(x['model']=='online_ensemble' for x in rows),1)
    def test_missing_delayed_quote_cannot_be_reported_as_success(self):
        at=1793520000000
        r=record(at)
        r['outcomes']['5']['exit_quote']['at_ms']=at+20*60000
        rows,c=observations({'completed':[r]},5)
        self.assertEqual(rows,[])
        self.assertEqual(c['rows_with_missing_or_unmeasured'],1)
    def test_spot_short_not_counted_as_buy_success(self):
        at=1793520000000
        r=record(at,venue='bithumb',sym='KRW-POP',side=-1)
        rows,_=observations({'completed':[r]},5)
        self.assertFalse(any(x['model']=='online_ensemble' for x in rows))
        self.assertTrue(any(x['model']=='momentum5' for x in rows))
    def test_empty_data_never_claims_predictive_improvement(self):
        r=run({},'SHA','2026-11-01T12:00:00Z')
        self.assertFalse(r['out_of_sample_improvement_proved'])
        self.assertFalse(r['actual_executable_returns_verified'])
        self.assertEqual(r['timeframes']['5']['results']['bitget']['online_ensemble']['all']['n'],0)
if __name__=='__main__':unittest.main()
