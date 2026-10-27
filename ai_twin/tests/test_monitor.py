import datetime as dt
import os
import unittest
from unittest.mock import patch
from ai_twin import monitor as m

NOW=dt.datetime(2026,10,27,12,0,0, tzinfo=dt.timezone.utc)

def source(**overrides):
    a={'collector_status':'PASS','collector_utc':(NOW-dt.timedelta(minutes=4)).isoformat(),
      'finished_utc':(NOW-dt.timedelta(minutes=2)).isoformat(),
      'stats':{'candle_symbols_failed':0,'oi_symbols_failed':0,'funding_feed_ok':True,
               'instrument_verified_crypto':468},
      'spot_flow':{'status':'PASS','markets':489,'tickers':489,'signals':[]},'early_pool':[]}
    a.update(overrides)
    return a

def future(sym='ABCUSDT',oi=.8,five=.7,wick=.15,base=None):
    return {'symbol':sym,'baseCoin':base or sym[:-4], 'venue':'bitget','asset_identity':'VERIFIED_CRYPTO',
       'funding_rate':.0001,'early_volume_rank':10,
       'oi':{'status':'OK','change_pct_from_previous_run':oi,'elapsed_min_since_previous_snapshot':5},
       'windows':{'5m':{'quote_turnover':70000,'adjacent_ratio':5,'price_change_pct':five,'coverage':1,'baseline_coverage':1,'close':1},
                  '15m':{'quote_turnover':100000,'coverage':1,'upper_wick_ratio':wick},
                  '60m':{'quote_turnover':200000,'coverage':1,'price_change_pct':1}}}

def spot_sig():
    return {'venue':'bithumb','direction':'BUY_OBSERVATION','market':'KRW-ABC',
       'price_krw':123, 'volume_ratio_5m':5,'official_warning_checked':True,
       'risk_status':'NO_OFFICIAL_WARNING_AT_COLLECTION',
       'windows':{'5m':{'quote_krw':40000000,'price_change_pct':1},'15m':{'upper_wick_ratio':.1}},
       'spot_taker_sample_2m':{'coverage':True,'recent_net_buy_krw':13000000,'buy_share':.74,'recent_buy_share':.7,
                                'net_buy_krw':21000000,'count':50}}

def binance_bars(now, buy_share=.8, recent_positive=True, four_positive=True):
    cutoff=int(now.timestamp()*1000)//60000*60000
    out=[]
    for i in range(260,0,-1):
        stamp=cutoff-i*60000
        ratio=buy_share if i<=2 else (.6 if four_positive else .2)
        if not recent_positive and i<=2:ratio=.2
        row=[stamp,'1','1.01','0.99','1','100',stamp+59999,'1000','20','200',str(1000*ratio),'0']
        out.append(row)
    return out

