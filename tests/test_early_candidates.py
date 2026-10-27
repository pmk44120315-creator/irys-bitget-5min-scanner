import unittest
from early_candidates import build_early_pool

def observation(symbol='ABCUSDT',identity='VERIFIED_CRYPTO',q=26000,ratio=4):
    return {'venue':'bitget','symbol':symbol,'asset_identity':identity,'baseCoin':symbol.removesuffix('USDT'),
            'funding_rate':0.0001,'oi':{'status':'OK','change_pct_from_previous_run':0.8,
                                         'elapsed_min_since_previous_snapshot':5},
            'windows':{'1m':{'quote_turnover':1000,'coverage':1},
              '5m':{'quote_turnover':q,'adjacent_ratio':ratio,'coverage':1,'baseline_coverage':1,'price_change_pct':0.9},
              '15m':{'quote_turnover':q*2,'adjacent_ratio':1.1,'coverage':1,'upper_wick_ratio':0.12},
              '60m':{'quote_turnover':q*3,'coverage':1,'price_change_pct':1.2}}}

class TestEarlyPool(unittest.TestCase):
    def test_captures_fast_5min_before_15min(self):
        self.assertEqual(build_early_pool([observation()])[0]['symbol'],'ABCUSDT')
    def test_excludes_stocks_and_unverified(self):
        data=[observation('STOCKUSDT','NON_CRYPTO'),observation('UNKNOWNUSDT','UNVERIFIED'),observation()]
        self.assertEqual([x['symbol'] for x in build_early_pool(data)],['ABCUSDT'])
    def test_late_surge_excluded(self):
        item=observation();item['windows']['60m']['price_change_pct']=12
        self.assertEqual(build_early_pool([item]),[])
    def test_upper_wick_excluded(self):
        item=observation();item['windows']['15m']['upper_wick_ratio']=0.9
        self.assertEqual(build_early_pool([item]),[])
    def test_low_notional_excluded(self):
        self.assertEqual(build_early_pool([observation(q=200,ratio=1000000)]),[])
    def test_incomplete_candles_excluded(self):
        item=observation();item['windows']['5m']['baseline_coverage']=0.6
        self.assertEqual(build_early_pool([item]),[])
    def test_compact_and_not_buy_signal(self):
        x=build_early_pool([observation()])[0]
        self.assertTrue(x['observation_only']);self.assertNotIn('spotCVD',x)
    def test_bounded_and_deterministic(self):
        xs=[observation(f'X{i:03}USDT',ratio=2+i*0.1) for i in range(160)]
        r=build_early_pool(xs)
        self.assertEqual(len(r),80);self.assertEqual(r[0]['symbol'],'X159USDT')
        self.assertEqual(r,build_early_pool(xs))

if __name__=='__main__':unittest.main()
