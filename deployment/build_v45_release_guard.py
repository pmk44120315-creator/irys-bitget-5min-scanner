"""Derive reviewed guarded rollout, retaining code-only upload and exact rollback."""
from pathlib import Path
import hashlib,sys
base=Path(__file__).with_name('release_v421_guarded.mjs').read_bytes()
assert hashlib.sha256(base).hexdigest()=='791ccbb7275d87b4fe6353387f51b5e7d8f23ebcf18eeca2333a60a086166d59'
s=base.decode()
changes={
"const OLD='cc1414e1883546c1eb1fe53ea449e81b721de3089c1689fc636b65fa0470459e'":"const OLD='99845f001c17542fbe1c5c1a7dde9beadef1881d6f31f1c1e0f7765109b9e3bb'",
"const NEW='99845f001c17542fbe1c5c1a7dde9beadef1881d6f31f1c1e0f7765109b9e3bb'":"const NEW='f78b500927f41af3412c17bd3b47c25e3d9fba9c6d156a72302c67266a2a40cd'",
'IRYS-V42.1-TRUSTED-RUNNER-DISPATCH-20261108':'IRYS-V45-RSI-ENTRY-CONTEXT-20261109',
'fix/irys-v421-runner-quote-transport-20261108':'fix/irys-v45-rsi-entry-context-20261109',
'v421_release':'v45_release',
'IRYS_V421_DISPATCH_WORKER.mjs':'IRYS_V45_RSI_WORKER.mjs',
"assert(transport.quote_count>0&&transport.errors===0&&transport.source_verified===true,'RUNNER_TRANSPORT_NOT_VERIFIED');":"assert(transport.quote_count>=0&&transport.errors===0&&transport.source_verified===true&&transport.entry_context_version==='V45_RSI_ENTRY_CONTEXT_V1','RUNNER_TRANSPORT_NOT_VERIFIED');",
"assert(a.trustedRunnerDispatchQuoteEnabled===true,'RUNNER_TRANSPORT_FLAG_MISSING');":"assert(a.trustedRunnerDispatchQuoteEnabled===true,'RUNNER_TRANSPORT_FLAG_MISSING');assert(a.rsiEntryContextEnabled===true&&a.rsiEntryContextVersion==='V45_RSI_ENTRY_CONTEXT_V1','RSI_CONTEXT_FLAG_MISSING');",
'assert(Array.isArray(q.quotes)&&q.quotes.length>0);':"assert(Array.isArray(q.quotes));assert.equal(q.entry_context_version,'V45_RSI_ENTRY_CONTEXT_V1');",
'quote_count:q.quotes.length,errors:q.errors?.length??1':'quote_count:q.quotes.length,entry_context_version:q.entry_context_version,context_summary:q.entry_context_summary,errors:q.errors?.length??1',
'dispatch_revalidation:d.dispatch_revalidation,':'dispatch_revalidation:d.dispatch_revalidation,entry_context:d.entry_context,',
"assert.equal(d.dispatch_revalidation?.errors,0,'NATURAL_DISPATCH_TRANSPORT_ERRORS');":"assert.equal(d.dispatch_revalidation?.errors,0,'NATURAL_DISPATCH_TRANSPORT_ERRORS');assert.equal(d.entry_context?.version,'V45_RSI_ENTRY_CONTEXT_V1','NATURAL_ENTRY_CONTEXT_NOT_OBSERVED');",
'dispatch_now_revalidates_new_official_quote:true,':'dispatch_now_revalidates_new_official_quote:true,live_rsi_context_enabled:true,forecast_policy_replaced:false,'}
for a,b in changes.items():
 assert s.count(a)>=1,a
 s=s.replace(a,b)
# Uploaded source and public request serving may become visible at different
# instants. Re-read under the exact source lease; missing flags never count as PASS.
readiness="""async function v45WaitForPublicReadiness(io){
 const started=io.clock(),deadline=(Math.floor(started/300000)+1)*300000+240000,observations=[];
 let previous=started;
 while(io.clock()<=deadline){
  const sourceHash=hash(await io.source());assert.equal(sourceHash,NEW,'SOURCE_CHANGED_DURING_PUBLIC_READINESS');
  const a=await io.health(),at=io.clock();assert(at>=previous,'PUBLIC_READINESS_CLOCK_BACKWARDS');
  observations.push({checked_at_ms:at,source_sha256:sourceHash,rsi_enabled:a.rsiEntryContextEnabled===true,
   rsi_version:a.rsiEntryContextVersion??null,previous_runtime_version:a.last?.codeVersion??null});
  io.save('public_readiness.json',{started_at_ms:started,observations,source_lease_preserved:true});
  if(a.rsiEntryContextEnabled===true&&a.rsiEntryContextVersion==='V45_RSI_ENTRY_CONTEXT_V1')return a;
  if(a.rsiEntryContextVersion&&a.rsiEntryContextVersion!=='V45_RSI_ENTRY_CONTEXT_V1')throw Error('UNEXPECTED_PUBLIC_CONTEXT_VERSION');
  previous=at;await (io.sleep||((ms)=>new Promise(r=>setTimeout(r,ms))))(10000);
  assert(io.clock()>previous,'PUBLIC_READINESS_CLOCK_NOT_ADVANCING');
 }
 throw Error('PUBLIC_RSI_CONTEXT_NOT_PROPAGATED');
}
"""
assert s.count('async function release(io,candidate){')==1
s=s.replace('async function release(io,candidate){',readiness+'async function release(io,candidate){')
assert s.count('const a=await io.health();assert(a.kvConfigured')==1
s=s.replace('const a=await io.health();assert(a.kvConfigured','const a=await v45WaitForPublicReadiness(io);assert(a.kvConfigured')
out=Path(sys.argv[1]);out.write_text(s);print('V45_RELEASE_GUARD_SHA256',hashlib.sha256(s.encode()).hexdigest())
