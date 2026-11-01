"""V26 causality and persistence tests: unknown != 0, no future reuse, no trades."""
import copy
import datetime as dt
import unittest
from unittest.mock import patch
import v26_direction_core as core
import v26_direction_runtime as engine

NOW=int(dt.datetime(2026,11,1,12,45,tzinfo=dt.timezone.utc).timestamp()*1000)
def iso(ts):return dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat()
def feat(flow=1,bias=.3,p5=.8):
    return {'p1':.2,'p5':p5,'p15':-.4,'relative_to_market':.5,
      'flow_verified':flow,'recent_flow_missing':int(not flow),
      'recent_flow_bias':bias,'oi_delta':3.4,
      'close_location':.76,'close_location_missing':0,'book_verified':1,
      'book_ratio_log':.3,'spread_missing':0,'spread_pct':.04}
def event(issued=NOW-30_000,venue='bitget',symbol='POWRUSDT',flow=1,bias=.3,p5=.8):
    return {'venue':venue,'symbol':symbol,'issued_ms':issued,
      'features':feat(flow,bias,p5),'real_taker_verified':bool(flow),
      'entry_quote':{'bid':100.,'ask':100.1,'at_ms':issued-3_000},
      'votes':{'5':{'momentum5':1}},'decisions':{'5':{'direction':1}},
      'outcomes':{}}
def source(t):return {'asof_utc':iso(t-1_000),'status':'RESEARCH_ACTIVE'}
def ledger(e):return {'pending':[e],'completed':[]}
def later(e,minutes=5,bid=101.,ask=101.1):
    z=copy.deepcopy(e)
    issued=z['issued_ms'];at=issued+minutes*60_000+2_000
    ep=z['entry_quote']
    z['outcomes'][str(minutes)]={'both_sides_measured':True,
        'exit_quote':{'bid':bid,'ask':ask,'at_ms':at},
        'signed_quote_returns':{
         '1':100*(bid/ep['ask']-1),
         '-1':100*(ep['bid']-ask)/ep['bid']}}
    return z

class DirectionV26Core(unittest.TestCase):
    def test_real_taker_and_price_agreement_is_hypothesis_not_trade_proof(self):
        r=core.direction_hypotheses(feat(), 'bitget',True)
        self.assertEqual(r['votes']['v26_primary'],1)
        self.assertEqual(r['evidence_class'],'REAL_TAKER_PRICE_ALIGNED')
        self.assertTrue(r['first_reversal_vs_15m'])
        self.assertFalse(r['future_direction_proven'])
        self.assertFalse(r['orders_allowed'])
        self.assertFalse(r['telegram_allowed'])
        self.assertEqual(r['oi_change_observed_not_position_side'],3.4)
    def test_price_rises_while_aggressive_sellers_dominate_is_not_falsely_short(self):
        r=core.direction_hypotheses(feat(bias=-.4),'bitget',True)
        self.assertEqual(r['evidence_class'],'PRICE_TAKER_DISAGREEMENT_UNRESOLVED')
        self.assertEqual(r['votes']['v26_primary'],0)
        self.assertEqual(r['votes']['price_with_flow_disagreement'],1)
        self.assertEqual(r['votes']['taker_with_price_disagreement'],-1)
    def test_sparse_or_unverified_taker_is_unknown_not_fake_confirmation(self):
        r=core.direction_hypotheses(feat(flow=0,bias=.99),'bitget',False)
        self.assertEqual(r['votes']['verified_taker'],0)
        self.assertEqual(r['evidence_class'],'PRICE_ONLY')
        self.assertNotEqual(r['votes']['v26_primary'],0)
        s=core.direction_hypotheses(feat(flow=1,bias=.99),'bithumb',True)
        self.assertEqual(s['votes']['verified_taker'],0)
        self.assertEqual(s['evidence_class'],'PRICE_ONLY')
    def test_no_absorption_claim_from_two_book_samples(self):
        r=core.direction_hypotheses(feat(bias=-.4),'bitget',True)
        self.assertIn('not_absorption', 'top5_book_ratio_log_observed_not_absorption')
        self.assertEqual(r['votes']['v26_primary'],0)
    def test_real_bid_ask_future_label_requires_target_clock(self):
        e=event(issued=NOW-6*60_000)
        matured=later(e,5)
        self.assertIsNone(core.label_from_v22(matured,5,e['issued_ms']+5*60_000-5_000))
        result=core.label_from_v22(matured,5,NOW)
        self.assertEqual(result['status'],'ACTUAL_DELAYED_BID_ASK_MEASURED')
        self.assertFalse(result['actual_fill_verified'])
        self.assertGreater(result['long_quote_return_pct'],.5)
        wrong=later(e,5)
        wrong['outcomes']['5']['signed_quote_returns']['1']=99
        self.assertIsNone(core.label_from_v22(wrong,5,NOW))
        late=later(e,5)
        late['outcomes']['5']['exit_quote']['at_ms']+=3*60_000
        self.assertIsNone(core.label_from_v22(late,5,NOW))
    def test_spot_sell_is_never_counted_as_spot_buy(self):
        r={'venue':'bithumb','symbol':'KRW-POP','issued_ms':NOW-6*60_000,
         'votes':{'v26_primary':-1},'labels':{'5':{
           'status':'ACTUAL_DELAYED_BID_ASK_MEASURED',
           'long_quote_return_pct':-.3,'short_quote_return_pct':.3,
           'midprice_direction':-1}}}
        m=core.evaluate_records([r],5,'bithumb','v26_primary')
        self.assertEqual(m['measured'],0)

