import test from 'node:test';
import assert from 'node:assert/strict';
import {sendV21Forecasts} from '../deployment/v21_forecast_delivery.mjs';
const NOW=Date.parse('2026-10-31T12:00:00Z');
const SHA='2b87c4fa2894dc665b584de6a1c816691d53152f70ea6528741c9524c776bbf3';
function data(age){
 const proof={ready:true,evidence_type:'FROZEN_MODEL_PROSPECTIVE_QUOTE_RETURNS',
 lower_net_pct:.3,mean_net_pct:.5,span_hours:48,hour_blocks:16,observed_signals:60,
 cost_scenario_pct:.2,coverage_ratio:1};
 return {version:'IRYS_V21_SUPERVISED_PROSPECTIVE_V1',status:'ACTIVE',source_status:'PASS',
 at_utc:new Date(NOW-age).toISOString(),certificates:{bitget_5:{'1':proof}},
 delivery_candidates:[{model_key:'bitget_5',model_sha256:SHA,venue:'bitget',symbol:'ALTUSDT',
 side:1,horizon_min:5,event_id:'valid-five-minute-forecast',issued_ms:NOW-age,
 expires_ms:NOW-age+300000,entry_quote:{bid:99.99,ask:100,at_ms:NOW-age},
 certificate:proof,notification_eligible:true}]};
}
const market={collector_status:'PASS',early_pool:[{symbol:'ALTUSDT',venue:'bitget',asset_identity:'VERIFIED_CRYPTO'}]};
const options=doc=>({clock:()=>NOW,waitForFresh:false,readReport:async()=>doc,
 getQuote:async()=>({bid:100,ask:100.01,at_ms:NOW}),send:async()=>({message_id:88}),
 receipt:(_state,channel,symbol,at,ack)=>({channel,symbol,at,telegram_message_id:ack.message_id}),persist:async()=>true});
test('110-second-old five-minute forecast has more than half its horizon and is not needlessly blocked',async()=>{
 const r=await sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,options(data(110000)));
 assert.equal(r.sent,1);assert.equal(r.status,'TELEGRAM_API_ACK');
});
test('over-half-consumed horizon is still rejected as late',async()=>{
 const r=await sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,options(data(180000)));
 assert.equal(r.sent,0);
});
test('recent healthy but unqualified research is described as learning, not transport failure',async()=>{
 const d=data(240000);d.delivery_candidates=[];d.certificates.bitget_5['1'].ready=false;
 const r=await sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,options(d));
 assert.equal(r.status,'LEARNING_NO_ELIGIBLE_FORWARD_EVIDENCE');assert.equal(r.sent,0);
});
test('very old producer data is diagnosed as stale even when no eligible message exists',async()=>{
 const d=data(1800000);d.delivery_candidates=[];d.certificates.bitget_5['1'].ready=false;
 const r=await sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,options(d));
 assert.equal(r.status,'STALE_REPORT');assert.equal(r.sent,0);
});
