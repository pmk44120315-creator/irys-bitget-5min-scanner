import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractWorkerSource} from '../deployment/parse-cloudflare-script.mjs';
const code="const VERSION='IRYS-MORNING-AI-V7-CF-20261027';\nexport default {async fetch(){return new Response('ok')}};\n";
const hash=createHash('sha256').update(code).digest('hex');
test('multipart download extracts exact Worker source bytes, not envelope',async()=>{
  const f=new FormData();
  f.set('metadata',JSON.stringify({main_module:'index.mjs',bindings:[{name:'TELEGRAM_BOT_TOKEN',type:'secret_text'}]}));
  f.set('index.mjs',new Blob([code],{type:'application/javascript+module'}),'index.mjs');
  const parsed=await extractWorkerSource(new Response(f));
  assert.equal(parsed.sha256,hash);assert.equal(parsed.data.toString(),code);
  assert.equal(parsed.selectedPart,'index.mjs');assert.equal(parsed.format,'multipart');
});
test('single source part without metadata detected',async()=>{
  const f=new FormData();f.set('worker.mjs',new Blob([code],{type:'application/javascript+module'}),'worker.mjs');
  assert.equal((await extractWorkerSource(new Response(f))).sha256,hash);
});
test('ambiguous multipart download fails closed',async()=>{
  const f=new FormData();
  f.set('a.mjs',new Blob(['a'],{type:'application/javascript+module'}),'a.mjs');
  f.set('b.mjs',new Blob(['b'],{type:'application/javascript+module'}),'b.mjs');
  await assert.rejects(()=>extractWorkerSource(new Response(f)),/AMBIGUOUS/);
});
test('direct JS retains exact bytes',async()=>{
  const parsed=await extractWorkerSource(new Response(code,{headers:{'content-type':'application/javascript'}}));
  assert.equal(parsed.sha256,hash);assert.equal(parsed.format,'direct');
});
test('HTML response cannot masquerade as Worker source',async()=>{
  await assert.rejects(()=>extractWorkerSource(new Response('<html/>',{headers:{'content-type':'text/html'}})),/UNEXPECTED/);
});
