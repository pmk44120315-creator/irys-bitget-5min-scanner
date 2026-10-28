"""Directional evidence must be causal and fail closed on absent/contradictory flow."""
import datetime as dt
import unittest
from unittest.mock import patch

from spot_direction import (
    collect_spot_directional, evaluate_market, market_structure,
    verified_local_cvd
)
from spot_flow import candles

NOW=int(dt.datetime(2026,10,29,0,0,tzinfo=dt.timezone.utc).timestamp()*1000)
M=60_000


def early(**kwargs):
    out={'market':'KRW-AAA','price_krw':105.95,
         'five_minute_equivalent_turnover_krw':90_000_000,
         'five_minute_prior_ema_krw':150_000,
         'risk_class':'EARLY_MOMENTUM_WATCH',
         'observation_only':True,'is_buy_signal':False}
    out.update(kwargs)
    return out


def feed(positive=True, gap=None):
    def api(venue,path,opts=None):
        assert venue=='bithumb'
        if path!='/v1/candles/minutes/1':
            raise AssertionError('Unexpected API '+path)
        end=NOW+5*M
        if opts.get('count')!=80:
            raise AssertionError('Not using bounded 80 closed 1m bars')
        bars=[]
        for i in range(75,0,-1):
            if gap==i:
                continue
            ts=end-i*M
            level=(100+(75-i)*.08) if positive else (110-(75-i)*.08)
            bars.append({
                'candle_date_time_utc':dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
                'opening_price':level,
                'high_price':level+.05,
                'low_price':level-.05,
                'trade_price':level+.035 if positive else level-.035,
                'candle_acc_trade_price':7_000_000})
        return bars
    return api


def flow(positive=True):
    return {'coverage':True,'count':80,
            'buy_share':.72 if positive else .28,
            'net_buy_krw':8_000_000 if positive else -8_000_000,
            'recent_net_buy_krw':3_000_000 if positive else -3_000_000}


def book(now,positive=True):
    return {'timestamp_ms':now,'spread_pct':.12,'bid_ask_top5_ratio':1.4 if positive else .72}


def cvd(positive=True,verified=True):
    net=15_000_000 if positive else -15_000_000
    share=.7 if positive else .3
    return {'verified':verified,'marketwide_cvd_verified':False,
            'candle_relative_error':.001,'net_buy_krw':net,'buy_share':share,
            'blocks':[{'trades':140,'buy_share':share,'net_buy_krw':net/3} for _ in range(3)]}


