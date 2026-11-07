"""Apply the reviewed research-only repair. No data, sender, credentials or live Worker changes."""
from pathlib import Path

def edit(path, before, after, count=1):
    p=Path(path);s=p.read_text();assert s.count(before)==count,(path,before[:80],s.count(before));p.write_text(s.replace(before,after))

edit('deployment/v37_early.mjs',"const state={version:V37_EARLY_VERSION,events:structuredClone(old?.events||[]),asof_ms:now};","const state={...structuredClone(old||{}),version:V37_EARLY_VERSION,events:structuredClone(old?.events||[]),asof_ms:now};",2)
edit('deployment/v37_runner.mjs','measured:{},positive:{},unknown:{},directions:{}','measured:{},positive:{},negative:{},flat:{},unknown:{},directions:{}')
edit('deployment/v37_runner.mjs',"for(const h of [5,15,30,60]){let measured=0,positive=0,missing=0;for(const e of verified){const v=e.outcomes?.[String(h)];if(v?.status==='MEASURED_DIRECTION'){measured++;if(v.direction_positive)positive++;}else missing++;}\n  out.measured[h]=measured;out.positive[h]=positive;out.unknown[h]=missing;","for(const h of [5,15,30,60]){let measured=0,positive=0,negative=0,flat=0,missing=0;for(const e of verified){const v=e.outcomes?.[String(h)];if(v?.status==='MEASURED_DIRECTION'&&Number.isFinite(v.signed_pct)){measured++;if(v.signed_pct>0)positive++;else if(v.signed_pct<0)negative++;else flat++;}else missing++;}\n  out.measured[h]=measured;out.positive[h]=positive;out.negative[h]=negative;out.flat[h]=flat;out.unknown[h]=missing;")
edit('deployment/v37_runner.mjs'," const r=v37BuildEvents(old,selections,now);",""" const diagnostics={};
 for(const venue of ['bithumb','bitget']){
  const rows=prepared.rows.filter(r=>r.venue===venue),reasons={};
  for(const row of rows){const a=v37AssessSnapshot(row,now),reason=a.reason||a.phase||a.status;
   reasons[reason]=(reasons[reason]||0)+1;
  }
  diagnostics[venue]={observed:rows.length,selected:selections.filter(r=>r.venue===venue).length,reasons};
 }
 const r=v37BuildEvents(old,selections,now);""")
edit('deployment/v37_runner.mjs','new_events:r.added.length,selected_early_count:selections.length,tracked:state.events.length,','new_events:r.added.length,selected_early_count:selections.length,tracked:state.events.length,candidate_diagnostics:diagnostics,')
edit('deployment/v37_runner.mjs',"group.filter(e=>e.outcomes?.[5]?.status==='MEASURED_DIRECTION').length","group.filter(e=>e.outcomes?.[5]?.status==='MEASURED_DIRECTION'&&Number.isFinite(e.outcomes[5].signed_pct)).length")
edit('deployment/v37_runner.mjs',"group.filter(e=>e.outcomes?.[5]?.status==='MEASURED_DIRECTION'&&e.outcomes[5].direction_positive).length","group.filter(e=>e.outcomes?.[5]?.status==='MEASURED_DIRECTION'&&Number.isFinite(e.outcomes[5].signed_pct)&&e.outcomes[5].signed_pct>0).length")
edit('deployment/v36_shadow.mjs',"s={issued:rows.length,baseline_ready:rows.filter(r=>r.baseline_ready).length,horizons:{}};","s={issued:rows.length,baseline_ready:rows.filter(r=>r.baseline_ready).length,\n   evidence_observed:rows.filter(r=>r.observed_hypothesis?.status==='OBSERVED').length,\n   evidence_unavailable:rows.filter(r=>r.observed_hypothesis?.status!=='OBSERVED').length,horizons:{}};")
edit('deployment/v36_shadow.mjs',"const labels=rows.map(r=>r.outcomes?.[h]?.status),dc=rows.map(r=>r.direction_outcomes?.[h]);","const labels=rows.filter(r=>r.barriers_locked===true).map(r=>r.outcomes?.[h]?.status),dc=rows.map(r=>r.direction_outcomes?.[h]);")
edit('deployment/v36_shadow.mjs','s.horizons[h]={direction_measured:',"""s.horizons[h]={risk_not_evaluable:rows.filter(r=>r.barriers_locked!==true).length,
    direction_negative:dc.filter(x=>x?.status==='MEASURED_DIRECTION'&&x.signed_direction_pct<0).length,
    direction_flat:dc.filter(x=>x?.status==='MEASURED_DIRECTION'&&x.signed_direction_pct===0).length,
    observed_evidence_measured:rows.filter(r=>r.observed_hypothesis?.status==='OBSERVED'&&r.direction_outcomes?.[h]?.status==='MEASURED_DIRECTION').length,
    observed_evidence_positive:rows.filter(r=>r.observed_hypothesis?.status==='OBSERVED'&&r.direction_outcomes?.[h]?.status==='MEASURED_DIRECTION'&&r.direction_outcomes[h].signed_direction_pct>0).length,
    direction_measured:""")
