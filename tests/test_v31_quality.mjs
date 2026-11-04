import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
import {item,T} from './fixtures/v30_pair.mjs';
const path=new URL('../deployment/v31_quality.mjs',import.meta.url);
async function load(){assert(existsSync(path),'V31 entry-budget and pair scheduling helper absent');return import(path)}
test('entry budget rejects chase measured against its own original traded range, not a fixed percent',async()=>{
 const m=await load(),x=item();x.candidate.discovery_price=99.9;x.final.quote.ask=103;x.final.quote.bid=102.9;
 assert.equal(m.v31EntryBudget(x).allowed,false);
});
test('normal LONG and symmetric SHORT remain possible without any future-win assertion',async()=>{
 const m=await load();for(const dir of ['LONG','SHORT']){const r=m.v31EntryBudget(item(dir));assert.equal(r.allowed,true,JSON.stringify(r));assert.equal(r.forecast_accuracy_proven,false);}
});
test('exact saved AKE original price evidence exposes entry drift larger than original range',async()=>{
 const m=await load();const p=process.env.V31_AKE_PACKET||new URL('./fixtures/v31_ake_case.json',import.meta.url);
 assert(p,'real AKE source fixture missing');const doc=JSON.parse(readFileSync(p,'utf8'));
 const x=doc.items.find(x=>x.candidate.symbol==='AKEUSDT');assert(x);const r=m.v31EntryBudget(x);
 assert.equal(r.allowed,false);assert(r.directional_drift>r.budget_price);
});
test('new READY after a rejection is not swallowed by the previous15minute freeze',async()=>{
 const m=await load(),r={issued_at_ms:T-1000,evidence_status:'NOT_READY'};
 assert.equal(m.v31ShouldRecord(r,{status:'READY_CURRENT_EVIDENCE'},T),true);
 assert.equal(m.v31ShouldRecord({...r,evidence_status:'READY_CURRENT_EVIDENCE'},{status:'READY_CURRENT_EVIDENCE'},T),false);
});
test('a slow independent market does not delay second snapshot of a ready market',async()=>{
 const m=await load();let now=0,jobs=[],taken=[];
 const sleep=ms=>new Promise(resolve=>jobs.push({at:now+ms,resolve}));
 const counts={};const snapshot=async c=>{counts[c.symbol]=(counts[c.symbol]||0)+1;
  if(c.symbol==='SLOW'&&counts[c.symbol]===1)await sleep(30000);
  taken.push([c.symbol,counts[c.symbol],now]);return {observed_at_ms:now,symbol:c.symbol};};
 let done=false;const task=m.v31ReadPairs([{symbol:'FAST'},{symbol:'SLOW'}],snapshot,()=>now,sleep).then(x=>(done=true,x));
 for(let i=0;!done&&i<100;i++){for(let j=0;j<10;j++)await Promise.resolve();jobs.sort((a,b)=>a.at-b.at);if(jobs.length){const next=jobs.shift();now=next.at;next.resolve();}}
 const r=await task;assert.equal(r.length,2);assert(taken.find(x=>x[0]==='FAST'&&x[1]===2)[2]<30000);assert(taken.find(x=>x[0]==='FAST'&&x[1]===2)[2]>=8500);
});
test('a new model revision is recorded separately, never hidden by a recent old-model READY',async()=>{
 const m=await load();assert.equal(m.v31ShouldRecord({issued_at_ms:T-1000,evidence_status:'READY_CURRENT_EVIDENCE',model:'OLD'}, {status:'READY_CURRENT_EVIDENCE',model:'NEW'},T),true);
});
