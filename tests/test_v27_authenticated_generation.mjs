import test from 'node:test';import assert from 'node:assert/strict';
import {v27ReadFresh} from '../deployment/v27_response.mjs';
const T=1793588700000;
function doc(at=T){return {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:at,parent_at_ms:at-1000,source:{at_ms:at-1000}};}
test('actual stale raw branch case prefers authorized content with same-generation clock',async()=>{
 const calls=[];const x=await v27ReadFresh(async(url,opts)=>{calls.push({url,opts});return url.startsWith('https://api.github.com/')?doc():doc(T-300000)},T,{clock:()=>T,maxWaitMs:0,githubToken:'MOCK_ONLY'});
 assert.equal(x.status,'FRESH');assert.equal(x.source_transport,'GITHUB_AUTHENTICATED_CONTENTS');
 assert.equal(calls.length,1);assert.equal(calls[0].opts.headers.authorization,'Bearer MOCK_ONLY');
 assert.equal(calls[0].opts.headers.accept,'application/vnd.github.raw+json');
 assert.ok(!JSON.stringify(x).includes('MOCK_ONLY'));
});
test('expired auth falls back to raw without forwarding secret to raw host',async()=>{
 const calls=[];const x=await v27ReadFresh(async(url,opts)=>{calls.push({url,opts});if(url.startsWith('https://api.github.com/'))throw Error('HTTP_401');return doc();},T,{clock:()=>T,maxWaitMs:0,githubToken:'MOCK_SECRET'});
 assert.equal(x.status,'FRESH');assert.equal(x.source_transport,'PUBLIC_RAW_FALLBACK');assert.equal(calls.length,2);
 assert.equal(calls[1].opts.headers.authorization,undefined);assert.ok(!JSON.stringify(x).includes('MOCK_SECRET'));
});
test('authorized HTTP success still cannot turn old generation into fresh quotes',async()=>{
 const x=await v27ReadFresh(async()=>doc(T-300000),T,{clock:()=>T,maxWaitMs:0,githubToken:'MOCK_ONLY'});
 assert.equal(x.status,'FRESH_GENERATION_UNAVAILABLE');assert.equal(x.last_observation.same_generation,false);
 assert.ok(!JSON.stringify(x).includes('MOCK_ONLY'));
});
test('primary error diagnostics never echo token text in provider exceptions',async()=>{
 const x=await v27ReadFresh(async()=>{throw Error('leaked MOCK_SECRET must never be in telemetry')},T,{clock:()=>T,maxWaitMs:0,githubToken:'MOCK_SECRET'});
 assert.equal(x.status,'FRESH_GENERATION_UNAVAILABLE');assert.ok(!JSON.stringify(x).includes('MOCK_SECRET'));
});