edit('deployment/v36_shadow.mjs',"import {v36Evidence} from './v36_hypotheses.mjs';","import {v36Evidence} from './v36_hypotheses.mjs';\nimport {v36Response,RESPONSE_VERSION} from './v36_response.mjs';")
edit('deployment/v36_shadow.mjs','const state={version:V36_VERSION,events:Array.isArray(old.events)?structuredClone(old.events):[],last_asof_ms:old.last_asof_ms||0};','const state={version:V36_VERSION,events:Array.isArray(old.events)?structuredClone(old.events):[],response_events:structuredClone(old.response_events||[]),last_asof_ms:old.last_asof_ms||0};')
edit('deployment/v36_shadow.mjs','const ids=new Set(state.events.map(e=>e.id)),added=[];','const ids=new Set(state.events.map(e=>e.id)),responseIds=new Set(state.response_events.map(e=>e.id)),added=[],responseDiagnostics={};')
edit('deployment/v36_shadow.mjs',' for(const item of packet.items){\n  const frozen=',""" for(const item of packet.items){
  const response=v36Response(item,now);
  const statusKey=(response.venue||'unknown')+':'+response.status+':'+(response.reason||'NONE');
  responseDiagnostics[statusKey]=(responseDiagnostics[statusKey]||0)+1;
  if(response.status==='OBSERVED'){
   const responseId=['RESPONSE',response.venue,response.symbol,Math.floor(now/EPISODE_MS)].join(':');
   if(!responseIds.has(responseId)){responseIds.add(responseId);state.response_events.push({...response,id:responseId});}
  }
  const frozen=""")
