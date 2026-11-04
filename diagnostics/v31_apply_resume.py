from pathlib import Path
root=Path(__file__).resolve().parents[1]
def edit(path,pairs):
 p=root/path;s=p.read_text()
 for old,new in pairs:
  assert s.count(old)==1,(path,old[:100],s.count(old));s=s.replace(old,new)
 p.write_text(s)
edit('deployment/v30_core.mjs',[
 ("import {v29CheckPair,v29Quote} from './v29_direction_gate.mjs';", "import {v29CheckPair,v29Quote} from './v29_direction_gate.mjs';\nimport {v31EntryBudget} from './v31_quality.mjs';"),
 ("const V30_MODEL='V30_PAIRED_REVALIDATED_CURRENT_DIRECTION_V1';", "const V30_MODEL='V31_PAIRED_TIMELY_ENTRY_V1';"),
 (" const progress=long?100*(q.bid/a.quote.ask-1):100*(a.quote.bid-q.ask)/a.quote.bid;", " const entryBudget=v31EntryBudget(item);\n if(!entryBudget.allowed)return fail(entryBudget.reason);\n const progress=long?100*(q.bid/a.quote.ask-1):100*(a.quote.bid-q.ask)/a.quote.bid;"),
 ("  pair,final_quote:q,entry_reference:long?q.ask:q.bid,invalidation_reference:long?a.quote.bid:a.quote.ask,", "  pair,entry_budget:entryBudget,final_quote:q,entry_reference:long?q.ask:q.bid,invalidation_reference:long?a.quote.bid:a.quote.ask,")
])
edit('deployment/v30_producer.mjs',[
 ("const PAIR_SEPARATION_MS=8500;", "import {v31ReadPairs,v31ShouldRecord} from './v31_quality.mjs';\nimport {v31FetchHistory,v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';"),
 (" const first=await pooled(candidates,async c=>{try{return await v29ReadSnapshot(c,read,clock)}catch(e){return {error:briefError(e)}}});\n const validFirst=first.filter(x=>!x.error);\n if(validFirst.length){const newest=Math.max(...validFirst.map(x=>x.observed_at_ms));await sleep(Math.max(0,newest+PAIR_SEPARATION_MS-clock()));}\n const second=await pooled(candidates,async(c,i)=>{if(first[i].error)return {error:'FIRST_SAMPLE_UNAVAILABLE'};try{return await v29ReadSnapshot(c,read,clock)}catch(e){return {error:briefError(e)}}});", " const pairs=await v31ReadPairs(candidates,c=>v29ReadSnapshot(c,read,clock),clock,sleep);\n const first=pairs.map(x=>x.first),second=pairs.map(x=>x.second);\n // History reads run before final quotes; they cannot age a just-validated entry.\n const history=await v31FetchHistory(state.records||[],read,clock,state.minute_history||[]);\n state.minute_history=history.pages;"),
 (" let records=v30Settle(oldRows,end.quotes.map(x=>({...x.quote,venue:x.venue,symbol:x.symbol})),now);", " let records=v30Settle(oldRows,end.quotes.map(x=>({...x.quote,venue:x.venue,symbol:x.symbol})),now);\n records=v31SettleMinute(records,history.pages,now);"),
 ("  if(recent&&now-recent.issued_at_ms<15*60000)continue;\n  const quality=v30Qualify(x,now);", "  const quality=v30Qualify(x,now);\n  if(!v31ShouldRecord(recent,quality,now))continue;"),
 ("  checks,items,outcome_quotes:end.quotes.map(q=>({...q.quote,venue:q.venue,symbol:q.symbol})),forward:summaryForward(state.records),orders_sent:false,telegram_sent:false};", "  checks,items,outcome_quotes:end.quotes.map(q=>({...q.quote,venue:q.venue,symbol:q.symbol})),\n  outcome_candles:history.pages,history_errors:history.errors,\n  timing:{discovery_at_ms:snapshotAt,paired_completed_ms:Math.max(snapshotAt,...second.filter(x=>!x.error).map(x=>x.observed_at_ms)),finished_at_ms:now,\n   pair_separations_ms:pairs.filter(x=>!x.first.error&&!x.second.error).map(x=>x.second.observed_at_ms-x.first.observed_at_ms),cadence_ms:300000,barrier_removed:true},\n  forward:{...summaryForward(state.records),minute_close_proxies:v31MinuteSummary(state.records)},orders_sent:false,telegram_sent:false};"),
 (" const files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs'];", " const files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs','v31_quality.mjs','v31_outcomes.mjs'];"),
 (" const result={scope:'ROLLING_2000_PUBLIC_HYPOTHESES_NOT_ALL_TIME',actual_execution_verified:false,forecast_accuracy_proven:false,groups:{}};", " const result={scope:'ROLLING_2000_PUBLIC_HYPOTHESES_NOT_ALL_TIME',current_model:V30_MODEL,legacy_records:rows.filter(r=>r.model!==V30_MODEL).length,actual_execution_verified:false,forecast_accuracy_proven:false,groups:{}};\n rows=rows.filter(r=>r.model===V30_MODEL);")
])
edit('deployment/v30_delivery.mjs',[
 ("const V30_FEED=", "import {v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';\nconst V30_FEED="),
 (" state.v30ActualForecasts=v30Settle(state.v30ActualForecasts||[],Array.isArray(doc.outcome_quotes)?doc.outcome_quotes:[],clock());", " state.v30ActualForecasts=v30Settle(state.v30ActualForecasts||[],Array.isArray(doc.outcome_quotes)?doc.outcome_quotes:[],clock());\n state.v30ActualForecasts=v31SettleMinute(state.v30ActualForecasts,Array.isArray(doc.outcome_candles)?doc.outcome_candles:[],clock());"),
 (" output.actual_alert_outcomes=v30OutcomeSummary(state.v30ActualForecasts);", " output.actual_alert_outcomes={...v30OutcomeSummary(state.v30ActualForecasts),minute_close_proxies:v31MinuteSummary(state.v30ActualForecasts)};"),
 ("🔎 [V30 방향 근거 확인]", "🔎 [V31 방향·진입가격 재확인]")
])
edit('tests/test_v30_producer.mjs',[
 ("price:direction(s)==='SHORT'&&!s.startsWith('KRW-')?price(s)+.6-i*.2:price(s)-.6+i*.2", "price:direction(s)==='SHORT'&&!s.startsWith('KRW-')?price(s)+(first()?1.2:.6)-i*(first()?.4:.2):price(s)-(first()?1.2:.6)+i*(first()?.4:.2)")
])
s=(root/'deployment/build_v30_worker.py').read_text()
s=s.replace("'IRYS-V30-SELECTIVE-PAIRED-DIRECTION-20261104'","'IRYS-V31-TIMELY-ENTRY-AND-OUTCOMES-20261104'")
s=s.replace("files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs']","files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs','v31_quality.mjs','v31_outcomes.mjs']")
s=s.replace("s=f\"const V30_PRODUCER_DIGEST='{digest}';\\n\"+embedded('v30_core.mjs')", "s=f\"const V30_PRODUCER_DIGEST='{digest}';\\n\"+embedded('v31_quality.mjs')+'\\n'+embedded('v31_outcomes.mjs')+'\\n'+embedded('v30_core.mjs')")
s=s.replace("out=Path(sys.argv[2]);out.write_text(s,encoding='utf-8')", """# Start delivery-source waiting at dispatch time, not after unrelated legacy reads.
a='  const v23Fast=await v23ScoutTick(env,state,Date.now());'
b=\"  const v31DeliveryTask=v30WorkerReview(env,state,now).catch(()=>({status:'DIRECTION_DELIVERY_RUNTIME_ERROR',sent:0,market_notifications_enabled:true,forecast_accuracy_proven:false}));\\n\"+a
assert s.count(a)==1;s=s.replace(a,b)
a='try{v30Run=await v30WorkerReview(env,state,now);}'
assert s.count(a)==1;s=s.replace(a,'try{v30Run=await v31DeliveryTask;}')
out=Path(sys.argv[2]);out.write_text(s,encoding='utf-8')""")
s=s.replace('V30_BUILD_MANIFEST','V31_BUILD_MANIFEST')
(root/'deployment/build_v31_worker.py').write_text(s)
