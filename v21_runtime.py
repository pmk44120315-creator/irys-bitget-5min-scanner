"""V21 frozen-model market forecaster and independent forward-validation ledger.
Uses public quotes only. NO Telegram/Cloudflare/account/order credentials.
Historical success alone never unlocks a message. Future quote-based evidence
is separated by frozen model, venue, side and horizon. Quotes are not fills.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import math
import pathlib
import time
from v21_forecast_core import (number, futures_features, spot_features,
    evaluate_predictions, clip)

MIN=60000
ROOT=pathlib.Path(__file__).resolve().parent
DATA=ROOT/'data'
MODELS=ROOT/'research/v21_results/models.json'
COST_SCENARIO=.20  # assumed round-trip costs beyond quote spread, not actual account fees


def probabilities(model, features):
    names=model['features'];classes=[int(x) for x in model['classes']]
    x=[number(features.get(k),0.0) for k in names]
    if model['kind']=='forest':
        scores=[0.0]*len(classes);trees=model['trees']
        if not trees:raise ValueError('EMPTY_FOREST')
        for tree in trees:
            node=0;visited=set()
            while tree['left'][node]!=-1:
                if node in visited:raise ValueError('TREE_CYCLE')
                visited.add(node);feature=tree['feature'][node]
                if not 0<=feature<len(x):raise ValueError('TREE_FEATURE_INDEX')
                node=tree['left'][node] if x[feature]<=tree['threshold'][node] else tree['right'][node]
            values=tree['value'][node];total=sum(values)
            if total<=0 or len(values)!=len(classes):raise ValueError('INVALID_LEAF')
            for k,v in enumerate(values):scores[k]+=v/total/len(trees)
        return dict(zip(classes,scores))
    if model['kind']!='logistic':raise ValueError('UNKNOWN_MODEL')
    z=[(v-model['mean'][i])/model['scale'][i] for i,v in enumerate(x)]
    logits=[bias+sum(a*b for a,b in zip(weights,z))
        for weights,bias in zip(model['coef'],model['intercept'])]
    if len(classes)==2 and len(logits)==1:
        p=1/(1+math.exp(-max(-35,min(35,logits[0]))))
        return {classes[0]:1-p,classes[1]:p}
    if len(logits)!=len(classes):raise ValueError('LOGISTIC_CLASS_DIMENSION')
    peak=max(logits);exp=[math.exp(v-peak) for v in logits];total=sum(exp)
    return {k:v/total for k,v in zip(classes,exp)}


def research_reason(payload):
    r=payload.get('research_metrics') or {};v=r.get('validation') or {}
    t=(r.get('test_cost_scenarios') or {}).get('0.2') or {}
    if v.get('signals',0)<2 or v.get('hour_blocks',0)<2:
        return 'VALIDATION_UNCERTAINTY_UNESTIMABLE'
    if number(v.get('mean_net_pct'),-1)<=0:return 'VALIDATION_NET_LOSS'
    if t.get('signals',0)<2 or number(t.get('mean_net_pct'),-1)<=0:
        return 'HELDOUT_NET_ADVANTAGE_NOT_OBSERVED'
    return 'PROSPECTIVE_VALIDATION_REQUIRED'


def valid_quote(q):
    if not isinstance(q,dict):return False
    bid=number(q.get('bid'));ask=number(q.get('ask'));at=q.get('at_ms')
    return bid is not None and ask is not None and bid>0 and ask>=bid and isinstance(at,int)


def quote_return(entry, exit, side):
    if not valid_quote(entry) or not valid_quote(exit) or side not in (-1,1):
        raise ValueError('INVALID_QUOTE_OR_SIDE')
    if side==1:return 100*(exit['bid']/entry['ask']-1)
    return 100*(entry['bid']-exit['ask'])/entry['bid']


def finish_record(record, quote, now):
    if not valid_quote(quote):return None
    target=record['issued_ms']+record['horizon_min']*MIN;stamp=quote['at_ms']
    if stamp<target or stamp>target+150000 or stamp>now or now-stamp>MIN:return None
    signed=quote_return(record['entry_quote'],quote,record['side'])
    return {'model_key':record['model_key'],'model_sha256':record.get('model_sha256'),
        'symbol':record['symbol'],'venue':record.get('venue','bitget'),
        'side':record['side'],'issued_ms':record['issued_ms'],
        'closed_ms':stamp,'horizon_min':record['horizon_min'],
        'ret':signed*record['side'],'signed_quote_return_pct':signed,
        'quote_based_not_execution':True,'target_delay_ms':stamp-target,
        'entry_quote':record['entry_quote'],'exit_quote':quote}


def certificate(rows, venue, horizon, side, unmeasured=0):
    own=[r for r in rows if r.get('side')==side]
    metric=evaluate_predictions(own,COST_SCENARIO,venue,horizon)
    lower=metric['hour_block_bootstrap_lower_95_pct']
    times=sorted({r['issued_ms'] for r in own})
    span=(times[-1]-times[0])/3600000 if len(times)>1 else 0
    reason='INSUFFICIENT_INDEPENDENT_FORWARD_EVIDENCE';ready=False
    if span>=24 and metric['hour_blocks']>=8 and lower is not None:
        reason='FORWARD_NET_ADVANTAGE_NOT_SUPPORTED'
        midpoint=times[len(times)//2]
        recent=evaluate_predictions([r for r in own if r['issued_ms']>=midpoint],COST_SCENARIO,venue,horizon)
        if lower>0 and number(recent['mean_net_pct'],-1)>0:
            ready=True;reason='POSITIVE_PROSPECTIVE_QUOTE_EVIDENCE'
    missing=max(0,int(unmeasured))
    total=metric['signals']+missing
    coverage=metric['signals']/total if total else 0.0
    if missing and coverage<.95:
        ready=False;reason='FORWARD_OUTCOME_COVERAGE_INSUFFICIENT'
    if venue=='bithumb' and side!=1:ready=False;reason='SPOT_SHORT_NOT_ACTIONABLE'
    return {'ready':ready,'reason':reason,'lower_net_pct':lower,
        'span_hours':span,'observed_signals':metric['signals'],
        'coverage_ratio':coverage,'unmeasured_outcomes':missing,
        'mean_net_pct':metric['mean_net_pct'],'hour_blocks':metric['hour_blocks'],
        'net_wins':metric['net_wins'],'net_losses':metric['net_losses'],
        'cost_scenario_pct':COST_SCENARIO,
        'evidence_type':'FROZEN_MODEL_PROSPECTIVE_QUOTE_RETURNS',
        'actual_execution_verified':False}


def load(path):
    try:
        d=json.loads(path.read_text(encoding='utf8'))
        return d if isinstance(d,dict) else {}
    except FileNotFoundError:return {}


def verified_models(raw):
    out={};errors={}
    if not isinstance(raw,dict) or not raw:return {},{'models':'MISSING_MODEL_BUNDLE'}
    for key,p in raw.items():
        try:
            if p.get('schema')!='IRYS_V21_SUPERVISED_MODEL_V1' or not p.get('frozen_before_test'):
                raise ValueError('MODEL_SCHEMA')
            sha=hashlib.sha256(json.dumps(p['model'],sort_keys=True).encode()).hexdigest()
            if sha!=p.get('model_sha256'):raise ValueError('MODEL_HASH')
            if p['venue'] not in ('bitget','bithumb') or p['horizon_min'] not in (5,15):
                raise ValueError('VENUE_OR_HORIZON')
            out[key]=p
        except (ValueError,KeyError,TypeError) as exc:errors[key]=str(exc)
    return out,errors


def fetch_quotes(pairs,api,now):
    result={};failures=[];bitget={sym for venue,sym in pairs if venue=='bitget'}
    if bitget:
        try:
            ticks=api('bitget','/api/v2/mix/market/tickers',{'productType':'USDT-FUTURES'})
            received=max(now,int(time.time()*1000))
            for r in ticks if isinstance(ticks,list) else []:
                sym=r.get('symbol')
                if sym not in bitget:continue
                ts=number(r.get('ts'));bid=number(r.get('bidPr'));ask=number(r.get('askPr'))
                q={'at_ms':int(ts) if ts is not None else 0,'bid':bid,'ask':ask,
                    'source':'BITGET_OFFICIAL_PUBLIC_BEST_QUOTES'}
                if valid_quote(q) and 0<=received-q['at_ms']<=MIN:result[('bitget',sym)]=q
        except Exception as exc:failures.append('BITGET_QUOTES_'+type(exc).__name__)
    symbols=sorted({sym for venue,sym in pairs if venue=='bithumb'})
    for start in range(0,len(symbols),80):
        try:
            rows=api('bithumb','/v1/orderbook',{'markets':','.join(symbols[start:start+80])})
            received=max(now,int(time.time()*1000))
            for r in rows if isinstance(rows,list) else []:
                units=r.get('orderbook_units') or []
                if not units:continue
                u=units[0];ts=number(r.get('timestamp'))
                q={'at_ms':int(ts) if ts is not None else 0,'bid':number(u.get('bid_price')),
                    'ask':number(u.get('ask_price')),'source':'BITHUMB_OFFICIAL_PUBLIC_BEST_QUOTES'}
                if valid_quote(q) and 0<=received-q['at_ms']<=MIN:result[('bithumb',r.get('market'))]=q
        except Exception as exc:failures.append('BITHUMB_QUOTES_'+type(exc).__name__)
    return result,failures


def current_features(market,flow,market_state,previous,now):
    from research.v21_train_causal_models import context,spot_sample_features
    source_ms=_ms(market.get('finished_utc'));observed_ms=_ms(flow.get('at_utc'))
    if (market.get('collector_status')!='PASS' or flow.get('status')!='PASS'
        or source_ms is None or observed_ms is None or source_ms>now or observed_ms>now
        or now-source_ms>12*MIN or now-observed_ms>12*MIN
        or flow.get('source_finished_utc')!=market.get('finished_utc')):
        return [],previous,'CURRENT_SOURCE_NOT_MATCHED_FRESH'
    prices={}
    for sym,r in (market.get('verified_crypto_futures_closed_prices') or {}).items():
        if isinstance(r,dict) and isinstance(r.get('closed_end_ms'),int) and number(r.get('close_usdt'),0)>0:
            prices[sym]=(r['closed_end_ms'],float(r['close_usdt']))
    ctx=context(prices,previous)
    items={r.get('symbol'):r for r in list(market.get('early_pool') or [])+list(market.get('watchlist') or [])
      if isinstance(r,dict) and r.get('asset_identity')=='VERIFIED_CRYPTO' and r.get('venue')=='bitget'}
    rows=[]
    for obs in flow.get('observations') or []:
        item=items.get(obs.get('symbol'))
        if not item:continue
        try:
            f=futures_features(obs,item,observed_ms)
            f.update(ctx);f['relative_to_market']=clip(f['p5']-f['market_median5'])
            rows.append({'symbol':obs['symbol'],'venue':'bitget','features':f})
        except (ValueError,TypeError):continue
    for seed in (market.get('spot_flow') or {}).get('direction_review_seeds') or []:
        sym=seed.get('market')
        if not isinstance(sym,str) or not sym.startswith('KRW-'):continue
        try:
            f=spot_features(seed,ctx);f.update(spot_sample_features(market_state,sym,source_ms))
            rows.append({'symbol':sym,'venue':'bithumb','features':f})
        except (ValueError,TypeError):continue
    return rows,prices,'PASS'


def _ms(s):
    try:return int(dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).timestamp()*1000)
    except (ValueError,TypeError):return None


def run(market,flow,market_state,old,models,now,api):
    state=dict(old or {});active,model_errors=verified_models(models)
    model_status={key:research_reason(p) for key,p in active.items()}
    features,previous,source_status=current_features(market,flow,market_state,state.get('previous_prices') or {},now)
    if source_status=='PASS':state['previous_prices']=previous
    pending=[dict(r) for r in state.get('pending',[]) if isinstance(r,dict)]
    completed=[dict(r) for r in state.get('completed',[]) if isinstance(r,dict)]
    unmeasured=[dict(r) for r in state.get('unmeasured',[]) if isinstance(r,dict)]
    proposals=[]
    for obs in features:
        for key,p in active.items():
            if p['venue']!=obs['venue'] or model_status[key]!='PROSPECTIVE_VALIDATION_REQUIRED':continue
            ps=probabilities(p['model'],obs['features']);up=ps.get(1,0);down=ps.get(-1,0)
            side=1 if up>=p['threshold'] and up>down else (-1 if obs['venue']=='bitget' and down>=p['threshold'] and down>up else 0)
            if not side:continue
            proposals.append({**obs,'model_key':key,'model_sha256':p['model_sha256'],
                'side':side,'horizon_min':p['horizon_min'],
                'model_score_not_calibrated_win_probability':max(up,down)})
    pairs={(r['venue'],r['symbol']) for r in pending+proposals}
    quotes,quote_errors=fetch_quotes(pairs,api,now)
    finished_now=max(now,int(time.time()*1000))
    remaining=[];new_outcomes=[];expired=0
    for r in pending:
        q=quotes.get((r['venue'],r['symbol']))
        result=finish_record(r,q,finished_now) if q else None
        if result is not None:
            completed.append(result);new_outcomes.append(result)
        elif finished_now>r['issued_ms']+r['horizon_min']*MIN+150000:
            expired+=1
            unmeasured.append({k:r.get(k) for k in ('model_key','model_sha256','symbol','side','issued_ms')})
        else:remaining.append(r)
    completed=completed[-4000:];unmeasured=unmeasured[-4000:];certificates={}
    for key,p in active.items():
        own=[r for r in completed if r.get('model_sha256')==p['model_sha256']
          and r.get('model_key')==key and r['issued_ms']>=p['prospective_validation_start_ms']]
        certificates[key]={str(side):certificate(own,p['venue'],p['horizon_min'],side,
            unmeasured=sum(1 for r in unmeasured if r.get('model_key')==key
                and r.get('model_sha256')==p['model_sha256'] and r.get('side')==side
                and (r.get('issued_ms') or 0)>=p['prospective_validation_start_ms']))
            for side in ((1,-1) if p['venue']=='bitget' else (1,))}
    seen=state.get('last_registered') or {};forecasts=[];deliverable=[]
    open_ids={(r['model_key'],r['symbol']) for r in remaining}
    for obs in proposals:
        key=obs['model_key'];symbol=obs['symbol'];q=quotes.get((obs['venue'],symbol))
        identity=key+':'+symbol
        if (key,symbol) in open_ids or finished_now-number(seen.get(identity),0)<obs['horizon_min']*MIN:continue
        if not q or not valid_quote(q) or not 0<=finished_now-q['at_ms']<=MIN:continue
        issued=finished_now
        event_id=hashlib.sha256((obs['model_sha256']+':'+symbol+':'+str(issued)).encode()).hexdigest()[:24]
        row={k:v for k,v in obs.items() if k!='features'}
        row.update({'issued_ms':issued,'entry_quote':q,'event_id':event_id})
        remaining.append(row);open_ids.add((key,symbol));seen[identity]=issued
        proof=certificates[key][str(obs['side'])]
        message={**row,'expires_ms':issued+obs['horizon_min']*MIN,
            'certificate':proof,'notification_eligible':proof['ready'],
            'reason':proof['reason'],'automatic_order':False,'telegram_sent':False}
        forecasts.append(message)
        if proof['ready']:deliverable.append(message)
    state.update({'pending':remaining,'completed':completed,'unmeasured':unmeasured,'last_registered':seen,
        'expired_quote_targets_total':state.get('expired_quote_targets_total',0)+expired})
    status=('MODEL_INTEGRITY_FAILURE' if model_errors else 'SOURCE_UNAVAILABLE' if source_status!='PASS'
            else 'QUOTE_FEED_UNAVAILABLE' if pairs and not quotes else 'ACTIVE')
    report={'version':'IRYS_V21_SUPERVISED_PROSPECTIVE_V1','status':status,
      'at_utc':dt.datetime.fromtimestamp(finished_now/1000,dt.timezone.utc).isoformat(),
      'source_finished_utc':market.get('finished_utc'),'source_status':source_status,
      'model_status':model_status,'model_integrity_errors':model_errors,
      'quote_errors':quote_errors,'quote_markets_available':len(quotes),
      'forecast_count':len(forecasts),'forecasts':forecasts,
      'pending_count':len(remaining),'new_outcomes':len(new_outcomes),
      'completed_quote_outcomes':len(completed),'expired_targets_this_run':expired,
      'unmeasured_quote_targets':len(unmeasured),
      'certificates':certificates,'delivery_candidates':deliverable,
      'delivery_mode':'MEASURED_PROSPECTIVE_EVIDENCE_NOT_PERMANENT_FALSE',
      'cost_scenario_pct':COST_SCENARIO,'actual_trade_execution_verified':False,
      'no_orders':True,'telegram_sent':False}
    return report,state


def main():
    import collector
    now=int(time.time()*1000)
    report,state=run(load(DATA/'latest.json'),load(DATA/'v18_evidence_latest.json'),
       load(DATA/'state.json'),load(DATA/'v21_state.json'),load(MODELS),now,collector.http_json)
    collector.write_json_atomic(DATA/'v21_latest.json',report)
    collector.write_json_atomic(DATA/'v21_state.json',state)
    print('V21_RUNTIME',json.dumps({k:report[k] for k in ('status','source_status','model_status',
       'quote_errors','forecast_count','pending_count','new_outcomes','completed_quote_outcomes')},ensure_ascii=False))
    return 0 if report['status']=='ACTIVE' else 2

if __name__=='__main__':raise SystemExit(main())
