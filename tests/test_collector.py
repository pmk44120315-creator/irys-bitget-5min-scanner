import datetime as dt
import unittest
import collector as c

class ReadOnlyMarketTests(unittest.TestCase):
    def setUp(self):
        self.ms=1740000000000
        self.end=self.ms//60000*60000

    def rows(self,amount=100):
        return [{'ts':self.end-(i+1)*60000,'open':1.,'high':1.05,'low':0.95,
                 'close':1.,'quote':amount} for i in range(180)]

    def test_complete_windows_from_finished_candles(self):
        w=c.closed_windows(self.rows(),self.ms)
        self.assertEqual(w['1m']['quote_turnover'],100)
        self.assertEqual(w['5m']['quote_turnover'],500)
        self.assertEqual(w['15m']['quote_turnover'],1500)
        self.assertEqual(w['60m']['quote_turnover'],6000)
        self.assertEqual(w['60m']['adjacent_ratio'],1.0)

    def test_missing_1m_not_imputed_with_zero(self):
        rows=self.rows()
        rows=[r for r in rows if r['ts']!=self.end-60000]
        w=c.closed_windows(rows,self.ms)
        self.assertIsNone(w['1m']['quote_turnover'])
        self.assertEqual(w['5m']['coverage'],0.8)

    def test_open_candle_not_read(self):
        rows=self.rows()
        rows.append({'ts':self.end,'open':1.,'high':1.,'low':1.,'close':1.,'quote':999999999})
        w=c.closed_windows(rows,self.ms)
        self.assertEqual(w['1m']['quote_turnover'],100)

    def test_oi_is_percentage_of_previous_raw_size(self):
        n=dt.datetime.fromtimestamp(self.end/1000,dt.timezone.utc)
        report,state=c.gather(
            now_utc=n,
            old_state={'oi_previous':{'BTCUSDT':{'size':10,'utc':'2025-02-19T00:00:00+00:00'}}},
            fetch_markets=lambda:([],[{'venue':'bitget','symbol':'BTCUSDT','contract_status':'normal'}]),
            fetch_warnings=lambda:{},
            fetch_funding=lambda:{'BTCUSDT':0.0001},
            fetch_candles=lambda m,ts:c.closed_windows(self.rows(1000),self.ms),
            fetch_oi=lambda symbol:{'size_raw':11,'timestamp_ms':self.ms},
            fetch_trades=lambda m,ts:{'trades_in_last_hour':2,'label':'futures sample'}
        )
        self.assertEqual(report['collector_status'],'PASS')
        self.assertEqual(report['stats']['bithumb_listed_krw'],0)
        self.assertEqual(report['stats']['oi_symbols_success'],1)
        self.assertAlmostEqual(report['watchlist'][0]['oi']['change_pct_from_previous_run'],10,places=3)
        self.assertEqual(state['oi_previous']['BTCUSDT']['size'],11)

    def test_oi_failure_prevents_pass(self):
        n=dt.datetime.fromtimestamp(self.end/1000,dt.timezone.utc)
        def no_oi(symbol):
            raise c.ExchangeAPIError('API HTTP_403')
        report,_=c.gather(
            now_utc=n,
            old_state={},
            fetch_markets=lambda:([],[{'venue':'bitget','symbol':'BTCUSDT'}]),
            fetch_warnings=lambda:{},
            fetch_funding=lambda:{'BTCUSDT':0.0},
            fetch_candles=lambda m,ts:c.closed_windows(self.rows(1000),self.ms),
            fetch_oi=no_oi,
            fetch_trades=lambda m,ts:None
        )
        self.assertEqual(report['collector_status'],'PARTIAL')
        self.assertEqual(report['stats']['oi_symbols_failed'],1)

    def test_contract_identity_filter(self):
        old=c.http_json
        def fake(venue,path,params):
            return [
              {'symbol':'BTCUSDT','symbolStatus':'normal','symbolType':'perpetual','quoteCoin':'USDT'},
              {'symbol':'FAKEUSDT','symbolStatus':'offline','symbolType':'perpetual','quoteCoin':'USDT'},
              {'symbol':'DELIVERYUSDT','symbolStatus':'normal','symbolType':'delivery','quoteCoin':'USDT'}
            ]
        try:
            c.http_json=fake
            spot,futures=c.get_markets()
            self.assertEqual(spot,[])
            self.assertEqual([x['symbol'] for x in futures],['BTCUSDT'])
        finally:
            c.http_json=old

if __name__=='__main__':
    unittest.main()
