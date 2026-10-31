import datetime as dt
import unittest
from v20_regime_shadow import options,update

UTC=dt.timezone.utc
def ms(h,m=0):return int(dt.datetime(2026,10,31,h,m,tzinfo=UTC).timestamp()*1000)
def source(p5=.4,p15=-.7):
 return {'early_pool':[{'venue':'bitget','symbol':'TESTUSDT',
     'asset_identity':'VERIFIED_CRYPTO'}],
    'watchlist':[]}
def evidence(p5=.4,p15=-.7,net=15500):
 at=ms(4,0)
 return {'status':'PASS','observations':[{
   'symbol':'TESTUSDT','window_5m_price_pct':p5,
   'window_15m_price_pct':p15,
   'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
   'price_context_end_ms':at,
   'taker_flow_15m':{'verified':True,'end_ms':at,
     'full_exchange_local_public_taker_flow_verified':True,
     'completeness':'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED'},
   'recent5_pressure_shift_research':{
     'status':'REAL_15M_RECONCILED_RECENT5_VS_PRIOR10',
     'price_time_alignment_verified':True,
     'recent_flow_price_same_sign':True,
     'recent_5m_net_taker_usdt':net}
 }]}

class RegimeForward(unittest.TestCase):
 def test_initial_reversal_adopts_first_turn_for_research_only(self):
  items=list(options(source(),evidence(),ms(4,2)))
  self.assertEqual(len(items),1)
  self.assertEqual(items[0]['direction'],1)
  self.assertEqual(items[0]['regime'],'EARLY_REVERSAL')
  self.assertIsNone(items[0]['entry'])
 def test_no_15m_reversal_records_countertrend_exhaustion_hypothesis(self):
  rows=list(options(source(.4,.8),evidence(.4,.8),ms(4,2)))
  self.assertEqual(rows[0]['direction'],-1)
  self.assertEqual(rows[0]['regime'],'TREND_EXHAUSTION_HYPOTHESIS')
 def test_future_prices_required_and_four_horizon_outcomes_are_distinct(self):
  a,p=update(source(),evidence(),{'TESTUSDT':(ms(3,59),1.00)},{},ms(4,2))
  self.assertEqual(a['registered_now'],1)
  self.assertEqual(a['new_future_price_labels'],0)
  self.assertEqual(a['outcomes']['15']['decisive_accuracy'],None)
  self.assertEqual(p['pending'][0]['entry'],None)
  b,p=update(source(),evidence(),{'TESTUSDT':(ms(4,6),1.04)},p,ms(4,7))
  self.assertEqual(b['new_future_price_labels'],0)
  self.assertEqual(p['pending'][0]['entry'][0],ms(4,6))
  c,p=update(source(),evidence(),{'TESTUSDT':(ms(4,11),1.05)},p,ms(4,12))
  self.assertEqual(c['new_future_price_labels'],1)
  self.assertEqual(c['outcomes']['15']['measured'],0)
  d,p=update(source(),evidence(),{'TESTUSDT':(ms(4,21),1.08)},p,ms(4,22))
  self.assertEqual(d['new_future_price_labels'],1)
  self.assertEqual(p['pending'][0]['future_results']['15']['judgment'],'RIGHT')
  _,p=update(source(),evidence(),{'TESTUSDT':(ms(4,36),1.12)},p,ms(4,37))
  z,p=update(source(),evidence(),{'TESTUSDT':(ms(5,6),1.16)},p,ms(5,7))
  self.assertEqual(z['newly_completed_60m'],1)
  self.assertEqual(z['outcomes']['15']['measured'],1)
  self.assertEqual(z['outcomes']['15']['right'],1)
  self.assertEqual(z['outcomes']['60']['right'],1)
  self.assertEqual(z['registered_now'],0)
  self.assertFalse(z['telegram_sent'])
  self.assertFalse(z['real_orders'])
 def test_trend_continuation_predicts_exhaustion_and_prospective_outcome(self):
  flow=evidence(.4,.7)
  _,p=update(source(),flow,{}, {},ms(4,2))
  _,p=update(source(),flow,{'TESTUSDT':(ms(4,6),1.00)},p,ms(4,7))
  a,p=update(source(),flow,{'TESTUSDT':(ms(4,21),.97)},p,ms(4,22))
  self.assertEqual(p['pending'][0]['direction'],-1)
  self.assertEqual(p['pending'][0]['future_results']['15']['judgment'],'RIGHT')
  self.assertEqual(a['outcomes']['15']['measured'],0)
 def test_wrong_and_missing_execution_data_never_fabricate_win(self):
  x=evidence();x['observations'][0]['taker_flow_15m']['verified']=False
  self.assertEqual(list(options(source(),x,ms(4,2))),[])
  r,p=update(source(),x,{}, {},ms(4,2))
  self.assertEqual(r['registered_now'],0)
  self.assertEqual(p['outcomes'],[])
 def test_quote_coverage_and_missing_time_do_not_create_return(self):
  _,p=update(source(),evidence(),{}, {},ms(4,2))
  a,p=update(source(),evidence(),{'TESTUSDT':(ms(4,6),1)},p,ms(4,7))
  b,p=update(source(),evidence(),{'TESTUSDT':(ms(4,26),1.2)},p,ms(4,27))
  self.assertEqual(b['outcomes']['15']['measured'],0)
  self.assertEqual(p['pending'][0]['future_results']['15']['judgment'],
     'UNAVAILABLE_EXACT_COMPLETED_PRICE')
if __name__=='__main__':unittest.main()
