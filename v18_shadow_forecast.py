"""V18 live shadow directional brain. Real delayed-label learning; no trades/Telegram.
Separate runtime state. Existing V17 alerts and existing market source are read-only.
"""
import datetime as dt
import json
import math
from pathlib import Path
import collector
from v20_regime_shadow import update as update_v20_regime

UTC=dt.timezone.utc
DATA=Path(__file__).resolve().parent/'data'
FILES={k:DATA/v for k,v in {
 'market':'latest.json','source_state':'state.json',
 'flow':'v18_evidence_latest.json','state':'v18_shadow_state.json',
 'report':'v18_shadow_latest.json'}.items()}
EXPERTS={'bitget':5,'bithumb':3}
def num(v):
 try:
  if v is None or isinstance(v,bool):return None
  f=float(v)
  return f if math.isfinite(f) else None
 except (TypeError,ValueError,OverflowError):return None
def sign(v):return (v>0)-(v<0) if v is not None else 0
def ms(s):
 try:return int(dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp()*1000)
 except (TypeError,ValueError):return None
def read(p):
 try:
  x=json.loads(p.read_text(encoding='utf8'))
  return x if isinstance(x,dict) else {}
 except (ValueError,FileNotFoundError):return {}
def priors(state,venue):
 w=(state.get('weights') or {}).get(venue)
 if not isinstance(w,list) or len(w)!=EXPERTS[venue] or any(
    num(a) is None or a<=0 for a in w):return [1/EXPERTS[venue]]*EXPERTS[venue]
 total=sum(w);return [x/total for x in w]
def infer(votes,weights):
 strength=sum(a*b for a,b in zip(votes,weights))
 return sign(strength),round(strength,5)
def learn(weights,votes,change):
 ret=max(-1,min(1,change/.7))
 w=[a*math.exp(.30*b*ret) for a,b in zip(weights,votes)]
 total=sum(w)
 return [.98*x/total+.02/len(w) for x in w]
def market_prices(market,source_state):
 future={}
 for sym,row in (market.get('verified_crypto_futures_closed_prices') or {}).items():
  if not isinstance(row,dict):continue
  t,p=row.get('closed_end_ms'),num(row.get('close_usdt'))
  if isinstance(t,int) and p and p>0:future[sym]=(t,p)
 spot={}
 tape=source_state.get('spot_fast') or {}
 if isinstance(tape.get('time_ms'),int):
  for sym,row in (tape.get('prices') or {}).items():
   p=num(row[0]) if isinstance(row,list) and row else None
   if p and p>0:spot[sym]=(tape['time_ms'],p)
 return {'bitget':future,'bithumb':spot}
def candidates(market,flow):
 original={}
 for x in (market.get('early_pool') or [])+(market.get('watchlist') or []):
  if isinstance(x,dict) and isinstance(x.get('symbol'),str):original[x['symbol']]=x
 for obs in flow.get('observations') or []:
  if not isinstance(obs,dict):continue
  sym=obs.get('symbol');m=original.get(sym)
  if not m:continue
  p5=num(obs.get('window_5m_price_pct'))
  p15=num(obs.get('window_15m_price_pct'))
  evidence=obs.get('taker_flow_15m') or {}
  recent=obs.get('recent5_pressure_shift_research') or {}
  verified=evidence.get('verified') is True and (
    obs.get('price_context_status')=='ALIGNED_REAL_OFFICIAL_1M_CONTEXT') and (
    recent.get('price_time_alignment_verified') is True)
  taker=num(recent.get('recent_5m_net_taker_usdt')) if verified else None
  if not verified or p5 is None or p15 is None:continue
  votes=[sign(p5),-sign(p5),sign(p15),sign(p5-p15/3),sign(taker)]
  yield {'venue':'bitget','symbol':sym,'votes':votes,'taker_proof':True}
 for s in (market.get('spot_flow') or {}).get('direction_review_seeds') or []:
  sym=s.get('market');change=num(s.get('observed_5m_price_change_pct'))
  if not isinstance(sym,str) or not sym.startswith('KRW-') or change is None:continue
  votes=[sign(change),-sign(change),
    sign(change) if abs(change)<1.5 else -sign(change)]
  yield {'venue':'bithumb','symbol':sym,'votes':votes,'taker_proof':False}
