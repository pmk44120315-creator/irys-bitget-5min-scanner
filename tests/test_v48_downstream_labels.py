import unittest,copy
from research.v40_frozen_features import labels
V='V48_CLOSED_MINUTE_AT_OR_AFTER_TARGET_V1'
T=1794021639000;M=60000

def row():
 return {'issued_at_ms':T,'direction':'LONG','original_bid':100.,'original_ask':100.1,'entry_price':100.1,'direction_measurement_version':V,'direction_outcomes':{'5':{'status':'MEASURED_DIRECTION','target_ms':T+5*M,'close_at_ms':((T+5*M+M-1)//M)*M,'entry_quote_reference':100.1,'target_close':101.,'horizon_minutes':5,'actual_execution_verified':False,'measurement_version':V}}}
class Downstream(unittest.TestCase):
 def test_corrected_label_accepted_with_semantics(self):
  v=labels(row(),5,T+10*M);self.assertIsNotNone(v);self.assertEqual(v['measurement_version'],V)
 def test_before_actual_close_not_accepted(self):self.assertIsNone(labels(row(),5,T+5*M))
 def test_mismatched_version_rejected(self):
  e=row();e.pop('direction_measurement_version');self.assertIsNone(labels(e,5,T+10*M))
 def test_unknown_version_rejected(self):
  e=row();e['direction_measurement_version']='UNKNOWN';self.assertIsNone(labels(e,5,T+10*M))
 def test_legacy_remains_replayable_but_identified(self):
  e=row();e.pop('direction_measurement_version');o=e['direction_outcomes']['5'];o.pop('measurement_version');o['close_at_ms']=(T+5*M)//M*M
  v=labels(e,5,T+10*M);self.assertIsNotNone(v);self.assertEqual(v['measurement_version'],'LEGACY_BEFORE_TARGET')
if __name__=='__main__':unittest.main()
