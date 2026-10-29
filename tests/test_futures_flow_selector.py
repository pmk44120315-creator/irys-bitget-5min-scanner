import datetime as dt
import unittest
from copy import deepcopy
from bitget_futures_cvd import collect_futures_flow_observations

MIN=60000
NOW=int(dt.datetime(2026,10,28,6,47,21,tzinfo=dt.timezone.utc).timestamp()*1000)
END=NOW//MIN*MIN
START=END-15*MIN

def market(symbol="BANKUSDT"):
    return {"symbol":symbol,"quoteCoin":"USDT","venue":"bitget",
            "asset_identity":"VERIFIED_CRYPTO","isRwa":"NO",
            "symbolType":"perpetual","contract_status":"normal",
            "funding_rate":.00005,"oi":{"change_pct_from_previous_run":.1},
            "windows":{"5m":{"price_change_pct":-.6,"quote_turnover":50000},
                       "15m":{"price_change_pct":-1.2,"quote_turnover":150000}}}

def mock_api(venue,path,opts):
    assert venue=="bitget", "only official public Bitget API expected"
    assert opts["symbol"]=="BANKUSDT"
    if path=="/api/v2/mix/market/candles":
        return [[str(START+i*MIN),"100","100","100","100","240","24000"] for i in range(15)]
    if path=="/api/v2/mix/market/fills-history":
        ticks=[]
        for m in range(15):
            for ix,(side,qty) in enumerate((("sell",100),("sell",70),("sell",50),("buy",20))):
                ts=START+m*MIN+1000+ix*1000
                ticks.append({"tradeId":str(100_000+m*10+ix),"symbol":"BANKUSDT",
                              "ts":str(ts),"side":side,"price":"100","size":str(qty)})
        return sorted(ticks,key=lambda x:int(x["tradeId"]),reverse=True)
    raise AssertionError("Unexpected path: "+path)

class FuturesSelector(unittest.TestCase):
    def test_confirmed_taker_sell_flow_remains_read_only_not_short_alert(self):
        latest={"collector_status":"PASS","watchlist":[market()],"early_pool":[]}
        result=collect_futures_flow_observations(latest,NOW,mock_api)
        self.assertEqual(result["status"],"EVALUATED")
        self.assertEqual(result["verified_count"],1)
        self.assertEqual(result["observations"][0]["flow_class"],"SUSTAINED_FUTURES_TAKER_SELL_PRESSURE")
        self.assertFalse(result["observations"][0]["send_allowed"])
        self.assertFalse(result["alert_eligible"])
        self.assertFalse(result["observations"][0]["position_direction_verified"])
        shift=result["observations"][0]["recent5_pressure_shift_research"]
        self.assertEqual(shift["status"],"REAL_15M_RECONCILED_RECENT5_VS_PRIOR10")
        self.assertIs(shift["direction_signal"],False)
        self.assertIs(shift["observation_only"],True)
        self.assertLess(shift["recent_5m_net_taker_usdt"],0)
        self.assertEqual(shift["recent_5m_trades"],20)

    def test_rwa_stocks_and_unverified_market_never_selected(self):
        for change in [
            lambda x: x.update({"isRwa":"YES"}),
            lambda x: x.update({"asset_identity":"NON_CRYPTO"}),
            lambda x: x.update({"contract_status":"suspended"}),
            lambda x: x.update({"venue":"bithumb"}),
        ]:
            x=market();change(x)
            out=collect_futures_flow_observations({"collector_status":"PASS","watchlist":[x]},NOW,
                lambda *a: (_ for _ in ()).throw(AssertionError("should not request")))
            self.assertEqual(out["markets_evaluated"],0)
            self.assertEqual(out["observations"],[])
            self.assertFalse(out["alert_eligible"])

    def test_collector_failure_cannot_be_recategorized_as_verified(self):
        out=collect_futures_flow_observations(
            {"collector_status":"PARTIAL","watchlist":[market()]},NOW,mock_api)
        self.assertEqual(out["status"],"SKIPPED_SOURCE_NOT_PASS")
        self.assertFalse(out["alert_eligible"])


if __name__=="__main__":
    unittest.main()
