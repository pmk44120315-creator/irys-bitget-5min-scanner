#!/usr/bin/env python3
"""V22 independent all-candidate, two-sided *prospective* direction evaluator.

Uses existing 5m GitHub runner and official public best quotes; no orders, no
Telegram or Cloudflare requests. Both long and short are scored against the
same later quote, so 'flip the losing V21' is tested rather than assumed.
Fallback observes authentic market-only candidates if the separate taker
collector is unavailable; missing taker/book remains explicitly UNKNOWN.
"""
from __future__ import annotations
import datetime as dt
import json
import math
import pathlib
import time

import collector
from v21_forecast_core import futures_features,spot_features,clip,number,logpos
from v21_runtime import (fetch_quotes,probabilities,verified_models,valid_quote,
                         _ms,load)
from research.v21_train_causal_models import context,spot_sample_features
from v22_direction_core import (EXPERTS,HORIZONS,MIN,expert_votes,prior_weights,
    choose,update_weights,evaluate_outcome,metrics,prequential_summary,finite)

BASE=pathlib.Path(__file__).resolve().parent
DATA=BASE/'data'
MODEL_PATH=BASE/'research/v21_results/models.json'
STATE_PATH=DATA/'v22_evidence_state.json'
REPORT_PATH=DATA/'v22_evidence_latest.json'
STORE_RESULTS=5000
CANDIDATE_OBSERVATION_BUDGET_FUTURES=18
CANDIDATE_OBSERVATION_BUDGET_SPOT=12

def build_candidates(market,flow,market_state,previous,now):
    observed=_ms(market.get('finished_utc'))
    if(market.get('collector_status')!='PASS' or observed is None or
       observed>now+MIN or now-observed>12*MIN):
        return [],previous,'MARKET_SOURCE_NOT_FRESH',0
    current={}
    for sym,r in (market.get('verified_crypto_futures_closed_prices') or {}).items():
        if not isinstance(r,dict):continue
        stamp=r.get('closed_end_ms');price=number(r.get('close_usdt'))
        if isinstance(stamp,int) and price and price>0 and stamp<=now:
            current[sym]=(stamp,price)
    ctx=context(current,previous)
    matched=(flow.get('status')=='PASS' and
        flow.get('source_finished_utc')==market.get('finished_utc') and
        (lambda at:at is not None and 0<=now-at<=12*MIN)(_ms(flow.get('at_utc'))))
    actual={}
    if matched:
        actual={o.get('symbol'):o for o in (flow.get('observations') or [])
                if isinstance(o,dict) and isinstance(o.get('symbol'),str)}
    contracts={}
    for item in list(market.get('early_pool') or [])+list(market.get('watchlist') or []):
        if not isinstance(item,dict) or item.get('venue')!='bitget' or
           item.get('asset_identity')!='VERIFIED_CRYPTO':continue
        symbol=item.get('symbol')
        if isinstance(symbol,str) and symbol.endswith('USDT'):
            contracts[symbol]=item
    ranked=[]
    for symbol,item in contracts.items():
        try:
            obs=actual.get(symbol) or {}
            f=futures_features(obs,item,now)
            f.update(ctx);f['relative_to_market']=clip(f['p5']-f['market_median5'])
        except (ValueError,TypeError,KeyError):continue
        # Budget official quotes, NOT signal eligibility: no 20-streak or
        # fixed turnover/price hard gate. Also watch first falling impulses.
        rank=(abs(f['acceleration'])+abs(f['p1'])+
              1.4*logpos(math.expm1(min(12,f['relative_volume5_log'])))+
              .4*abs(f['p5'])+.2*abs(f['relative_to_market']))
        if f.get('flow_verified'):rank+=1.0
        ranked.append({'symbol':symbol,'venue':'bitget','features':f,
            'real_taker_verified':bool(f['flow_verified']),
            'quote_research_rank':round(rank,6)})
    ranked.sort(key=lambda r:(-r['quote_research_rank'],r['symbol']))
    selected=ranked[:CANDIDATE_OBSERVATION_BUDGET_FUTURES]
    # Reuse separately verified taker observations even if they did not happen
    # to rank among largest price/turnover impulses.
    selected_symbols={r['symbol'] for r in selected}
    for r in ranked:
        if r['symbol'] in actual and r['symbol'] not in selected_symbols:
            selected.append(r);selected_symbols.add(r['symbol'])
    spot=[]
    for seed in (market.get('spot_flow') or {}).get('direction_review_seeds') or []:
        sym=seed.get('market')
        if not isinstance(sym,str) or not sym.startswith('KRW-'):continue
        try:
            f=spot_features(seed,ctx)
            f.update(spot_sample_features(market_state,sym,now))
            rank=abs(f['p5'])+1.2*max(0,f['turnover_log_change'])+
                .3*abs(f['relative_to_market'])
            spot.append({'symbol':sym,'venue':'bithumb','features':f,
                'real_taker_verified':False,'quote_research_rank':round(rank,6)})
        except (ValueError,TypeError,KeyError):continue
    spot.sort(key=lambda r:(-r['quote_research_rank'],r['symbol']))
    selected.extend(spot[:CANDIDATE_OBSERVATION_BUDGET_SPOT])
    return selected,current,'PASS' if matched else 'MARKET_PASS_FLOW_INDEPENDENTLY_UNAVAILABLE',len(ranked)+len(spot)

