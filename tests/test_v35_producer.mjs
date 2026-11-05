import test from 'node:test';import assert from 'node:assert/strict';
import {v30Produce} from '../deployment/v30_producer.mjs';
import {environment,T} from './test_v30_producer.mjs';
test('live evidence does not wait for historical prices when cached history is selected',async()=>{
 const e=environment();e.state.records=[{id:'prior',venue:'bitget',symbol:'F0USDT',direction:'LONG',issued_at_ms:T-360000,evidence_status:'READY_CURRENT_EVIDENCE',entry_quote:{bid:100,ask:101,at_ms:T-360000},outcomes:{}}];
 let historyCalls=0;const read=async url=>{if(url.includes('candles')){historyCalls++;throw Error('HISTORY_MUST_NOT_BLOCK_CURRENT')};return e.read(url)};
 const x=await v30Produce({read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test',historyMode:'cached',cachedHistory:[]});
 assert.equal(historyCalls,0);assert.equal(x.report.timing.history_reads_in_live_path,false);assert(x.report.summary.selected>0);
});
test('READY prior signal is freshly checked even after it leaves current discovery',async()=>{
 const e=environment();e.state.market.futures.prices.F100USDT=100;
 e.state.records=[{id:'ready',venue:'bitget',symbol:'F100USDT',direction:'LONG',issued_at_ms:T-300000,evidence_status:'READY_CURRENT_EVIDENCE',entry_quote:{bid:100,ask:100.1,at_ms:T-300000},outcomes:{}}];
 const x=await v30Produce({read:e.read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test',historyMode:'cached'});
 assert(!x.report.checks.some(c=>c.symbol==='F100USDT'));assert(x.report.followups.some(f=>f.symbol==='F100USDT'&&f.first&&f.second&&f.final));
});

test('first cached-mode migration preserves already collected native historical pages',async()=>{
 const e=environment(),pages=[{venue:'bitget',symbol:'F0USDT',source:'OFFICIAL_NATIVE_1M',fetched_at_ms:T-1000,bars:[]}];e.state.minute_history=pages;
 const x=await v30Produce({read:e.read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test',historyMode:'cached',cachedHistory:[]});
 assert.deepEqual(x.state.minute_history,pages);assert.deepEqual(x.report.outcome_candles,pages);
});
