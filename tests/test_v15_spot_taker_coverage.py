"""V15: real sparse taker data is UNKNOWN, never an invented direction."""
import datetime as dt
import unittest
from unittest.mock import patch

from spot_flow import trade_sample
from spot_direction import collect_spot_directional, evaluate_market, MAX_CHECKED, MAX_TRACKED

NOW = int(dt.datetime(2026,10,29,14,50,tzinfo=dt.timezone.utc).timestamp()*1000)
M=60000

def book(at):
    return {'timestamp_ms':at,'spread_pct':0.15,
            'bid_ask_top5_ratio':1.22,'continuous_absorption_verified':False}

def incomplete():
    return {'coverage':False,'coverage_reasons':['INSUFFICIENT_TRADE_COUNT'],
            'count':3,'early_minute_trade_count':1,
            'recent_minute_trade_count':2,
            'pages_read':1,'buy_share':0.88,
            'net_buy_krw':1800000,'recent_net_buy_krw':200000}

def seed(sym):
    return {'market':sym,'price_krw':100,'source_channel':'RANKED_PRICE_TURNOVER_REVIEW_ONLY',
            'review_priority_score':2,'observation_only':True,'is_buy_signal':False,
            'risk_class':'EARLY_MOMENTUM_WATCH'}

class V15Sparse(unittest.TestCase):
    def test_actual_tick_gaps_are_explicit_not_buy(self):
        def api(venue,path,params):
            self.assertEqual(path,'/v1/trades/ticks')
            return [{'trade_timestamp':NOW-25000,'ask_bid':'BID','trade_price':100,
                     'trade_volume':4,'sequential_id':10}]
        x=trade_sample('KRW-TEST',NOW,api)
        self.assertFalse(x['coverage'])
        self.assertEqual(x['count'],1)
        self.assertIn('INSUFFICIENT_TRADE_COUNT',x['coverage_reasons'])
        self.assertIn('MISSING_ONE_MINUTE_SIDE',x['coverage_reasons'])
        self.assertEqual(x['recent_minute_trade_count'],1)
        self.assertEqual(x['early_minute_trade_count'],0)

    def test_real_book_survives_sparse_taker_but_never_becomes_signal(self):
        with patch('spot_direction.trade_sample',return_value=incomplete()),\
             patch('spot_direction.book_snapshot',return_value=book(NOW)):
            x=evaluate_market(seed('KRW-TEST'),{},NOW,lambda *a:[])
        self.assertEqual(x['status'],'RECENT_TAKER_INCOMPLETE')
        self.assertFalse(x['validated_direction'])
        self.assertIsNone(x['sample'])
        self.assertEqual(x['book_observation']['timestamp_ms'],NOW)
        self.assertEqual(x['taker_diagnostics']['count'],3)

    def test_existing_watch_budget_does_not_starve_20_queued_markets(self):
        self.assertEqual(MAX_CHECKED,MAX_TRACKED)
        picks=[seed('KRW-P%02d'%i) for i in range(18)]
        spot={'status':'PASS','early_watch_observations':[],
              'direction_review_seeds':picks,'rally_watch_only':[]}
        # Only first 8 are nominated by the existing ticker rank feed, not
        # fabricated from unavailable market data.
        with patch('spot_direction.evaluate_market',side_effect=lambda raw,*args,**kwargs:{
            'status':'RECENT_TAKER_INCOMPLETE','market':raw['market'],
            'direction':'WAIT','sample':None,'validated_direction':False,
            'book_observation':book(NOW),'taker_diagnostics':{'count':2,'reasons':[]}}) as check:
            out=collect_spot_directional(spot,{},NOW,lambda *a:None)
        self.assertEqual(out['reviewed'],8)
        self.assertEqual(out['queued_for_next_scan'],0)
        self.assertEqual(check.call_count,8)
        self.assertEqual(out['qualified'],0)

    def test_real_book_memory_survives_two_scans_without_invented_flow(self):
        spot={'status':'PASS','early_watch_observations':[],
              'direction_review_seeds':[seed('KRW-M')],'rally_watch_only':[]}
        state={}
        def read(raw,prev,now,api,permit_cvd=True):
            return {'market':'KRW-M','status':'RECENT_TAKER_INCOMPLETE','direction':'WAIT',
                'sample':None,'validated_direction':False,
                'book_observation':book(now),'taker_diagnostics':{'count':2,
                'reasons':['INSUFFICIENT_TRADE_COUNT']}}
        with patch('spot_direction.evaluate_market',side_effect=read):
            a=collect_spot_directional(spot,state,NOW,lambda *a:None)
            b=collect_spot_directional(spot,state,NOW+5*M,lambda *a:None)
        self.assertEqual(a['signals'],[])
        self.assertEqual(b['signals'],[])
        p=state['spot_direction_tracking_v13']['KRW-M']
        self.assertEqual(len(p['book_history_v15']),2)
        self.assertNotIn('sample',p)
        self.assertEqual(b['diagnostics'][0]['historical_real_book_reads'],2)

if __name__=='__main__':
    unittest.main()