class DirectionV26Runtime(unittest.TestCase):
    def test_preissue_freeze_and_exact_later_real_quote(self):
        issued=NOW-30_000
        e=event(issued)
        first,state=engine.run(source(NOW),ledger(e),{},NOW)
        self.assertEqual(first['new_predictions'],1)
        self.assertEqual(first['new_future_quote_labels'],0)
        self.assertEqual(first['latest_preissued_hypotheses'][0]['side'],1)
        self.assertFalse(first['production_signal_eligible'])
        self.assertFalse(first['telegram_sent'])
        self.assertFalse(first['orders_sent'])
        older=copy.deepcopy(state['records'][0]['votes'])
        later_time=issued+5*60_000+10_000
        altered=later(e,5)
        altered['features']=feat(p5=-15,bias=-.95)
        altered['real_taker_verified']=False
        second,new=engine.run(source(later_time),ledger(altered),state,later_time)
        self.assertEqual(second['new_predictions'],0)
        self.assertEqual(second['new_future_quote_labels'],1)
        self.assertEqual(new['records'][0]['votes'],older)
        self.assertEqual(second['quote_coverage']['5']['real_quote_measured'],1)
        m=second['forward_quote_results']['5']['bitget']['v26_primary']
        self.assertEqual(m['measured'],1)
        self.assertGreater(m['mean_net_quote_proxy_pct'],0)
    def test_do_not_mint_new_predictions_from_hindsight_only_ledger(self):
        e=event(NOW-6*60_000)
        e=later(e,5)
        report,state=engine.run(source(NOW),ledger(e),{},NOW)
        self.assertEqual(report['new_predictions'],0)
        self.assertEqual(state['records'],[])
    def test_stale_replayed_source_never_rewrites_state_or_registers_new(self):
        e=event()
        r,state=engine.run(source(NOW),ledger(e),{},NOW)
        stale,_=engine.run(source(NOW-35*60_000),ledger(event(NOW+60_000)),state,NOW)
        self.assertEqual(stale['status'],'SOURCE_STALE_NO_NEW_ENROLLMENT')
        self.assertEqual(stale['new_predictions'],0)
    def test_no_partial_side_measured_as_a_win(self):
        e=event()
        result,state=engine.run(source(NOW),ledger(e),{},NOW)
        target=e['issued_ms']+5*60_000+5000
        broken=later(e,5)
        broken['outcomes']['5']={'status':'UNMEASURED_AFTER_TARGET'}
        report,new=engine.run(source(target),ledger(broken),state,target)
        self.assertEqual(report['new_future_quote_labels'],0)
        self.assertEqual(report['quote_coverage']['5']['source_missing_or_expired'],1)
        self.assertEqual(report['forward_quote_results']['5']['bitget']['v26_primary']['measured'],0)
    def test_duplicate_immutable_issue_not_reenrolled(self):
        e=event()
        report,state=engine.run(source(NOW),ledger(e),{},NOW)
        second,again=engine.run(source(NOW),ledger(e),state,NOW)
        self.assertEqual(second['new_predictions'],0)
        self.assertEqual(second['diagnostics']['duplicates'],1)
        self.assertEqual(len(again['records']),1)
    def test_preissued_entry_quote_required_before_enrollment(self):
        e=event();e['entry_quote']['ask']=e['entry_quote']['bid']-.01
        report,_=engine.run(source(NOW),ledger(e),{},NOW)
        self.assertEqual(report['diagnostics']['invalid_entry_quotes'],1)
        self.assertEqual(report['new_predictions'],0)

if __name__=='__main__':
    unittest.main()
