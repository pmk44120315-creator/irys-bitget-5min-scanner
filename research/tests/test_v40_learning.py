import unittest,sys,copy,numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from research.v40_direction_model import fit_preprocessor,transform,predict_portable,fit_candidates,evaluate,choose
from research.v40_context_learning import prepare_rows,context_label,signal_name
from research.v40_forward_validation import forward
T=1794000000000

def event(t=T):
 return {'issued_ms':t,'venue':'bitget','symbol':'AAAUSDT','shadow_only':True,
 'features':{'p5':1.,'p15':2.,'recent_flow_bias':0.},
 'entry_quote':{'bid':100.,'ask':100.2,'at_ms':t-1000},
 'decisions':{'5':{'direction':1}},
 'outcomes':{'5':{'horizon_min':5,'target_ms':t+300000,'both_sides_measured':True,'actual_fills_verified':False,
 'exit_quote':{'bid':100.12,'ask':100.14,'at_ms':t+310000},'signed_quote_returns':{'1':-.0798403,'-1':-.14}}}}

class ModelTests(unittest.TestCase):
 def test_training_only_preprocessor(self):
  x=np.array([[1.,np.nan],[2.,3.],[3.,4.]])
  p=fit_preprocessor(x);before=copy.deepcopy(p);y=transform(np.array([[100000.,999.]]),p)
  self.assertEqual(before,p);self.assertTrue(np.isfinite(y).all());self.assertEqual(y.shape,(1,4))
 def test_missing_flags_are_retained(self):
  x=np.array([[1.,np.nan],[2.,3.],[3.,4.]])
  p=fit_preprocessor(x);y=transform(x,p)
  self.assertEqual(y.shape[1],4);self.assertFalse(np.array_equal(y[0],y[1]))
 def test_portable_model_matches_library_predictions(self):
  rng=np.random.default_rng(20);x=rng.normal(size=(120,3));y=np.where(x[:,0]>0,1,-1)
  for name,(model,bundle) in fit_candidates(x,y).items():
   want=model.predict_proba(x)[:,list(model.classes_).index(1)]
   self.assertTrue(np.allclose(want,predict_portable(x,bundle),atol=1e-11),name)
 def test_validation_choice_ignores_test(self):
  self.assertEqual(choose({'a':{'balanced_accuracy':.6,'logloss':.7},'b':{'balanced_accuracy':.6,'logloss':.6}}),'b')
 def test_flat_missing_and_price_direction_separate(self):
  rows=[{'label':{'direction':1,'long_quote_proxy_pct':-.1,'short_quote_proxy_pct':-.1},'features':{'candidate_side':1},'issued_at_ms':10,'symbol':'AAA'},
  {'label':{'direction':0,'long_quote_proxy_pct':-.1,'short_quote_proxy_pct':-.1},'features':{'candidate_side':-1},'issued_at_ms':20,'symbol':'BBB'},
  {'label':None,'features':{'candidate_side':1},'issued_at_ms':30,'symbol':'CCC'}]
  m=evaluate(rows,np.array([.7,.7,.7]),'bitget')
  self.assertEqual(m['cases'],3);self.assertEqual(m['direction_measured'],1)
  self.assertEqual(m['flat'],1);self.assertEqual(m['unmeasured'],1);self.assertEqual(m['correct'],1)
  self.assertLess(m['mean_quote_proxy_pct'],0)
 def test_bithumb_wait_never_simulated_as_short(self):
  rows=[{'label':{'direction':-1,'long_quote_proxy_pct':-2.,'short_quote_proxy_pct':2.},'features':{'candidate_side':1},'issued_at_ms':10,'symbol':'AAA'}]
  m=evaluate(rows,np.array([.1]),'bithumb')
  self.assertEqual(m['correct'],1);self.assertEqual(m['entry_signals'],0);self.assertIsNone(m['mean_quote_proxy_pct'])

class ContextTests(unittest.TestCase):
 def test_real_mid_direction_distinct_from_bidask_losses(self):
  r=context_label(event(),5,T+360000)
  self.assertEqual(r['direction'],1);self.assertLess(r['long_quote_proxy_pct'],0);self.assertLess(r['short_quote_proxy_pct'],0)
 def test_future_quote_blocked(self):
  self.assertIsNone(context_label(event(),5,T+300000))
 def test_stale_entry_invalid(self):
  e=event();e['entry_quote']['at_ms']=T-61000
  r,d=prepare_rows({'completed':[e]},T+360000);self.assertEqual(len(r),0)
 def test_delayed_outside_window_is_missing(self):
  e=event();e['outcomes']['5']['exit_quote']['at_ms']=T+460000
  self.assertIsNone(context_label(e,5,T+600000))
 def test_features_not_altered_by_outcome(self):
  e=event();a,_=prepare_rows({'completed':[e]},T+360000)
  e['outcomes']['5']['exit_quote'].update({'bid':110.,'ask':110.2})
  b,_=prepare_rows({'completed':[e]},T+360000);self.assertEqual(a[0]['features'],b[0]['features'])
 def test_duplicates_not_independent(self):
  a=event();r,d=prepare_rows({'completed':[a,copy.deepcopy(a)]},T+360000)
  self.assertEqual(len(r),1);self.assertEqual(d['duplicate'],1)
 def test_conflicting_duplicates_neither_accepted(self):
  a=event();b=copy.deepcopy(a);b['features']['p5']=99
  r,d=prepare_rows({'completed':[a,b]},T+360000)
  self.assertEqual(len(r),0);self.assertEqual(d['conflicting_duplicate'],2)
 def test_spot_signal_names(self):
  self.assertEqual(signal_name('bithumb',.9),'BUY');self.assertEqual(signal_name('bithumb',.1),'WAIT');self.assertEqual(signal_name('bitget',.1),'SHORT')
 def test_no_unknown_future_feature_column(self):
  e=event();e['features']['future_price']=1e9;r,d=prepare_rows({'completed':[e]},T+360000)
  self.assertNotIn('future_price',r[0]['features'])
 def test_label_metadata_matches(self):
  e=event();e['outcomes']['5']['target_ms']+=1;self.assertIsNone(context_label(e,5,T+360000))

class ForwardTests(unittest.TestCase):
 def model(self):
  return {'bitget':{'features':['p5'],'preprocessor':{'median':[0.],'lower':[-5.],'upper':[5.],'center':[0.],'scale':[1.]},'model':{'kind':'logistic','coefficients':[1.,0.],'intercept':0.},'train_max_label_ms':T-60000}}
 def test_new_period_only(self):
  r=forward(self.model(),{'completed':[event(T),event(T+600000)]},T+3600000,T)
  self.assertEqual(r['venues']['bitget']['model']['cases'],1)
 def test_model_immutable(self):
  m=self.model();before=copy.deepcopy(m);forward(m,{'completed':[event(T+600000)]},T+3600000,T);self.assertEqual(m,before)
 def test_later_training_blocked(self):
  m=self.model();m['bitget']['train_max_label_ms']=T+600000
  self.assertRaises(ValueError,forward,m,{'completed':[event(T+600000)]},T+3600000,T)
 def test_no_live_claim_or_retraining(self):
  r=forward(self.model(),{'completed':[event(T+600000)]},T+3600000,T)
  self.assertFalse(r['live_approved']);self.assertFalse(r['retrained']);self.assertFalse(r['actual_execution_verified'])
if __name__=='__main__':unittest.main()