class TestDirectionalV13(unittest.TestCase):
    def test_up_proof_after_two_distinct_books_takers_and_real_15m_cvd(self):
        sample_time=NOW+5*M
        api=feed()
        state={}
        spot={'status':'PASS','early_watch_observations':[early()],'rally_watch_only':[]}
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',side_effect=lambda *_:book(sample_time-5*M)), \
             patch('spot_direction.cvd_15m',return_value=cvd()) as verify:
            first=collect_spot_directional(spot,state,sample_time-5*M,api)
            self.assertEqual(first['qualified'],0)
            self.assertEqual(first['diagnostics'][0]['status'],'WAIT_SECOND_DISTINCT_FLOW_AND_BOOK')
            self.assertEqual(verify.call_count,0)
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',side_effect=lambda *_:book(sample_time)), \
             patch('spot_direction.cvd_15m',return_value=cvd()) as verify:
            # Momentum has cooled: continue the prior observed candidate.
            second=collect_spot_directional(
                {'status':'PASS','early_watch_observations':[],'rally_watch_only':[]},
                state,sample_time,api)
            self.assertEqual(second['qualified'],1,second['diagnostics'])
            self.assertEqual(second['signals'][0]['direction'],'UP')
            self.assertFalse(second['signals'][0]['future_direction_accuracy_verified'])
            self.assertFalse(second['signals'][0]['orderbook_absorption_verified'])
            self.assertEqual(len(second['signals'][0]['flow_snapshots']),2)
            self.assertEqual(verify.call_count,1)

    def test_real_sell_flow_after_up_momentum_is_down_warning_not_short_position(self):
        t=NOW+5*M
        api=feed(positive=False)
        seed=early(price_krw=104.04)
        prev={'sample':{'time_ms':t-5*M,'book':book(t-5*M,False),
                        'buy_share':.28,'net_buy_krw':-5_000_000}}
        with patch('spot_direction.trade_sample',return_value=flow(False)), \
             patch('spot_direction.book_snapshot',return_value=book(t,False)), \
             patch('spot_direction.cvd_15m',return_value=cvd(False)):
            r=evaluate_market(seed,prev,t,api)
            self.assertEqual(r['status'],'QUALIFIED_VENUE_LOCAL_MULTI_EVIDENCE',r)
            self.assertEqual(r['direction'],'DOWN')
            self.assertFalse(r['is_buy_signal'])
            self.assertFalse(r['order_allowed'])

    def test_one_taker_burst_never_sends(self):
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',return_value=book(NOW+5*M)), \
             patch('spot_direction.cvd_15m') as expensive:
            r=evaluate_market(early(),{},NOW+5*M,feed())
            self.assertFalse(r['validated_direction'])
            self.assertEqual(r['status'],'WAIT_SECOND_DISTINCT_FLOW_AND_BOOK')
            expensive.assert_not_called()

    def test_contradicting_real_cvd_blocks_directional_signal(self):
        t=NOW+5*M
        prev={'sample':{'time_ms':t-5*M,'book':book(t-5*M),
                        'buy_share':.72,'net_buy_krw':8_000_000}}
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',return_value=book(t)), \
             patch('spot_direction.cvd_15m',return_value=cvd(False)):
            r=evaluate_market(early(),prev,t,feed())
            self.assertEqual(r['status'],'CVD_15M_NOT_VERIFIED_OR_CONTRADICTS_DIRECTION')
            self.assertFalse(r['validated_direction'])

    def test_incomplete_closed_candles_cannot_be_direction(self):
        with patch('spot_direction.trade_sample') as trades:
            r=evaluate_market(early(),{},NOW+5*M,feed(gap=2))
            self.assertEqual(r['status'],'CLOSED_20M_CANDLE_GAP')
            trades.assert_not_called()

    def test_official_warning_never_continues_tracked_candidate(self):
        state={}
        spot={'status':'PASS','early_watch_observations':[early()],
              'rally_watch_only':[{'market':'KRW-AAA','reason':'OFFICIAL_WARNING'}]}
        result=collect_spot_directional(spot,state,NOW,lambda *a:None)
        self.assertEqual(result['qualified'],0)
        self.assertEqual(result['diagnostics'][0]['status'],'OFFICIAL_WARNING_BLOCKED')

    def test_tiny_ema_is_not_advertised_as_a_75000x_market_flow(self):
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',return_value=book(NOW+5*M)):
            r=evaluate_market(early(five_minute_prior_ema_krw=445),{},NOW+5*M,feed())
            self.assertLess(r['normalized_early_turnover_ratio_floor5m'],20)

    def test_stale_prior_sample_is_not_independent(self):
        t=NOW+5*M
        prev={'sample':{'time_ms':t-12*M,'book':book(t-12*M),
                        'buy_share':.72,'net_buy_krw':8_000_000}}
        with patch('spot_direction.trade_sample',return_value=flow()), \
             patch('spot_direction.book_snapshot',return_value=book(t)):
            r=evaluate_market(early(),prev,t,feed())
            self.assertEqual(r['status'],'NONINDEPENDENT_OR_STALE_SAMPLE')

    def test_buy_side_only_is_not_direction_without_three_cvd_blocks(self):
        bad=cvd()
        bad['blocks'][1]['net_buy_krw']=-1
        self.assertFalse(verified_local_cvd(bad,'UP'))
        self.assertFalse(verified_local_cvd(cvd(verified=False),'UP'))


if __name__=='__main__':
    unittest.main()
