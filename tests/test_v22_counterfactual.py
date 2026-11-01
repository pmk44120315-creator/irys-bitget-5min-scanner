import datetime as dt
import math
import unittest
from unittest.mock import patch

import v22_direction_core as core
import v22_runtime as runtime

BASE=int(dt.datetime(2026,11,1,4,40,tzinfo=dt.timezone.utc).timestamp()*1000)
UTC=dt.timezone.utc
def utc(t):return dt.datetime.fromtimestamp(t/1000,UTC).isoformat()
def quote(time,bid=99,ask=101):
    return {'at_ms':time,'bid':bid,'ask':ask,'source':'OFFICIAL_MOCK'}
def market(now=BASE):
    return {'collector_status':'PASS','finished_utc':utc(now-60_000),
       'verified_crypto_futures_closed_prices':{
          'REVERSALUSDT':{'close_usdt':1.0,'closed_end_ms':now-2*60_000},
          'BTCUSDT':{'close_usdt':80000,'closed_end_ms':now-2*60_000}},
       'early_pool':[
         {'venue':'bitget','asset_identity':'VERIFIED_CRYPTO','symbol':'REVERSALUSDT',
          'windows':{'1m':{'price_change_pct':.4},'5m':{'price_change_pct':1.1,
             'adjacent_ratio':3.4,'close':1.0,'high':1.01,'low':.99},
             '15m':{'price_change_pct':-.5,'adjacent_ratio':1.2}}},
         {'venue':'bitget','asset_identity':'NON_CRYPTO','symbol':'STOCKUSDT',
          'windows':{'5m':{'price_change_pct':12}}},
       ],
       'watchlist':[],
       'spot_flow':{'direction_review_seeds':[
          {'market':'KRW-SAMPLE','price_krw':500,'observed_5m_price_change_pct':1.2,
           'five_minute_equivalent_turnover_krw':34000000,
           'five_minute_prior_ema_krw':11000000,
           'risk_class':'EARLY_MOMENTUM_WATCH'}]}}
def flow(now=BASE):
    return {'status':'PASS','at_utc':utc(now-20_000),
       'source_finished_utc':utc(now-60_000),'observations':[]}

class CounterfactualCore(unittest.TestCase):
    def test_spread_is_cost_even_if_market_does_not_move(self):
        r=core.quote_returns(quote(BASE,99,101),quote(BASE+300000,99,101))
        self.assertLess(r['1'],0)
        self.assertLess(r['-1'],0)
        self.assertNotEqual(r['1'],r['-1'])
    def test_long_and_short_returns_use_real_bid_ask_and_cost(self):
        e=quote(BASE,99,101);f=quote(BASE+300000,105,106)
        r=core.quote_returns(e,f)
        self.assertAlmostEqual(r['1'],100*(105/101-1))
        self.assertAlmostEqual(r['-1'],100*(99-106)/99)
        self.assertLess(r['-1'],0)
    def test_too_early_late_or_stale_futures_cannot_create_label(self):
        e=quote(BASE,99,101)
        self.assertIsNone(core.evaluate_outcome(e,quote(BASE+299999,100,101),BASE,5,BASE+300000))
        self.assertIsNone(core.evaluate_outcome(e,quote(BASE+451000,100,101),BASE,5,BASE+451000))
        self.assertIsNone(core.evaluate_outcome(e,quote(BASE+300000,100,101),BASE,5,BASE+400001))
        self.assertIsNone(core.evaluate_outcome(e,quote(BASE+300000,100,101),BASE,5,BASE+299999))
    def test_missing_flow_is_abstention_not_fabricated_taker(self):
        votes=core.expert_votes({'p5':1,'p15':-1,'p1':.5,'acceleration':2,
            'relative_to_market':1,'flow_verified':0,'recent_flow_missing':1})
        self.assertEqual(votes['taker_bias'],0)
        self.assertEqual(votes['momentum5'],1)
        self.assertEqual(votes['countertrend5'],-1)
        self.assertEqual(votes['first_reversal_else_reversion'],1)
    def test_online_model_does_not_learn_without_future(self):
        f={'p5':1,'p15':1,'acceleration':1,'relative_to_market':1,
           'flow_verified':1,'recent_flow_missing':0,'recent_flow_bias':-.5,
           'price_flow_disagreement':1}
        votes=core.expert_votes(f,{'up':.3,'down':.7})
        self.assertEqual(votes['taker_bias'],-1)
        self.assertEqual(votes['v21_frozen'],-1)
        w=core.prior_weights({})
        direction=core.choose(votes,w)['direction']
        update=core.update_weights(w,votes,core.quote_returns(
           quote(BASE,99,101),quote(BASE+300000,106,107)))
        self.assertNotEqual(w,update)
        self.assertIn(direction,(-1,0,1))
    def test_independent_hour_blocks_not_100_coin_iid(self):
        rows=[]
        for hour in range(2):
            for i in range(10):
                t=BASE+hour*3600000
                rows.append({'venue':'bitget','symbol':'X'+str(i)+'USDT','issued_ms':t,
                    'outcomes':{'5':{'both_sides_measured':True,
                      'signed_quote_returns':{'1':1.,'-1':-.8}}}})
        m=core.metrics(rows,5,'bitget',1)
        self.assertEqual(m['count'],20)
        self.assertEqual(m['hour_blocks'],2)
        self.assertIsNone(m['lower_95_pct'])

