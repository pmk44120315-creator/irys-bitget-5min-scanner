import test from 'node:test';
import assert from 'node:assert/strict';
const NOW=Date.parse('2026-10-31T12:00:00Z');
const SHA='2b87c4fa2894dc665b584de6a1c816691d53152f70ea6528741c9524c776bbf3';
async function module(){let m=null;try{m=await import('../deployment/v21_forecast_delivery.mjs')}catch{}assert.ok(m,'V21 delivery not implemented');return m;}
function report(){
 const cert={ready:true,evidence_type:'FROZEN_MODEL_PROSPECTIVE_QUOTE_RETURNS',
 lower_net_pct:.3,mean_net_pct:.6,span_hours:48,hour_blocks:16,
 observed_signals:60,net_wins:40,net_losses:20,cost_scenario_pct:.2,coverage_ratio:1};
 return {version:'IRYS_V21_SUPERVISED_PROSPECTIVE_V1',status:'ACTIVE',source_status:'PASS',
 at_utc:new Date(NOW-10000).toISOString(),source_finished_utc:new Date(NOW-60000).toISOString(),
 certificates:{bitget_5:{'1':cert}},delivery_candidates:[{
 model_key:'bitget_5',model_sha256:SHA,venue:'bitget',symbol:'ALTUSDT',side:1,
 horizon_min:5,event_id:'test-event-1',issued_ms:NOW-10000,expires_ms:NOW+290000,
 entry_quote:{at_ms:NOW-10000,bid:99.99,ask:100},notification_eligible:true,
 certificate:cert,automatic_order:false,telegram_sent:false}]};
}
const market={collector_status:'PASS',early_pool:[{venue:'bitget',symbol:'ALTUSDT',asset_identity:'VERIFIED_CRYPTO'}],watchlist:[]};
function opts(doc=report()){
 return {clock:()=>NOW,readReport:async()=>doc,
   getQuote:async()=>({bid:100.01,ask:100.02,at_ms:NOW}),
   send:async()=>({message_id:123}),
   receipt:(_state,channel,symbol,at,ack)=>({channel,symbol,accepted_at:at,telegram_message_id:ack.message_id}),
   persist:async()=>true};
}
test('positive frozen prospective evidence can reach sender; no permanent false gate',async()=>{
 const m=await module();const state={lastAlert:{}};
 const r=await m.sendV21Forecasts({},state,market,NOW,1,opts());
 assert.equal(r.sent,1);assert.equal(r.status,'TELEGRAM_API_ACK');
 assert.equal(r.message_id,123);assert.ok(state.v21LastSent);
});
test('unqualified future evidence cannot masquerade as a tested direction',async()=>{
 const m=await module();const d=report();d.certificates.bitget_5['1'].ready=false;
 const r=await m.sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,
 {...opts(d),send:async()=>{throw Error('MUST_NOT_SEND')}});
 assert.equal(r.sent,0);assert.ok(r.reasons.PROSP_EVIDENCE_NOT_READY);
});
test('stale report and expired target are not actionable',async()=>{
 const m=await module();const d=report();d.at_utc=new Date(NOW-300000).toISOString();
 const r=await m.sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,opts(d));
 assert.equal(r.sent,0);assert.equal(r.status,'STALE_REPORT');
 const e=report();e.delivery_candidates[0].expires_ms=NOW-1;
 const x=await m.sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,opts(e));
 assert.equal(x.sent,0);assert.ok(x.reasons.EXPIRED_OR_LATE_FORECAST);
});
test('one-hour repeats of same model-symbol-side are suppressed',async()=>{
 const m=await module();const state={lastAlert:{}};
 await m.sendV21Forecasts({},state,market,NOW,1,opts());
 const d=report();d.delivery_candidates[0].event_id='new-but-same-trend';
 const r=await m.sendV21Forecasts({},state,market,NOW+60000,1,{...opts(d),clock:()=>NOW+60000});
 assert.equal(r.sent,0);assert.ok(r.reasons.DUPLICATE_DIRECTION_EPISODE);
});
test('price chase cannot consume the conservative measured edge',async()=>{
 const m=await module();const r=await m.sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,
 {...opts(),getQuote:async()=>({bid:102,ask:102.01,at_ms:NOW})});
 assert.equal(r.sent,0);assert.ok(r.reasons.CONSERVATIVE_EDGE_CONSUMED_BY_PRICE_MOVE);
});
test('unknown model and explicit non-crypto instruments rejected',async()=>{
 const m=await module();const d=report();d.delivery_candidates[0].model_sha256='not-reviewed';
 const a=await m.sendV21Forecasts({}, {lastAlert:{}},market,NOW,1,opts(d));
 assert.equal(a.sent,0);assert.ok(a.reasons.MODEL_IDENTITY_MISMATCH);
 const b=await m.sendV21Forecasts({}, {lastAlert:{}},{...market,early_pool:[{symbol:'ALTUSDT',venue:'bitget',asset_identity:'NON_CRYPTO'}]},NOW,1,opts());
 assert.equal(b.sent,0);assert.ok(b.reasons.INSTRUMENT_NOT_VERIFIED);
});
test('failed Telegram ACK never increments dedupe or successful count',async()=>{
 const m=await module();const state={lastAlert:{}};
 const r=await m.sendV21Forecasts({},state,market,NOW,1,{...opts(),send:async()=>{throw Error('offline')}});
 assert.equal(r.sent,0);assert.equal(r.status,'TELEGRAM_ERROR');
 assert.equal(Object.keys(state.v21LastSent||{}).length,0);
});
test('at most two new messages per hour is transport pacing, not a feature gate',async()=>{
 const m=await module();const state={lastAlert:{},v21Hour:{hour:Math.floor(NOW/3600000),count:2}};
 const r=await m.sendV21Forecasts({},state,market,NOW,1,opts());
 assert.equal(r.sent,0);assert.ok(r.reasons.DELIVERY_PACING);
});
