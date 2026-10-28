"""Test Bithumb prescreen observability without widening any BUY alert contract."""
import datetime as dt
import unittest
from spot_flow import collect_spot_flow, KST


NOW = dt.datetime(2026, 10, 28, 6, 50, tzinfo=dt.timezone.utc)
NOW_MS = int(NOW.timestamp()*1000)


def scenario(markets):
    listed = []
    prices = []
    state = {"spot_fast": {
        "time_ms": NOW_MS-300000, "kst_day": NOW.astimezone(KST).date().isoformat(), "prices": {}}}
    for i in range(101):
        symbol = list(markets)[i] if i < len(markets) else "KRW-T%03d" % i
        entry=markets.get(symbol, {})
        listed.append({"market":symbol,"market_warning":entry.get("warning", "NONE")})
        previous=100
        price=entry.get("price", 100)
        five=entry.get("five", 0)
        past_ema=entry.get("past_ema", 12_000_000)
        state["spot_fast"]["prices"][symbol]=[previous,10_000_000,past_ema,5]
        prices.append({"market":symbol,"trade_price":price,
            "acc_trade_price":10_000_000+five,
            "acc_trade_price_24h":entry.get("daily24", 500_000_000),
            "signed_change_rate":entry.get("daily_rate", 0.0)})
    def fake_api(venue,path,opts=None):
        assert venue == "bithumb"
        if path=="/v1/market/all":return listed
        if path=="/v1/market/virtual_asset_warning":return []
        if path=="/v1/ticker":
            return [x for x in prices if x["market"] in opts["markets"].split(",")]
        raise AssertionError("Unexpected detail API: "+path)
    return collect_spot_flow(NOW,state,fake_api),state


class TestPrescreenAudit(unittest.TestCase):
    def test_fast_pump_is_seen_but_cannot_be_a_buy_alert(self):
        output,state=scenario({"KRW-XAN":{"price":120,"five":90_000_000,"past_ema":10_000_000}})
        w=output["rally_watch_only"][0]
        self.assertEqual(w["market"],"KRW-XAN")
        self.assertEqual(w["reason"],"PRICE_ABOVE_EARLY_ENTRY_LIMIT")
        self.assertAlmostEqual(w["observed_5m_price_change_pct"],20)
        self.assertEqual(w["send_allowed"],False)
        self.assertEqual(output["signals"],[])
        self.assertEqual(output["shortlisted"],0)
        self.assertEqual(output["details_checked"],0)
        self.assertEqual(len(state["spot_fast"]["prices"]),101)

    def test_early_mover_is_logged_even_below_ratio_three(self):
        output,_=scenario({"KRW-BFC":{"price":102.8,"five":30_000_000,"past_ema":12_000_000}})
        self.assertEqual(output["rally_watch_only"][0]["reason"],"VOLUME_RATIO_BELOW_EARLY_ENTRY")
        self.assertEqual(output["signals"],[])

    def test_official_warning_stays_excluded_from_alerts(self):
        output,_=scenario({"KRW-D":{"price":103,"five":90_000_000,"warning":"CAUTION"}})
        self.assertEqual(output["rally_watch_only"][0]["reason"],"OFFICIAL_WARNING")
        self.assertEqual(output["rally_watch_only"][0]["send_allowed"],False)
        self.assertEqual(output["signals"],[])

    def test_watchlist_is_bounded_and_explicitly_non_alerting(self):
        markets={("KRW-X%02d"%i):{"price":105+i/100,"five":90_000_000}
                for i in range(35)}
        out,_=scenario(markets)
        self.assertEqual(out["rally_watch_total"],35)
        self.assertEqual(len(out["rally_watch_only"]),20)
        self.assertTrue(all(r["send_allowed"] is False for r in out["rally_watch_only"]))
        self.assertEqual(out["signals"],[])


if __name__ == "__main__":
    unittest.main()
