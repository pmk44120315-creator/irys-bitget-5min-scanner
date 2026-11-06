import test from 'node:test';
import assert from 'node:assert/strict';
import {v38Enroll,v38Settle,v38Summary} from '../deployment/v38_shadow.mjs';
const STEP=300000,T=1793960400000;
const signal=(dir='LONG')=>({version:'V38_EARLY_PULLBACK_CONTINUATION_SHADOW_V1',status:'EARLY_TURN_WATCH',source:'ONLY_CLOSED_5M_PUBLIC_CANDLES',
 venue:'bitget',symbol:'ONEUSDT',direction:dir,evaluated_at_ms:T,signal_closed_at_ms:T-10000,impulse_peak_at_ms:T-4*STEP,
 close_reference:dir==='SHORT'?100:1.18,previous_impulse_high:dir==='SHORT'?95:1.22,stop_reference:dir==='SHORT'?103:1.17,
 prior_high_reward_risk:1.2,trade_permit:false,entry_ready:false,future_accuracy_proven:false});
const candle=(t,o,h,l,c)=>({start_ms:t,open:o,high:h,low:l,close:c,turnover_quote:100});
test('first watch signal remains an observation with real decision clock and no account permission',()=>{
 const r=v38Enroll({},[signal()],T);
 assert.equal(r.added.length,1);
 const e=r.added[0];assert.equal(e.issued_at_ms,T);assert.equal(e.source_closed_at_ms,T-10000);
 assert.equal(e.source_to_selection_delay_ms,10000);assert.equal(e.time_basis,'ACTUAL_GITHUB_EVALUATOR_TIME');
 assert.equal(e.trade_permit,false);assert.equal(e.telegram_sent,false);assert.equal(e.entry_reference_is_executable,false);
});
test('same prior swing episode never turns five repeat notices into five independent successes',()=>{
 const first=v38Enroll({},[signal()],T);const next=v38Enroll(first.state,[signal()],T+40000);
 assert.equal(next.added.length,0);assert.equal(next.state.events.length,1);
});
test('reject stale or fabricated future-source signals before inserting history',()=>{
 const stale={...signal(),signal_closed_at_ms:T-10*STEP};
 const future={...signal(),signal_closed_at_ms:T+STEP};
 assert.equal(v38Enroll({},[stale],T).added.length,0);
 assert.equal(v38Enroll({},[future],T).added.length,0);
});
test('five-minute closed bar outcome is observed only after actual issuance',()=>{
 const r=v38Enroll({},[signal()],T),bars=[candle(T,1.18,1.23,1.17,1.22),candle(T+STEP,1.22,1.24,1.20,1.23),
  candle(T+2*STEP,1.23,1.26,1.22,1.25)];
 const page=[{venue:'bitget',symbol:'ONEUSDT',source:'OFFICIAL_NATIVE_5M',fetched_at_ms:T+3*STEP,bars}];
 const early=v38Settle(r.state,page,T+STEP-1);assert.equal(early.events[0].outcomes?.['5'],undefined);
 const later=v38Settle(r.state,page,T+3*STEP);
 assert.equal(later.events[0].outcomes['5'].status,'MEASURED_CLOSE_PROXY');
 assert.equal(later.events[0].outcomes['15'].status,'MEASURED_CLOSE_PROXY');
 assert.equal(later.events[0].outcomes['5'].future_price_direction_positive,true);
 assert.equal(later.events[0].outcomes['5'].actual_execution_verified,false);
});
test('missing outcome bars are unknown, not hidden wins',()=>{
 const r=v38Enroll({},[signal()],T);
 const p=[{venue:'bitget',symbol:'ONEUSDT',source:'OFFICIAL_NATIVE_5M',fetched_at_ms:T+10*STEP,bars:[]}];
 const v=v38Settle(r.state,p,T+10*STEP);
 assert.equal(v.events[0].outcomes['5'].status,'UNMEASURED_NO_CANDLE');
 assert.equal(v38Summary(v).horizons['5'].measured,0);
});
test('short-side falls show positive signed direction only after the subsequent real 5m close',()=>{
 const r=v38Enroll({},[signal('SHORT')],T);
 const p=[{venue:'bitget',symbol:'ONEUSDT',source:'OFFICIAL_NATIVE_5M',fetched_at_ms:T+STEP,
  bars:[candle(T,100,101,96,97)]}];
 const v=v38Settle(r.state,p,T+STEP);
 assert.equal(v.events[0].outcomes['5'].future_price_direction_positive,true);
});
test('no automatic live promotion from a single known winner chart or test pass',()=>{
 const r=v38Enroll({},[signal()],T),s=v38Summary(r.state);
 assert.equal(s.promote,false);assert.equal(s.actual_telegram_messages,0);
 assert.equal(s.future_accuracy_proven,false);
});
