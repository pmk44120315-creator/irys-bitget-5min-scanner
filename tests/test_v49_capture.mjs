import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {packet,item,T} from './v49_fixture.mjs';
const api=await import('../deployment/v49_capture.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const opts={now:T,baselineDigest:'exact',sourceCommit:'a'.repeat(40)};
function make(p=packet(),more={}){assert.equal(typeof api.v49CreateCapture,'function','actual capture builder must exist');return api.v49CreateCapture({packet:p,...opts,...more});}
test('capture freezes the real early decision and preserves its original input',()=>{
 const p=packet(),before=structuredClone(p),r=make(p);
 assert.deepEqual(p,before);assert.equal(r.events.length,1);assert.equal(r.recorded_at_ms,T);assert.equal(r.events[0].issued_at_ms,T);
 assert.equal(r.events[0].source_quote_at_ms,T-500);assert.equal(r.admission.accepted,1);
 assert.equal(api.v49ValidateCapture(r,T+3600000,'exact'),true);
 assert.equal(r.telegram_sent,false);assert.equal(r.orders_sent,false);assert.equal(r.auto_promotion,false);
});
test('late capture still rejects a 55-second-old quote rather than resetting its timestamp',()=>{
 const r=make(packet(),{now:T+55000});assert.equal(r.events.length,0);assert.equal(r.admission.health,'BLOCKED_QUOTE_FRESHNESS');
});
test('capture checksum and causal timestamps are independently validated',()=>{
 const r=make();const bad=structuredClone(r);bad.events[0].entry_price=999;
 assert.throws(()=>api.v49ValidateCapture(bad,T+60000,'exact'),/HASH/);
 assert.throws(()=>api.v49ValidateCapture(r,T-1,'exact'),/CLOCK/);
 assert.throws(()=>api.v49ValidateCapture(r,T+60000,'different'),/MODEL/);
});
test('valid checksum cannot authorize fake execution, old quotes or future source evidence',()=>{
 for(const mutate of [e=>e.execution_verified=true,e=>e.source_quote_at_ms=T-45001,e=>e.source_observed_at_ms=T+1,e=>e.first_complete_start_ms=T+60000,e=>e.id='fake',e=>e.entry_price=1]){
  const r=make();mutate(r.events[0]);r.id=api.v49CaptureHash(r);
  assert.throws(()=>api.v49ValidateCapture(r,T+60000,'exact'),/EVENT/);
 }
});
test('persisted captures are append-only; repeated identical capture is idempotent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'irys-v49-'));
 try{const r=make(),a=api.v49WriteCapture(r,dir),b=api.v49WriteCapture(r,dir);assert.equal(a.path,b.path);assert.equal(b.created,false);
  const files=readdirSync(join(dir,'v49_captures'));assert.equal(files.length,1);
  writeFileSync(a.path,'corrupt');assert.throws(()=>api.v49WriteCapture(r,dir),/IMMUTABLE/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid source packet is recorded as a failed capture, never a new hypothesis',()=>{
 const r=make({...packet(),telegram_sent:true});assert.equal(r.events.length,0);assert.equal(r.status,'SOURCE_NOT_ELIGIBLE');
 assert.equal(r.admission.health,'SOURCE_NOT_ELIGIBLE');
});
test('interrupted gzip write cannot expose a partial immutable receipt',async()=>{
 const {spawnSync}=await import('node:child_process');const dir=mkdtempSync(join(tmpdir(),'irys-v49-crash-'));
 try{
  const source=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
   const write=fs.writeFileSync;fs.writeFileSync=(p,b,o)=>{if(Buffer.isBuffer(b)&&b[0]===31&&b[1]===139){write(p,b.subarray(0,2),o);throw Error('INJECTED_INTERRUPTED_WRITE');}return write(p,b,o);};syncBuiltinESMExports();
   const {v49WriteCapture}=await import('./deployment/v49_capture.mjs');
   try{v49WriteCapture(${JSON.stringify(make())},${JSON.stringify(dir)});process.exitCode=2;}catch(e){if(!String(e).includes('INJECTED_INTERRUPTED_WRITE'))throw e;}`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  assert.deepEqual(readdirSync(join(dir,'v49_captures')),[],'partial receipt must never become visible to the importer');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('quote later than its sealed source packet cannot be smuggled into a valid capture',()=>{
 const r=make(packet(),{now:T+1000});r.events[0].source_quote_at_ms=T+100;r.id=api.v49CaptureHash(r);
 assert.throws(()=>api.v49ValidateCapture(r,T+2000,'exact'),/EVENT/);
});
