import importlib
import unittest

class V21Contracts(unittest.TestCase):
    def core(self):
        try:
            m = importlib.import_module('v21_forecast_core')
        except ModuleNotFoundError:
            m = None
        self.assertIsNotNone(m, 'V21 forecast core has not been implemented yet')
        return m

    def observation(self, net=-100, p=.4):
        return {'symbol':'ALTUSDT','window_5m_price_pct':p,'window_15m_price_pct':-.8,
            'price_context_status':'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
            'price_context_end_ms':600000,
            'taker_flow_15m':{'verified':True,'end_ms':600000,
                'full_exchange_local_public_taker_flow_verified':True,
                'completeness':'COMPLETE_PAGINATION_15_CLOSED_CANDLES_RECONCILED',
                'taker_turnover_usdt':1000,'buy_share':.6},
            'recent5_pressure_shift_research':{
                'status':'REAL_15M_RECONCILED_RECENT5_VS_PRIOR10',
                'price_time_alignment_verified':True,
                'recent_5m_net_taker_usdt':net,'recent_5m_buy_share':.3,
                'recent_5m_price_change_pct':p,'prior_10m_net_taker_usdt':300,
                'buy_share_delta':-.3,'actual_5m_close_location_in_range':.9,
                'recent_5m_trades':20}}

    def test_contrary_taker_is_feature_not_exclusion(self):
        m=self.core()
        x=m.futures_features(self.observation(), {}, 620000)
        self.assertEqual(x['flow_verified'],1)
        self.assertEqual(x['price_flow_disagreement'],1)
        self.assertLess(x['recent_flow_bias'],0)
        self.assertEqual(x['p5'],.4)

    def test_missing_flow_is_not_fabricated_zero_observation(self):
        m=self.core();o=self.observation();o['taker_flow_15m']['verified']=False
        x=m.futures_features(o,{},620000)
        self.assertEqual(x['flow_verified'],0)
        self.assertEqual(x['recent_flow_bias'],0)
        self.assertEqual(x['price_flow_disagreement'],0)
        self.assertEqual(x['recent_flow_missing'],1)

    def test_future_outcome_fields_never_change_features(self):
        m=self.core();o=self.observation();a=m.futures_features(o,{},620000)
        o['future_return_pct']=999;o['results']={'win':True};o['future_price']=2
        self.assertEqual(a,m.futures_features(o,{},620000))

    def test_mismatched_five_minute_flow_price_is_missing(self):
        m=self.core();o=self.observation();o['recent5_pressure_shift_research']['recent_5m_price_change_pct']=2
        self.assertEqual(m.futures_features(o,{},620000)['flow_verified'],0)

    def test_future_label_uses_first_price_after_publication_and_known_time(self):
        m=self.core();M=60000
        tape=[(9*M,1,10*M),(12*M,2,13*M),(17*M,2.2,18*M)]
        r=m.forward_label(tape,10*M,5)
        self.assertEqual(r['entry_ms'],12*M)
        self.assertEqual(r['available_ms'],18*M)
        self.assertAlmostEqual(r['return_pct'],10)
        self.assertEqual(r['entry_delay_ms'],2*M)
        self.assertIsNone(m.forward_label(tape,17*M,5))

    def test_missing_exact_future_timestamp_is_not_interpolated(self):
        m=self.core();M=60000
        self.assertIsNone(m.forward_label([(12*M,1,13*M),(18*M,1.5,19*M)],10*M,5))

    def test_chronological_training_never_sees_not_yet_available_labels(self):
        m=self.core()
        rows=[{'issued_ms':1,'label_known_ms':20},
              {'issued_ms':2,'label_known_ms':60},
              {'issued_ms':65,'label_known_ms':80},
              {'issued_ms':120,'label_known_ms':130}]
        train,valid,test=m.temporal_partition(rows,50,100,5)
        self.assertEqual(train,[rows[0]])
        self.assertEqual(valid,[rows[2]])
        self.assertEqual(test,[rows[3]])
        self.assertEqual(rows[1]['label_known_ms'],60)

    def test_nonoverlap_is_horizon_specific_and_symbol_specific(self):
        m=self.core();M=60000
        rows=[{'symbol':'A','issued_ms':0},{'symbol':'A','issued_ms':M},
              {'symbol':'B','issued_ms':M},{'symbol':'A','issued_ms':5*M}]
        self.assertEqual(len(m.nonoverlap(rows,5)),3)
        self.assertEqual(len(m.nonoverlap(rows,15)),2)

    def test_spot_evaluation_does_not_count_down_as_buy_success(self):
        m=self.core()
        result=m.evaluate_predictions([
            {'symbol':'A','issued_ms':0,'ret':-3,'side':-1},
            {'symbol':'B','issued_ms':60000,'ret':.1,'side':1}],.2,'bithumb',5)
        self.assertEqual(result['signals'],1)
        self.assertEqual(result['buy_count'],1)
        self.assertEqual(result['short_count'],0)
        self.assertAlmostEqual(result['mean_net_pct'],-.1)

    def test_costs_and_flat_rows_stay_in_economic_metrics(self):
        m=self.core()
        r=m.evaluate_predictions([{'symbol':'A','issued_ms':0,'ret':.05,'side':1},
            {'symbol':'B','issued_ms':3600000,'ret':.5,'side':1}],.2,'bitget',5)
        self.assertEqual(r['signals'],2)
        self.assertEqual(r['net_wins'],1)
        self.assertEqual(r['net_losses'],1)
        self.assertAlmostEqual(r['mean_net_pct'],.075)
        self.assertFalse(r['actual_execution_verified'])

if __name__=='__main__':unittest.main()
