import datetime as dt
import unittest
from copy import deepcopy
from bitget_futures_cvd import verify_taker_flow, classify_flow

NOW=int(dt.datetime(2026,10,28,6,47,21,tzinfo=dt.timezone.utc).timestamp()*1000)
MIN=60_000
END=NOW//MIN*MIN
START=END-15*MIN


def fixture(pressure="buy"):
    trade_rows=[]
    candle_rows=[]
    for m in range(15):
        minute=START+m*MIN
        qtys=(("buy",100),("buy",70),("buy",50),("sell",20)) if pressure=="buy" else (
             ("sell",100),("sell",70),("sell",50),("buy",20))
        for ix,(side,qty) in enumerate(qtys):
            trade_rows.append({"tradeId":str(900_000+m*10+ix),
              "symbol":"BANKUSDT","ts":str(minute+1000+ix*1000),
              "side":side.title(),"price":"100","size":str(qty)})
        candle_rows.append([str(minute),"100","100","100","100","240","24000"])
    trade_rows.sort(key=lambda x:int(x["tradeId"]),reverse=True)
    return trade_rows,candle_rows


def api_for(trades,candles, mutate=None):
    def api(venue,path,opts):
        assert venue=="bitget"
        assert opts["symbol"]=="BANKUSDT"
        if path=="/api/v2/mix/market/candles":return deepcopy(candles)
        if path=="/api/v2/mix/market/fills-history":
            q=[t for t in trades if int(opts["startTime"])<=int(t["ts"])<int(opts["endTime"])]
            cursor=opts.get("idLessThan")
            if cursor is not None:q=[t for t in q if int(t["tradeId"])<int(cursor)]
            return deepcopy(q[:int(opts["limit"])])
        raise AssertionError(path)
    return api


class TestOfficialBitgetCvd(unittest.TestCase):
    def test_buy_pressure_full_15m_with_cursor(self):
        t,c=fixture()
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t,c),page_limit=20,max_pages=5)
        self.assertTrue(out["verified"],out)
        self.assertEqual(out["unique_trades"],60)
        self.assertEqual(out["pages"],3)
        self.assertEqual(out["closed_candles"],15)
        self.assertEqual(out["candle_relative_error"],0)
        self.assertEqual(len(out["blocks"]),3)
        self.assertEqual(classify_flow(out),"SUSTAINED_FUTURES_TAKER_BUY_PRESSURE")
        self.assertFalse(out["position_owner_long_short_verified"])

    def test_sell_pressure_full_15m(self):
        t,c=fixture("sell")
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t,c),page_limit=20,max_pages=5)
        self.assertTrue(out["verified"],out)
        self.assertEqual(classify_flow(out),"SUSTAINED_FUTURES_TAKER_SELL_PRESSURE")

    def test_incomplete_pagination_must_fail(self):
        t,c=fixture()
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t,c),page_limit=20,max_pages=1)
        self.assertFalse(out["verified"])
        self.assertEqual(out["reason"],"HISTORY_PAGINATION_INCOMPLETE")

    def test_missing_candle_does_not_impute_zero(self):
        t,c=fixture()
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t,c[:-1]))
        self.assertFalse(out["verified"])
        self.assertEqual(out["reason"],"CLOSED_15M_CANDLE_GAP")

    def test_missing_trade_creates_reconciliation_mismatch(self):
        t,c=fixture()
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t[:-1],c))
        self.assertFalse(out["verified"])
        self.assertEqual(out["reason"],"TICKS_CANDLE_TURNOVER_MISMATCH")

    def test_conflicting_repeated_execution_id_rejected(self):
        t,c=fixture()
        clone=deepcopy(t[0]);clone["price"]="101"
        t.insert(1,clone)
        out=verify_taker_flow("BANKUSDT",NOW,api_for(t,c))
        self.assertFalse(out["verified"])
        self.assertEqual(out["reason"],"AMBIGUOUS_EXECUTION_ID")

    def test_api_failure_fails_closed(self):
        def broken(*args):raise ConnectionError("offline")
        result=verify_taker_flow("BANKUSDT",NOW,broken)
        self.assertFalse(result["verified"])
        self.assertEqual(result["reason"],"CANDLE_API_FAILED")


if __name__=="__main__":
    unittest.main()
