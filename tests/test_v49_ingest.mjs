import test from 'node:test';import assert from 'node:assert/strict';
import {packet,item,T} from './v49_fixture.mjs';
const cap=await import('../deployment/v49_capture.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const imp=await import('../deployment/v49_ingest.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function receipt(p=packet(),now=T){assert.equal(typeof cap.v49CreateCapture,'function');return cap.v49CreateCapture({packet:p,now,baselineDigest:'exact',sourceCommit:'a'.repeat(40)});}
function ingest(old,rows,now=T+120000){assert.equal(typeof imp.v49IngestCaptures,'function');return imp.v49IngestCaptures(old,rows,now,'exact');}
test('a delayed importer preserves the actually recorded early clock and reports transport delay',()=>{
 const r=receipt(),x=ingest({events:[],last_asof_ms:T+60000},[r]);
 assert.equal(x.events.length,1);assert.equal(x.state.events[0].issued_at_ms,T);assert.equal(x.state.events[0].source_to_decision_latency_ms,0);
 assert.equal(x.report.max_capture_to_import_ms,120000);assert.equal(x.state.last_asof_ms,T+60000);
});
test('restart and duplicate transport cannot multiply evaluation opportunities',()=>{
 const r=receipt(),a=ingest({events:[]},[r]),b=ingest(a.state,[r]);
 assert.equal(b.events.length,0);assert.equal(b.state.events.length,1);assert.equal(b.report.already_consumed,1);
});
test('different captures of the same 30-minute episode preserve the first frozen observation',()=>{
 const a=receipt(),b=receipt(packet([item('LONG','AAAUSDT',T+60000)],T+60000),T+60000);
 const x=ingest({events:[]},[b,a],T+180000);assert.equal(x.events.length,1);assert.equal(x.state.events[0].issued_at_ms,T);assert.equal(x.report.duplicate_episodes,1);
});
test('tampered receipt fails without mutating previous state',()=>{
 const old={events:[],last_asof_ms:T},before=structuredClone(old),r=receipt();r.events[0].stop_price=1;
 assert.throws(()=>ingest(old,[r]),/HASH/);assert.deepEqual(old,before);
});
test('rolling eviction returns every displaced frozen record for append-only archive',()=>{
 const r=receipt(),base=r.events[0],old={events:Array.from({length:3000},(_,i)=>({...structuredClone(base),id:'prior-'+i,issued_at_ms:T-3600000+i}))};
 const x=ingest(old,[r]);assert.equal(x.state.events.length,3000);assert.equal(x.evicted.length,1);assert.deepEqual(x.evicted[0],old.events[0]);assert.equal(x.state.events.at(-1).id,base.id);
});
test('a zero-candidate diagnostic capture cannot fabricate alerts or measurements',()=>{
 const r=receipt(packet(),T+55000),x=ingest({events:[]},[r]);
 assert.equal(x.events.length,0);assert.equal(x.report.capture_health.BLOCKED_QUOTE_FRESHNESS,1);
});
