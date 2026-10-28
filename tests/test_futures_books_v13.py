"""Verify on-venue futures book snapshots are distinct and never called absorption."""
import datetime as dt
import unittest
from bitget_futures_cvd import futures_orderbook_snapshot, paired_futures_books

M=60_000
NOW=int(dt.datetime(2026,10,29,0,0,tzinfo=dt.timezone.utc).timestamp()*1000)

def payload(timestamp,skew=False):
    b=[[str(10-.01*i),'100'] for i in range(15)]
    a=[[str(10.01+.01*i),'70'] for i in range(15)]
    if skew:a[0][0]='9'
    return {'ts':str(timestamp),'bids':b,'asks':a}

def api_at(at,skew=False):
    def api(venue,path,opts):
        assert venue=='bitget'
        assert path=='/api/v2/mix/market/merge-depth'
        assert opts['productType']=='USDT-FUTURES'
        assert opts['precision']=='scale0'
        assert opts['limit']=='15'
        return payload(at,skew)
    return api


class FuturesBooks(unittest.TestCase):
    def test_two_real_times_qualify_only_as_point_in_time_depth_not_absorption(self):
        state={}
        one=paired_futures_books('BANKUSDT',NOW,api_at(NOW),state)
        self.assertEqual(one['status'],'WAIT_SECOND_BOOK')
        two=paired_futures_books('BANKUSDT',NOW+5*M,api_at(NOW+5*M),state)
        self.assertEqual(two['status'],'TWO_DISTINCT_BOOK_SNAPSHOTS')
        self.assertEqual(len(two['snapshots']),2)
        self.assertFalse(two['continuous_absorption_verified'])
        self.assertGreater(two['snapshots'][0]['bid_ask_top5_ratio'],1)
        self.assertLess(two['snapshots'][0]['spread_pct'],.8)

    def test_stale_repeated_or_crossed_books_cannot_be_proof(self):
        memory={}
        paired_futures_books('BANKUSDT',NOW,api_at(NOW),memory)
        repeat=paired_futures_books('BANKUSDT',NOW,api_at(NOW),memory)
        self.assertNotEqual(repeat['status'],'TWO_DISTINCT_BOOK_SNAPSHOTS')
        too_late=paired_futures_books('BANKUSDT',NOW+12*M,api_at(NOW+12*M),memory)
        self.assertNotEqual(too_late['status'],'TWO_DISTINCT_BOOK_SNAPSHOTS')
        self.assertIsNone(futures_orderbook_snapshot('BANKUSDT',NOW,api_at(NOW,True)))

    def test_missing_orderbook_is_explicitly_unverified(self):
        def fail(*_):
            raise RuntimeError('official data unavailable')
        out=paired_futures_books('BANKUSDT',NOW,fail,{})
        self.assertEqual(out['status'],'FUTURES_BOOK_UNAVAILABLE')
        self.assertEqual(out['snapshots'],[])

if __name__=='__main__':
    unittest.main()
