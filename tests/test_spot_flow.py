import datetime as dt
import unittest
import spot_flow as s

NOW=dt.datetime(2026,10,27,8,30,30,tzinfo=dt.timezone.utc)
MS=int(NOW.timestamp()*1000)
BASE=MS//60000*60000

class TestSpotBasics(unittest.TestCase):
    def test_trade_flow_recent_persistent(self):
        events=[]
        for i in range(44):
            t=MS-(110000-i*1000 if i<22 else 56000-(i-22)*1500)
            events.append({'ask_bid':'ASK' if i%4==0 else 'BID',
                           'timestamp':t,'trade_price':100,'trade_volume':3000,
                           'sequential_id':18000000001230000+i})
        def fake(_venue,_path,_opts):return events
        x=s.trade_sample('KRW-AAA',MS,fake)
        self.assertTrue(x['coverage'])
        self.assertGreater(x['buy_share'],.6)
        self.assertFalse(x['full_cvd_verified'])

    def test_candle_spike_and_previous_55min(self):
        raw=[]
        for i in range(1,126):
            t=BASE-i*60000
            v=100.8 if i==1 else 100.05
            raw.append({'candle_date_time_utc':dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
                        'opening_price':100.05,'high_price':max(v,100.05),'low_price':100.05,
                        'trade_price':v,'candle_acc_trade_price':6000000 if i<=5 else 200000})
        parsed=s.candles(raw,MS)
        self.assertEqual(len(parsed),125)
        w=s.window(parsed,MS,5)
        self.assertEqual(w['quote_krw'],30000000)
        calm,base,count=s.past_context(parsed,MS)
        self.assertEqual(count,11)
        self.assertEqual(base,1000000)
        self.assertAlmostEqual(calm['drift_pct'],0)

    def test_missing_candles_never_zero_filled(self):
        self.assertIsNone(s.window({},MS,5))
        self.assertIsNone(s.past_context({},MS))

if __name__=='__main__':unittest.main()
