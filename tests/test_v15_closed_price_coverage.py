"""Ensure full-market future-outcome reference contains only actual completed crypto 1m."""
import unittest
from collector import verified_crypto_closed_price_coverage

class FullCryptoClosedPrices(unittest.TestCase):
    def test_only_crypto_verified_real_closed_one_minute(self):
        def item(s,identity,close=1.02,coverage=1,end=1793286000000):
            return {'symbol':s,'venue':'bitget','asset_identity':identity,
                    'windows':{'end_utc_ms':end,'1m':{'coverage':coverage,'close':close}}}
        items=[
            item('IRYSUSDT','VERIFIED_CRYPTO'),
            item('XYZUSDT','UNVERIFIED'),
            item('AAPLUSDT','NON_CRYPTO'),
            item('MISSINGUSDT','VERIFIED_CRYPTO',coverage=0),
            item('NULLUSDT','VERIFIED_CRYPTO',close=None),
            item('FUTUREUSDT','VERIFIED_CRYPTO',end=1793286021000),
        ]
        out=verified_crypto_closed_price_coverage(items)
        self.assertEqual(list(out),['IRYSUSDT'])
        self.assertEqual(out['IRYSUSDT']['close_usdt'],1.02)
        self.assertEqual(out['IRYSUSDT']['closed_end_ms'],1793286000000)

    def test_empty_or_unavailable_does_not_invent_market_prices(self):
        self.assertEqual(verified_crypto_closed_price_coverage([]),{})
        self.assertEqual(verified_crypto_closed_price_coverage([
            {'symbol':'IRYSUSDT','venue':'bitget','asset_identity':'VERIFIED_CRYPTO',
             'windows':{'end_utc_ms':1793286000000,'1m':{'coverage':0,'close':0}}}]),{})

if __name__=='__main__':unittest.main()
