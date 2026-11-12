"""Causal raw-packet feature recovery. Public-market GETs only; no trading or alerts.
Keep sparse tape missing instead of erasing otherwise valid price observations.
Price-direction and quote-to-close profitability proxies are different targets.
"""
import argparse, concurrent.futures, datetime as dt, hashlib, json, math, os, time
import urllib.parse, urllib.request
from pathlib import Path
REPO='pmk44120315-creator/irys-bitget-5min-scanner'
MIN=60000

def finite(v):
    return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)

def quote(q, at):
    if not isinstance(q,dict) or not all(finite(q.get(k)) for k in ('bid','ask','at_ms')):
        raise ValueError('QUOTE_MISSING')
    if q['bid']<=0 or q['ask']<q['bid'] or not isinstance(q['at_ms'],int) or not 0<=at-q['at_ms']<=45000:
        raise ValueError('QUOTE_CLOCK_OR_VALUE')
    return (q['bid']+q['ask'])/2,100*(q['ask']/q['bid']-1)

def tape(raw, venue, after, before, exclude=()):
    seen={}; excluded=set(exclude)
    for t in raw or []:
        if not isinstance(t,dict) or not all(finite(t.get(k)) for k in ('at_ms','price','size')):continue
        if not after<t['at_ms']<=before or t['price']<=0 or t['size']<=0 or t.get('side') not in ('BUY','SELL'):continue
        fp=(t['at_ms'],t['price'],t['size'],t['side'])
        key=str(t.get('id')) if venue=='bitget' and t.get('id') else repr(fp)
        if key in excluded:continue
        if key in seen and seen[key]!=fp:raise ValueError('CONFLICTING_TRADE_ID')
        seen[key]=fp
    rows=sorted(seen.values()); total=sum(p*s for ts,p,s,side in rows)
    if not total:return {'share':None,'count':0,'notional':0.,'response':None,'duration':0.,'ids':set()}
    buy=sum(p*s for ts,p,s,side in rows if side=='BUY')
    # Aggregate equal timestamp trades; their within-ms ordering is not observable.
    buckets={}
    for ts,p,s,side in rows:
        q=p*s;v=buckets.setdefault(ts,[0.,0.]);v[0]+=q;v[1]+=q*p
    used=early=late=0.
    for ts,(q,qp) in sorted(buckets.items()):
        take=min(q,max(0,total/2-used));early+=take*qp/q;late+=(q-take)*qp/q;used+=q
    response=100*(late/early-1) if len(buckets)>=2 and early>0 else None
    return {'share':buy/total,'count':len(rows),'notional':total,'response':response,
            'duration':(rows[-1][0]-rows[0][0])/1000,'ids':set(seen)}

