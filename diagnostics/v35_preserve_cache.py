from pathlib import Path
p=Path('deployment/v30_producer.mjs');s=p.read_text()
a="const history=historyMode==='cached'?{pages:Array.isArray(cachedHistory)?cachedHistory:[],errors:[]}:"
b="const history=historyMode==='cached'?{pages:Array.isArray(cachedHistory)&&cachedHistory.length?cachedHistory:(state.minute_history||[]),errors:[]}:"
assert s.count(a)==1;s=s.replace(a,b);p.write_text(s)
p=Path('tests/test_v35_producer.mjs');s=p.read_text();assert 'first cached-mode migration preserves' not in s
s+='''\ntest('first cached-mode migration preserves already collected native historical pages',async()=>{
 const e=environment(),pages=[{venue:'bitget',symbol:'F0USDT',source:'OFFICIAL_NATIVE_1M',fetched_at_ms:T-1000,bars:[]}];e.state.minute_history=pages;
 const x=await v30Produce({read:e.read,clock:e.clock,sleep:e.sleep,previous:e.state,priorSpot:e.legacy,modelDigest:'test',historyMode:'cached',cachedHistory:[]});
 assert.deepEqual(x.state.minute_history,pages);assert.deepEqual(x.report.outcome_candles,pages);
});
''';p.write_text(s)
