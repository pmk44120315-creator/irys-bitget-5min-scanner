import test from 'node:test';
import assert from 'node:assert/strict';
import {incorporate,run} from '../research/v39_ack_feedback_ledger.mjs';
const fixture={version:'IRYS_V39_PUBLIC_ACK_FEEDBACK_LEDGER_V1',asof_ms:0,events:[],source:'PUBLIC_TELEGRAM_API_ACK_AND_OFFICIAL_PRE_ACK_V30_COMMIT',scope:'RESEARCH_ONLY_NO_TELEGRAM_SEND_OR_ORDER',complete_ack_history_verified:false,actual_execution_verified:false};
const T=1794051279190;
test('exact production initial ledger has canonical safety fields even when latest proof unavailable',async()=>{
 const original=JSON.stringify(fixture);
 const result=await run({state:fixture,latest:{status:'NO_CURRENT_PUBLIC_ACK'},now:T});
 assert.equal(result.ledger.research_only,true);
 assert.equal(result.ledger.telegram_sent,false);
 assert.equal(result.ledger.orders_sent,false);
 assert.equal(result.ledger.all_alerts_captured_proven,false);
 assert.equal(JSON.stringify(fixture),original);
});
test('legacy existing records are preserved on metadata migration without claiming complete capture',()=>{
 const old={...fixture,events:[{id:'preserve',ack_at_ms:T-1,outcomes:{'5':{status:'PENDING_HORIZON'}}}]};
 const migrated=incorporate(old,null,T).ledger;
 assert.equal(migrated.research_only,true);
 assert.deepEqual(migrated.events,old.events);
 assert.equal(migrated.actual_execution_verified,false);
});
