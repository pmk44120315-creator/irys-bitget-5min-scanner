"""Offline, deterministic, read-only verification of sustained spot gate."""
import datetime as dt
import unittest

import spot_continuity as s

BASE = int(dt.datetime(2026, 10, 28, 1, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)


def tick(i, side='BID'):
    return {'sequential_id': str(10_000 + i),
            'timestamp': BASE - 15 * 60_000 + int((i + .5) * 10_000),
            'ask_bid': side, 'trade_price': 1000, 'trade_volume': 1000}


def events():
    return [tick(i, 'ASK' if i % 5 == 0 else 'BID') for i in range(90)] + [
        {'sequential_id': '999', 'timestamp': BASE - 15 * 60_000 - 1,
         'ask_bid': 'BID', 'trade_price': 1000, 'trade_volume': 1000}]


class TestTradeContinuity(unittest.TestCase):
    def api_ticks(self, venue, path, opts):
        self.assertEqual(venue, 'bithumb')
        self.assertEqual(path, '/v1/trades/ticks')
        self.assertEqual(opts['market'], 'KRW-TEST')
        return events()

    def test_full_window_reconciles_three_independent_blocks(self):
        x = s.cvd_15m('KRW-TEST', BASE + 10_000, 90_000_000, self.api_ticks)
        self.assertTrue(x['verified'], x)
        self.assertFalse(x['marketwide_cvd_verified'])
        self.assertEqual(len(x['blocks']), 3)
        self.assertTrue(all(b['net_buy_krw'] > 0 and b['buy_share'] > .55
                            for b in x['blocks']))

    def test_fail_closed_if_candle_turnover_mismatch(self):
        x = s.cvd_15m('KRW-TEST', BASE + 10_000, 120_000_000, self.api_ticks)
        self.assertFalse(x['verified'])
        self.assertEqual(x['reason'], 'TICKS_CANDLE_MISMATCH')

    def test_fail_closed_if_historical_ticks_do_not_reach_window_start(self):
        x = s.cvd_15m('KRW-TEST', BASE + 10_000, 90_000_000,
                       lambda *args: events()[:-1])
        self.assertFalse(x['verified'])
        self.assertEqual(x['reason'], 'TICKS_HISTORY_INCOMPLETE')

    def test_fail_closed_on_cursor_not_advancing(self):
        data = [{'sequential_id': str(30_000 + i), 'timestamp': BASE - i * 100,
                 'ask_bid': 'BID', 'trade_price': 1, 'trade_volume': 1}
                for i in range(500)]
        x = s.cvd_15m('KRW-TEST', BASE + 10_000, 500, lambda *args: data)
        self.assertFalse(x['verified'])
        self.assertEqual(x['reason'], 'CURSOR_NOT_ADVANCING')

    def test_book_snapshot_never_claims_absorption(self):
        def api(venue, path, opts):
            return [{'market': 'KRW-TEST', 'timestamp': BASE,
                     'orderbook_units': [
                         {'ask_price': 100.5 + i, 'ask_size': 1000,
                          'bid_price': 100 - i, 'bid_size': 1200}
                         for i in range(5)]}]
        x = s.book_snapshot('KRW-TEST', BASE + 2_000, api)
        self.assertIsNotNone(x)
        self.assertFalse(x['continuous_absorption_verified'])
        self.assertGreater(x['bid_ask_top5_ratio'], .8)

    def test_four_independent_5m_checks_gate_and_no_duplicate(self):
        state = {}
        pos = {'now': BASE - 15 * 60_000}

        def api(venue, path, opts):
            self.assertEqual(venue, 'bithumb')
            if path == '/v1/orderbook':
                return [{'market': 'KRW-TEST', 'timestamp': pos['now'],
                         'orderbook_units': [
                             {'ask_price': 100.5 + i, 'ask_size': 1000,
                              'bid_price': 100 - i, 'bid_size': 1200}
                             for i in range(5)]}]
            if path == '/v1/trades/ticks':
                return events()
            self.fail('unexpected endpoint: ' + path)

        candidate = {'market': 'KRW-TEST',
                     'windows': {'5m': {'quote_krw': 35_000_000},
                                 '15m': {'quote_krw': 90_000_000}},
                     'spot_taker_sample_2m': {
                         'buy_share': .75, 'net_buy_krw': 5_000_000}}
        for i in range(4):
            pos['now'] = BASE - 15 * 60_000 + i * 5 * 60_000 + 15_000
            sig, reason = s.verify_continuity(candidate, pos['now'], state, api)
            if i < 3:
                self.assertIsNone(sig)
                self.assertEqual(reason, 'WAIT_4_CONSECUTIVE_5M_CHECKS')
            else:
                self.assertIsNotNone(sig, reason)
                self.assertEqual(sig['direction'], 'SUSTAINED_BUY_OBSERVATION')
                self.assertFalse(
                    sig['verification']['continuous_orderbook_absorption_verified'])
        duplicate, reason = s.verify_continuity(candidate, pos['now'], state, api)
        self.assertIsNone(duplicate)
        self.assertEqual(reason, 'DUPLICATE_OBSERVATION')

    def test_missing_book_fail_closed(self):
        state = {}

        def api(venue, path, opts):
            if path == '/v1/orderbook':
                return []
            return events()

        candidate = {'market': 'KRW-TEST',
                     'windows': {'5m': {'quote_krw': 35_000_000},
                                 '15m': {'quote_krw': 90_000_000}},
                     'spot_taker_sample_2m': {
                         'buy_share': .75, 'net_buy_krw': 5_000_000}}
        reason = None
        for i in range(4):
            now = BASE - 15 * 60_000 + i * 5 * 60_000 + 15_000
            sig, reason = s.verify_continuity(candidate, now, state, api)
            self.assertIsNone(sig)
        self.assertEqual(reason, 'BOOK_NOT_PERSISTENT_OR_UNKNOWN')

    def test_missing_intermediate_run_breaks_chain(self):
        state = {}

        def api(venue, path, opts):
            if path == '/v1/orderbook':
                return []
            return events()

        candidate = {'market': 'KRW-TEST',
                     'windows': {'5m': {'quote_krw': 35_000_000}},
                     'spot_taker_sample_2m': {'buy_share': .8,
                                             'net_buy_krw': 5_000_000}}
        for minute in (0, 5, 15):
            sig, reason = s.verify_continuity(
                candidate, BASE - 15 * 60_000 + minute * 60_000 + 10_000,
                state, api)
            self.assertIsNone(sig)
        self.assertEqual(reason, 'WAIT_4_CONSECUTIVE_5M_CHECKS')
        self.assertEqual(len(state['spot_candidate_checks']['KRW-TEST']['history']), 1)


if __name__ == '__main__':
    unittest.main()

