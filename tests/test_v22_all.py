import copy,unittest,importlib,math
from v22_performance import enrich,aligned_label,return_prediction,decide,regression_export_valid
from v22_learning import initialize,predict,update
from v22_live import process,policy_hash
MIN=60000;BASE=1800000000000

class V22Performance(unittest.TestCase):
 def test_current_horizon_rejects_four_minute_delayed_entry(self):
  t=BASE;self.assertIsNone(aligned_label([(t+4*MIN,100,t+4*MIN+1000),(t+9*MIN,102,t+9*MIN+1000)],t,5))
 def test_near_current_entry_exact_future_horizon(self):
  t=BASE;r=aligned_label([(t+20000,100,t+21000),(t+320000,101,t+321000)],t,5)
  self.assertEqual(r['entry_delay_ms'],20000);self.assertAlmostEqual(r['return_pct'],1);self.assertEqual(r['available_ms'],t+321000)
 def test_no_future_price_interpolation(self):
  t=BASE;self.assertIsNone(aligned_label([(t+20000,100,t+21000),(t+360000,110,t+361000)],t,5))
 def test_contrary_flow_remains_a_feature(self):
  x=enrich({'p5':1,'range5':2,'recent_flow_bias':-.8,'flow_verified':1});self.assertLess(x['price_flow_efficiency'],0);self.assertEqual(x['recent_flow_bias'],-.8)
 def test_future_outcomes_never_enter_input(self):
  a={'p5':1,'range5':2,'recent_flow_bias':.5};self.assertEqual(enrich(a),enrich({**a,'future_return':100,'outcomes':{'win':True}}))
 def test_missingness_does_not_fabricate_verified_flow(self):
  x=enrich({'p5':.1,'range5':0,'flow_verified':0,'recent_flow_missing':1});self.assertEqual(x['flow_verified'],0);self.assertEqual(x['recent_flow_missing'],1)
 def test_linear_expected_return_is_not_probability(self):
  m={'kind':'return_ridge','features':['p5'],'mean':[0.],'scale':[2.],'coef':[.4],'intercept':-.1};self.assertAlmostEqual(return_prediction(m,{'p5':2}),.3)
 def test_tree_export_scalar_ensemble_parity(self):
  m={'kind':'return_forest','features':['p5'],'trees':[{'left':[1,-1,-1],'right':[2,-1,-1],'feature':[0,-2,-2],'threshold':[0,-2,-2],'value':[0,-.4,.8]},{'left':[-1],'right':[-1],'feature':[-2],'threshold':[-2],'value':[.2]}]}
  self.assertAlmostEqual(return_prediction(m,{'p5':1}),.5);self.assertAlmostEqual(return_prediction(m,{'p5':-1}),-.1)
 def test_corrupt_regression_rejected(self):
  m={'kind':'return_ridge','features':['p5'],'mean':[0],'scale':[0],'coef':[1],'intercept':0};self.assertFalse(regression_export_valid(m))
  with self.assertRaises(ValueError):return_prediction(m,{'p5':1})
 def test_spread_and_cost_economic_accounting(self):
  a=decide(.32,'bitget',.2,.15);self.assertEqual(a['side'],0);self.assertEqual(a['reason'],'EXPECTED_MOVE_BELOW_COSTS')
  b=decide(-.6,'bitget',.2,.1);self.assertEqual(b['side'],-1);self.assertAlmostEqual(b['expected_net_pct'],.3)
 def test_spot_short_is_not_buy(self):
  a=decide(-.8,'bithumb',.2,.01);self.assertEqual(a['side'],0);self.assertEqual(a['reason'],'SPOT_DOWN_NOT_BUY')
 def test_nonfinite_model_or_negative_spread_not_actionable(self):
  for p,s in [(float('nan'),.1),(.6,-.1),(.6,float('inf'))]:self.assertEqual(decide(p,'bitget',.2,s)['side'],0)