def features(e,x):
    now=e.get('issued_at_ms'); c=x.get('candidate',{})
    if e.get('time_basis')!='ACTUAL_EVALUATOR_DECISION_CLOCK' or not isinstance(now,int):raise ValueError('UNVERIFIED_CLOCK')
    if c.get('venue')!=e.get('venue') or c.get('symbol')!=e.get('symbol') or c.get('direction')!=e.get('direction'):
        raise ValueError('IDENTITY_MISMATCH')
    venue=e['venue'];direction=e['direction']
    if venue not in ('bitget','bithumb') or direction not in (('BUY',) if venue=='bithumb' else ('LONG','SHORT')):raise ValueError('INVALID_DIRECTION')
    a,b,f=[x.get(k,{}) for k in ('first','second','final')]
    ats=[r.get('observed_at_ms') for r in (a,b,f)]
    if not all(isinstance(t,int) for t in ats) or not ats[0]<ats[1]<=ats[2]<=now:raise ValueError('SOURCE_CLOCK')
    for r in (a,b,f):
        if r.get('venue')!=venue or r.get('symbol')!=e['symbol']:raise ValueError('SNAPSHOT_IDENTITY')
    m1,s1=quote(a.get('quote'),ats[0]);m2,s2=quote(b.get('quote'),ats[1]);m3,s3=quote(f.get('quote'),now)
    if f['quote']['at_ms']!=e.get('source_quote_at_ms') or any(f['quote'][k]!=e.get('original_'+k) for k in ('bid','ask')):
        raise ValueError('FROZEN_QUOTE_MISMATCH')
    first=tape(a.get('trades'),venue,ats[0]-MIN,ats[0])
    fresh=tape(b.get('trades'),venue,ats[0],ats[1],first['ids'])
    r12=100*(m2/m1-1);r23=100*(m3/m2-1)
    share1,share2=first['share'],fresh['share']
    prior=c.get('change_pct'); anchor=c.get('anchor_price'); discovery=c.get('discovery_price')
    safe=lambda v:float(v) if finite(v) else None
    return {
      'candidate_side':-1. if direction=='SHORT' else 1.,
      'preselection_return_pct':safe(prior),
      'anchor_to_final_mid_pct':100*(m3/anchor-1) if finite(anchor) and anchor>0 else None,
      'discovery_to_final_mid_pct':100*(m3/discovery-1) if finite(discovery) and discovery>0 else None,
      'quote_progress_pct':100*(m3/m1-1),'first_to_second_pct':r12,'second_to_final_pct':r23,
      'quote_velocity_first':r12/((ats[1]-ats[0])/1000),
      'quote_velocity_last':r23/max(.001,(ats[2]-ats[1])/1000),
      'spread_pct':s3,'spread_change_pct':s3-s1,
      'buy_share_first':share1,'buy_share_new':share2,
      'pressure_change':share2-share1 if share1 is not None and share2 is not None else None,
      'first_trade_count':first['count'],'new_trade_count':fresh['count'],
      'first_trade_response_pct':first['response'],'new_trade_response_pct':fresh['response'],
      'first_trade_notional_log':math.log1p(first['notional']),
      'new_trade_notional_log':math.log1p(fresh['notional']),
      'first_trade_span_seconds':first['duration'],'new_trade_span_seconds':fresh['duration'],
      'decision_latency_seconds':(now-ats[2])/1000,
      'sample_gap_seconds':(ats[1]-ats[0])/1000,
      'risk_range_pct':100*e['risk_price']/m3 if finite(e.get('risk_price')) else None,
    }

