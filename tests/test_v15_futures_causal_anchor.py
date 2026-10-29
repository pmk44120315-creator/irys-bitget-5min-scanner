"""Prevent a 3-minute stale-price/late-fill mismatch in Bitget futures evidence."""
import copy
import unittest
from collector import align_futures_flow_price_context

M=60000
END=1793286180000
OLD=END-3*M

def native(end,quote=75000):
    def bucket(count,turnover):
        return {'coverage':1,'baseline_coverage':1,'quote_turnover':turnover,
                'price_change_pct':0.7,'close':100,'open':99.3,
                'high':100.1,'low':99.2}
    return {'end_utc_ms':end,'1m':bucket(1,5000),
            '5m':bucket(5,25000),'15m':bucket(15,quote),
            '60m':bucket(60,200000)}

def snapshot():
    one={'symbol':'IRYSUSDT','venue':'bitget','windows':native(OLD)}
    two=copy.deepcopy(one)
    flow={'observations':[{'symbol':'IRYSUSDT','observed_ms':END,
        'taker_flow_15m':{'verified':True,'end_ms':END,
                          'taker_turnover_usdt':75000},
        'recent5_pressure_shift_research':{
            'recent_5m_net_taker_usdt':4200,
            'recent_flow_price_same_sign':True,
            'direction_signal':False}}]}
    return {'watchlist':[one],'early_pool':[two],'futures_flow':flow}

class TimeAlignedPrice(unittest.TestCase):
    def test_three_minute_price_lag_is_fixed_without_creating_a_signal(self):
        j=snapshot()
        calls=[]
        def read(m,t):
            calls.append((m['symbol'],t))
            return native(END)
        result=align_futures_flow_price_context(j,read)
        self.assertEqual(calls,[('IRYSUSDT',END)])
        self.assertEqual(result['aligned'],1)
        for x in j['watchlist']+j['early_pool']:
            self.assertEqual(x['windows']['end_utc_ms'],END)
        proof=j['futures_flow']['observations'][0]
        self.assertEqual(proof['price_context_status'],'ALIGNED_REAL_OFFICIAL_1M_CONTEXT')
        self.assertEqual(proof['price_context_end_ms'],END)
        self.assertIs(proof['recent5_pressure_shift_research']['direction_signal'],False)
        self.assertTrue(proof['recent5_pressure_shift_research']['price_time_alignment_verified'])

    def test_real_candle_gap_cannot_be_passed_as_valid_price(self):
        j=snapshot()
        invalid=native(END)
        invalid['5m']['coverage']=0
        result=align_futures_flow_price_context(j,lambda *_:invalid)
        self.assertEqual(result['aligned'],0)
        self.assertEqual(j['watchlist'][0]['windows']['end_utc_ms'],OLD)
        self.assertEqual(j['futures_flow']['observations'][0]['price_context_status'],
                         'UNVERIFIED_OR_SPARSE_COMPLETED_1M_PRICE')

    def test_same_clock_turnover_conflict_fails_closed(self):
        j=snapshot()
        result=align_futures_flow_price_context(j,lambda *_:native(END,quote=40000))
        self.assertEqual(result['failed'],1)
        self.assertEqual(j['futures_flow']['observations'][0]['price_context_status'],
                         'SAME_TIME_PRICE_TAKER_TURNOVER_MISMATCH')

    def test_no_fills_never_mints_future_candles(self):
        j={'watchlist':[],'early_pool':[],
           'futures_flow':{'observations':[]}}
        r=align_futures_flow_price_context(j,lambda *_:None)
        self.assertEqual(r['aligned'],0)
        self.assertEqual(r['checked'],0)

if __name__=='__main__':
    unittest.main()
