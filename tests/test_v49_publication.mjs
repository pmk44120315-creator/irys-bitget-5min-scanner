import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {v48PublishResearch,v48LoadState} from '../deployment/v48_persistence.mjs';
import {v48ReadArchive} from '../deployment/v48_evidence_archive.mjs';
import {v36Observe} from '../deployment/v36_shadow.mjs';import {packet,T} from './v49_fixture.mjs';
const output={orders_sent:false,telegram_sent:false};
function initial(){return v36Observe({events:[]},{packet:packet(),now:T,baselineDigest:'exact'}).state;}
test('later recovery diagnostics append a revision without changing frozen decision identity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v49-publish-'));
 try{
  const s=initial();v48PublishResearch({directory:dir,kind:'v36',old:{events:[]},state:s,output,now:T+1000});
  const root=join(dir,'v36_archive'),before=Object.fromEntries(readdirSync(root).map(n=>[n,readFileSync(join(root,n),'utf8')]));
  const next=structuredClone(s);next.events[0].history_recovery={version:'V49_BOUNDED_HISTORY_RECOVERY_V1',horizons:{'5':{reason:'TARGET_MINUTE_ABSENT_IN_OFFICIAL_WINDOW',attempts:1,next_retry_at_ms:T+12*60000}}};
  const pub=v48PublishResearch({directory:dir,kind:'v36',old:s,state:next,output,now:T+6*60000});
  assert.equal(pub.archive.appended,1);assert.equal(pub.archive.unique_events,1);
  for(const [n,text] of Object.entries(before))assert(readFileSync(join(root,n),'utf8').startsWith(text),'earlier archive bytes rewritten');
  const rows=v48ReadArchive(root);assert.equal(rows.revisions,2);assert.equal(rows.events[0].history_recovery.horizons['5'].attempts,1);
  const saved=readFileSync(join(dir,'v36_shadow_state.json'));assert.equal(createHash('sha256').update(saved).digest('hex'),pub.output.state_sha256);
  assert.equal(v48LoadState(join(dir,'v36_shadow_state.json')).publication.revision,pub.output.publication.revision);
  const again=structuredClone(next);again.events[0].history_recovery.horizons['5'].attempts=2;
  v48PublishResearch({directory:dir,kind:'v36',old:next,state:again,output,now:T+12*60000});
  assert.equal(v48ReadArchive(root).revisions,3);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('allowing recovery metadata revisions cannot permit changed entry, direction or decision clock',()=>{
 for(const mutate of [e=>e.entry_price+=1,e=>e.direction='SHORT',e=>e.issued_at_ms+=1,e=>e.source_quote_at_ms+=1]){
  const dir=mkdtempSync(join(tmpdir(),'v49-immutable-'));
  try{const s=initial();v48PublishResearch({directory:dir,kind:'v36',old:{events:[]},state:s,output,now:T+1000});
   const before=readFileSync(join(dir,'v36_shadow_state.json'),'utf8'),next=structuredClone(s);mutate(next.events[0]);
   assert.throws(()=>v48PublishResearch({directory:dir,kind:'v36',old:s,state:next,output,now:T+60000}),/IMMUTABLE_CONFLICT/);
   assert.equal(readFileSync(join(dir,'v36_shadow_state.json'),'utf8'),before);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