def run(market,source_state,flow,state,now):
 published=ms(market.get('finished_utc'))
 observed=ms(flow.get('at_utc'))
 if (market.get('collector_status')!='PASS' or flow.get('status')!='PASS' or
     not published or not observed or published>now or observed>now or
     now-published>15*60000 or now-observed>12*60000 or
     flow.get('source_finished_utc')!=market.get('finished_utc')):
  return {'status':'SOURCE_NOT_READY','predictions':[]},state
 if not isinstance(state,dict):state={}
 weights={v:priors(state,v) for v in EXPERTS}
 prices=market_prices(market,source_state)
 pending=state.get('pending') if isinstance(state.get('pending'),list) else []
 outcomes=state.get('outcomes') if isinstance(state.get('outcomes'),list) else []
 remaining=[];newly_scored=0
 for item in pending:
  venue=item.get('venue');symbol=item.get('symbol')
  if venue not in EXPERTS or not isinstance(symbol,str):continue
  issued=item.get('issued')
  if not isinstance(issued,int):continue
  p=prices[venue].get(symbol)
  if p is None:
   if now-issued<3*3600000:remaining.append(item)
   continue
  stamp,price=p
  entry=item.get('entry')
  if not entry and stamp>issued:
   item['entry']=[stamp,price];entry=item['entry']
  if not entry:
   if now-issued<20*60000:remaining.append(item)
   continue
  target=entry[0]+15*60000
  if stamp<target or now<target:
   remaining.append(item);continue
  if stamp>target+6*60000:continue
  actual=100*(price/entry[1]-1)
  side=item.get('direction')
  if side not in (-1,1):continue
  signed=side*actual
  verdict='RIGHT' if signed>=.15 else 'WRONG' if signed<=-.15 else 'FLAT'
  weights[venue]=learn(weights[venue],item['votes'],actual)
  outcomes.append({'venue':venue,'symbol':symbol,'verdict':verdict,
    'signed_pct':round(signed,5),'close_ms':stamp,
    'entry_first_post_signal_price':True,'real_trade_execution':False})
  newly_scored+=1
 current={(x['venue'],x['symbol']) for x in remaining}
 predictions=[]
 for item in candidates(market,flow):
  venue,symbol=item['venue'],item['symbol']
  if (venue,symbol) in current:continue
  direction,score=infer(item['votes'],weights[venue])
  if direction==0:continue
  remaining.append({**item,'issued':now,'entry':None,'direction':direction})
  current.add((venue,symbol))
  predictions.append({'venue':venue,'symbol':symbol,
   'hypothesis':'UP' if direction>0 else 'DOWN','score_not_probability':score,
   'venue_local_real_taker':item['taker_proof'],'signal_class':'RESEARCH_ONLY',
   'telegram_sent':False,'trade_allowed':False})
 history={'pending':remaining[-160:],'outcomes':outcomes[-300:],'weights':weights}
 # Independent forward-only model cannot break the existing V18 study.
 try:
  regime_report,regime_history=update_v20_regime(
   market,flow,prices['bitget'],state.get('v20_regime') or {},now)
  history['v20_regime']=regime_history
 except Exception as exc:
  history['v20_regime']=state.get('v20_regime') or {}
  regime_report={'status':'RESEARCH_CALIBRATION_FAILED',
    'error_type':type(exc).__name__,'telegram_sent':False,'real_orders':False}
 summaries={}
 for venue in EXPERTS:
  rows=[x for x in history['outcomes'] if x['venue']==venue]
  measurable=[x for x in rows if x['verdict'] in ('RIGHT','WRONG')]
  good=sum(x['verdict']=='RIGHT' for x in measurable)
  summaries[venue]={'measured':len(rows),'decisive':len(measurable),
   'right':good,'wrong':len(measurable)-good,
   'direction_accuracy':round(good/len(measurable),4) if measurable else None}
 return {'version':'V18_ACTUAL_SERVER_SHADOW_V1','status':'RESEARCH_ACTIVE',
  'source_finished_utc':market['finished_utc'],
  'forecast_at_utc':dt.datetime.fromtimestamp(now/1000,UTC).isoformat(),
  'predictions':predictions,'matured_new':newly_scored,
  'observed_results':summaries,'pending':len(history['pending']),
  'weights':weights,'v20_regime_shadow':regime_report,
  'no_orders':True,'no_telegram':True,
  'higher_predictive_accuracy_unverified':True},history
def main():
 now=int(collector.utc_now().timestamp()*1000)
 report,state=run(read(FILES['market']),read(FILES['source_state']),
                  read(FILES['flow']),read(FILES['state']),now)
 collector.write_json_atomic(FILES['report'],report)
 if report['status']=='RESEARCH_ACTIVE':
  collector.write_json_atomic(FILES['state'],state)
 print('V18_SHADOW_RESULT',json.dumps({k:report.get(k) for k in
       ('status','matured_new','pending','observed_results')},ensure_ascii=False))
 return 0 if report['status']=='RESEARCH_ACTIVE' else 2
if __name__=='__main__':raise SystemExit(main())
