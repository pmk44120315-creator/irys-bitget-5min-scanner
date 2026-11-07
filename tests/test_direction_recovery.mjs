import test from 'node:test';
import assert from 'node:assert/strict';
import {v37LabelEvents} from '../deployment/v37_early.mjs';
import {v37RunCycle,v37Stats} from '../deployment/v37_runner.mjs';
import {v36Summary} from '../deployment/v36_shadow.mjs';
const T=1794000000000,STEP=300000;
test('V37 second native labeling preserves futures history across actual JSON save/restart boundary',()=>{
 const old={events:[],futuresHistory:{AAAUSDT:[[T,100,1000]]},last_source_at_ms:T};
 const next=v37LabelEvents(old,[],T+1000);
 assert.deepEqual(next.futuresHistory,old.futuresHistory);
 next.futuresHistory.AAAUSDT[0][1]=999;assert.equal(old.futuresHistory.AAAUSDT[0][1],100);
 assert.equal(next.last_source_at_ms,T);
});
test('V37 four independent runner restarts accumulate enough futures observations to create a candidate',()=>{
 let old={};const volumes=[1000000,1200000,1700000,3100000],prices=[100,100.02,100.03,100.05];
 for(let i=0;i<4;i++){
  const now=T+i*STEP;
  const cycle=v37RunCycle({old,history:old.futuresHistory||{},spotState:{},fastFeed:{venue:'bitget',at_ms:now,prices:{AAAUSDT:[prices[i],0,now]}},tickers:[{symbol:'AAAUSDT',ts:String(now),lastPr:String(prices[i]),usdtVolume:String(volumes[i])}],now});
  old=JSON.parse(JSON.stringify(v37LabelEvents(cycle.state,[],now+1000)));
 }
 assert.equal(old.futuresHistory?.AAAUSDT?.length,4);
 assert(old.events.some(e=>e.venue==='bitget'&&e.direction==='LONG'));
});
test('V37 provider outage during restart cannot erase already recorded futures history',()=>{
 const old={events:[],futuresHistory:{AAAUSDT:[[T,100,1000]]}};
 const r=v37RunCycle({old,history:old.futuresHistory,spotState:{},fastFeed:{},tickers:[],now:T+STEP});
 const saved=v37LabelEvents(r.state,[],T+STEP+1);
 assert.deepEqual(saved.futuresHistory,old.futuresHistory);
});
test('V37 diagnosis exposes warmup rather than silently reporting zero futures signals',()=>{
 const r=v37RunCycle({spotState:{},fastFeed:{venue:'bitget',at_ms:T,prices:{AAAUSDT:[100,0,T]}},tickers:[{symbol:'AAAUSDT',ts:String(T),lastPr:'100',usdtVolume:'1000'}],now:T});
 assert.equal(r.output.candidate_diagnostics.bitget.reasons.INSUFFICIENT_PRIOR_OBSERVATIONS,1);
 assert.equal(r.output.candidate_diagnostics.bitget.observed,1);
});
test('V37 flat negative and unknown outcomes are not collapsed into an invented reverse success',()=>{
 const e=(v)=>({venue:'bithumb',direction:'BUY',issued_at_ms:T,source_observed_at_ms:T,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',outcomes:v===null?{}:{5:{status:'MEASURED_DIRECTION',signed_pct:v,direction_positive:v>0}}});
 const s=v37Stats([e(1),e(-1),e(0),e(null)]);
 assert.equal(s.positive[5],1);assert.equal(s.negative[5],1);assert.equal(s.flat[5],1);assert.equal(s.unknown[5],1);
 assert.equal(s.actual_telegram_acks,0);
});
test('V36 aggregate separates non-observed hypotheses and unevaluable risk from genuine pending paths',()=>{
 const one={venue:'bitget',direction:'LONG',observed_hypothesis:{status:'INSUFFICIENT_EVIDENCE'},barriers_locked:false,direction_outcomes:{5:{status:'MEASURED_DIRECTION',signed_direction_pct:-1,direction_positive:false}},outcomes:{}};
 const two={...one,observed_hypothesis:{status:'OBSERVED'},barriers_locked:true,direction_outcomes:{5:{status:'MEASURED_DIRECTION',signed_direction_pct:0,direction_positive:false}}};
 const s=v36Summary({events:[one,two]}),g=s.directions['bitget:LONG'];
 assert.equal(g.evidence_observed,1);assert.equal(g.evidence_unavailable,1);
 assert.equal(g.horizons[5].risk_not_evaluable,1);assert.equal(g.horizons[5].pending,1);
 assert.equal(g.horizons[5].direction_negative,1);assert.equal(g.horizons[5].direction_flat,1);
 assert.equal(g.horizons[5].observed_evidence_measured,1);
});
test('V37 invalid numeric outcome remains unknown consistently in overall and per-direction summaries',()=>{
 const e={venue:'bithumb',direction:'BUY',issued_at_ms:T,source_observed_at_ms:T,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',outcomes:{5:{status:'MEASURED_DIRECTION',signed_pct:null,direction_positive:true}}};
 const s=v37Stats([e]);assert.equal(s.measured[5],0);assert.equal(s.directions['bithumb:BUY'].measured5,0);assert.equal(s.directions['bithumb:BUY'].direction_positive5,0);
});
