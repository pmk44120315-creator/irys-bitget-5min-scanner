import datetime as dt
import unittest
from v18_shadow_forecast import run
UTC=dt.timezone.utc
def at(h,m):return int(dt.datetime(2026,10,30,h,m,tzinfo=UTC).timestamp()*1000)
def snap(h,m,price_ts=None,price=1.02):
 t=at(h,m)
 return {'collector_status':'PASS',
  'finished_utc':dt.datetime.fromtimestamp(t/1000,UTC).isoformat(),
  'watchlist':[{'symbol':'ALTUSDT','asset_identity':'VERIFIED_CRYPTO',
    'venue':'bitget','windows':{'5m':{'price_change_pct':.3},
      '15m':{'price_change_pct':-.2}}}],
  'early_pool':[],
  'spot_flow':{'direction_review_seeds':[{'market':'KRW-ALT',
    'observed_5m_price_change_pct':.4}]},
  'verified_crypto_futures_closed_prices':{
    'ALTUSDT':{'closed_end_ms':price_ts if price_ts is not None else t-3*60000,
      'close_usdt':price}}}
def evidence(h,m,s):
 return {'status':'PASS','at_utc':dt.datetime.fromtimestamp(at(h,m)/1000,UTC).isoformat(),
  'source_finished_utc':s['finished_utc'],
  'observations':[{'symbol':'ALTUSDT',
    'window_5m_price_pct':.3,'window_15m_price_pct':-.2,
    'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
    'taker_flow_15m':{'verified':True},
    'recent5_pressure_shift_research':{
      'price_time_alignment_verified':True,
      'recent_5m_net_taker_usdt':2000}}]}
class LiveShadow(unittest.TestCase):
 def test_infer_real_flow_and_no_future_label_leak(self):
  x=snap(8,0);flow=evidence(8,1,x)
  r,state=run(x,{},flow,{},at(8,2))
  self.assertEqual(r['status'],'RESEARCH_ACTIVE')
  self.assertEqual(r['matured_new'],0)
  self.assertIsNone(r['observed_results']['bitget']['direction_accuracy'])
  self.assertTrue(r['no_telegram'])
  self.assertTrue(r['no_orders'])
  self.assertGreater(len(r['predictions']),0)
  self.assertEqual(r['pending'],2)
  y=snap(8,7,at(8,6),1.04)
  r2,state2=run(y,{},evidence(8,8,y),state,at(8,9))
  self.assertEqual(r2['matured_new'],0)
  self.assertIsNone(r2['observed_results']['bitget']['direction_accuracy'])
  self.assertIsNotNone(state2['pending'][0]['entry'])
  z=snap(8,24,at(8,23),1.11)
  r3,state3=run(z,{},evidence(8,25,z),state2,at(8,26))
  self.assertGreaterEqual(r3['matured_new'],1)
  self.assertGreaterEqual(r3['observed_results']['bitget']['measured'],1)
  self.assertTrue(all(x['real_trade_execution'] is False for x in state3['outcomes']))
 def test_incomplete_future_is_not_marked_win(self):
  x=snap(8,0);r,state=run(x,{},evidence(8,1,x),{},at(8,2))
  y=snap(8,7,at(8,6));r2,state2=run(y,{},evidence(8,8,y),state,at(8,9))
  z=snap(8,15,at(8,14))
  r3,_=run(z,{},evidence(8,16,z),state2,at(8,17))
  self.assertEqual(r3['matured_new'],0)
 def test_missing_evidence_cannot_create_direction(self):
  s=snap(8,0)
  r,_=run(s,{}, {'status':'FAILED'}, {},at(8,2))
  self.assertEqual(r['status'],'SOURCE_NOT_READY')
  self.assertEqual(r['predictions'],[])
 def test_unverified_futures_taker_excluded(self):
  s=snap(8,0);e=evidence(8,1,s)
  e['observations'][0]['taker_flow_15m']['verified']=False
  r,_=run(s,{},e,{},at(8,2))
  self.assertEqual([x for x in r['predictions'] if x['venue']=='bitget'],[])
 def test_existing_state_is_not_modified_on_invalid_source(self):
  state={'weights':{'bitget':[.2]*5},'pending':[]}
  s=snap(8,0)
  r,out=run(s,{},evidence(8,1,s),state,at(9,0))
  self.assertEqual(r['status'],'SOURCE_NOT_READY')
  self.assertEqual(out,state)
if __name__=='__main__': unittest.main()
