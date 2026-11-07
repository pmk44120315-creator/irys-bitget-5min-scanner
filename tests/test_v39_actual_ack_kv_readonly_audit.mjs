import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLiveRows} from '../research/v39_actual_ack_kv_readonly_audit.mjs';
const T=1794040000000;
const now=T+2*3600000;
function e(id='x',dir='LONG',signed=1,venue='bitget',issued=T){
 const entry=dir==='SHORT'?100:100.1;
 return {id:'ACK:'+id,venue,symbol:venue==='bitget'?'AAAUSDT':'KRW-AAA',direction:dir,issued_at_ms:issued,
  entry_quote:{bid:100,ask:100.1,at_ms:issued-5000},
  minute_outcomes:{'5':{status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:issued+5*60000,
   gross_reference_pct:signed,net_cost_scenario_pct:signed-.2,actual_execution_verified:false}}};
}
test('actual ACK LONG and SHORT outcomes are separately attributed',()=>{
 const r=summarizeLiveRows([e('a','LONG',1),e('b','SHORT',-1)],now);
 assert.equal(r.actual_ack_records,2);
 assert.equal(r.groups['bitget:LONG'].horizons[5].positive,1);
 assert.equal(r.groups['bitget:SHORT'].horizons[5].positive,0);
});
test('positive gross but nonpositive scenario is not mislabeled profitable',()=>{
 const r=summarizeLiveRows([e('a','LONG',.1)],now);
 const p=r.groups['bitget:LONG'].horizons[5];
 assert.equal(p.positive,1);assert.equal(p.net_scenario_positive,0);
});
test('unmeasured close cannot count as directional miss or hit',()=>{
 const a=e();delete a.minute_outcomes['5'];
 const r=summarizeLiveRows([a],now),h=r.groups['bitget:LONG'].horizons[5];
 assert.equal(h.measured,0);assert.equal(h.missing,1);assert.equal(h.positive,0);
});
test('pending horizon cannot be silently treated as loss',()=>{
 const a=e();a.issued_at_ms=now-60000;a.entry_quote.at_ms=a.issued_at_ms-5000;
 const r=summarizeLiveRows([a],now);
 assert.equal(r.groups['bitget:LONG'].horizons[5].pending,1);
});
test('invalid venue, stale source, future issue or impossible ASK are excluded',()=>{
 const a=e('a');a.entry_quote.ask=99;
 const b=e('b');b.entry_quote.at_ms=T-70000;
 const c=e('c');c.issued_at_ms=now+1;
 const d=e('d');d.venue='unknown';
 const r=summarizeLiveRows([a,b,c,d,e('valid')],now);
 assert.equal(r.actual_ack_records,1);assert.equal(r.unverified_fields_skipped,4);
});
test('spot BUY remains BUY, no short interpretation on spot exchange',()=>{
 const a=e('spot','BUY',-1,'bithumb');
 const r=summarizeLiveRows([a],now);
 assert.equal(r.groups['bithumb:BUY'].horizons[5].measured,1);
 assert.equal(r.groups['bitget:SHORT'].events,0);
});
test('private message identifiers and bot configuration are never exported',()=>{
 const a=e('private');a.chat_id='private-chat';a.telegram_token='private-token';
 const r=summarizeLiveRows([a],now);const out=JSON.stringify(r);
 assert(!out.includes('private-chat'));assert(!out.includes('private-token'));
 assert(!out.includes('ACK:private'));assert.equal(r.metadata_only,true);
});
test('does not mutate underlying KV state',()=>{
 const a=[e('a'),e('b')],before=JSON.stringify(a);
 summarizeLiveRows(a,now);assert.equal(JSON.stringify(a),before);
});
