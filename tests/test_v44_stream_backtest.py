import copy, importlib.util, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
 from research.v44_stream_backtest import pair_observations, compare_policies, normalize_book
except ImportError:
 pair_observations=compare_policies=normalize_book=None
T=1794180000000

def feature(at=T):
 return {'session':'s','feature':{'version':'V43_PUBLIC_STREAM_EVIDENCE_V1','venue':'bitget','symbol':'AAAUSDT','asof_ms':at,'window_ms':60000,'book_count':20,'trade_count':10,'unbroken_window':True,'conflicts':0,'observed_mid_change_pct':1.,'buy_share':.7,'top_depth_imbalance':.3,'order_flow_imbalance_base':5,'spread_pct':.1,'last_quote':{'at_ms':at-50,'at_us':(at-50)*1000,'received_at_ms':at-10,'bid':100.,'ask':100.1}}}
def book(at=T+60000,bid=101.,ask=101.1):
 return {'venue':'bitget','symbol':'AAAUSDT','at_ms':at,'received_at_ms':at+10,'bid':bid,'ask':ask,'segment':'s'}
class Contracts(unittest.TestCase):
 def require(self):self.assertIsNotNone(pair_observations,'frozen-feature to future-quote evaluator must exist')
 def test_future_quote_not_past_or_candle(self):
  self.require();rows,d=pair_observations([feature()],[book(T+59999,99,99.1),book(T+60025)],T+70000,60)
  self.assertEqual(rows[0]['outcome']['provider_at_ms'],T+60025);self.assertEqual(rows[0]['outcome']['target_delay_ms'],25)
 def test_missing_future_not_invented_as_loss(self):
  self.require();r,d=pair_observations([feature()],[book(T+66000)],T+70000,60);self.assertEqual(r[0]['outcome']['status'],'UNMEASURED_QUOTE_GAP')
 def test_pending_not_counted_miss(self):
  self.require();r,d=pair_observations([feature()],[],T+30000,60);self.assertEqual(r[0]['outcome']['status'],'PENDING')
 def test_mid_direction_and_executable_return_separate(self):
  self.require();r,d=pair_observations([feature()],[book(bid=100.04,ask=100.14)],T+70000,60);o=r[0]['outcome'];self.assertEqual(o['mid_direction'],1);self.assertLess(o['long_quote_return_pct'],0);self.assertFalse(o['actual_execution_verified'])
 def test_no_future_features(self):
  self.require();f=feature();f['feature']['last_quote']['at_ms']=T+1;r,d=pair_observations([f],[book()],T+70000,60);self.assertEqual(r,[]);self.assertEqual(d['invalid_feature'],1)
 def test_market_identity_kept(self):
  self.require();q=book();q['venue']='bithumb';q['symbol']='KRW-AAA';r,d=pair_observations([feature()],[q],T+70000,60);self.assertEqual(r[0]['outcome']['status'],'UNMEASURED_QUOTE_GAP')
 def test_conflicting_duplicate_feature_excluded_both(self):
  self.require();a=feature();b=copy.deepcopy(a);b['feature']['buy_share']=.1;r,d=pair_observations([a,b],[book()],T+70000,60);self.assertEqual(r,[]);self.assertEqual(d['conflicting_features'],1)
 def test_equal_original_records_count_once(self):
  self.require();a=feature();r,d=pair_observations([a,copy.deepcopy(a)],[book()],T+70000,60);self.assertEqual(len(r),1);self.assertEqual(d['duplicate_features'],1)
 def test_initial_reverse_move_not_erased_by_later_win(self):
  self.require();r,d=pair_observations([feature()],[book(T+1000,98,98.1),book()],T+70000,60);o=r[0]['outcome'];self.assertGreater(o['long_quote_return_pct'],0);self.assertLess(o['long_max_adverse_pct'],-2);self.assertFalse(o['complete_path_verified'])
 def test_input_immutable(self):
  self.require();f=[feature()];q=[book()];before=copy.deepcopy((f,q));pair_observations(f,q,T+70000,60);self.assertEqual((f,q),before)
 def test_future_source_receive_rejected(self):
  self.require();q=book();q['received_at_ms']=T+90000;r,d=pair_observations([feature()],[q],T+70000,60);self.assertEqual(r[0]['outcome']['status'],'UNMEASURED_QUOTE_GAP')
 def test_empty_tape_does_not_vote_buy(self):
  self.require();f=feature();f['feature']['buy_share']=None;f['feature']['trade_count']=0;r,d=pair_observations([f],[book()],T+70000,60);self.assertIsNone(r[0]['hypotheses']['taker_flow'])
 def test_compared_baseline_on_identical_cases(self):
  self.require();f=feature();r,d=pair_observations([f],[book()],T+70000,60);m=compare_policies(r);self.assertEqual(m['price_momentum']['measured'],1);self.assertEqual(m['price_momentum']['baseline_correct_same_cases'],1);self.assertFalse(m['price_momentum']['live_promotion_approved'])
 def test_spot_no_fabricated_short_pnl(self):
  self.require();f=feature();f['feature'].update(venue='bithumb',symbol='KRW-AAA',observed_mid_change_pct=-1,top_depth_imbalance=-.3,buy_share=.2);q=book(bid=99,ask=99.1);q.update(venue='bithumb',symbol='KRW-AAA');r,d=pair_observations([f],[q],T+70000,60);m=compare_policies(r);self.assertEqual(m['price_momentum']['entry_count'],0);self.assertIsNone(m['price_momentum']['mean_quote_return_pct'])
 def test_bithumb_timestamp_units_are_exact(self):
  self.require();raw={'venue':'bithumb','received_at_ms':T+100,'session':'s','raw':'{"type":"orderbook","code":"KRW-AAA","timestamp":1794180000000123,"orderbook_units":[{"bid_price":100,"ask_price":101}]}'};q=normalize_book(raw)[0];self.assertEqual(q['at_ms'],T)
if __name__=='__main__':unittest.main()
