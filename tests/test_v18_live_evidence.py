import datetime as dt
import unittest
from unittest.mock import patch
from v18_live_evidence import run

NOW=int(dt.datetime(2026,10,30,8,0,tzinfo=dt.timezone.utc).timestamp()*1000)
SOURCE={'collector_status':'PASS','finished_utc':'2026-10-30T07:58:00+00:00',
        'watchlist':[],'early_pool':[]}
class EvidenceContract(unittest.TestCase):
    def test_fresh_real_flow_selection_is_enabled_and_precisely_aligned(self):
        incoming={'status':'EVALUATED','selector_version':'V18_BLENDED_BASELINE_PLUS_REVERSAL_REAL_FLOW',
          'markets_eligible_for_proof':12,'selected_reversal_evidence_targets':3,
          'old_v17_selector_preserved_in_blend':True,
          'observations':[{'symbol':'ALTUSDT','taker_flow_15m':{'verified':True},
             'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT'}]}
        with patch('v18_live_evidence.collect_futures_flow_observations',return_value=incoming) as f:
            r,state=run(SOURCE,{},NOW,api=lambda *_:None,align=lambda *_:{'aligned':1,'status':'PASS'})
            self.assertEqual(r['status'],'PASS')
            self.assertEqual(r['reversal_selected'],3)
            self.assertEqual(r['time_aligned_real_taker'],1)
            self.assertEqual(r['verified_real_taker_15m'],1)
            self.assertTrue(r['historical_selector_preserved'])
            self.assertFalse(r['orders'])
            self.assertFalse(r['telegram_sent'])
            self.assertTrue(f.call_args.kwargs['v18_select'])
            self.assertEqual(f.call_args.kwargs['limit'],6)
    def test_price_aligned_but_unverified_taker_is_not_counted_as_real_taker(self):
        incoming={'status':'EVALUATED','observations':[
          {'symbol':'ALTUSDT','taker_flow_15m':{'verified':True},
           'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT'},
          {'symbol':'OTHERUSDT','taker_flow_15m':{'verified':False},
           'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT'}]}
        with patch('v18_live_evidence.collect_futures_flow_observations',return_value=incoming):
            result,_=run(SOURCE,{},NOW,api=lambda *_:None,
                         align=lambda *_:{'status':'EVALUATED','aligned':2})
        self.assertEqual(result['verified_real_taker_15m'],1)
        self.assertEqual(result['time_aligned_real_taker'],1)
        self.assertEqual(result['price_context_aligned_including_unverified_taker'],2)
    def test_stale_data_must_not_be_falsely_qualified(self):
        r,_=run({'collector_status':'PASS','finished_utc':'2026-10-30T06:00:00+00:00'}, {},NOW)
        self.assertEqual(r['status'],'SOURCE_UNAVAILABLE')
        self.assertEqual(r['observations'],[])
    def test_invalid_source_never_runs_market_api(self):
        with patch('v18_live_evidence.collect_futures_flow_observations') as c:
            r,_=run({'collector_status':'FAILED'}, {},NOW)
            c.assert_not_called()
            self.assertEqual(r['status'],'SOURCE_UNAVAILABLE')
    def test_real_api_error_reported_and_no_fake_pass(self):
        with patch('v18_live_evidence.collect_futures_flow_observations',side_effect=RuntimeError('offline')):
            r,_=run(SOURCE,{},NOW)
            self.assertEqual(r['status'],'EVIDENCE_API_FAILED')
            self.assertEqual(r['reason'],'RuntimeError')
if __name__=='__main__':unittest.main()
