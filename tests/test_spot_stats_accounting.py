"""Reconcile independently collected Bithumb KRW market counts without fake candle coverage."""
import unittest
from collector import reconcile_bithumb_spot_stats


class TestSpotStats(unittest.TestCase):
    def test_verified_489_krw_tickers_are_counted_separately_from_futures(self):
        snap={'stats':{'bithumb_listed_krw':0,
                       'bitget_active_usdt_perpetual':866,
                       'candle_symbols_success':866,
                       'oi_symbols_failed':0},
              'spot_flow':{'status':'PASS','markets':489,'tickers':489,'signals':[]}}
        self.assertTrue(reconcile_bithumb_spot_stats(snap))
        st=snap['stats']
        self.assertEqual(st['bithumb_listed_krw'],489)
        self.assertEqual(st['bithumb_ticker_snapshots'],489)
        self.assertEqual(st['candle_symbols_success'],866)
        self.assertEqual(st['bitget_active_usdt_perpetual'],866)
        self.assertEqual(st['bithumb_spot_data_scope'],
                         'ALL_KRW_LISTINGS_TICKERS_DETAILS_CANDIDATES_ONLY')

    def test_failed_spot_does_not_invent_total_market_coverage(self):
        snap={'stats':{'bithumb_listed_krw':489,'candle_symbols_success':866},
              'spot_flow':{'status':'FAILED','markets':489,'tickers':489}}
        self.assertFalse(reconcile_bithumb_spot_stats(snap))
        self.assertEqual(snap['stats']['bithumb_listed_krw'],0)
        self.assertEqual(snap['stats']['bithumb_spot_data_scope'],'SPOT_NOT_VERIFIED')

    def test_partial_ticker_coverage_does_not_pass(self):
        snap={'stats':{},'spot_flow':{'status':'PASS','markets':489,'tickers':220}}
        self.assertFalse(reconcile_bithumb_spot_stats(snap))
        self.assertEqual(snap['stats']['bithumb_ticker_snapshots'],0)

    def test_missing_spot_is_explicitly_unverified(self):
        snap={'stats':{'bitget_active_usdt_perpetual':866}}
        self.assertFalse(reconcile_bithumb_spot_stats(snap))
        self.assertEqual(snap['stats']['bithumb_listed_krw'],0)
        self.assertEqual(snap['stats']['bitget_active_usdt_perpetual'],866)


if __name__=='__main__':
    unittest.main()
