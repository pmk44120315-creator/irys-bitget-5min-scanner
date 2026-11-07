import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,incorporate,ledgerStats,run} from '../research/v39_ack_feedback_ledger.mjs';
const T=1794049888026, NOW=T+3600000;
const source='a'.repeat(40);
function proof({symbol='AKEUSDT',direction='SHORT',pct=-1.68,at=T,source_commit=source}={}){
 return {read_only:true,telegram_sent:false,orders_sent:false,same_pre_ack_evidence_verified:true,
  ack_at_ms:at,source_at_ms:at-8000,symbol,venue:'bitget',direction,source_commit,
  source_to_ack_ms:8000,quote_to_ack_ms:8000,preselection_5m_move_pct:-.78,
  independent_first_taker_share:.17,independent_second_taker_share:.48,
  outcomes:{'5':{status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:at+5*60000,
   closed_at_ms:Math.floor((at+5*60000)/60000)*60000,actual_execution_verified:false,
   signed_price_pct:pct,scenario_after_0_20pct_cost:pct-.2,
   path_minutes_observed:4,path_minutes_expected:4},
   '15':{status:'PENDING_HORIZON'},'30':{status:'PENDING_HORIZON'},'60':{status:'PENDING_HORIZON'}}};
}
test('first true public ACK becomes a single sanitized durable event',()=>{
 const r=incorporate(empty(),proof(),NOW);
 assert.equal(r.added,1);assert.equal(r.ledger.events.length,1);
 assert.equal(r.ledger.events[0].outcomes['5'].signed_price_pct,-1.68);
 assert.equal(r.ledger.events[0].source_commit,source);
});
test('duplicate replay does not count signal twice or invent an improvement',()=>{
 const a=incorporate(empty(),proof(),NOW);
 const b=incorporate(a.ledger,proof(),NOW+100);
 assert.equal(b.added,0);assert.equal(b.updated,0);assert.equal(b.ledger.events.length,1);
});
test('existing mature label remains immutable when later history conflicts',()=>{
 const old=incorporate(empty(),proof(),NOW).ledger;
 const changed=proof({pct:9});
 const out=incorporate(old,changed,NOW+100);
 assert.equal(out.conflicts,1);
 assert.equal(out.ledger.events[0].outcomes['5'].signed_price_pct,-1.68);
});
test('unverified future label may not be stored as a measured success',()=>{
 const p=proof();p.outcomes['5'].target_ms=T+60000;
 const r=incorporate(empty(),p,NOW);
 assert.equal(r.ledger.events[0].outcomes['5'].status,'UNVERIFIED_MEASUREMENT');
});
test('missing pre-ACK source is rejected with no invented Telegram trade',()=>{
 const p=proof();p.same_pre_ack_evidence_verified=false;
 const r=incorporate(empty(),p,NOW);
 assert.equal(r.added,0);assert.equal(r.ledger.events.length,0);assert.equal(r.ignored,1);
});
test('same exact ACK with contradicting source or direction cannot rewrite it',()=>{
 const old=incorporate(empty(),proof(),NOW).ledger;
 const r=incorporate(old,proof({direction:'LONG'}),NOW+100);
 assert.equal(r.conflicts,1);assert.equal(r.ledger.events[0].direction,'SHORT');
});
test('no private chat id, message text, account key or Telegram token in the resulting ledger',()=>{
 const p=proof();Object.assign(p,{chat_id:'SENSITIVE_CHAT_ID',message_text:'PRIVATE_MESSAGE',token:'PRIVATE_BOT'});
 const r=incorporate(empty(),p,NOW);
 const s=JSON.stringify(r.ledger);
 assert(!s.includes('SENSITIVE_CHAT_ID')&&!s.includes('PRIVATE_MESSAGE')&&!s.includes('PRIVATE_BOT'));
});
test('time-scoped unresolved outcomes are not silently favorable',()=>{
 const r=ledgerStats(incorporate(empty(),proof(),NOW).ledger,NOW);
 assert.equal(r.horizons[5].measured,1);assert.equal(r.horizons[5].positive,0);
 assert.equal(r.horizons[15].missing_or_pending,1);
 assert.equal(r.trade_execution_verified,false);
});
test('historical live ACK is not treated as a complete capture of all past messages',()=>{
 const r=incorporate(empty(),proof(),NOW).ledger;
 assert.equal(r.all_alerts_captured_proven,false);
});
test('pure feedback logic does not mutate original prior state',()=>{
 const a=incorporate(empty(),proof(),NOW).ledger;
 const before=JSON.stringify(a);incorporate(a,proof({direction:'LONG'}),NOW+100);
 assert.equal(JSON.stringify(a),before);
});
test('advance function preserves prior observation when no public ACK is available',async()=>{
 const old=incorporate(empty(),proof(),NOW).ledger;
 const current={read_only:true,telegram_sent:false,orders_sent:false};
 const r=await run({state:old,latest:current,now:NOW+2*3600000});
 assert.equal(r.ledger.events.length,1);assert.equal(r.ledger.events[0].direction,'SHORT');
});
