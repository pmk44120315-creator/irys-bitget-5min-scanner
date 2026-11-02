import importlib.util
import unittest
T=1793534400000
MIN=60000
class AuditTests(unittest.TestCase):
    def engine(self):
        self.assertIsNotNone(importlib.util.find_spec('v27_alert_audit'),'actual-delivery audit module missing')
        import v27_alert_audit
        return v27_alert_audit
    def bars(self):
        return [{'start_ms':T+i*MIN,'open':100.,'close':103. if i==5 else 100.,'high':104.,'low':99.} for i in range(1,7)]
    def receipt(self,channel='V23_DIRECT_FAST_MARKET_WATCH',direction=None):
        return {'event_ms':T+40000,'symbol':'TESTUSDT','channel':channel,'telegram_message_id':10,'direction':direction}
    def test_watch_is_aftermath_not_claimed_direction_prediction(self):
        a=self.engine().evaluate(self.receipt(),self.bars(),5,T+10*MIN)
        self.assertEqual(a['status'],'MEASURED');self.assertEqual(a['return_pct'],3.)
        self.assertIsNone(a['direction_right']);self.assertEqual(a['measurement_kind'],'WATCH_AFTERMATH')
    def test_short_is_opposite_signed_price_change_not_inverse_return(self):
        a=self.engine().evaluate(self.receipt('BITGET_VERIFIED_FUTURES_FLOW','DOWN'),self.bars(),5,T+10*MIN)
        self.assertEqual(a['signed_return_pct'],-3.);self.assertFalse(a['direction_right'])
    def test_post_alert_reference_and_excursion_excludes_prior_candle(self):
        b=[{'start_ms':T,'open':1,'close':2,'high':999,'low':.01}]+self.bars()
        a=self.engine().evaluate(self.receipt(),b,5,T+10*MIN)
        self.assertEqual(a['reference_start_ms'],T+MIN);self.assertEqual(a['up_excursion_pct'],4.)
        self.assertEqual(a['down_excursion_pct'],-1.);self.assertFalse(a['actual_execution_verified'])
    def test_missing_reference_is_not_filled_from_last_price(self):
        a=self.engine().evaluate(self.receipt(),self.bars()[1:],5,T+10*MIN)
        self.assertEqual(a['status'],'MISSING_POST_ALERT_REFERENCE')
    def test_missing_target_is_not_turned_into_success(self):
        a=self.engine().evaluate(self.receipt(),[b for b in self.bars() if b['start_ms']!=T+5*MIN],5,T+10*MIN)
        self.assertEqual(a['status'],'MISSING_TARGET_CANDLE')
    def test_partial_path_does_not_claim_full_excursion(self):
        a=self.engine().evaluate(self.receipt(),[b for b in self.bars() if b['start_ms']!=T+3*MIN],5,T+10*MIN)
        self.assertEqual(a['return_pct'],3.);self.assertIsNone(a['up_excursion_pct']);self.assertFalse(a['full_path_coverage'])
    def test_pending_horizon_never_counted(self):
        a=self.engine().evaluate(self.receipt(),self.bars(),5,T+3*MIN)
        self.assertEqual(a['status'],'PENDING_HORIZON')
    def test_bithumb_utc_is_not_double_shifted(self):
        a=self.engine().parse_bars([{'candle_date_time_utc':'2026-11-01T12:00:00','opening_price':1,'high_price':1.2,'low_price':.9,'trade_price':1.1}], 'bithumb',T+MIN)
        self.assertEqual(a[0]['start_ms'],T)
    def test_invalid_ohlc_and_future_candle_excluded(self):
        raw=[[T,1,.5,2,1,2,3],[T+MIN,1,2,.5,1,2,3]]
        self.assertEqual(self.engine().parse_bars(raw,'bitget',T+MIN),[])
if __name__=='__main__':unittest.main()