def _weights(state,venue,horizon):
    return prior_weights(((state.get('learning') or {}).get(venue+'_'+str(horizon))) or {})

def run(market,flow,market_state,old,raw_models,now,api):
    state=dict(old or {})
    rows,prices,source_status,eligible=build_candidates(
        market,flow,market_state,state.get('previous_prices') or {},now)
    if source_status=='MARKET_SOURCE_NOT_FRESH':
        return {'version':'IRYS_V22_COUNTERFACTUAL_FORWARD_V1',
          'status':source_status,'asof_ms':now,'candidate_count':0,
          'telegram_sent':False,'orders_sent':False},state
    state['previous_prices']=prices
    models,errors=verified_models(raw_models)
    existing=[dict(x) for x in state.get('pending') or [] if isinstance(x,dict)]
    observed_quotes,quote_errors=fetch_quotes(
        {(x['venue'],x['symbol']) for x in existing+rows},api,now)
    snapshot_now=max(now,int(time.time()*1000))
    weights={venue+'_'+str(h):_weights(state,venue,h)
             for venue in ('bitget','bithumb') for h in HORIZONS}
    new_results=[];still=[];unmeasured=0
    past=list(state.get('completed') or [])
    for row in existing:
        quote=observed_quotes.get((row['venue'],row['symbol']))
        outcomes=dict(row.get('outcomes') or {})
        for h in HORIZONS:
            if str(h) in outcomes:continue
            target=row['issued_ms']+h*MIN
            report=evaluate_outcome(row['entry_quote'],quote,row['issued_ms'],h,
                                    snapshot_now) if quote else None
            if report is not None:
                outcomes[str(h)]=report
                k=row['venue']+'_'+str(h)
                weights[k]=update_weights(weights[k],
                    row.get('votes',{}).get(str(h),{}),
                    report['signed_quote_returns'])
                new_results.append({'symbol':row['symbol'],'venue':row['venue'],
                     'issued_ms':row['issued_ms'],'horizon':h,
                     'long_net_pct':round(report['signed_quote_returns']['1']-.2,5),
                     'short_net_pct':round(report['signed_quote_returns']['-1']-.2,5)
                         if row['venue']=='bitget' else None,
                     'both_sides_quote_proxy':True})
            elif snapshot_now>target+150_000:
                outcomes[str(h)]={'status':'UNMEASURED_AFTER_TARGET',
                    'target_ms':target}
                unmeasured+=1
        row['outcomes']=outcomes
        if all(str(h) in outcomes for h in HORIZONS):
            past.append(row)
        else:still.append(row)
    # State at the beginning of this loop reflects ONLY earlier real prices.
    # Newly finished results have just been learned; candidates from this
    # run are stamped afterwards. No labels from their own future can leak.
    last_seen=dict(state.get('last_seen') or {})
    fresh=[];skipped_duplicate=0
    for r in rows:
        identity=r['venue']+':'+r['symbol']
        previous=last_seen.get(identity)
        if isinstance(previous,int) and snapshot_now-previous<2*MIN:
            skipped_duplicate+=1;continue
        q=observed_quotes.get((r['venue'],r['symbol']))
        if not valid_quote(q) or q['at_ms']>snapshot_now or snapshot_now-q['at_ms']>MIN:
            continue
        decisions={};votes_by_h={}
        for h in HORIZONS:
            key=r['venue']+'_'+str(h)
            frozen=models.get(key)
            p=None
            if frozen and frozen['venue']==r['venue'] and
                frozen['horizon_min']==h:
                p=probabilities(frozen['model'],r['features'])
                p={'up':p.get(1,0),'down':p.get(-1,0)}
            votes=expert_votes(r['features'],p)
            votes_by_h[str(h)]=votes
            decisions[str(h)]=choose(votes,weights[key])
        event={'issued_ms':snapshot_now,'symbol':r['symbol'],'venue':r['venue'],
           'features':r['features'],'rank':r['quote_research_rank'],
           'real_taker_verified':r['real_taker_verified'],
           'entry_quote':q,'votes':votes_by_h,'decisions':decisions,
           'outcomes':{},'shadow_only':True}
        still.append(event);last_seen[identity]=snapshot_now
        fresh.append({'venue':r['venue'],'symbol':r['symbol'],
            'direction_hypothesis_5m':decisions['5']['direction'],
            'direction_hypothesis_15m':decisions['15']['direction'],
            'strength_not_probability':decisions['5']['ensemble_score_not_probability'],
            'real_taker_verified':r['real_taker_verified'],
            'telegram_sent':False,'order_allowed':False})
    past=past[-STORE_RESULTS:]
    still=still[-200:]
    state.update({'pending':still,'completed':past,'last_seen':last_seen,
       'learning':{key:{'log_weights':value} for key,value in weights.items()}})
    summary={}
    for venue in ('bitget','bithumb'):
        for h in HORIZONS:
            key=venue+'_'+str(h)
            done=[x for x in past+still if x.get('venue')==venue and
                str(h) in x.get('outcomes',{}) and
                x['outcomes'][str(h)].get('both_sides_measured')]
            summary[key]={
               'long':metrics(done,h,venue,1),
               'short':metrics(done,h,venue,-1) if venue=='bitget' else None,
               'fixed_experts':prequential_summary(done,h,venue),
               'model_weights':weights[key],
               'forward_outcomes':len(done),
            }
    report={'version':'IRYS_V22_COUNTERFACTUAL_FORWARD_V1',
       'asof_utc':dt.datetime.fromtimestamp(snapshot_now/1000,dt.timezone.utc).isoformat(),
       'source_finished_utc':market.get('finished_utc'),
       'source_status':source_status,
       'status':'RESEARCH_ACTIVE' if not errors and not quote_errors else 'RESEARCH_PARTIAL',
       'model_integrity_errors':errors,'quote_errors':quote_errors,
       'eligible_candidates':eligible,'selected_for_quote_research':len(rows),
       'quotes_available':len(observed_quotes),
       'new_events':len(fresh),'newly_completed_quotes':len(new_results),
       'new_unmeasured_labels':unmeasured,'pending_events':len(still),
       'completed_events':len(past),'skipped_duplicate_observations':skipped_duplicate,
       'new_forecasts_shadow_only':fresh[:25],
       'forward_skill_by_venue_and_horizon':summary,
       'independent_baseline_strategies_predeclared':list(EXPERTS),
       'actual_execution_verified':False,'future_accuracy_improvement_proven':False,
       'telegram_sent':False,'orders_sent':False}
    return report,state

def main():
    now=int(time.time()*1000)
    report,state=run(load(DATA/'latest.json'),load(DATA/'v18_evidence_latest.json'),
       load(DATA/'state.json'),load(STATE_PATH),load(MODEL_PATH),now,collector.http_json)
    collector.write_json_atomic(REPORT_PATH,report)
    if report['status'] in ('RESEARCH_ACTIVE','RESEARCH_PARTIAL'):
        collector.write_json_atomic(STATE_PATH,state)
    print('IRYS_V22_LIVE_COUNTERFACTUAL',json.dumps({k:report.get(k) for k in
        ('status','source_status','eligible_candidates','selected_for_quote_research',
         'new_events','newly_completed_quotes','new_unmeasured_labels',
         'pending_events','completed_events','quotes_available')},ensure_ascii=False))
    return 0 if report['status']=='RESEARCH_ACTIVE' else 2

if __name__=='__main__':
    raise SystemExit(main())
