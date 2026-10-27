import unittest
from realtime_research.ws_probe import Metrics


class LiveFeedAggregateTests(unittest.TestCase):
    def test_snapshot_not_absorption_proof(self):
        metrics = Metrics("KRW-BTC")
        metrics.add({"type":"trade", "code":"KRW-BTC",
                     "trade_price":100, "trade_volume":30, "ask_bid":"BID"}, 100.)
        metrics.add({"type":"trade", "code":"KRW-BTC",
                     "trade_price":100, "trade_volume":20, "ask_bid":"ASK"}, 100.1)
        for i,t in enumerate((101.,102.)):
            metrics.add({"type":"orderbook", "code":"KRW-BTC", "orderbook_units":[
                {"bid_price":99,"bid_size":10-i,"ask_price":101,"ask_size":20}]},t)
        result = metrics.report()
        self.assertEqual(result["trade_updates"],2)
        self.assertEqual(result["orderbook_updates"],2)
        self.assertEqual(result["taker_net_krw_sample"],1000)
        self.assertFalse(result["orderbook_absorption_verified"])
        self.assertFalse(result["complete_continuous_cvd_verified"])

    def test_gap_disclosed_not_hidden(self):
        m=Metrics("KRW-BTC")
        for t in (100.,101.,105.):
            m.add({"type":"orderbook","code":"KRW-BTC","orderbook_units":[
                {"bid_size":1,"ask_size":1}]},t)
        self.assertEqual(m.report()["book_intervals_over_two_s"],1)
        self.assertEqual(m.report()["max_book_gap_seconds"],4.)

    def test_invalid_trade_not_included(self):
        m=Metrics("KRW-BTC")
        m.add({"type":"trade","code":"KRW-BTC","trade_price":5,
               "trade_volume":0,"ask_bid":"BID"},100.)
        self.assertEqual(m.report()["trade_updates"],0)

if __name__=="__main__":unittest.main()
