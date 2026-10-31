import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../deployment/v21_forecast_delivery.mjs';
const NOW=Date.parse('2026-10-31T12:00:00Z');
test('fresh publication arriving after the first read is retried without cached URL',async()=>{
 assert.equal(typeof m.readV21CurrentReport,'function');
 let at=NOW,reads=0;const urls=[];
 const doc=await m.readV21CurrentReport(async url=>{
  urls.push(url);reads++;
  return {version:'IRYS_V21_SUPERVISED_PROSPECTIVE_V1',status:'ACTIVE',
    at_utc:new Date(reads===1?NOW-300000:at-1000).toISOString(),
    certificates:{bitget_5:{'1':{ready:true}}}};
 },()=>at,async ms=>{at+=ms;},true);
 assert.equal(reads,2);assert.notEqual(urls[0],urls[1]);
 assert.ok(at-Date.parse(doc.at_utc)<90000);
});
test('no qualified forward evidence never delays the legacy watcher',async()=>{
 assert.equal(typeof m.readV21CurrentReport,'function');
 let waits=0;
 const d=await m.readV21CurrentReport(async()=>({status:'ACTIVE',
   version:'IRYS_V21_SUPERVISED_PROSPECTIVE_V1',at_utc:new Date(NOW-300000).toISOString(),
   certificates:{bitget_5:{'1':{ready:false}}}}),()=>NOW,async()=>{waits++;},true);
 assert.equal(waits,0);assert.ok(d);
});
test('persistent stale source returns a diagnostic without forcing a message',async()=>{
 assert.equal(typeof m.readV21CurrentReport,'function');
 let at=NOW;
 const d=await m.readV21CurrentReport(async()=>({status:'ACTIVE',
  version:'IRYS_V21_SUPERVISED_PROSPECTIVE_V1',at_utc:new Date(NOW-300000).toISOString(),
  certificates:{bitget_5:{'1':{ready:true}}}}),()=>at,async ms=>{at+=ms;},true);
 assert.ok(at>=NOW+90000);assert.ok(d);
});