class CounterfactualRuntime(unittest.TestCase):
    def test_fast_mover_observed_even_if_taker_collector_outage(self):
        s=market();r,prev,status,eligible=runtime.build_candidates(
             s,{'status':'FAILED'}, {}, {},BASE)
        self.assertEqual(status,'MARKET_PASS_FLOW_INDEPENDENTLY_UNAVAILABLE')
        self.assertIn(('bitget','REVERSALUSDT'),[(x['venue'],x['symbol']) for x in r])
        self.assertIn(('bithumb','KRW-SAMPLE'),[(x['venue'],x['symbol']) for x in r])
        self.assertNotIn('STOCKUSDT',[x['symbol'] for x in r])
        self.assertFalse(next(x for x in r if x['symbol']=='REVERSALUSDT')['real_taker_verified'])
    def test_past_future_comes_after_issue_not_before(self):
        def books(pairs,api,now):
            return {key:quote(now-100,99,101) for key in pairs},[]
        with patch('v22_runtime.fetch_quotes',side_effect=books),patch(
            'v22_runtime.verified_models',return_value=({},{})),patch(
            'v22_runtime.time.time',return_value=BASE/1000):
            report,state=runtime.run(market(),flow(),{}, {}, {},BASE,lambda *_:None)
        self.assertEqual(report['status'],'RESEARCH_ACTIVE')
        self.assertEqual(report['newly_completed_quotes'],0)
        self.assertEqual(report['new_events'],2)
        self.assertTrue(all(x['shadow_only'] for x in state['pending']))
        self.assertFalse(report['telegram_sent'])
        self.assertFalse(report['orders_sent'])
        self.assertEqual(report['eligible_candidates'],2)
        early=dict(state['learning'])
        future_time=BASE+5*60000+1000  # later quote must actually be after target
        with patch('v22_runtime.fetch_quotes',side_effect=books),patch(
            'v22_runtime.verified_models',return_value=({},{})),patch(
            'v22_runtime.time.time',return_value=future_time/1000):
            r2,s2=runtime.run(market(future_time),flow(future_time),
                {},state,{},future_time,lambda *_:None)
        self.assertEqual(r2['newly_completed_quotes'],2)
        self.assertEqual(r2['new_unmeasured_labels'],0)
        self.assertTrue(s2['pending'])
        self.assertNotEqual(s2['learning'],early)
    def test_expired_target_is_declared_missing_not_copied_late_quote(self):
        old={'pending':[{
           'venue':'bitget','symbol':'REVERSALUSDT','issued_ms':BASE,
           'entry_quote':quote(BASE,99,101),
           'votes':{'5':{'momentum5':1},'15':{'momentum5':1}},
           'outcomes':{},'features':{'p5':1}}],
           'learning':{},'previous_prices':{}}
        moment=BASE+9*60_000
        with patch('v22_runtime.fetch_quotes',return_value=(
              {('bitget','REVERSALUSDT'):quote(moment-100,100,101)},[])),patch(
              'v22_runtime.verified_models',return_value=({},{})),patch(
              'v22_runtime.time.time',return_value=moment/1000):
           _,state=runtime.run(market(moment),flow(moment),{},old,{},moment,lambda *_:None)
        first=next(x for x in state['pending'] if x['issued_ms']==BASE)
        self.assertEqual(first['outcomes']['5']['status'],'UNMEASURED_AFTER_TARGET')
        self.assertNotIn('signed_quote_returns',first['outcomes']['5'])
    def test_stale_source_cannot_overwrite_original_state(self):
        original={'completed':[{'symbol':'KEEP'}]}
        report,state=runtime.run({'collector_status':'FAILED'}, {}, {},original,{},BASE,
                                  lambda *_:None)
        self.assertEqual(report['status'],'MARKET_SOURCE_NOT_FRESH')
        self.assertEqual(state,original)

if __name__=='__main__':unittest.main()
