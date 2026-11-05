"""Bridge integration: generate an actual Python 4x5m sustained spot proof for the V8 Worker."""
import datetime as dt
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from spot_continuity import verify_continuity

NOW = int(dt.datetime(2026, 10, 28, 4, 0, tzinfo=dt.timezone.utc).timestamp()*1000)
FIVE = 300_000
MINUTE = 60_000
START = NOW-15*MINUTE
MARKET='KRW-TEST'
TRADES=[]
for bucket in range(3):
    bstart=START+bucket*FIVE
    for i in range(25):
        timestamp=bstart+5000+i*1000
        TRADES.append({
            'trade_timestamp':timestamp,'timestamp':timestamp,
            'trade_price':100,'trade_volume':10_000,
            'ask_bid':'BID' if i<20 else 'ASK',
            'sequential_id':str(17930000000000000+bucket*1000+i),
        })
TRADES.append({
    'timestamp':START-1000,'trade_price':100,'trade_volume':1,
    'ask_bid':'BID','sequential_id':'17930000009999999'
})
TRADES.sort(key=lambda x:-x['timestamp'])

now_ref=NOW
def api(venue,path,opts):
    assert venue=='bithumb'
    if path=='/v1/orderbook':
        return [{
            'market':MARKET,'timestamp':now_ref,
            'orderbook_units':[
                {'bid_price':100-.01*i,'bid_size':100,'ask_price':100.1+.01*i,'ask_size':100}
                for i in range(5)
            ]
        }]
    if path=='/v1/trades/ticks':
        return TRADES
    raise AssertionError('unexpected endpoint '+path)

def candidate(at):
    return {
      'venue':'bithumb','market':MARKET,'direction':'BUY_OBSERVATION',
      'observation_only':True,'risk_status':'NO_OFFICIAL_WARNING_AT_COLLECTION',
      'official_warning_checked':True,
      'full_cvd_verified':False,'orderbook_absorption_verified':False,
      'timestamp_utc':dt.datetime.fromtimestamp(at/1000,dt.timezone.utc).isoformat(),
      'price_krw':100,'volume_ratio_5m':3.8,
      'prior_55m_quiet':{'sample_count':55,'range_pct':2.2,'drift_pct':.4},
      'windows':{
          '5m':{'quote_krw':25_000_000,'price_change_pct':.7,'upper_wick_ratio':.12},
          '15m':{'quote_krw':75_000_000,'price_change_pct':1.4,'upper_wick_ratio':.16},
          '60m':{'price_change_pct':2.6}
      },
      'retrace_from_15m_high_pct':.2,
      'spot_taker_sample_2m':{
          'coverage':True,'buy_share':.8,'early_buy_share':.72,'recent_buy_share':.75,
          'net_buy_krw':15_000_000,'recent_net_buy_krw':6_000_000,'count':80
      }
    }

state={}
history=[]
verified=None
for step in range(4):
    now_ref=NOW-(3-step)*FIVE
    obs=candidate(now_ref)
    confirmed,reason=verify_continuity(obs,now_ref,state,api)
    history.append(reason)
    if step<3 and confirmed is not None:raise AssertionError('premature approval')
    if step==3:verified=confirmed

if verified is None:
    raise AssertionError('Python never confirmed: '+str(history))
assert verified['direction']=='SUSTAINED_BUY_OBSERVATION'
assert verified['verification']['alert_classification']=='SUSTAINED_EARLY_SPOT_OBSERVATION_ONLY'
assert len(verified['verification']['candle_reconciled_15m_spot_taker']['blocks'])==3
print(json.dumps({'now':NOW,'signal':verified,'history':history}))
