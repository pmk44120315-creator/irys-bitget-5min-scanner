import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../deployment/v31_outcomes.mjs',import.meta.url),T=1793729400123;
async function load(){assert(existsSync(url),'V31 minute-outcome sidecar absent');return import(url)}
const row=(d='LONG')=>({venue:'bitget',symbol:'TESTUSDT',direction:d,issued_at_ms:T,entry_quote:{bid:100,ask:100.1,at_ms:T-1000},outcomes:{'5':{status:'UNMEASURED_TARGET_QUOTE'}}});
function page(h=5){const end=Math.ceil((T+h*60000)/60000)*60000;return {venue:'bitget',symbol:'TESTUSDT',source:'OFFICIAL_NATIVE_1M',fetched_at_ms:end+1000,bars:[{start_ms:end-60000,open:101,high:102,low:100,close:101}]};}
test('quote phase-missed 5m is measured separately from native minute close without inventing bid/ask',async()=>{
 const m=await load(),p=page(),input=row(),r=m.v31SettleMinute([input],[p],p.fetched_at_ms)[0];
 assert.equal(r.outcomes['5'].status,'UNMEASURED_TARGET_QUOTE');assert.equal(r.minute_outcomes['5'].status,'MEASURED_MINUTE_CLOSE_PROXY');assert.equal(r.minute_outcomes['5'].executable_exit_verified,false);assert(r.minute_outcomes['5'].target_offset_ms<60000);assert.equal(input.minute_outcomes,undefined);
});
test('missing target bar is not forward-filled from an earlier candle',async()=>{
 const m=await load(),p=page();p.bars[0].start_ms-=60000;const r=m.v31SettleMinute([row()],[p],p.fetched_at_ms)[0];assert.notEqual(r.minute_outcomes?.['5']?.status,'MEASURED_MINUTE_CLOSE_PROXY');
});
test('no unclosed or future candle can label an outcome',async()=>{
 const m=await load(),p=page();const r=m.v31SettleMinute([row()],[p],T+300000)[0];assert.notEqual(r.minute_outcomes?.['5']?.status,'MEASURED_MINUTE_CLOSE_PROXY');
});
test('wrong symbol or venue cannot label another forecast',async()=>{
 const m=await load();for(const key of ['symbol','venue']){const p=page();p[key]='OTHER';const r=m.v31SettleMinute([row()],[p],p.fetched_at_ms)[0];assert.notEqual(r.minute_outcomes?.['5']?.status,'MEASURED_MINUTE_CLOSE_PROXY');}
});
test('short and long metrics use appropriate original sides and remain scenario proxies',async()=>{
 const m=await load(),p=page();const rows=m.v31SettleMinute([row('LONG'),row('SHORT')],[p],p.fetched_at_ms);assert(rows[0].minute_outcomes['5'].gross_reference_pct>0);assert(rows[1].minute_outcomes['5'].gross_reference_pct<0);assert.equal(rows[1].minute_outcomes['5'].actual_execution_verified,false);
});
test('already measured labels are not rewritten after new future prices arrive',async()=>{
 const m=await load(),p=page(),a=m.v31SettleMinute([row()],[p],p.fetched_at_ms);p.bars[0].close=100;const b=m.v31SettleMinute(a,[p],p.fetched_at_ms);assert.deepEqual(b[0].minute_outcomes,a[0].minute_outcomes);
});
test('Bithumb UTC candle anchor is not inferred from last-trade timestamp',async()=>{
 const m=await load(),raw=[{market:'KRW-TEST',candle_date_time_utc:'2026-11-03T18:10:00',opening_price:1,high_price:2,low_price:.5,trade_price:1.5,timestamp:0}];const out=m.v31ParseBars(raw,'bithumb','KRW-TEST',Date.parse('2026-11-03T18:12:00Z'));assert.equal(out[0].start_ms,Date.parse('2026-11-03T18:10:00Z'));
});
test('invalid candle OHLC and conflicting duplicates are excluded',async()=>{
 const m=await load(),t=Math.floor(T/60000)*60000;assert.deepEqual(m.v31ParseBars([[t,1,.5,2,1]],'bitget','TESTUSDT',t+60000),[]);
 assert.deepEqual(m.v31ParseBars([[t,1,2,.5,1],[t,1,2,.5,1.1]],'bitget','TESTUSDT',t+60000),[]);
});
test('malformed official candle response is a source error, never a successful empty history',async()=>{
 const m=await load(),r={...row(),evidence_status:'READY_CURRENT_EVIDENCE'};
 const got=await m.v31FetchHistory([r],async()=>({code:'00000',data:null}),()=>T+360000,[]);
 assert(got.errors.some(x=>x.reason==='OFFICIAL_HISTORY_UNAVAILABLE'));assert.equal(got.pages.length,0);
});
