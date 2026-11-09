"""Exact-source overlay: honest RSI/entry-risk display on existing V42.1 transport."""
from pathlib import Path
import hashlib,json,sys
OLD='99845f001c17542fbe1c5c1a7dde9beadef1881d6f31f1c1e0f7765109b9e3bb'
VERSION='IRYS-V45-RSI-ENTRY-CONTEXT-20261109'
raw=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(raw).hexdigest()==OLD,'DEPLOYED_SOURCE_LEASE'
a=raw.decode();s=a
root=Path(__file__).resolve().parent
unit='\n'.join(x for x in (root/'v45_rsi_context.mjs').read_text().splitlines() if not x.startswith('export '))
needle='const V421_VERSION=';assert s.count(needle)==1;s=s.replace(needle,unit+'\n'+needle)
old='IRYS-V42.1-TRUSTED-RUNNER-DISPATCH-20261108';assert s.count(old)==1;s=s.replace(old,VERSION)
old="final:{venue:'bitget',symbol:item.candidate.symbol,observed_at_ms:finish,quote:q},\n   dispatch_snapshot:"
new="final:{venue:'bitget',symbol:item.candidate.symbol,observed_at_ms:finish,quote:q},entry_context_v45:v45AttachContext(batch,item,doc,q,finish),\n   dispatch_snapshot:"
assert s.count(old)==1;s=s.replace(old,new)
start=s.index('async function v421ReviewAndDeliver(');end=s.index('\nasync function v30WorkerReview(',start)
s=s[:start]+'''async function v421ReviewAndDeliver(env,state,requestedAt,options={}){
 const clock=options.clock||Date.now,contexts=new Map(),stats={version:'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1',transport_version:V421_VERSION,
  attempted:0,verified:0,rejected:0,errors:0,reason_counts:{},safe_error_counts:{}};
 const output=await v30ReviewAndDeliver(env,state,requestedAt,{...options,
  refreshFinalQuote:async(item,doc)=>{
   stats.attempted++;
   try{
    let revised;
    if(item.candidate.venue==='bitget')revised=await v421ReadRunnerQuote(item,doc,{read:options.read,clock,githubToken:env?.GITHUB_DISPATCH_TOKEN,expectedDigest:options.expectedDigest,sleep:options.sleep,maxWaitMs:options.runnerMaxWaitMs??15000});
    else{
     let batch=null;try{batch=await options.read(V421_FEED+'?ref=data%2Firys-v421-dispatch-quotes&generation='+clock(),{headers:{authorization:'Bearer '+env.GITHUB_DISPATCH_TOKEN,accept:'application/vnd.github.raw+json','User-Agent':'IRYS-RSI-context','cache-control':'no-cache'},cf:{cacheTtl:0}},12000)}catch{}
     revised=await v42ReadFinalQuote(item,{read:options.read,clock});revised.entry_context_v45=v45AttachContext(batch,item,doc,revised.final.quote,clock());
    }
    contexts.set(item.candidate.venue+':'+item.candidate.symbol,revised.entry_context_v45);return revised;
   }catch(e){stats.errors++;const code=['RUNNER_REFRESH_INPUT_INVALID','RUNNER_REFRESH_WAIT_INVALID','RUNNER_REFRESH_CLOCK_INVALID','RUNNER_REFRESH_UNAVAILABLE','DISPATCH_IDENTITY_OR_READER_INVALID','DISPATCH_OFFICIAL_QUOTE_IDENTITY','DISPATCH_OFFICIAL_QUOTE_CLOCK'].includes(e?.message)?e.message:'OFFICIAL_DISPATCH_PROVIDER_UNAVAILABLE';stats.safe_error_counts[code]=(stats.safe_error_counts[code]||0)+1;throw Error(code);}
  },
  onDispatchRecheck:(allowed,reason)=>{stats[allowed?'verified':'rejected']++;if(reason)stats.reason_counts[reason]=(stats.reason_counts[reason]||0)+1;},
  formatSignal:(p,at)=>v45Format(p,at,contexts.get(p.venue+':'+p.symbol))});
 output.dispatch_revalidation=stats;output.public_ack_history=v42PublicAckHistory(state.v30ActualForecasts||[],clock());
 output.entry_context={version:V45_VERSION,evaluated:contexts.size,roles:[...contexts.values()].map(c=>c?.role??'CONTEXT_UNVERIFIED'),last_sent:output.sent?[...contexts.entries()].find(([k])=>k.endsWith(':'+output.sent_symbol))?.[1]??null:null,hard_entry_filter_added:false};
 output.forecast_accuracy_proven=false;return output;
}
''' +s[end:]
old='source_packet_at_ms:doc.at_ms,dispatch_snapshot:item.dispatch_snapshot||null,'
assert s.count(old)==1;s=s.replace(old,old+'entry_context_v45:item.entry_context_v45||null,')
old='  if(v42Clock(r.source_packet_at_ms))x.source_packet_at_ms=r.source_packet_at_ms;'
assert s.count(old)==1
new=old+"\n  if(r.entry_context_v45?.version===V45_VERSION){const c=r.entry_context_v45;x.entry_context_v45={version:V45_VERSION,role:['CAUTION_OBSERVATION','DIRECTION_OBSERVATION','CONTEXT_UNVERIFIED'].includes(c.role)?c.role:'CONTEXT_UNVERIFIED',entry_confirmed:false,auto_reversed:false,frames:{}};for(const k of ['1','5']){const f=c.frames?.[k];if(f&&Number.isFinite(f.closed_rsi)&&Number.isFinite(f.quote_rsi))x.entry_context_v45.frames[k]={closed_rsi:f.closed_rsi,quote_rsi:f.quote_rsi,quote_at_ms:f.quote_at_ms,closed_end_ms:f.closed_end_ms,current_candle_closed:false};}}"
s=s.replace(old,new)
old="mode:'CLOCK_SCHEDULED_ONLY',trustedRunnerDispatchQuoteEnabled:true,"
assert s.count(old)==1;s=s.replace(old,"mode:'CLOCK_SCHEDULED_ONLY',rsiEntryContextEnabled:true,rsiEntryContextVersion:V45_VERSION,trustedRunnerDispatchQuoteEnabled:true,")
for st,en in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('function v31EntryBudget(','function v31ShouldRecord('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST=')]:
 assert a[a.index(st):a.index(en)]==s[s.index(st):s.index(en)],st
assert a.split('  async scheduled(_controller,env){')[1]==s.split('  async scheduled(_controller,env){')[1]
s+='\nexport {v45RsiSeries,v45ClosedBars,v45Frame,v45Project,v45Classify,v45AttachContext,v45Format};\n'
out=Path(sys.argv[2]);out.write_text(s)
m={'version':VERSION,'old_sha256':OLD,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'original_qualification_and_risk_unchanged':True,'context_changes_actual_sent_message':True,'signal_role_exposed':True,'forecast_improvement_proven':False,'automatic_reversal':False}
out.with_suffix('.manifest.json').write_text(json.dumps(m,indent=2));print(json.dumps(m))
