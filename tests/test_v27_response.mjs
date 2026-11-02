import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const path=new URL('../deployment/v27_response.mjs',import.meta.url);
async function engine(){assert.ok(existsSync(path),'new effort/response engine is absent');return import(path);}
const NOW=1793584500000;
const quote=(bid=100,ask=101,at=NOW-1000)=>({bid,ask,at_ms:at});
function trades(side='buy',prices=[100,101,102,103]){
 return prices.map((p,i)=>({side,price:String(p),size:'10',ts:String(NOW-90000+i*25000),tradeId:String(i),symbol:'TESTUSDT'}));
}
test('one-tick last-price bounce cannot become executable upward progress',async()=>{
 const {v27Progress}=await engine();const x=v27Progress({baseline_price:100,side_observed:'UP'},quote(),NOW);
 assert.equal(x.status,'NO_EXECUTABLE_PROGRESS');assert.equal(x.executable_progress_pct,0);
});
test('a genuinely moved bid and validated symbol-time can qualify without arbitrary volume floor',async()=>{
 const {v27Progress}=await engine();const x=v27Progress({baseline_price:100,side_observed:'UP'},quote(101,101.1),NOW);
 assert.equal(x.status,'QUOTED_PROGRESS');assert.ok(Math.abs(x.executable_progress_pct-1)<1e-8);
});
test('missing and old quote remain unknown, not fabricated as zero or a success',async()=>{
 const {v27Progress}=await engine();assert.equal(v27Progress({baseline_price:100},null,NOW).status,'QUOTE_UNKNOWN');
 assert.equal(v27Progress({baseline_price:100},quote(101,102,NOW-120000),NOW).status,'QUOTE_UNKNOWN');
 assert.equal(v27Progress({},quote(),NOW).status,'BASELINE_UNKNOWN');
});
test('market sell aggression with rising price is failed sell pressure, never forced SHORT',async()=>{
 const {v27EffortResponse}=await engine();let x=v27EffortResponse(trades('sell'),'bitget',NOW,.01,'TESTUSDT');
 assert.equal(x.status,'SAMPLED_RESPONSE');assert.equal(x.state,'SELL_PRESSURE_FAILED');
 assert.equal(x.observed_response,'UP');assert.equal(x.future_direction_proven,false);assert.equal(x.full_cvd_verified,false);
});
test('buy aggression falling price is failed buy pressure, not forced LONG',async()=>{
 const {v27EffortResponse}=await engine();let x=v27EffortResponse(trades('buy',[104,103,102,101]),'bitget',NOW,.01,'TESTUSDT');
 assert.equal(x.state,'BUY_PRESSURE_FAILED');assert.equal(x.observed_response,'DOWN');
});
test('movement inside spread is unresolved rather than a discovered market turn',async()=>{
 const {v27EffortResponse}=await engine();let x=v27EffortResponse(trades('buy',[100,100.1,100.05,100.1]),'bitget',NOW,1,'TESTUSDT');
 assert.equal(x.state,'BUY_PRESSURE_STALLED');assert.equal(x.observed_response,'WITHIN_SPREAD');
});
test('chronology, duplicate trades, wrong market and future ticks cannot change response',async()=>{
 const {v27EffortResponse}=await engine();const t=trades();const a=v27EffortResponse(t,'bitget',NOW,.01,'TESTUSDT');
 const b=v27EffortResponse([...t].reverse().concat(t[0],{...t[0],tradeId:'other',symbol:'OTHERUSDT'},{...t[0],tradeId:'future',ts:NOW+10000}),'bitget',NOW,.01,'TESTUSDT');
 assert.deepEqual(a,b);
});
test('conflicting repeated trade ID is rejected instead of selecting favorable version',async()=>{
 const {v27EffortResponse}=await engine();const t=trades();const a=v27EffortResponse(t.concat({...t[0],price:'1000'}),'bitget',NOW,.01,'TESTUSDT');
 assert.equal(a.status,'CONFLICTING_TRADE_IDS');assert.equal(a.future_direction_proven,false);
});
test('legacy LONG already crossed below evidence beyond spread is vetoed, quote in spread is not',async()=>{
 const {v27DirectionCheck}=await engine();assert.equal(v27DirectionCheck({direction:'LONG',price:100},quote(98,99),NOW).status,'EVIDENCE_REVERSED');
 assert.equal(v27DirectionCheck({direction:'LONG',price:100},quote(99,101),NOW).status,'CURRENT_QUOTE_CHECKED');
 assert.equal(v27DirectionCheck({direction:'SHORT',price:100},quote(101,102),NOW).status,'EVIDENCE_REVERSED');
});
test('old GitHub response generation cannot be relabeled fresh with a new fetch timestamp',async()=>{
 const {v27ReadFresh}=await engine();let t=NOW;
 const result=await v27ReadFresh(async()=>({version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:NOW-300000,parent_at_ms:NOW-300000,source:{at_ms:NOW-300000},quotes:{}}),NOW,{clock:()=>t,sleep:async ms=>{t+=ms},maxWaitMs:1000});
 assert.equal(result.status,'FRESH_GENERATION_UNAVAILABLE');
});
test('fresh generation rendezvous waits for the same scan rather than using prior 5m quote',async()=>{
 const {v27ReadFresh}=await engine();let t=NOW,calls=0;
 const read=async()=>{calls++;return {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:calls===1?NOW-300000:t,parent_at_ms:calls===1?NOW-300000:NOW,source:{at_ms:calls===1?NOW-300000:NOW},quotes:{}}};
 const x=await v27ReadFresh(read,NOW,{clock:()=>t,sleep:async ms=>{t+=ms},maxWaitMs:10000});
 assert.equal(x.status,'FRESH');assert.equal(calls,2);assert.equal(x.doc.parent_at_ms,NOW);
});

test('observed 60-second producer publication is awaited without accepting the previous generation',async()=>{
 const {v27ReadFresh}=await engine();let t=NOW,seen=0;
 const read=async()=>{seen++;return t<NOW+60000?
  {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:NOW-300000,parent_at_ms:NOW-300000,source:{at_ms:NOW-300000}}:
  {version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:NOW+60000,parent_at_ms:NOW+55000,source:{at_ms:NOW+55000}};};
 const x=await v27ReadFresh(read,NOW,{clock:()=>t,sleep:async ms=>{t+=ms}});
 assert.equal(x.status,'FRESH');assert.equal(x.doc.parent_at_ms,NOW+55000);
 assert.equal(x.wait_ms,60000);assert.ok(seen>10);
});