class V22Learning(unittest.TestCase):
 def model(self):return {'features':['p5','recent_flow_bias'],'mean':[0,0],'scale':[1,1],'coef':[0,0],'intercept':0}
 def test_future_label_cannot_update(self):
  s=initialize(self.model());before=copy.deepcopy(s)
  with self.assertRaises(ValueError):update(s,{'p5':1},.5,100,101,'future')
  self.assertEqual(s,before)
 def test_completed_positive_labels_change_forecast(self):
  s=initialize(self.model());before=predict(s,{'p5':1,'recent_flow_bias':1})
  for i in range(1,40):s=update(s,{'p5':1,'recent_flow_bias':1},.8,i*1000,i*1000,str(i))
  self.assertGreater(predict(s,{'p5':1,'recent_flow_bias':1}),before+.3);self.assertEqual(s['updates'],39)
 def test_duplicate_outcome_never_trained_twice(self):
  s=update(initialize(self.model()),{'p5':1},.5,100,100,'same');before=copy.deepcopy(s)
  self.assertEqual(update(s,{'p5':1},.5,100,100,'same'),before)
 def test_losses_can_learn_reversal_without_manual_switch(self):
  s=initialize(self.model())
  for i in range(1,40):s=update(s,{'p5':1,'recent_flow_bias':1},-.8,i*1000,i*1000,str(i))
  self.assertLess(predict(s,{'p5':1,'recent_flow_bias':1}),-.3)
 def test_corrupt_scaling_rejected(self):
  m=self.model();m['scale']=[1,0]
  with self.assertRaises(ValueError):initialize(m)
 def test_covariance_remains_symmetric_finite(self):
  s=initialize(self.model())
  for i in range(1,150):s=update(s,{'p5':(-1)**i,'recent_flow_bias':i%3-1},.2*(-1)**i,i*100000,i*100000,str(i))
  p=s['covariance'];self.assertTrue(all(math.isfinite(v) for row in p for v in row));self.assertTrue(all(abs(p[i][j]-p[j][i])<1e-8 for i in range(3) for j in range(3)));self.assertTrue(all(p[i][i]>0 for i in range(3)))
 def test_seed_information_preserved(self):
  m={'features':['a'],'mean':[0.],'scale':[1.],'coef':[0.],'intercept':0.,'covariance':[[.001,0.],[0.,.002]]};s=initialize(m)
  self.assertEqual(s['covariance'],m['covariance']);self.assertLess(abs(predict(update(s,{'a':1.},.1,2000,2000,'x'),{'a':1.})),.001)
 def test_asymmetric_seed_information_rejected(self):
  m={'features':['a'],'mean':[0.],'scale':[1.],'coef':[0.],'intercept':0.,'covariance':[[1.,2.],[0.,1.]]}
  with self.assertRaises(ValueError):initialize(m)

class DenseLearning(unittest.TestCase):
 def seed(self):return {'bitget_5':{'venue':'bitget','horizon_min':5,'features':['p5'],'mean':[0.],'scale':[1.],'coef':[0.],'intercept':0.}}
 def rows(self):return [{'symbol':'TESTUSDT','venue':'bitget','features':{'p5':1.}}]
 def quote(self,t,bid=100.,ask=100.1):return {('bitget','TESTUSDT'):{'bid':bid,'ask':ask,'at_ms':t,'source':'OFFICIAL_TEST_QUOTE'}}
 def test_abstentions_are_recorded_not_filtered_away(self):
  r,s=process(self.rows(),self.quote(BASE),{},self.seed(),BASE)
  self.assertEqual(r['registered_examples'],1);self.assertEqual(r['directional_predictions'],0);self.assertEqual(len(s['pending']),1);self.assertEqual(s['pending'][0]['features']['p5'],1.);self.assertEqual(s['learners']['bitget_5']['updates'],0)
 def test_only_completed_future_quote_teaches(self):
  _,s=process(self.rows(),self.quote(BASE),{},self.seed(),BASE)
  early,s=process([],self.quote(BASE+299000,101,101.1),s,self.seed(),BASE+299000);self.assertEqual(early['new_training_examples'],0)
  r,s=process([],self.quote(BASE+300000,101,101.1),s,self.seed(),BASE+300000);self.assertEqual(r['new_training_examples'],1);self.assertEqual(s['learners']['bitget_5']['updates'],1);self.assertEqual(s['completed'][0]['up_quote_return_pct'],100*(101/100.1-1))
 def test_repeat_run_cannot_duplicate_registration_or_learning(self):
  _,s=process(self.rows(),self.quote(BASE),{},self.seed(),BASE);_,s=process(self.rows(),self.quote(BASE),s,self.seed(),BASE);self.assertEqual(len(s['pending']),1)
  _,s=process([],self.quote(BASE+300000,101,101.1),s,self.seed(),BASE+300000);_,s=process([],self.quote(BASE+300000,101,101.1),s,self.seed(),BASE+300000);self.assertEqual(s['learners']['bitget_5']['updates'],1)
 def test_missing_future_is_not_win_or_training(self):
  _,s=process(self.rows(),self.quote(BASE),{},self.seed(),BASE);r,s=process([],{},s,self.seed(),BASE+451000)
  self.assertEqual(r['new_training_examples'],0);self.assertEqual(s['learners']['bitget_5']['updates'],0);self.assertEqual(len(s['unmeasured']),1)
 def test_abstentions_can_teach_later_directions_but_not_premature_alerts(self):
  s={}
  for i in range(20):
   now=BASE+i*300000;p=100*1.01**i;r,s=process(self.rows(),self.quote(now,p,p+.1),s,self.seed(),now)
  self.assertGreater(s['learners']['bitget_5']['updates'],15);self.assertGreater(r['directional_predictions'],0);self.assertFalse(r['delivery_candidates']);self.assertEqual(r['certificates']['bitget_5']['1']['evidence_type'],'CAUSAL_PREQUENTIAL_ADAPTIVE_POLICY_QUOTE_RETURNS')
 def test_policy_change_cannot_inherit_prior_accuracy(self):
  b=self.seed();_,s=process(self.rows(),self.quote(BASE),{},b,BASE);h=policy_hash(b);b['bitget_5']['coef']=[.1];self.assertNotEqual(h,policy_hash(b));r,s=process([],{},s,b,BASE+300000);self.assertEqual(r['completed_examples'],0);self.assertTrue(r['policy_reset'])
 def test_negative_spot_estimate_is_not_buy(self):
  b={'bithumb_5':{'venue':'bithumb','horizon_min':5,'features':['p5'],'mean':[0.],'scale':[1.],'coef':[-1.],'intercept':0.}}
  r,s=process([{'symbol':'KRW-TEST','venue':'bithumb','features':{'p5':1.}}],{('bithumb','KRW-TEST'):{'bid':99.,'ask':100.,'at_ms':BASE}},{},b,BASE)
  self.assertEqual(r['registered_examples'],1);self.assertEqual(r['directional_predictions'],0);self.assertEqual(r['delivery_candidates'],[])
 def test_stale_quote_no_fresh_entry(self):
  r,s=process(self.rows(),self.quote(BASE-61000),{},self.seed(),BASE);self.assertEqual(r['registered_examples'],0);self.assertEqual(r['entry_quote_rejections'],1)
 def test_input_state_not_mutated(self):
  _,s=process(self.rows(),self.quote(BASE),{},self.seed(),BASE);before=copy.deepcopy(s);process([],self.quote(BASE+300000,101,101.1),s,self.seed(),BASE+300000);self.assertEqual(s,before)
 def test_training_retention_does_not_destroy_24h_validation(self):
  now=2000000000000;b=self.seed();v=[{'model_key':'bitget_5','side':1,'symbol':'AAUSDT','issued_ms':now-26*3600000,'ret':.8},{'model_key':'bitget_5','side':1,'symbol':'BBUSDT','issued_ms':now-100000,'ret':.8}]
  r,s=process([],{}, {'policy_sha256':policy_hash(b),'validation':v,'completed':[]},b,now);self.assertEqual(r['certificates']['bitget_5']['1']['observed_signals'],2);self.assertGreater(r['certificates']['bitget_5']['1']['span_hours'],24)
 def test_unselected_comparison_keeps_training_without_direction(self):
  b=self.seed();b['bitget_5'].update({'forecast_enabled':False,'intercept':2.});r,s=process(self.rows(),self.quote(BASE),{},b,BASE);self.assertEqual(r['registered_examples'],1);self.assertEqual(r['directional_predictions'],0)
 def test_tree_runtime_not_reported_as_linear_update(self):
  tree={'kind':'return_forest','features':['p5'],'trees':[{'left':[-1],'right':[-1],'feature':[-2],'threshold':[-2.],'value':[1.]}]};b={'bitget_15':{'venue':'bitget','horizon_min':15,'kind':'hourly_tree','tree_model':tree}}
  r,s=process(self.rows(),self.quote(BASE),{},b,BASE);self.assertEqual(r['directional_predictions'],1);self.assertEqual(r['learner_updates'],{})
  r,s=process(self.rows(),self.quote(BASE+900000,101,101.1),s,b,BASE+900000);self.assertEqual(r['new_training_examples'],1);self.assertEqual(r['tree_refits']['bitget_15'],0);self.assertEqual(len(s['tree_training']),1)

