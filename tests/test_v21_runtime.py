import importlib
import unittest

class V21RuntimeTests(unittest.TestCase):
    def mod(self):
        try:m=importlib.import_module('v21_runtime')
        except ModuleNotFoundError:m=None
        self.assertIsNotNone(m,'V21 runtime not implemented')
        return m

    def test_forest_pure_inference_matches_leaf_probabilities(self):
        m=self.mod()
        model={'kind':'forest','features':['x'],'classes':[-1,0,1],
          'trees':[{'left':[1,-1,-1],'right':[2,-1,-1],'feature':[0,-2,-2],
             'threshold':[0,-2,-2],'value':[[1,1,1],[8,1,1],[1,1,8]]}]}
        self.assertAlmostEqual(m.probabilities(model,{'x':1})[1],.8)
        self.assertAlmostEqual(m.probabilities(model,{'x':-1})[-1],.8)

    def test_logistic_zero_coefficients_are_not_high_confidence(self):
        m=self.mod();x={'kind':'logistic','features':['x'],'classes':[-1,0,1],
          'mean':[0],'scale':[1],'coef':[[0],[0],[0]],'intercept':[0,0,0]}
        for p in m.probabilities(x,{'x':4}).values():self.assertAlmostEqual(p,1/3)

    def test_one_lucky_validation_win_cannot_be_admitted(self):
        m=self.mod()
        payload={'research_metrics':{'validation':{'signals':1,'hour_blocks':1,'mean_net_pct':10},
            'test_cost_scenarios':{'0.2':{'signals':1,'mean_net_pct':10}}}}
        self.assertEqual(m.research_reason(payload),'VALIDATION_UNCERTAINTY_UNESTIMABLE')

    def test_losing_validation_cannot_be_hidden_by_positive_holdout(self):
        m=self.mod()
        p={'research_metrics':{'validation':{'signals':50,'hour_blocks':10,'mean_net_pct':-.2},
            'test_cost_scenarios':{'0.2':{'signals':50,'mean_net_pct':1}}}}
        self.assertEqual(m.research_reason(p),'VALIDATION_NET_LOSS')

    def test_quote_return_includes_bid_ask_crossing_not_last_price(self):
        m=self.mod()
        e={'bid':99,'ask':101,'at_ms':1000};x={'bid':104,'ask':106,'at_ms':301000}
        self.assertAlmostEqual(m.quote_return(e,x,1),100*(104/101-1))
        self.assertAlmostEqual(m.quote_return(e,x,-1),100*(99-106)/99)

    def test_fresh_quote_and_real_horizon_required(self):
        m=self.mod();e={'bid':99,'ask':101,'at_ms':600000}
        record={'model_key':'bitget_5','symbol':'ALTUSDT','side':1,'issued_ms':600000,
                'horizon_min':5,'entry_quote':e}
        self.assertIsNone(m.finish_record(record,{'bid':104,'ask':106,'at_ms':899000},900000))
        self.assertIsNone(m.finish_record(record,{'bid':104,'ask':106,'at_ms':900000},1000000))
        outcome=m.finish_record(record,{'bid':104,'ask':106,'at_ms':901000},905000)
        self.assertTrue(outcome['quote_based_not_execution'])
        self.assertEqual(outcome['issued_ms'],600000)

    def test_certificate_never_approves_empty_or_losing_live_data(self):
        m=self.mod()
        self.assertFalse(m.certificate([], 'bitget', 5,1)['ready'])
        r=[{'symbol':str(i),'issued_ms':i*3600000,'side':1,'ret':-.4} for i in range(60)]
        self.assertFalse(m.certificate(r,'bitget',5,1)['ready'])

    def test_positive_future_data_can_qualify_without_manual_false_switch(self):
        m=self.mod()
        r=[{'symbol':str(i),'issued_ms':i*3600000,'side':1,'ret':.7 if i%4 else -.1} for i in range(60)]
        c=m.certificate(r,'bitget',5,1)
        self.assertTrue(c['ready'])
        self.assertGreater(c['lower_net_pct'],0)
        self.assertEqual(c['evidence_type'],'FROZEN_MODEL_PROSPECTIVE_QUOTE_RETURNS')

    def test_spot_short_results_do_not_unlock_spot_buy(self):
        m=self.mod();r=[{'symbol':str(i),'issued_ms':i*3600000,'side':-1,'ret':1} for i in range(60)]
        self.assertFalse(m.certificate(r,'bithumb',5,1)['ready'])

if __name__=='__main__':unittest.main()
