import test from 'node:test';
import assert from 'node:assert/strict';
import {v37PrepareRows,v37RunCycle,v37Stats,v37PendingMarkets} from '../deployment/v37_runner.mjs';
const T=1793952300000,STEP=300000;
const points=[
 [T-3*STEP,100,1000000],
 [T-2*STEP,100.02,1200000],
 [T-STEP,100.03,1700000],
 [T,100.05,3000000]];
const state={at_ms:T,v28:{at_ms:T,assets:{'KRW-TEST':{points},'KRW-LATE':{points:points.map(([t,p,v],i)=>[t,p+(i===3?14:i*4),v])}}}};
const fast={at_ms:T,prices:{XYZUSDT:[100,0,T],BADUSDT:[2,0,T]},venue:'bitget',status:'SOURCE_AVAILABLE'};
const ticker={symbol:'XYZUSDT',lastPr:'100.05',usdtVolume:'3100000',ts:String(T)};
const futureOld={XYZUSDT:[[T-3*STEP,100,1000000],[T-2*STEP,100.02,1200000],[T-STEP,100.03,1700000]]};
test('combines universe of all market candidates rather than only top already-moving list',()=>{
 const r=v37PrepareRows({spotState:state,fastFeed:fast,tickers:[ticker],futuresHistory:futureOld,now:T});
 assert(r.rows.some(x=>x.symbol==='KRW-TEST'));
 assert(r.rows.some(x=>x.symbol==='XYZUSDT'));
 assert(!r.rows.some(x=>x.symbol==='BADUSDT'));
 assert.equal(r.nextFutures.XYZUSDT.length,4);
});
test('new stale or mismatched ticker cannot masquerade as a valid early candidate',()=>{
 const bad={...ticker,ts:String(T-300000)};
 const r=v37PrepareRows({spotState:state,fastFeed:fast,tickers:[bad],futuresHistory:futureOld,now:T});
 assert(!r.rows.some(x=>x.symbol==='XYZUSDT'));
 assert(r.source_errors.some(x=>x.reason==='STALE_OR_INVALID_FUTURES_PRICE'));
});
test('a full run records only as-of early watches, with no current-time telegram alerts',()=>{
 const r=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 assert.equal(r.output.telegram_sent,false);assert.equal(r.output.orders_sent,false);assert.equal(r.output.live_entry_approved,false);
 assert(r.output.new_events>=1);assert(r.state.events.some(x=>x.symbol==='KRW-TEST'));
 assert.equal(r.output.prediction_accuracy_proven,false);
});
test('a replay of same historical snapshot creates no new independent opportunities',()=>{
 const a=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 const b=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:a.state,now:T+10000,nativePages:[]});
 assert.equal(b.output.new_events,0);
});
test('new future source unavailable cannot erase previous prospective samples',()=>{
 const a=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 const b=v37RunCycle({spotState:{},fastFeed:{},tickers:[],history:a.state.futuresHistory,old:a.state,now:T+STEP,nativePages:[]});
 assert.equal(b.state.events.length,a.state.events.length);
 assert(b.output.source_errors.length>0);
});
test('summary never counts missing result or research event as actual Telegram accuracy',()=>{
 const a=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 const s=v37Stats(a.state.events);
 assert.equal(s.actual_telegram_acks,0);assert.equal(s.measured['5'],0);assert.equal(s.ready_to_promote,false);
});
test('select pending market only if outcome is unmeasured, within observed future horizon',()=>{
 const a=v37RunCycle({spotState:state,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 const xs=v37PendingMarkets(a.state.events,T+15*60000,40);
 assert(xs.some(x=>x.venue==='bithumb'&&x.symbol==='KRW-TEST'));
});

test('only actual public V30 READY can count as later baseline evidence, not all old candidates',()=>{
 const data={...state,records:[{venue:'bithumb',symbol:'KRW-TEST',direction:'BUY',issued_at_ms:T+300000,model:'V31_PAIRED_TIMELY_ENTRY_V1',evidence_status:'READY_CURRENT_EVIDENCE',entry_quote:{ask:100.5,bid:100.4}}]};
 const r=v37RunCycle({spotState:data,fastFeed:fast,tickers:[ticker],history:futureOld,old:{},now:T,nativePages:[]});
 assert.equal(r.output.public_baseline_ready_timing.matched,1);
 assert.equal(r.output.public_baseline_ready_timing.median_lead_ms,300000);
 assert.equal(r.output.public_baseline_ready_timing.actual_telegram_ack_matches_verified,false);
});
