import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {v36Process} from '../deployment/v36_runner.mjs';import {v49CreateCapture} from '../deployment/v49_capture.mjs';
import {v30ModelDigest} from '../deployment/v30_producer.mjs';import {packet,T} from './v49_fixture.mjs';
test('the slow V36 process imports a real earlier capture even after the original quote expired',async()=>{
 const p=packet(),r=v49CreateCapture({packet:p,now:T,baselineDigest:'exact',sourceCommit:'a'.repeat(40)});
 const out=await v36Process({old:{events:[]},packet:p,now:T+120000,baselineDigest:'exact',captures:[r],readHistory:async()=>({code:'00000',data:[]})});
 assert.equal(out.public_output.new_events,1);assert.equal(out.state.events[0].issued_at_ms,T);
 assert.equal(out.public_output.capture_ingestion?.admitted,1);assert.equal(out.public_output.operating_health?.enrollment,'CAPTURE_IMPORTED');
 assert.equal(out.public_output.telegram_sent,false);assert.equal(out.public_output.orders_sent,false);
});
test('a delayed run without captures exposes enrollment failure instead of claiming current observation',async()=>{
 const out=await v36Process({old:{events:[]},packet:packet(),now:T+55000,baselineDigest:'exact',readHistory:async()=>({code:'00000',data:[]})});
 assert.equal(out.public_output.operating_health?.enrollment,'BLOCKED_QUOTE_FRESHNESS');
 assert.equal(out.public_output.new_events,0);
});
test('capture is isolated after producer and before publication and slow quote/history work',()=>{
 const y=readFileSync('.github/workflows/v30-public-direction-producer.yml','utf8');
 const prod=y.indexOf('run: node deployment/v30_producer.mjs'),capture=y.indexOf('run: node deployment/v49_capture.mjs'),publish=y.indexOf('Independently publish current public evidence');
 assert(prod>=0&&capture>prod&&publish>capture,'source-side capture must precede publication delay');
 assert.match(y,/id: research_capture\n\s+if: steps\.producer\.outcome == 'success'\n\s+continue-on-error: true/);
 assert.match(y,/git add data\/v49_captures data\/v49_capture_latest\.json/);
 assert.match(y,/node deployment\/v45_quote_producer\.mjs/);assert.match(y,/node deployment\/v35_history\.mjs/);
});
test('live producer model digest is unchanged by research repair',()=>{
 assert.equal(v30ModelDigest(),'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9');
});
test('a failed source-side capture cannot disappear behind SOURCE_ALREADY_OBSERVED',async()=>{
 const p=packet(),r=v49CreateCapture({packet:p,now:T+55000,baselineDigest:'exact',sourceCommit:'a'.repeat(40)});
 const out=await v36Process({old:{events:[]},packet:p,now:T+120000,baselineDigest:'exact',captures:[r],readHistory:async()=>({code:'00000',data:[]})});
 assert.equal(out.public_output.operating_health?.enrollment,'BLOCKED_QUOTE_FRESHNESS');
});
test('the real process persists official-window gap diagnostics, not just helper-test results',async()=>{
 const {item,M}=await import('./v49_fixture.mjs');const {v36Observe}=await import('../deployment/v36_shadow.mjs');
 const x=item('BUY','KRW-TEST');x.first.trades=[];x.second.trades=[];
 const e=v36Observe({},{packet:packet([x]),now:T,baselineDigest:'exact'}).events[0];
 const old={events:[e],direction_measurement_version:'V48_CLOSED_MINUTE_AT_OR_AFTER_TARGET_V1'};
 const raw=[{market:'KRW-TEST',candle_date_time_utc:new Date(T).toISOString().slice(0,19),opening_price:100,high_price:101,low_price:99,trade_price:100}];
 const out=await v36Process({old,packet:packet(),now:T+6*M,baselineDigest:'exact',readHistory:async()=>raw});
 assert.equal(out.public_output.recovery?.reasons?.TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW,1);
 assert.equal(out.state.events[0].history_recovery?.horizons?.['5']?.no_trade_confirmed,false);
});
