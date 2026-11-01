import datetime as dt
import unittest
from bitget_fast_public import digest,VERSION

NOW=int(dt.datetime(2026,11,1,11,30,tzinfo=dt.timezone.utc).timestamp()*1000)

def source(now=NOW,spike=False):
    ids=[f'SYM{i}USDT' for i in range(120)]
    ids[0]='IMPACTUSDT';ids[1]='STOCKUSDT'
    types=[{'symbol':s,'symbolType':'stock' if i==1 else 'crypto',
       'instrumentType':'stock' if i==1 else 'crypto'} for i,s in enumerate(ids)]
    contacts=[{'symbol':s,'symbolStatus':'normal',
       'symbolType':'perpetual','quoteCoin':'USDT'} for s in ids]
    tickers=[{'symbol':s,'lastPr':('1.02' if spike and i==0 else '1'),
      'bidPr':('1.019' if spike and i==0 else '0.999'),
      'askPr':('1.021' if spike and i==0 else '1.001'),
      'usdtVolume':'10000000','ts':str(now-2000)} for i,s in enumerate(ids)]
    if spike:tickers[1]['lastPr']='100'
    return {'instruments':types,'contracts':contacts,'tickers':tickers}

class BitgetFastPublic(unittest.TestCase):
    def test_first_snap_not_fake_historical_movement(self):
        r=digest(source(),{},NOW)
        self.assertEqual(r['status'],'BASELINE_WARMING_OR_TIME_GAP')
        self.assertEqual(r['candidate_count'],0)
        self.assertEqual(r['version'],VERSION)
        self.assertFalse(r['telegram_sent'])
        self.assertFalse(r['orders_sent'])

    def test_genuine_first_5m_mover_selected_only_from_verified_crypto_perpetuals(self):
        old=digest(source(),{},NOW)
        nxt=digest(source(NOW+300000,True),old,NOW+300000)
        self.assertEqual(nxt['status'],'MARKET_COMPARISON_PASS')
        self.assertEqual(nxt['candidate_count'],1)
        self.assertEqual(nxt['candidates'][0]['symbol'],'IMPACTUSDT')
        self.assertAlmostEqual(nxt['candidates'][0]['move_pct'],2)
        self.assertTrue(nxt['candidates'][0]['identity_verified_v3_crypto'])
        self.assertTrue(nxt['candidates'][0]['active_contract_verified_v2'])
        self.assertTrue(nxt['candidates'][0]['price_only_not_future_direction'])
        self.assertNotIn('STOCKUSDT',[x['symbol'] for x in nxt['candidates']])
        self.assertEqual(nxt['source_identity'],'V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO')

    def test_stale_price_and_wide_quote_cannot_be_signaled(self):
        old=digest(source(),{},NOW)
        nxt=source(NOW+300000,True)
        nxt['tickers'][0]['ts']=str(NOW-400000)
        r=digest(nxt,old,NOW+300000)
        self.assertEqual(r['candidate_count'],0)
        self.assertEqual(r['rejected_stale_tickers'],1)
        nxt=source(NOW+300000,True)
        nxt['tickers'][0]['askPr']='1.1'
        x=digest(nxt,old,NOW+300000)
        self.assertEqual(x['candidate_count'],0)

    def test_five_minute_rollover_after_network_gap_refuses_to_make_15m_into_5m(self):
        old=digest(source(),{},NOW)
        later=digest(source(NOW+12*60000,True),old,NOW+12*60000)
        self.assertEqual(later['status'],'BASELINE_WARMING_OR_TIME_GAP')
        self.assertEqual(later['candidate_count'],0)

    def test_crypto_instrument_or_contract_status_failure_prevents_false_alert(self):
        old=digest(source(),{},NOW)
        current=source(NOW+300000,True)
        current['instruments'][0]['instrumentType']='metal'
        self.assertEqual(digest(current,old,NOW+300000)['candidate_count'],0)
        current=source(NOW+300000,True)
        current['contracts'][0]['symbolStatus']='off'
        self.assertEqual(digest(current,old,NOW+300000)['candidate_count'],0)

    def test_incomplete_identity_or_tickers_is_fatal_and_not_written_as_empty(self):
        old=digest(source(),{},NOW)
        with self.assertRaisesRegex(ValueError,'PUBLIC_MARKET_UNIVERSE_INCOMPLETE'):
            digest({'contracts':[],'instruments':source()['instruments'],
               'tickers':source()['tickers']},old,NOW+300000)
        with self.assertRaisesRegex(ValueError,'PUBLIC_PROVIDER_DATA_INCOMPLETE'):
            digest({'contracts':[]},old,NOW+300000)

    def test_not_trading_decisions_or_24h_volumes_fabricated_as_last_5m_cvd(self):
        old=digest(source(),{},NOW)
        x=digest(source(NOW+300000,True),old,NOW+300000)
        self.assertFalse(x['trade_data_included'])
        self.assertTrue(x['not_full_orderbook_or_marketwide_cvd'])
        self.assertTrue(x['not_profitable_future_direction_proof'])
        self.assertFalse(x['telegram_sent'])
        self.assertFalse(x['orders_sent'])
        c=x['candidates'][0]
        self.assertEqual(c['quote_24h_usdt'],10000000)
        self.assertNotIn('five_minute_cvd',c)

if __name__=='__main__':unittest.main()
