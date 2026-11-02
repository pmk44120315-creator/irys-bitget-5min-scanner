import importlib.util,unittest
class BundleReceiptTests(unittest.TestCase):
 def expand(self,x):
  self.assertIsNotNone(importlib.util.find_spec('v28_alert_events'),'V28 receipt-event decoder missing')
  from v28_alert_events import expand_receipts
  return expand_receipts(x)
 def receipt(self):return {'event_ms':10,'receipt':{'telegram_message_id':50,'channel':'V23_DIRECT_FAST_MARKET_WATCH','symbol':'KRW-AAA','ack_received_at_ms':11,'market_snapshot':{'bundle_version':'V28_ACK_BUNDLE_V1','bundle':[{'symbol':'KRW-AAA','venue':'bithumb','forecast_direction':None},{'symbol':'BBBUSBUSDT','venue':'bitget','forecast_direction':None}]}}}
 def test_each_symbol_shares_one_ack_not_duplicated_message(self):
  r=self.expand([self.receipt()]);self.assertEqual(len(r),2);self.assertEqual({x['message_id'] for x in r},{50});self.assertEqual({x['event_ms'] for x in r},{11})
 def test_watch_never_reclassified_long_from_rising_observation(self):
  p=self.receipt();p['receipt']['market_snapshot']['bundle'][0]['observed_direction']='UP';p['receipt']['market_snapshot']['bundle'][0]['forecast_direction']='LONG'
  self.assertTrue(all(x['direction'] is None for x in self.expand([p])))
 def test_repeated_envelope_is_not_an_extra_event(self):
  p=self.receipt();self.assertEqual(len(self.expand([p,p])),2)
 def test_old_single_receipt_still_evaluates_and_bundle_never_swallows_secondary(self):
  p=self.receipt();del p['receipt']['market_snapshot'];self.assertEqual(len(self.expand([p])),1)
  bad=self.receipt();bad['receipt']['market_snapshot']['bundle'][1]['symbol']='INVALID?'
  with self.assertRaises(ValueError):self.expand([bad])
 def test_official_one_character_symbols_do_not_disappear_from_real_alert_audit(self):
  p=self.receipt();p['receipt']['market_snapshot']['bundle'][0]['symbol']='KRW-A';p['receipt']['market_snapshot']['bundle'][1]['symbol']='AUSDT'
  rows=self.expand([p]);self.assertEqual({r['symbol'] for r in rows},{'KRW-A','AUSDT'})
if __name__=='__main__':unittest.main()
