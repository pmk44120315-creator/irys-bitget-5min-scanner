"""No invented minute candles, native 5m source and causal as-of boundary."""
import datetime as dt
import unittest

from spot_native_structure import parse_native_five, native_market_structure

M=60000
F=5*M
NOW=int(dt.datetime(2026,10,29,0,7,tzinfo=dt.timezone.utc).timestamp()*1000)
ANCHOR=NOW//F*F


def raw_bar(ts,op,close,quote=1_000_000):
    return {
        'candle_date_time_utc':dt.datetime.fromtimestamp(
             ts/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
        'opening_price':op,'high_price':max(op,close)+.1,
        'low_price':min(op,close)-.1,'trade_price':close,
        'candle_acc_trade_price':quote}


def native_rows():
    return [
        raw_bar(ANCHOR-4*F,100,101),
        raw_bar(ANCHOR-3*F,101,102),
        raw_bar(ANCHOR-2*F,102,103),
        raw_bar(ANCHOR-F,103,104),
        raw_bar(ANCHOR,104,105),  # future-INCOMPLETE 5m bar -> reject.
    ]


class TestNativeStructure(unittest.TestCase):
    def test_sparse_one_minute_keeps_real_price_and_3_native_five_minute_bars(self):
        native=parse_native_five(native_rows(),NOW)
        self.assertNotIn(ANCHOR,native)
        sparse_1m={NOW-1*M:[104,104.2,104.0,104.1,8_000_000]}
        structure=native_market_structure(sparse_1m,native,NOW)
        self.assertEqual(structure['status'],'PASS')
        self.assertTrue(structure['up_structure'])
        self.assertEqual(structure['native_15m_buckets_observed'],3)
        self.assertEqual(structure['closed_15m_turnover_krw'],3_000_000)
        self.assertFalse(structure['closed_20m_candles'])
        self.assertEqual(structure['observed_1m_bars_of_last20'],1)
        self.assertTrue(structure['missing_1m_not_zero_filled'])
        self.assertTrue(structure['native_missing_5m_not_zero_filled'])
        self.assertFalse(structure['closed_15m_turnover_verified_by_taker'])
        self.assertEqual(structure['anchor_end_ms'],ANCHOR)
        self.assertAlmostEqual(structure['close'],104.1)
        self.assertGreater(structure['previous_15m_high'],0)

    def test_missing_one_completed_native_five_minute_bucket_is_not_fabricated(self):
        bars=[b for b in native_rows()
              if b['candle_date_time_utc'] !=
              dt.datetime.fromtimestamp((ANCHOR-2*F)/1000,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')]
        native=parse_native_five(bars,NOW)
        observed=native_market_structure(
            {NOW-M:[104,104.1,103.9,104.05,900000]},native,NOW)
        self.assertEqual(observed['status'],'PASS')
        self.assertEqual(observed['native_15m_buckets_observed'],2)
        self.assertEqual(len(observed['native_15m_missing_buckets']),1)
        self.assertEqual(observed['closed_15m_turnover_krw'],2_000_000)
        self.assertFalse(observed['closed_15m_turnover_verified_by_taker'])

    def test_future_incomplete_5m_not_accepted_and_no_past_price_faked(self):
        raw=[raw_bar(ANCHOR,100,190)]
        parsed=parse_native_five(raw,NOW)
        self.assertFalse(parsed)
        r=native_market_structure({NOW-M:[100,110,100,105,100]},parsed,NOW)
        self.assertEqual(r['status'],'WAIT_NATIVE_5M_CONTEXT')
        self.assertFalse(r['closed_20m_candles'])

    def test_stale_one_minute_returns_wait_not_fake_price(self):
        native=parse_native_five(native_rows(),NOW)
        r=native_market_structure(
            {NOW-18*M:[104,104.2,103.9,104.1,1000]},native,NOW)
        self.assertEqual(r['status'],'WAIT_RECENT_CLOSED_1M_PRICE')
        self.assertIsNone(r['latest_closed_1m_ms'])

    def test_corrupted_native_5m_candles_rejected(self):
        broken=raw_bar(ANCHOR-F,100,101)
        broken['high_price']=99
        out=parse_native_five([broken],NOW)
        self.assertFalse(out)

    def test_decline_structure_from_actual_native_bars_without_arbitrary_price_minima(self):
        native=parse_native_five([
            raw_bar(ANCHOR-4*F,105,104),
            raw_bar(ANCHOR-3*F,104,103),
            raw_bar(ANCHOR-2*F,103,102),
            raw_bar(ANCHOR-F,102,101)],NOW)
        r=native_market_structure({NOW-M:[101,101.1,100.8,100.9,900000]},native,NOW)
        self.assertEqual(r['status'],'PASS')
        self.assertTrue(r['down_structure'])
        self.assertFalse(r['up_structure'])


if __name__=='__main__':
    unittest.main()
