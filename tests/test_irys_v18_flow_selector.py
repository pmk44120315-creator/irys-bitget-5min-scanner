import unittest
from research.v18_flow_selector import select_v18_evidence_targets,early_information_score
NOW=1793343600000
def row(symbol='ALTUSDT',p1=.1,p5=.4,p15=.7,q5=2500,q15=3000,**update):
    x={'symbol':symbol,'venue':'bitget','asset_identity':'VERIFIED_CRYPTO',
       'symbolType':'perpetual','contract_status':'normal','isRwa':'NO',
       'oi':{'change_pct_from_previous_run':-.3},
       'windows':{'1m':{'price_change_pct':p1},
         '5m':{'price_change_pct':p5,'quote_turnover':q5,'close':1.2,
               'coverage':1,'adjacent_ratio':2},
         '15m':{'price_change_pct':p15,'quote_turnover':q15}}}
    x.update(update)
    return x
class V18FlowSelector(unittest.TestCase):
    def test_first_real_candle_reversal_not_preblocked(self):
        x=row(p1=-.2,p5=.2,p15=-.6)
        d=select_v18_evidence_targets({'collector_status':'PASS','early_pool':[x]},NOW)
        self.assertEqual(d['status'],'ELIGIBLE')
        self.assertEqual(d['reversal_selected'],1)
        self.assertEqual(d['selected_symbols'],['ALTUSDT'])
    def test_low_turnover_is_data_not_direction_gate(self):
        x=row(p5=.01,p15=-.001,q5=1,q15=1)
        d=select_v18_evidence_targets({'collector_status':'PASS','watchlist':[x]},NOW)
        self.assertEqual(d['eligible'],1)
        self.assertEqual(d['reversal_selected'],1)
        self.assertEqual(d['selected_symbols'],['ALTUSDT'])
    def test_crypto_rwa_not_confused_with_unverified_stock(self):
        valid=row(isRwa='YES',asset_identity='VERIFIED_CRYPTO')
        invalid=row('STOCKUSDT',asset_identity='NON_CRYPTO')
        d=select_v18_evidence_targets({'collector_status':'PASS','watchlist':[valid,invalid]},NOW)
        self.assertEqual(d['selected_symbols'],['ALTUSDT'])
    def test_contract_identity_and_completed_candles_are_still_hard_integrity(self):
        a=row('SUSPENDEDUSDT',contract_status='suspended')
        b=row('NOTFULLUSDT')
        b['windows']['5m']['coverage']=.4
        c=row('EMPTYUSDT')
        c['windows']['5m']['close']=None
        d=select_v18_evidence_targets({'collector_status':'PASS',
            'watchlist':[a,b,c]},NOW)
        self.assertEqual(d['selected'],[])
    def test_priority_for_existing_book_second_snapshot_preserves_evidence(self):
        a=row('PENDINGUSDT',p5=.01,q5=100)
        b=row('NEWUSDT',p5=2,q5=300000)
        memory={'futures_book_snapshots_v13':{'PENDINGUSDT':{'timestamp_ms':NOW-5*60000}}}
        d=select_v18_evidence_targets({'collector_status':'PASS','watchlist':[a,b]},NOW,memory,1)
        self.assertEqual(d['selected_symbols'],['PENDINGUSDT'])
        self.assertEqual(d['pending_book_selected'],1)
    def test_duplicate_market_one_evidence_request(self):
        x=row()
        d=select_v18_evidence_targets({'collector_status':'PASS',
         'watchlist':[x],'early_pool':[x]},NOW,{},6)
        self.assertEqual(d['eligible'],1)
        self.assertEqual(len(d['selected']),1)
    def test_readonly_and_no_fake_verified_data(self):
        state={'futures_book_snapshots_v13':{}}
        a=row();before=str(state)
        d=select_v18_evidence_targets({'collector_status':'PASS','watchlist':[a]},NOW,state)
        self.assertEqual(str(state),before)
        self.assertNotIn('taker_flow_15m',d['selected'][0])
        self.assertGreater(early_information_score(a),0)
    def test_partial_source_gives_no_targets(self):
        d=select_v18_evidence_targets({'collector_status':'PARTIAL','watchlist':[row()]},NOW)
        self.assertEqual(d['status'],'SOURCE_UNVERIFIED')
        self.assertEqual(d['selected'],[])
if __name__=='__main__':unittest.main()