class ValidationTests(unittest.TestCase):
    def test_source_pass(self):self.assertEqual(m.status_source(source(),NOW),'PASS')
    def test_source_stale(self):self.assertEqual(m.status_source(source(finished_utc=(NOW-dt.timedelta(hours=2)).isoformat()),NOW),'SOURCE_STALE')
    def test_source_partial(self):self.assertEqual(m.status_source(source(collector_status='PARTIAL'),NOW),'SOURCE_NOT_PASS')
    def test_invalid_spot(self):self.assertEqual(m.status_source(source(spot_flow={'status':'FAILED','markets':489,'signals':[]}),NOW),'SPOT_SOURCE_NOT_PASS')
    def test_spot_positive(self):self.assertEqual(len(m.spot_candidates(source(spot_flow={'status':'PASS','markets':489,'signals':[spot_sig()]}))),1)
    def test_spot_warning_excluded(self):
        x=spot_sig();x['risk_status']='DANGER'
        self.assertEqual(m.spot_candidates(source(spot_flow={'status':'PASS','markets':489,'signals':[x]})),[])
    def test_stocks_unverified_excluded(self):
        x=future();x['asset_identity']='NON_CRYPTO'
        y=future('XYZUSDT');y['asset_identity']='UNVERIFIED'
        self.assertEqual(m.pick_futures({'early_pool':[x,y]}),[])
    def test_oi_negative_and_stale_excluded(self):
        x=future(oi=-.47); y=future('XYZUSDT');y['oi']['elapsed_min_since_previous_snapshot']=35
        self.assertEqual(m.pick_futures({'early_pool':[x,y]}),[])
    def test_short_preselect(self):
        self.assertEqual(m.pick_futures({'early_pool':[future(five=-.9)]})[0]['symbol'],'ABCUSDT')
    def test_funding_overheat_excluded(self):
        x=future();x['funding_rate']=.01
        self.assertEqual(m.pick_futures({'early_pool':[x]}),[])
    def test_binance_4h_flow(self):
        t=NOW-dt.timedelta(minutes=4)
        d=m.parse_binance(binance_bars(t),int(t.timestamp()*1000))
        self.assertEqual(d['status'],'PASS')
        self.assertGreater(d['last4h']['taker_net_usdt'],0)
        self.assertEqual(len(d['two_one_min_buy_shares']),2)
    def test_binance_incomplete_fails(self):
        self.assertEqual(m.parse_binance([],int(NOW.timestamp()*1000))['status'],'INSUFFICIENT_BARS')
    def test_conflict_long_recent_selling(self):
        t=NOW-dt.timedelta(minutes=4)
        def fake(url):
            if 'exchangeInfo' in url:return {'symbols':[{'symbol':'ABCUSDT','status':'TRADING','baseAsset':'ABC','quoteAsset':'USDT'}]}
            return binance_bars(t,recent_positive=False)
        c,d=m.evidence_candidates(source(early_pool=[future()]),t,fake)
        self.assertEqual(c,[])
        self.assertEqual(d['binance_verified'],1)
    def test_uni_spike_oi_drop_blocks(self):
        t=NOW-dt.timedelta(minutes=4)
        def fake(url):
            if 'exchangeInfo' in url:return {'symbols':[{'symbol':'UNIUSDT','status':'TRADING','baseAsset':'UNI','quoteAsset':'USDT'}]}
            return binance_bars(t)
        self.assertEqual(m.evidence_candidates(source(early_pool=[future('UNIUSDT',oi=-.47)]),t,fake)[0],[])
    def test_high_confidence_model_veto(self):
        c={'market':'ABCUSDT','source':'BITGET_FUTURES_WITH_BINANCE_SPOT','direction_candidate':'LONG'}
        a=[{'market':'ABCUSDT','decision':'WATCH','confidence':'HIGH','send_alert':True}]
        self.assertEqual(m.confirm_assessments([c],a),[])
    def test_hallucinated_symbol_rejected(self):
        c={'market':'ABCUSDT','source':'BITGET_FUTURES_WITH_BINANCE_SPOT','direction_candidate':'LONG'}
        a=[{'market':'ZZZUSDT','decision':'LONG','confidence':'HIGH','send_alert':True}]
        self.assertEqual(m.confirm_assessments([c],a),[])
    def test_wrong_direction_rejected(self):
        c={'market':'ABCUSDT','source':'BITGET_FUTURES_WITH_BINANCE_SPOT','direction_candidate':'SHORT'}
        a=[{'market':'ABCUSDT','decision':'LONG','confidence':'HIGH','send_alert':True}]
        self.assertEqual(m.confirm_assessments([c],a),[])
    def test_missing_ai_key_never_alerts(self):
        with patch.object(m,'evidence_candidates',return_value=([{'source':'BITHUMB_SPOT','market':'KRW-ABC','direction_candidate':'BUY'}],{})):
            with patch.dict(os.environ,{'AI_TWIN_OPENAI_API_KEY':'','AI_TWIN_SEND_ALERTS':'true'}):
                r,_=m.run(now=NOW,source=source(),state={})
        self.assertEqual((r['status'],r['alerts_sent']),('AI_NOT_CONFIGURED',0))
    def test_ai_call_failure_never_alerts(self):
        with patch.object(m,'evidence_candidates',return_value=([{'source':'BITHUMB_SPOT','market':'KRW-ABC','direction_candidate':'BUY'}],{})):
            with patch.dict(os.environ,{'AI_TWIN_OPENAI_API_KEY':'dummy','AI_TWIN_SEND_ALERTS':'true'}):
                r,_=m.run(now=NOW,source=source(),state={},model_caller=lambda *_:(_ for _ in ()).throw(RuntimeError('rate')))
        self.assertEqual((r['status'],r['alerts_sent']),('AI_FAILED',0))
    def test_ai_shadow_no_send(self):
        c={'source':'BITHUMB_SPOT','market':'KRW-ABC','direction_candidate':'BUY'}
        answer=[{'market':'KRW-ABC','decision':'BUY','confidence':'HIGH','send_alert':True,'reasons':['매수'],'counter_evidence':[],'explanation_ko':'관찰'}]
        with patch.object(m,'evidence_candidates',return_value=([c],{})):
            with patch.dict(os.environ,{'AI_TWIN_OPENAI_API_KEY':'dummy','AI_TWIN_SEND_ALERTS':'false'}):
                r,_=m.run(now=NOW,source=source(),state={},model_caller=lambda *_:(answer,'mock'))
        self.assertEqual((r['confirmed_count'],r['alerts_sent'],r['telegram_status']),(1,0,'SHADOW_NO_DELIVERY'))
    def test_ai_send_once_then_cooldown(self):
        c={'source':'BITHUMB_SPOT','market':'KRW-ABC','direction_candidate':'BUY','price_krw':123,'volume_ratio5':4}
        answer=[{'market':'KRW-ABC','decision':'BUY','confidence':'HIGH','send_alert':True,'reasons':['매수'],'counter_evidence':['표본제한'],'explanation_ko':'관찰'}]
        sent=[]
        with patch.object(m,'evidence_candidates',return_value=([c],{})):
            with patch.dict(os.environ,{'AI_TWIN_OPENAI_API_KEY':'dummy','AI_TWIN_SEND_ALERTS':'true','AI_TWIN_TELEGRAM_BOT_TOKEN':'secret','AI_TWIN_TELEGRAM_CHAT_ID':'1234567'}):
                x,state=m.run(now=NOW,source=source(),state={},model_caller=lambda *_:(answer,'mock'),send=lambda *args:sent.append(args))
                y,_=m.run(now=NOW+dt.timedelta(minutes=5),source=source(collector_utc=(NOW+dt.timedelta(minutes=1)).isoformat(),finished_utc=(NOW+dt.timedelta(minutes=3)).isoformat()),state=state,model_caller=lambda *_:(answer,'mock'),send=lambda *args:sent.append(args))
        self.assertEqual((x['alerts_sent'],y['alerts_sent'],len(sent)),(1,0,1))
    def test_no_candidate_skips_paid_ai(self):
        r,_=m.run(now=NOW,source=source(),state={},fetch_binance=lambda _: (_ for _ in ()).throw(AssertionError('unexpected network')))
        self.assertEqual((r['status'],r['ai_status']),('NO_EVIDENCE','SKIPPED_NO_CANDIDATES'))

if __name__=='__main__':unittest.main()