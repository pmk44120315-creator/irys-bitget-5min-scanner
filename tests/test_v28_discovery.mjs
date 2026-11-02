import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
const url=new URL('../deployment/v28_discovery.mjs',import.meta.url);
async function engine(){assert.ok(existsSync(url),'V28 buildup ledger not implemented');return import(url)}
const T=1793610000000,STEP=300000;
function feed(t,change={},warnings=[]){
 const markets=Array.from({length:105},(_,i)=>({market:'KRW-C'+i,market_warning:'NONE'}));
 const tickers=markets.map((m,i)=>{const v=change[m.market]||{};const at=v.tradeAt??t-1000;const d=new Date(at).toISOString();return {market:m.market,trade_price:v.price??100,acc_trade_price:v.cum??(1000000+Math.floor((t-T)/STEP)*1000),signed_change_rate:v.day??0,trade_date:d.slice(0,10).replaceAll('-',''),trade_time:d.slice(11,19).replaceAll(':',''),...v};});
 return {bithumb_markets:markets,bithumb_tickers:tickers,bithumb_warnings:warnings};
}
test('slow quarter-percent steps remain discoverable although no step reaches .70',async()=>{
 const {v28Discover}=await engine();let s={};let r;
 for(let i=0;i<5;i++){r=v28Discover(s,feed(T+i*STEP,{'KRW-C0':{price:100*1.0025**i,cum:1000000+10000*i*i}}),T+i*STEP);s=r.next;}
 const c=r.candidates.find(x=>x.symbol==='KRW-C0');assert.ok(c);assert.ok(c.move_pct<.70);assert.ok(c.build_gain_pct>.99);assert.ok(c.relative_run_pct>0);
 assert.equal(c.future_direction_proven,false);assert.equal(c.forecast_direction,null);
});
test('warning and designated caution stay visible but never become a safe BUY',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;
 const f=feed(T+STEP,{'KRW-C0':{price:110,day:.20}},[{market:'KRW-C0',warning_type:'TRADING_VOLUME_SUDDEN_FLUCTUATION',warning_step:'DANGER',end_date:'2026-11-03 23:59:59'}]);
 const r=v28Discover(old,f,T+STEP);const leader=r.leaders.find(x=>x.symbol==='KRW-C0');assert.ok(leader);assert.equal(leader.alert_eligible,false);assert.ok(leader.risks.length);assert.ok(!r.candidates.some(x=>x.symbol==='KRW-C0'));
});
test('day gain alone cannot turn a falling leader into an early rise',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T,{'KRW-C0':{price:120,day:.20}}),T).next;
 const r=v28Discover(old,feed(T+STEP,{'KRW-C0':{price:117,day:.17}}),T+STEP);
 assert.ok(r.leaders.some(x=>x.symbol==='KRW-C0'));assert.ok(!r.candidates.some(x=>x.symbol==='KRW-C0'));
 assert.equal(r.rows.find(x=>x.symbol==='KRW-C0').stage,'WEAKENING');
});
test('all-market common move is not invented as unique relative strength',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;const d=Object.fromEntries(Array.from({length:105},(_,i)=>['KRW-C'+i,{price:101,cum:1005000}]));
 const r=v28Discover(old,feed(T+STEP,d),T+STEP);assert.ok(r.rows.every(x=>Math.abs(x.relative_step_pct??0)<1e-8));assert.equal(r.candidates.length,0);
});
test('turnover reset is missing flow, not fabricated new money or total market exclusion',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;
 const r=v28Discover(old,feed(T+STEP,{'KRW-C0':{price:101,cum:20}}),T+STEP);const x=r.rows.find(x=>x.symbol==='KRW-C0');
 assert.equal(x.turnover_delta,null);assert.equal(x.flow_status,'COUNTER_RESET');assert.ok(r.candidates.some(x=>x.symbol==='KRW-C0'));
});
test('gap resets comparisons; it must not fabricate a five-minute move',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;const r=v28Discover(old,feed(T+20*60000,{'KRW-C0':{price:120,cum:90000000}}),T+20*60000);
 assert.equal(r.candidates.length,0);assert.equal(r.rows.find(x=>x.symbol==='KRW-C0').stage,'BASELINE_ONLY');
});
test('duplicate tick and unavailable venue preserve earlier ledger',async()=>{
 const {v28Discover}=await engine();const a=v28Discover({},feed(T),T).next;
 const b=v28Discover(a,feed(T),T);assert.deepEqual(b.next,a);assert.equal(b.summary.status,'DUPLICATE_UNCHANGED');
 const c=v28Discover(a,{bithumb_markets:[],bithumb_tickers:[],bithumb_warnings:[]},T+STEP);assert.deepEqual(c.next,a);assert.equal(c.summary.status,'SOURCE_UNAVAILABLE');
});
test('stale or future trade is visible as nonactionable and not used in market median',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;
 const r=v28Discover(old,feed(T+STEP,{'KRW-C0':{price:110,day:.2,tradeAt:T-500000},'KRW-C1':{price:120,tradeAt:T+STEP+120000}}),T+STEP);
 assert.ok(!r.candidates.some(x=>['KRW-C0','KRW-C1'].includes(x.symbol)));assert.equal(r.rows.find(x=>x.symbol==='KRW-C0').stage,'STALE_TRADE');
});
test('use a real V27 prior tape as migration baseline without inventing older history',async()=>{
 const {v28Discover}=await engine();const tape={spot_at_ms:T,spot:{'KRW-C0':[100,1000000,100,0]}};
 const r=v28Discover({},feed(T+STEP,{'KRW-C0':{price:100.4,cum:1005000}}),T+STEP,tape);
 assert.equal(r.next.assets['KRW-C0'].points.length,2);assert.equal(r.rows.find(x=>x.symbol==='KRW-C0').baseline_price,100);
});
test('ledger keeps all observed markets and bounded storage is not a mandatory streak',async()=>{
 const {v28Discover}=await engine();let state={};let result;
 for(let i=0;i<50;i++){result=v28Discover(state,feed(T+i*STEP,{'KRW-C0':{price:100+i/10,cum:1000000+i*2000}}),T+i*STEP);state=result.next;}
 assert.equal(Object.keys(state.assets).length,105);assert.ok(state.assets['KRW-C0'].points.length<=36);assert.ok(result.summary.tracked===105);
});
test('tracking records anchor invalidation after a successful rise, not just repeated peak mentions',async()=>{
 const {v28Discover}=await engine();let r=v28Discover({},feed(T),T);
 r=v28Discover(r.next,feed(T+STEP,{'KRW-C0':{price:101,cum:1010000}}),T+STEP);
 r=v28Discover(r.next,feed(T+2*STEP,{'KRW-C0':{price:99,cum:1020000}}),T+2*STEP);
 const x=r.rows.find(x=>x.symbol==='KRW-C0');assert.equal(x.stage,'ANCHOR_BROKEN');assert.ok(!r.candidates.some(c=>c.symbol===x.symbol));
});
test('top candidate bundles retain a valid second venue without changing hourly send count',async()=>{
 const {v28ChooseBundle}=await engine();const list=[{venue:'bithumb',symbol:'KRW-A',priority:9},{venue:'bithumb',symbol:'KRW-B',priority:8},{venue:'bithumb',symbol:'KRW-C',priority:7},{venue:'bitget',symbol:'XUSDT',priority:6}];
 const r=v28ChooseBundle(list,3);assert.equal(r.length,3);assert.ok(r.some(x=>x.venue==='bitget'));assert.equal(list.length,4);
});