edit('deployment/v36_shadow.mjs','state.events=state.events.slice(-MAX_EVENTS);state.last_asof_ms=','state.events=state.events.slice(-MAX_EVENTS);state.response_events=state.response_events.slice(-MAX_EVENTS);state.response_diagnostics=responseDiagnostics;state.last_asof_ms=')
edit('deployment/v36_shadow.mjs','const state={version:V36_VERSION,events:structuredClone(old.events||[]),last_asof_ms:old.last_asof_ms||0};','const state={version:V36_VERSION,events:structuredClone(old.events||[]),response_events:structuredClone(old.response_events||[]),response_diagnostics:structuredClone(old.response_diagnostics||{}),last_asof_ms:old.last_asof_ms||0};')
edit('deployment/v36_shadow.mjs',' return state;\n}\nfunction v36Gate',""" for(const e of state.response_events){
  const p=by.get(`${e.venue}:${e.symbol}`);if(!p)continue;
  e.direction_outcomes??={};
  for(const h of [5,15,30,60])if(e.direction_outcomes[h]?.status!=='MEASURED_DIRECTION'){
   const label=v36LabelClose(e,p.bars,Math.min(now,p.fetched_at_ms),h);
   if(label.status!=='PENDING')e.direction_outcomes[h]=label;
  }
 }
 return state;
}
function v36Gate""")
edit('deployment/v36_shadow.mjs',' }return out;\n}\nexport',""" }
 const responses=state?.response_events||[];
 out.response_challenger={version:RESPONSE_VERSION,events:responses.length,future_accuracy_proven:false,
  actual_telegram_acks:0,trade_permit:false,diagnostics:state?.response_diagnostics||{},directions:{}};
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){
  const rows=responses.filter(r=>r.venue===venue&&r.direction===direction),g={issued:rows.length,horizons:{}};
  for(const h of [5,15,30,60]){
   const labels=rows.map(r=>r.direction_outcomes?.[h]).filter(x=>x?.status==='MEASURED_DIRECTION'&&Number.isFinite(x.signed_direction_pct));
   g.horizons[h]={measured:labels.length,positive:labels.filter(x=>x.signed_direction_pct>0).length,
    negative:labels.filter(x=>x.signed_direction_pct<0).length,flat:labels.filter(x=>x.signed_direction_pct===0).length,
    unknown:rows.length-labels.length,not_net_profit:true};
  }
  out.response_challenger.directions[`${venue}:${direction}`]=g;
 }
 return out;
}
export""")
edit('deployment/v36_runner.mjs',"const list=(state.events||[]).filter(e=>now-e.issued_at_ms<61*MIN&&[5,15,30,60].some(h=>!['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT'].includes(e.outcomes?.[h]?.status)));","""const list=[...(state.events||[]),...(state.response_events||[])].filter(e=>e.issued_at_ms<=now&&now-e.issued_at_ms<65*MIN&&[5,15,30,60].some(h=>
  e.direction_outcomes?.[h]?.status!=='MEASURED_DIRECTION'||e.barriers_locked===true&&!['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT'].includes(e.outcomes?.[h]?.status)));""")
edit('.github/workflows/v37-shadow.yml','run: node --test tests/test_v37_early.mjs tests/test_v37_runner.mjs','run: node --test tests/test_v37*.mjs tests/test_direction_recovery*.mjs')
edit('.github/workflows/v37-shadow.yml','          assert(Array.isArray(state.events)&&state.events.length<=3000);',"""          assert(Array.isArray(state.events)&&state.events.length<=3000);
          assert(state.futuresHistory&&typeof state.futuresHistory==='object','FUTURES_HISTORY_NOT_PERSISTED');
          assert(Object.keys(state.futuresHistory).length>=out.futures_candidates_observed,'FUTURES_HISTORY_LOSS');
          assert.equal(out.candidate_diagnostics.bitget.observed,out.futures_candidates_observed);""")
edit('.github/workflows/v36-public-shadow.yml','run: node --test tests/test_v36_shadow.mjs','run: node --test tests/test_v36_shadow.mjs tests/test_direction_recovery*.mjs')
edit('.github/workflows/v36-public-shadow.yml','          for(const e of state.events){',"""          assert(Array.isArray(state.response_events)&&state.response_events.length<=3000);
          assert.equal(new Set(state.response_events.map(e=>e.id)).size,state.response_events.length);
          for(const e of state.response_events){
            assert.equal(e.trade_permit,false);assert.equal(e.telegram_sent,false);assert.equal(e.orders_sent,false);
            assert.equal(e.time_basis,'ACTUAL_EVALUATOR_DECISION_CLOCK');
            assert(e.source_observed_at_ms<=e.issued_at_ms&&e.issued_at_ms<=out.at_ms);
            assert.equal(e.entry_price,e.direction==='SHORT'?e.original_bid:e.original_ask);
          }
          for(const e of state.events){""")
print('Research-only source repair applied; live production source unchanged.')