def labels(e,h,asof):
    lab=e.get('direction_outcomes',{}).get(str(h),{})
    t=e.get('issued_at_ms');bid=e.get('original_bid');ask=e.get('original_ask');entry=e.get('entry_price')
    if not isinstance(t,int) or not all(finite(v) for v in (bid,ask,entry)) or bid<=0 or ask<bid:return None
    target=t+h*MIN;close=lab.get('target_close')
    version='V48_CLOSED_MINUTE_AT_OR_AFTER_TARGET_V1'
    ev=e.get('direction_measurement_version');lv=lab.get('measurement_version')
    if ev==version and lv==version:close_at=((target+MIN-1)//MIN)*MIN;semantics=version
    elif ev is None and lv is None:close_at=target//MIN*MIN;semantics='LEGACY_BEFORE_TARGET'
    else:return None
    if close_at>asof:return None
    if asof<target or lab.get('status')!='MEASURED_DIRECTION' or lab.get('actual_execution_verified') is not False:return None
    if lab.get('target_ms')!=target or lab.get('close_at_ms')!=close_at or lab.get('horizon_minutes')!=h:return None
    if lab.get('entry_quote_reference')!=entry or entry!=(bid if e.get('direction')=='SHORT' else ask):return None
    if not finite(close) or close<=0:return None
    mid=(bid+ask)/2;ret=100*(close/mid-1)
    return {'direction':1 if ret>1e-10 else -1 if ret< -1e-10 else 0,
      'mid_to_closed_trade_bar_pct':ret,'long_quote_proxy_pct':100*(close/ask-1),
      'short_quote_proxy_pct':100*(bid-close)/bid,'label_available_ms':target+MIN,
      'target_ms':target,'close_at_ms':close_at,'measurement_version':semantics,'actual_execution_verified':False}

def time_split(rows,embargo_minutes=60):
    unique=sorted({r['issued_at_ms'] for r in rows})
    if len(unique)<5:raise ValueError('INSUFFICIENT_DISTINCT_TIME_BLOCKS')
    a=unique[int(.6*len(unique))];b=unique[int(.8*len(unique))];gap=embargo_minutes*MIN
    out={'train':[],'validation':[],'test':[],'cut_validation_ms':a,'cut_test_ms':b,'embargo_minutes':embargo_minutes}
    for i,r in enumerate(rows):
        t=r['issued_at_ms'];av=r['label_available_ms']
        if t<a-gap and av<a:out['train'].append(i)
        elif a<=t<b-gap and av<b:out['validation'].append(i)
        elif t>=b:out['test'].append(i)
    return out

def collect(state_path,out_path):
    state_bytes=Path(state_path).read_bytes();state=json.loads(state_bytes)
    events=[e for e in state['events'] if e.get('time_basis')=='ACTUAL_EVALUATOR_DECISION_CLOCK']
    if not events:raise ValueError('NO_VERIFIED_EVENTS')
    earliest=min(e['issued_at_ms'] for e in events);latest=max(e['issued_at_ms'] for e in events)
    iso=lambda x:dt.datetime.fromtimestamp(x/1000,dt.timezone.utc).isoformat()
    token=os.environ.get('GITHUB_TOKEN');base='https://api.github.com/repos/'+REPO
    def get(url):
        headers={'User-Agent':'IRYS-causal-feature-recovery','Accept':'application/json'}
        if token and url.startswith(base+'/'):headers['Authorization']='Bearer '+token
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as r:data=r.read()
        return json.loads(data),hashlib.sha256(data).hexdigest()
    commits=[];page=1
    while True:
        qs=urllib.parse.urlencode({'path':'data/v30_direction_latest.json','since':iso(earliest-15*MIN),'until':iso(latest),'per_page':100,'page':page})
        batch,_=get(base+'/commits?'+qs)
        if not isinstance(batch,list):raise ValueError('COMMIT_LIST_SCHEMA')
        commits+=batch
        if len(batch)<100:break
        page+=1
    by_time={}
    for e in events:by_time.setdefault(e.get('created_from_public_packet_at_ms'),[]).append(e)
    records={};errors=[];receipts=[]
    def packet(c):
        sha=c['sha'];published=int(dt.datetime.fromisoformat(c['commit']['committer']['date'].replace('Z','+00:00')).timestamp()*1000)
        try:
            doc,digest=get('https://raw.githubusercontent.com/'+REPO+'/'+sha+'/data/v30_direction_latest.json')
            es=by_time.get(doc.get('at_ms'),[]);found=[]
            if doc.get('source')!='OFFICIAL_PUBLIC_RUNNER' or doc.get('orders_sent') is not False or doc.get('telegram_sent') is not False:return [],None,None
            for e in es:
                if published>e['issued_at_ms'] or doc.get('model_digest')!=e.get('baseline_model_digest'):continue
                matches=[x for x in doc.get('items',[]) if all(x.get('candidate',{}).get(k)==e.get(k) for k in ('venue','symbol','direction'))]
                if len(matches)!=1:continue
                try:f=features(e,matches[0])
                except ValueError as exc:continue
                found.append({'id':e['id'],'venue':e['venue'],'symbol':e['symbol'],'issued_at_ms':e['issued_at_ms'],
                 'source_observed_at_ms':doc['at_ms'],'source_commit':sha,'source_commit_time_ms':published,'raw_packet_sha256':digest,'features':f})
            return found,{'sha':sha,'packet_sha256':digest,'packet_at_ms':doc.get('at_ms'),'matched':len(found)},None
        except Exception as exc:return [],None,{'sha':sha,'error':type(exc).__name__}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for found,receipt,error in pool.map(packet,commits):
            if receipt:receipts.append(receipt)
            if error:errors.append(error)
            for r in found:
                if r['id'] not in records or r['source_commit_time_ms']<records[r['id']]['source_commit_time_ms']:records[r['id']]=r
    out={'version':'V40_FROZEN_ORIGINAL_PACKET_FEATURES_V1','created_at_ms':int(time.time()*1000),
      'state_sha256':hashlib.sha256(state_bytes).hexdigest(),'eligible_events':len(events),'recovered':len(records),
      'missing_event_ids':sorted(set(e['id'] for e in events)-set(records)),'errors':errors,'source_receipts':receipts,
      'records':sorted(records.values(),key=lambda r:(r['issued_at_ms'],r['id'])),'live_model_changed':False}
    Path(out_path).parent.mkdir(parents=True,exist_ok=True);Path(out_path).write_text(json.dumps(out,allow_nan=False))
    print('V40_FROZEN_FEATURE_RECOVERY',json.dumps({k:out[k] for k in ('eligible_events','recovered','errors','state_sha256')}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--out',required=True);a=p.parse_args();collect(a.state,a.out)
