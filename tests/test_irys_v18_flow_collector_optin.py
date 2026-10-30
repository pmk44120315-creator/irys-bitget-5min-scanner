import unittest
from bitget_futures_cvd import collect_futures_flow_observations
M=60000
NOW=1793343600000
START=NOW-15*M
def coin(symbol='ALTXUSDT',p5=.25,p15=-.8,q5=4000,q15=8000,identity='VERIFIED_CRYPTO'):
    return {'symbol':symbol,'venue':'bitget','asset_identity':identity,
        'symbolType':'perpetual','contract_status':'normal','isRwa':'NO',
        'oi':{'change_pct_from_previous_run':-.1},'funding_rate':.00001,
        'windows':{'end_utc_ms':NOW-1*M,
            '1m':{'price_change_pct':-.15},
            '5m':{'price_change_pct':p5,'quote_turnover':q5,
                  'close':100,'coverage':1,'adjacent_ratio':1.4},
            '15m':{'price_change_pct':p15,'quote_turnover':q15}}}
def api(venue,path,opts):
    assert venue=='bitget'
    assert opts['symbol']=='ALTXUSDT'
    if path=='/api/v2/mix/market/candles':
        return [[str(START+i*M),'100','100','100','100','240','24000']
                for i in range(15)]
    if path=='/api/v2/mix/market/fills-history':
        events=[]
        for k in range(15):
            for j,(side,qty) in enumerate([('buy',40),('sell',100),('sell',70),('buy',30)]):
                events.append({'tradeId':str(100000+k*10+j),'symbol':'ALTXUSDT',
                'ts':str(START+k*M+1000+j*1000),'side':side,'price':'100','size':str(qty)})
        return sorted(events,key=lambda x:int(x['tradeId']),reverse=True)
    if path=='/api/v2/mix/market/merge-depth':
        raise ConnectionError('OFFLINE_TEST_BOOK_UNAVAILABLE')
    raise AssertionError('unexpected API')
class TestV18Optin(unittest.TestCase):
    def test_old_production_default_still_omits_reversal(self):
        src={'collector_status':'PASS','watchlist':[coin()],'early_pool':[]}
        result=collect_futures_flow_observations(src,NOW,api,state={})
        self.assertEqual(result['observations'],[])
        self.assertEqual(result['markets_evaluated'],0)
        self.assertNotIn('selector_version',result)
    def test_new_evidence_selector_actually_fetches_reversal_taker(self):
        src={'collector_status':'PASS','watchlist':[coin()],'early_pool':[]}
        state={}
        result=collect_futures_flow_observations(src,NOW,api,state=state,v18_select=True)
        self.assertEqual(result['selector_version'],'V18_REVERSAL_AND_EVIDENCE_COVERAGE_RESEARCH')
        self.assertEqual(result['selected_reversal_evidence_targets'],1)
        self.assertEqual(result['markets_evaluated'],1)
        self.assertEqual(result['verified_count'],1,result)
        self.assertEqual(result['observations'][0]['symbol'],'ALTXUSDT')
        self.assertTrue(result['observations'][0]['taker_flow_15m']['verified'])
        self.assertFalse(result['alert_eligible'])
        self.assertFalse(result['observations'][0]['send_allowed'])
        self.assertEqual(state['v18_evidence_last_checked_ms']['ALTXUSDT'],NOW)
    def test_legitimate_crypto_rwa_allowed_but_explicit_noncrypto_denied(self):
        a=coin();a['isRwa']='YES'
        b=coin('STOCKUSDT',identity='NON_CRYPTO')
        result=collect_futures_flow_observations(
          {'collector_status':'PASS','watchlist':[a,b]},NOW,api,state={},v18_select=True)
        self.assertEqual(result['markets_evaluated'],1)
        self.assertEqual(result['verified_count'],1)
    def test_fail_closed_for_partial_collector(self):
        result=collect_futures_flow_observations(
         {'collector_status':'PARTIAL','watchlist':[coin()]},NOW,api,state={},v18_select=True)
        self.assertEqual(result['status'],'SKIPPED_SOURCE_NOT_PASS')
        self.assertEqual(result['observations'],[])
if __name__=='__main__':unittest.main()
