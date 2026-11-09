"""Frozen V43 observations matched to later original bid/ask, never candle PnL.
Descriptive backtest only: policies are compared on the same measured cases.
Uses first retained quote per provider second; gaps and incomplete paths remain
explicit. This module neither authorizes entries nor changes live alerts.
"""
import argparse,bisect,collections,gzip,hashlib,json,math
from pathlib import Path
VERSION='V44_FROZEN_STREAM_FORWARD_COMPARISON_V1'
POLICIES=('price_momentum','taker_flow','visible_depth','flow_price_agreement','counterflow_price_response','always_up','always_down')

def finite(x): return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def clock(x): return isinstance(x,int) and not isinstance(x,bool) and 0<=x<2**53
def sign(x): return (1 if x>0 else -1 if x<0 else 0) if finite(x) else None
def identity(v,s):
 import re
 return isinstance(s,str) and bool(re.fullmatch(r'[A-Z0-9]{1,25}USDT',s) if v=='bitget' else re.fullmatch(r'KRW-[A-Z0-9]{1,25}',s) if v=='bithumb' else False)

def normalize_book(frame):
 """Decode only public best quotes; trade messages never become quote labels."""
 v=frame.get('venue');received=frame.get('received_at_ms')
 if not clock(received):return []
 try:d=json.loads(frame['raw'])
 except (ValueError,TypeError,KeyError):return []
 if not isinstance(d,dict):return []
 if v=='bitget':
  a=d.get('arg',{})
  if a.get('channel')!='books5' or a.get('instType')!='USDT-FUTURES' or d.get('action')!='snapshot':return []
  source=[(a.get('instId'),x['ts'],x['bids'][0][0],x['asks'][0][0],x.get('seq')) for x in d.get('data',[]) if x.get('bids') and x.get('asks')]
 elif v=='bithumb' and d.get('type')=='orderbook' and d.get('orderbook_units'):
  x=d['orderbook_units'][0];source=[(d.get('code'),int(d['timestamp'])//1000,x['bid_price'],x['ask_price'],None)]
 else:return []
 result=[]
 for symbol,ts,bid,ask,seq in source:
  try:ts=int(ts);bid=float(bid);ask=float(ask)
  except (TypeError,ValueError,OverflowError):continue
  if not identity(v,symbol) or not 1577836800000<=ts<=received or not finite(bid) or not finite(ask) or not 0<bid<ask:continue
  result.append({'venue':v,'symbol':symbol,'at_ms':ts,'received_at_ms':received,'bid':bid,'ask':ask,'sequence':str(seq) if seq is not None else None,'segment':frame.get('session')})
 return result

def feature_valid(row,now):
 f=row.get('feature',{});q=f.get('last_quote') or {};t=f.get('asof_ms')
 return f.get('version')=='V43_PUBLIC_STREAM_EVIDENCE_V1' and identity(f.get('venue'),f.get('symbol')) and clock(t) and t<=now and clock(q.get('at_ms')) and clock(q.get('received_at_ms')) and q['at_ms']<=q['received_at_ms']<=t and 0<=t-q['at_ms']<=5000 and finite(q.get('bid')) and finite(q.get('ask')) and 0<q['bid']<q['ask'] and f.get('conflicts',0)==0

def hypotheses(f):
 p=sign(f.get('observed_mid_change_pct'));flow=sign(f['buy_share']-.5) if finite(f.get('buy_share')) and 0<=f['buy_share']<=1 and f.get('trade_count',0)>0 else None
 depth=sign(f.get('top_depth_imbalance'))
 return {'price_momentum':p or None,'taker_flow':flow or None,'visible_depth':depth or None,
 'flow_price_agreement':p if p and p==flow else None,
 'counterflow_price_response':p if p and flow and p!=flow else None,'always_up':1,'always_down':-1}

def pair_observations(observations,quotes,asof_ms,horizon_seconds=60,tolerance_ms=5000):
 if not clock(asof_ms) or horizon_seconds not in (60,300) or tolerance_ms!=5000:raise ValueError('FIXED_EVALUATION_CONTRACT_REQUIRED')
 diagnostics={'input_features':len(observations),'invalid_feature':0,'duplicate_features':0,'conflicting_features':0,'invalid_quotes':0,'conflicting_quotes':0}
 unique={};conflicts=set()
 for r in observations:
  if not feature_valid(r,asof_ms):diagnostics['invalid_feature']+=1;continue
  f=r['feature'];key=(f['venue'],f['symbol'],f['asof_ms']);fp=json.dumps(f,sort_keys=True,separators=(',',':'))
  if key in unique:
   if unique[key][0]!=fp:conflicts.add(key)
   else:diagnostics['duplicate_features']+=1
  else:unique[key]=(fp,r)
 diagnostics['conflicting_features']=len(conflicts)
 qmap={};bad=set()
 for q in quotes:
  if not identity(q.get('venue'),q.get('symbol')) or not clock(q.get('at_ms')) or not clock(q.get('received_at_ms')) or not q['at_ms']<=q['received_at_ms']<=asof_ms or not finite(q.get('bid')) or not finite(q.get('ask')) or not 0<q['bid']<q['ask']:
   diagnostics['invalid_quotes']+=1;continue
  k=(q['venue'],q['symbol'],q['at_ms'],q.get('sequence'))
  if k in qmap and (qmap[k]['bid'],qmap[k]['ask'])!=(q['bid'],q['ask']):bad.add(k)
  elif k not in qmap or q['received_at_ms']<qmap[k]['received_at_ms']:qmap[k]=q
 diagnostics['conflicting_quotes']=len(bad)
 grouped=collections.defaultdict(list)
 for k,q in qmap.items():
  if k not in bad:grouped[(q['venue'],q['symbol'])].append(q)
 for key,qs in grouped.items():qs.sort(key=lambda q:(q['at_ms'],q['received_at_ms']))
 times={k:[q['at_ms'] for q in v] for k,v in grouped.items()};rows=[]
 for k,(_,r) in sorted(unique.items(),key=lambda x:x[0][2]):
  if k in conflicts:continue
  f=r['feature'];t=f['asof_ms'];entry=f['last_quote'];target=t+horizon_seconds*1000
  result={'id':':'.join(map(str,k)),'venue':f['venue'],'symbol':f['symbol'],'issued_at_ms':t,'horizon_seconds':horizon_seconds,
   'source_session':r.get('session'),'hypotheses':hypotheses(f),'feature_window_complete':f.get('unbroken_window') is True,
   'entry_quote':{'bid':entry['bid'],'ask':entry['ask'],'at_ms':entry['at_ms']},'outcome':{'status':'PENDING' if asof_ms<target+tolerance_ms else 'UNMEASURED_QUOTE_GAP','target_ms':target}}
  key=(f['venue'],f['symbol']);qs=grouped[key];ts=times.get(key,[]);i=bisect.bisect_left(ts,target)
  if i<len(qs) and 0<=qs[i]['at_ms']-target<=tolerance_ms:
   q=qs[i];a=bisect.bisect_right(ts,t);path=qs[a:i+1]
   longs=[100*(x['bid']/entry['ask']-1) for x in path];shorts=[100*(entry['bid']-x['ask'])/entry['bid'] for x in path]
   ticks=[t]+[x['at_ms'] for x in path];gaps=[b-a for a,b in zip(ticks,ticks[1:])]
   result['outcome']={'status':'MEASURED_PUBLIC_QUOTE','target_ms':target,'provider_at_ms':q['at_ms'],'received_at_ms':q['received_at_ms'],'target_delay_ms':q['at_ms']-target,
     'exit_quote':{'bid':q['bid'],'ask':q['ask']},'mid_direction':sign((q['bid']+q['ask'])/(entry['bid']+entry['ask'])-1),
     'long_quote_return_pct':longs[-1],'short_quote_return_pct':shorts[-1],
     'long_max_adverse_pct':min(longs),'short_max_adverse_pct':min(shorts),
     'max_observed_gap_ms':max(gaps) if gaps else None,'path_quote_samples':len(path),
     'source_label':'FIRST_RETAINED_ORIGINAL_QUOTE_AT_OR_AFTER_TARGET','complete_path_verified':False,'actual_execution_verified':False}
  rows.append(result)
 return rows,diagnostics

def compare_policies(rows):
 out={}
 for policy in POLICIES:
  m={'eligible':len(rows),'measured':0,'correct':0,'wrong':0,'flat':0,'abstained':0,'unmeasured':0,'baseline_correct_same_cases':0,'always_up_correct_same_cases':0,'always_down_correct_same_cases':0,'entry_count':0,'mean_quote_return_pct':None,'mean_after_assumed_0_20pct_cost':None,'live_promotion_approved':False}
  returns=[];hours=set();syms=set()
  for r in rows:
   o=r['outcome'];p=r['hypotheses'][policy]
   if o['status']!='MEASURED_PUBLIC_QUOTE':m['unmeasured']+=1;continue
   if p is None:m['abstained']+=1;continue
   m['measured']+=1;truth=o['mid_direction'];m['flat' if truth==0 else 'correct' if truth==p else 'wrong']+=1
   m['baseline_correct_same_cases']+=int(truth!=0 and truth==r['hypotheses']['price_momentum'])
   m['always_up_correct_same_cases']+=int(truth==1);m['always_down_correct_same_cases']+=int(truth==-1)
   if r['venue']=='bitget' or p==1:
    m['entry_count']+=1;returns.append(o['long_quote_return_pct'] if p==1 else o['short_quote_return_pct'])
   hours.add(r['issued_at_ms']//3600000);syms.add(r['symbol'])
  if returns:m['mean_quote_return_pct']=sum(returns)/len(returns);m['mean_after_assumed_0_20pct_cost']=m['mean_quote_return_pct']-.2
  m['direction_accuracy_nonflat']=m['correct']/(m['correct']+m['wrong']) if m['correct']+m['wrong'] else None
  m['coverage']=m['measured']/len(rows) if rows else 0.;m['distinct_hours']=len(hours);m['distinct_symbols']=len(syms)
  out[policy]=m
 return out

def study(observations,quotes,asof):
 out={'version':VERSION,'asof_ms':asof,'comparison_scope':'V43_CANDIDATE_OBSERVATIONS_NOT_TELEGRAM_ACCURACY','sampling':'FIRST_OBSERVED_BOOK_PER_PROVIDER_SECOND','forecast_improvement_proven':False,'live_model_changed':False,'orders_sent':False,'telegram_sent':False,'horizons':{}}
 allrows=[]
 for h in (60,300):
  rows,diag=pair_observations(observations,quotes,asof,h);allrows.extend(rows)
  times=sorted({r['issued_at_ms'] for r in rows});cut=times[int(len(times)*.7)] if times else asof
  out['horizons'][str(h)]={'diagnostics':diag,'cutoff_ms':cut,'embargo_ms':300000,'venues':{}}
  for venue in ('bitget','bithumb'):
   own=[r for r in rows if r['venue']==venue];late=[r for r in own if r['issued_at_ms']>=cut+300000]
   out['horizons'][str(h)]['venues'][venue]={'all':compare_policies(own),'later_time_block':compare_policies(late),'earlier_time_block':compare_policies([r for r in own if r['issued_at_ms']<cut-300000])}
 return out,allrows

def ingest_session(folder):
 folder=Path(folder);s=json.loads((folder/'session.json').read_text());fs=folder/'frozen_features.jsonl.gz';raw=folder/'raw_frames.jsonl.gz'
 if s.get('version')!='V43_PUBLIC_CONTINUOUS_SESSION_V1' or s.get('orders_sent') is not False or s.get('telegram_sent') is not False:raise ValueError('SESSION_IDENTITY')
 for p,key in [(fs,'features_sha256'),(raw,'raw_sha256')]:
  if hashlib.sha256(p.read_bytes()).hexdigest()!=s.get(key):raise ValueError('SOURCE_HASH_MISMATCH')
 with gzip.open(fs,'rt') as f:features=[json.loads(l) for l in f if l.strip()]
 quotes={};malformed=0
 with gzip.open(raw,'rt') as f:
  for line in f:
   try:books=normalize_book(json.loads(line))
   except (ValueError,TypeError,KeyError,IndexError):malformed+=1;continue
   for q in books:
    key=(q['venue'],q['symbol'],q['at_ms']//1000)
    if key not in quotes or (q['at_ms'],q['received_at_ms'])<(quotes[key]['at_ms'],quotes[key]['received_at_ms']):quotes[key]=q
 return features,list(quotes.values()),{'session':s['session'],'started_at_ms':s['started_at_ms'],'ended_at_ms':s['ended_at_ms'],'frames':s['frames'],'raw_sha256':s['raw_sha256'],'features_sha256':s['features_sha256'],'malformed_book_frames':malformed,'source_errors':s.get('source_errors',{}),'frame_errors':s.get('frame_errors',{})}

def main():
 p=argparse.ArgumentParser();p.add_argument('--session-root',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 root=Path(a.session_root);folders=[root] if (root/'session.json').is_file() else sorted({x.parent for x in root.rglob('session.json')})
 if not folders:raise ValueError('NO_ORIGINAL_STREAM_SESSIONS')
 fs=[];qs=[];receipts=[]
 for folder in folders:
  f,q,r=ingest_session(folder);fs+=f;qs+=q;receipts.append(r)
 asof=max(r['ended_at_ms'] for r in receipts);report,rows=study(fs,qs,asof);report['source_sessions']=receipts
 out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2,allow_nan=False))
 with gzip.open(str(out)+'.pairs.jsonl.gz','wt') as f:
  for r in rows:f.write(json.dumps(r,allow_nan=False)+'\n')
 print('V44_FROZEN_FORWARD_COMPARISON',json.dumps({'sessions':len(receipts),'observations':len(fs),'quote_samples':len(qs),'horizons':{h:{v:{'price':d['all']['price_momentum'],'depth':d['all']['visible_depth'],'flow':d['all']['taker_flow']} for v,d in x['venues'].items()} for h,x in report['horizons'].items()},'live_model_changed':False},allow_nan=False))
if __name__=='__main__':main()
