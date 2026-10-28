"""Live smoke WLD sparse candles are no-signal; BTC public schema remains hard checked."""
import datetime as dt
import unittest
from smoke_spot_public_api import wld_readonly_reconciliation

NOW=int(dt.datetime(2026,10,28,8,0,17,tzinfo=dt.timezone.utc).timestamp()*1000)
END=NOW//60000*60000

def bars(missing=()):
    out=[]
    for i in range(15):
        if i in missing:continue
        stamp=END-(i+1)*60000
        out.append({
            "candle_date_time_utc":dt.datetime.fromtimestamp(stamp/1000,dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
            "opening_price":100.0,"trade_price":100.2,"high_price":100.3,
            "low_price":99.9,"candle_acc_trade_price":3000.0})
    return out

class TestWldSparseNoSignal(unittest.TestCase):
    def test_missing_closed_minute_never_imputed_or_reconciled(self):
        def should_not_run(*args):
            raise AssertionError("Do not call CVD with gaps")
        out=wld_readonly_reconciliation(bars(missing=(2,)),NOW,should_not_run)
        self.assertFalse(out["verified"])
        self.assertEqual(out["status"],"NO_SIGNAL_RECENT_15M_CANDLE_GAP")
        self.assertTrue(out["sparse_not_zero_imputed"])

    def test_full_closed_15m_and_paged_reconciled_cvd_pass(self):
        out=wld_readonly_reconciliation(bars(),NOW,lambda turnover:
          {"verified":True,"pages":3,"candle_relative_error":.0002})
        self.assertTrue(out["verified"])
        self.assertEqual(out["status"],"CVD_VERIFIED")

    def test_cvd_incomplete_cannot_become_buy_signal(self):
        out=wld_readonly_reconciliation(bars(),NOW,lambda turnover:
          {"verified":False,"reason":"RECONCILIATION_MISMATCH"})
        self.assertFalse(out["verified"])
        self.assertEqual(out["status"],"NO_SIGNAL_CVD_UNVERIFIED")

    def test_schema_break_remains_hard_error(self):
        with self.assertRaises(RuntimeError):
            wld_readonly_reconciliation({"invalid":"not a list"},NOW,lambda _:None)

    def test_public_cvd_api_error_still_blocks_no_signal(self):
        def fail(_):raise TimeoutError("public API timeout")
        out=wld_readonly_reconciliation(bars(),NOW,fail)
        self.assertFalse(out["verified"])
        self.assertEqual(out["status"],"NO_SIGNAL_CVD_API_OR_PAGING_UNVERIFIED")

if __name__=="__main__":unittest.main()