class TreeLearning(unittest.TestCase):
 def test_future_and_over_24h_rows_excluded(self):
  import v22_tree as m
  now=1000000000;rows=[{'closed_ms':now-1,'issued_ms':now-10000,'features':{'p5':1},'midpoint_return_pct':.2},{'closed_ms':now+1,'issued_ms':now-10000,'features':{'p5':1},'midpoint_return_pct':999},{'closed_ms':now-1,'issued_ms':now-25*3600000,'features':{'p5':1},'midpoint_return_pct':999}]
  selected=m.mature_rows(rows,now);self.assertEqual(len(selected),1);self.assertEqual(selected[0]['midpoint_return_pct'],.2)
 def test_insufficient_observations_preserve_seed(self):
  import v22_tree as m
  seed={'kind':'return_forest','features':['p5'],'trees':[{'left':[-1],'right':[-1],'feature':[-2],'threshold':[-2.],'value':[.3]}]};s=m.refresh({'model':seed},[],1000000000);self.assertEqual(m.forecast(s,{'p5':2}),.3);self.assertEqual(s.get('fit_count',0),0)
 def test_observed_data_updates_tree_once_per_hour(self):
  import v22_tree as m
  now=1000000000;rows=[{'closed_ms':now-1,'issued_ms':now-i*10000-10000,'features':{'p5':i/100},'midpoint_return_pct':.4} for i in range(100)]
  s=m.refresh({},rows,now);self.assertEqual(s['training_rows'],100);self.assertEqual(s['fit_count'],1);self.assertAlmostEqual(m.forecast(s,{'p5':.2}),.4);self.assertEqual(m.refresh(s,rows,now+1000)['fit_count'],1)

class QueryTime(unittest.TestCase):
 def test_bithumb_uses_documented_kst_not_utc_suffix(self):
  from research.v22_collect_exact_labels import bithumb_to
  self.assertEqual(bithumb_to(1793445000000),'2026-10-31T20:10:00')
if __name__=='__main__':unittest.main()
