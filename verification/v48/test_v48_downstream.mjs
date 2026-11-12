import test from 'node:test';import assert from 'node:assert/strict';
import {observation,audit} from '../../research/v39_direction_outcome_audit.mjs';
import {compareDirectionHypotheses} from '../../deployment/direction_response_research.mjs';
import {V48_MEASUREMENT_VERSION as V,v48LabelClose} from '../../deployment/v48_measurement.mjs';
const T=1794021639000,M=60000;
function row(id='a',kind='new') {const e={id,venue:'bitget',symbol:'AAAUSDT',direction:'LONG',issued_at_ms:T,source_observed_at_ms:T-1000,time_basis:'ACTUAL_EVALUATOR_DECISION_CLOCK',first_complete_start_ms:Math.ceil(T/M)*M,entry_price:100.1,original_bid:100,original_ask:100.1,direction_response:{version:'IRYS_DIRECTION_RESPONSE_RESEARCH_V1',decided_at_ms:T,source_observed_at_ms:T-1000,venue:'bitget',symbol:'AAAUSDT',baseline_direction:'LONG',trade_permission:false,hypotheses:{price_response:'LONG'}},direction_outcomes:{}};
 const at=(kind==='new'?Math.ceil:Math.floor)((T+5*M)/M)*M;
 e.direction_outcomes[5]={status:'MEASURED_DIRECTION',horizon_minutes:5,target_ms:T+5*M,close_at_ms:at,target_close:101,entry_quote_reference:100.1,actual_execution_verified:false};
 if(kind==='new'){e.direction_measurement_version=V;e.direction_outcomes[5].measurement_version=V;}return e;
}
test('v39 accepts exact V48 close while retaining distinct legacy clock contract',()=>{for(const k of ['new','legacy'])assert.equal(observation(row('x',k),5,T+10*M).status,'MEASURED');});
test('v39 does not consume corrected close before that minute closes',()=>{const e=row();assert.notEqual(observation(e,5,T+5*M).status,'MEASURED');});
test('v39 rejects unknown or mismatched measurement version',()=>{for(const version of ['UNKNOWN',undefined]){const e=row();e.direction_measurement_version=version;assert.equal(observation(e,5,T+10*M).status,'INVALID_CLOSE');}});
test('current hypothesis comparison accepts V48 close and reports semantics',()=>{const r=compareDirectionHypotheses([row()],{now:T+10*M});assert.equal(r.measured_records,1);assert.equal(r.horizon_reference,'FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET');});
test('comparison cannot pool old and new evaluation semantics',()=>{assert.throws(()=>compareDirectionHypotheses([row('a'),row('b','legacy')],{now:T+10*M}),/MIXED_MEASUREMENT_SEMANTICS/);});
test('v39 audit cannot silently combine old and new measurement conventions',()=>{assert.throws(()=>audit([row('a'),row('b','legacy')],T+10*M),/MIXED_MEASUREMENT_SEMANTICS/);});
