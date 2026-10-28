"""Replay MPLX's real 17:03->17:08 and 17:08->17:11 ticker changes.
These are historical prices/cumulative turnover, not trade-entry correctness.
"""
import datetime as dt
import unittest
from spot_flow import collect_spot_flow, KST

def case(time_utc,elapsed,previous_price,price,previous_total,current_total,
         previous_ema,previous_count,warning=False,day_move=.04):
    now=dt.datetime.fromisoformat(time_utc.replace("Z","+00:00"))
    now_ms=int(now.timestamp()*1000)
    base=now_ms-int(elapsed*60000)
    markets=[{"market":"KRW-MPLX","market_warning":"CAUTION" if warning else "NONE"}]
    markets.extend({"market":"KRW-T%03d"%i,"market_warning":"NONE"} for i in range(101))
    tickers=[{"market":"KRW-MPLX","trade_price":price,
              "acc_trade_price":current_total,"acc_trade_price_24h":1_500_000_000,
              "signed_change_rate":day_move}]
    tickers.extend({"market":"KRW-T%03d"%i,"trade_price":100,
             "acc_trade_price":1_000_000,"acc_trade_price_24h":10_000_000,
             "signed_change_rate":0} for i in range(101))
    baseline={"KRW-MPLX":[previous_price,previous_total,previous_ema,previous_count]}
    baseline.update({"KRW-T%03d"%i:[100,1_000_000,100_000,9] for i in range(101))
    state={"spot_fast":{"time_ms":base,
             "kst_day":now.astimezone(KST).date().isoformat(),"prices":baseline}}
    def api(venue,path,opts=None):
        assert venue=="bithumb"
        if path=="/v1/market/all":return markets
        if path=="/v1/market/virtual_asset_warning":return []
        if path=="/v1/ticker":
            return [x for x in tickers if x["market"] in opts["markets"].split(",")]
        if path=="/v1/candles/minutes/1":
            return [] # the actual 17:08 'WAIT_RECENT_CANDLE_GAP' is reproduced
        raise AssertionError("Unplanned API "+path)
    return collect_spot_flow(now,state,api),state


class TestMplxEarlyRally(unittest.TestCase):
    def test_1708_real_trigger_is_observed_not_claimed_buy(self):
        x,_=case("2026-10-28T08:08:23.129Z",4.91,65.99,68.01,
            47_967_329.35163915,81_530_031.97864495,56_383.58537,10)
        watch=next(z for z in x["early_watch_observations"] if z["market"]=="KRW-MPLX")
        self.assertAlmostEqual(watch["interval_price_change_pct"],3.061,places=2)
        self.assertEqual(watch["risk_class"],"EARLY_MOMENTUM_WATCH")
        self.assertTrue(watch["notify_observation_eligible"])
        self.assertFalse(watch["is_buy_signal"])
        self.assertEqual(x["signals"],[])
        self.assertEqual(x["detail_diagnostics"][0]["verdict"],"WAIT_RECENT_CANDLE_GAP")
        self.assertEqual(x["status"],"PASS")

    def test_1711_two_point_eight_minute_run_keeps_streak_and_observes_spike(self):
        x,state=case("2026-10-28T08:11:12.580Z",2.824,68.01,74.96,
           81_530_031.97864495,112_997_210.30951229,13_703_182.529,11,
           day_move=.16)
        self.assertEqual(state["spot_fast"]["prices"]["KRW-MPLX"][3],12)
        self.assertEqual(x["early_watch_observations"][0]["risk_class"],"LATE_CHASE_CAUTION")
        self.assertEqual(x["signals"],[])

    def test_very_short_duplicate_preserves_anchor_and_history(self):
        x,state=case("2026-10-28T08:10:00Z",1.1,68.01,74.0,
            81_530_031,96_000_000,13_703_182,11)
        self.assertEqual(state["spot_fast"]["prices"]["KRW-MPLX"],
            [68.01,81_530_031,13_703_182,11])
        self.assertEqual(x["early_watch_observations"],[])

    def test_official_warning_never_allows_notification_or_buy(self):
        x,_=case("2026-10-28T08:08:23.129Z",4.91,65.99,68.01,
            47_967_329,81_530_031,56_383,10,warning=True)
        self.assertEqual(x["early_watch_observations"],[])
        self.assertEqual(x["signals"],[])
        self.assertEqual(x["rally_watch_only"][0]["reason"],"OFFICIAL_WARNING")

    def test_day_gain_limit_only_blocks_buy_not_market_movement_watch(self):
        x,_=case("2026-10-28T08:08:23.129Z",4.91,65.99,68.01,
            47_967_329,81_530_031,56_383,10,day_move=.20)
        self.assertEqual(x["early_watch_observations"][0]["risk_class"],"LATE_CHASE_CAUTION")
        self.assertEqual(x["signals"],[])

if __name__=="__main__":unittest.main()
