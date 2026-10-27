"""V6 sparse historical candle tests. Fake public market payloads; no orders/network."""
import datetime as dt
import unittest
import spot_flow as sf

NOW=dt.datetime(2026,10,27,12,30,30,tzinfo=dt.timezone.utc)
MS=int(NOW.timestamp()*1000)
END=MS//60000*60000

def candle(ago,q=500000,unit=1):
    ts=END-ago*60000
    return {'candle_date_time_utc':dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
            'opening_price':100,'high_price':100.1,'low_price':99.9,
            'trade_price':100,'candle_acc_trade_price':q,'unit':unit}

class TestSparseHistorical(unittest.TestCase):
    def test_prior_hour_gaps_still_have_non_fabricated_observed_price(self):
        rows={END-ago*60000:[100,100.1,99.9,100,100000] for ago in list(range(1,16))+list(range(16,61,4))}
        result=sf.sparse_hour(rows,MS)
        self.assertIsNotNone(result)
        self.assertTrue(result['quote_is_partial_lower_bound'])
        self.assertLess(result['coverage'],1)

    def test_older_native_five_minute_trade_bars_validate_baseline(self):
        rows={END-i*60000:[100,100.1,99.9,100,100000] for i in list(range(1,16))+list(range(16,61,4))}
        native=[candle(i,1000000,5) for i in range(60,10,-5)]
        def api(venue,path,params):
            self.assertEqual(path,'/v1/candles/minutes/5')
            return native
        quiet,baseline,bar_count=sf.native_5m_context('KRW-TEST',MS,api,rows)
        self.assertTrue(quiet['sparse_verified'])
        self.assertGreaterEqual(quiet['span_minutes'],25)
        self.assertLess(quiet['sample_count'],50)
        self.assertEqual(baseline,1000000)
        self.assertEqual(bar_count,len(native))

    def test_missing_native_baseline_is_not_approved(self):
        self.assertIsNone(sf.native_5m_context('KRW-TEST',MS,lambda *args:[],{}))

    def test_recent_missing_minute_still_blocks_buy(self):
        def api(venue,path,params):
            self.assertEqual(path,'/v1/candles/minutes/1')
            return [candle(i,1000000) for i in range(1,61) if i!=2]
        signal,reason=sf.detailed_check('KRW-TEST',{'trade_price':100},MS,api)
        self.assertIsNone(signal)
        self.assertEqual(reason,'WAIT_RECENT_CANDLE_GAP')

if __name__=='__main__':unittest.main()