test('one invalid ticker cannot poison other symbols observed traded-value shares',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;
 const f=feed(T+STEP,{'KRW-C0':{price:NaN},'KRW-C1':{price:101,cum:1010000}});
 const r=v28Discover(old,f,T+STEP);assert.ok(r.rows.find(x=>x.symbol==='KRW-C1').money_share>0);
});
test('missing comparison member invalidates share migration only, never fabricates money inflow',async()=>{
 const {v28Discover}=await engine();let r=v28Discover({},feed(T),T);
 r=v28Discover(r.next,feed(T+STEP,{'KRW-C1':{price:100.1,cum:1003000}}),T+STEP);
 const f=feed(T+2*STEP,{'KRW-C0':{tradeAt:T-500000},'KRW-C1':{price:100.2,cum:1006000}});
 r=v28Discover(r.next,f,T+2*STEP);assert.equal(r.rows.find(x=>x.symbol==='KRW-C1').money_share_delta,null);
});
test('cumulative relative gain uses true elapsed interval, not a normalized 5m step treated as actual return',async()=>{
 const {v28Discover}=await engine();const old=v28Discover({},feed(T),T).next;
 const r=v28Discover(old,feed(T+360000,{'KRW-C0':{price:101.2,cum:1010000}}),T+360000);
 const row=r.rows.find(x=>x.symbol==='KRW-C0');assert.ok(Math.abs(row.relative_run_pct-1.2)<1e-6);
});
