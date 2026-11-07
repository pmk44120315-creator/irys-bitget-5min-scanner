import unittest,copy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
 from research.v40_frozen_features import features, labels, time_split
except ImportError:
 features=labels=time_split=None
T=1794032400000

def fixture():
 e={'id':'bitget:AAAUSDT:LONG:1','venue':'bitget','symbol':'AAAUSDT','direction':'LONG','issued_at_ms':T,
 'source_observed_at_ms':T-1000,'source_quote_at_ms':T-1100,'time_basis':'ACTUAL_EVALUATOR_DECISION_CLOCK',
 'original_bid':100.,'original_ask':100.2,'entry_price':100.2,
 'direction_outcomes':{'5':{'status':'MEASURED_DIRECTION','target_ms':T+300000,'close_at_ms':T+300000,'entry_quote_reference':100.2,'target_close':100.15,'horizon_minutes':5,'actual_execution_verified':False}}}
 x={'candidate':{'venue':'bitget','symbol':'AAAUSDT','direction':'LONG','change_pct':1.,'anchor_price':99.,'discovery_price':100.},
 'first':{'venue':'bitget','symbol':'AAAUSDT','observed_at_ms':T-20000,'quote':{'bid':99.9,'ask':100.1,'at_ms':T-21000},'trades':[{'id':'a','at_ms':T-30000,'side':'BUY','price':100.,'size':2}]},
 'second':{'venue':'bitget','symbol':'AAAUSDT','observed_at_ms':T-5000,'quote':{'bid':100.,'ask':100.2,'at_ms':T-5500},'trades':[{'id':'b','at_ms':T-10000,'side':'SELL','price':100.,'size':1}]},
 'final':{'venue':'bitget','symbol':'AAAUSDT','observed_at_ms':T-1000,'quote':{'bid':100.,'ask':100.2,'at_ms':T-1100}}}
 return e,x
class FrozenTests(unittest.TestCase):
 def test_independent_features_exist(self):
  self.assertIsNotNone(features)
  e,x=fixture();f=features(e,x)
  self.assertAlmostEqual(f['buy_share_first'],1.)
  self.assertAlmostEqual(f['buy_share_new'],0.)
  self.assertEqual(f['new_trade_count'],1)
 def test_future_quote_rejected(self):
  self.assertIsNotNone(features)
  e,x=fixture();x['final']['quote']['at_ms']=T+1
  self.assertRaises(ValueError,features,e,x)
 def test_future_trade_not_used(self):
  self.assertIsNotNone(features)
  e,x=fixture();a=features(e,x);x['second']['trades'].append({'id':'future','at_ms':T+1,'price':100.,'size':999,'side':'BUY'})
  self.assertEqual(a,features(e,x))
 def test_unmatched_quote_rejected(self):
  self.assertIsNotNone(features)
  e,x=fixture();x['final']['quote']['bid']=90
  self.assertRaises(ValueError,features,e,x)
 def test_legacy_clock_rejected(self):
  self.assertIsNotNone(features)
  e,x=fixture();e.pop('time_basis')
  self.assertRaises(ValueError,features,e,x)
 def test_labels_not_features(self):
  self.assertIsNotNone(features)
  e,x=fixture();a=features(e,x);e['direction_outcomes']['5']['target_close']=100000
  self.assertEqual(a,features(e,x))
 def test_empty_tape_is_missing_not_fabricated_buy(self):
  self.assertIsNotNone(features)
  e,x=fixture();x['second']['trades']=[];f=features(e,x)
  self.assertIsNone(f['buy_share_new']);self.assertEqual(f['new_trade_count'],0)
 def test_mid_direction_not_same_as_quote_profit(self):
  self.assertIsNotNone(labels)
  e,_=fixture();v=labels(e,5,T+360000)
  self.assertEqual(v['direction'],1);self.assertLess(v['long_quote_proxy_pct'],0)
 def test_pending_never_enters_training(self):
  self.assertIsNotNone(labels)
  e,_=fixture();self.assertIsNone(labels(e,5,T+200000))
 def test_future_label_clock_and_reference_mismatch_rejected(self):
  self.assertIsNotNone(labels)
  e,_=fixture();e['direction_outcomes']['5']['entry_quote_reference']=50
  self.assertIsNone(labels(e,5,T+360000))
 def test_split_strict_label_embargo_no_equal_time_leak(self):
  self.assertIsNotNone(time_split)
  rows=[{'issued_at_ms':T+i*60000,'label_available_ms':T+(i+5)*60000} for i in range(1000)]
  parts=time_split(rows,60)
  self.assertLess(max(rows[i]['label_available_ms'] for i in parts['train']),min(rows[i]['issued_at_ms'] for i in parts['validation']))
  self.assertLess(max(rows[i]['label_available_ms'] for i in parts['validation']),min(rows[i]['issued_at_ms'] for i in parts['test']))
  self.assertFalse(set(parts['train'])&set(parts['test']))
if __name__=='__main__':unittest.main()
