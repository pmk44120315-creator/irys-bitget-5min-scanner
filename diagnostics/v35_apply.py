from pathlib import Path
r=Path(__file__).resolve().parents[1]
def edit(name,pairs):
 p=r/name;s=p.read_text()
 for a,b in pairs:
  assert s.count(a)==1,(name,a[:100],s.count(a));s=s.replace(a,b)
 p.write_text(s)
edit('deployment/v30_producer.mjs',[
 ("import {v31ReadPairs,v31ShouldRecord} from './v31_quality.mjs';","import {v31ReadPairs,v31ShouldRecord} from './v31_quality.mjs';\nimport {v35FollowupMarkets} from './v35_lifecycle.mjs';"),
 ("previous={},priorSpot={},priorFutures={},modelDigest})","previous={},priorSpot={},priorFutures={},modelDigest,historyMode='inline',cachedHistory=[]})"),
 (" const pairs=await v31ReadPairs(candidates,c=>v29ReadSnapshot(c,read,clock),clock,sleep);", " const followupMarkets=v35FollowupMarkets(state.records||[],clock());\n const present=new Set(candidates.map(c=>c.venue+':'+c.symbol));\n const observed=[...candidates,...followupMarkets.filter(c=>!present.has(c.venue+':'+c.symbol))];\n const pairs=await v31ReadPairs(observed,c=>v29ReadSnapshot(c,read,clock),clock,sleep);"),
 (" const history=await v31FetchHistory(state.records||[],read,clock,state.minute_history||[]);", " const history=historyMode==='cached'?{pages:Array.isArray(cachedHistory)?cachedHistory:[],errors:[]}:await v31FetchHistory(state.records||[],read,clock,state.minute_history||[]);"),
 (" const end=await finalQuotes([...candidates,...due],finalRisk,read,clock),now=clock();", " const end=await finalQuotes([...observed,...due],finalRisk,read,clock),now=clock();"),
 ("  checks,items,outcome_quotes:end.quotes.map(q=>({...q.quote,venue:q.venue,symbol:q.symbol})),", "  checks,items,followups:observed.map((c,i)=>({venue:c.venue,symbol:c.symbol,first:first[i],second:second[i],final:byQuote.get(c.venue+':'+c.symbol)||null})),\n  outcome_quotes:end.quotes.map(q=>({...q.quote,venue:q.venue,symbol:q.symbol})),"),
 ("cadence_ms:300000,barrier_removed:true}", "cadence_ms:300000,barrier_removed:true,history_reads_in_live_path:historyMode!=='cached',followup_markets:followupMarkets.length}"),
 ("'v31_quality.mjs','v31_outcomes.mjs'];", "'v31_quality.mjs','v31_outcomes.mjs','v35_lifecycle.mjs'];"),
 (" const result=await v30Produce({read:publicReader(),previous:readJSON('data/v30_state.json'),priorSpot:", " const cache=readJSON('data/v35_outcome_history.json');\n const historyPages=cache.version==='V35_NATIVE_HISTORY_CACHE_V1'&&Array.isArray(cache.pages)?cache.pages:[];\n const result=await v30Produce({read:publicReader(),historyMode:'cached',cachedHistory:historyPages,previous:readJSON('data/v30_state.json'),priorSpot:")
])
edit('deployment/v30_delivery.mjs',[
 ("import {v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';", "import {v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';\nimport {v35Reconcile} from './v35_lifecycle.mjs';"),
 ("🔎 [V31 방향·진입가격 재확인]", "🔎 [V35 방향 근거·후속 상태 확인]"),
 ("5·15분 방향 가설입니다. 이후 적중률·실제 체결·수익은 보장되지 않으며, 유효시각이 지난 신호를 추격하지 마세요.", "5·15분 방향 가설이며 적중·수익을 보장하지 않습니다. 5분 주기로 최대15분간 기준 이탈을 재확인하고, 확인되면 이 메시지를 무효 표시합니다. 유효시각이 지난 신호를 추격하지 마세요."),
 (" const approved=[],rejected={};", " output.signal_lifecycle=await v35Reconcile(state,doc,{clock,edit:options.editStatus});\n const approved=[],rejected={};")
])
