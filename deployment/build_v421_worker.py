"""Build a code-only V42.1 transport repair from the exact deployed V42 bytes."""
from pathlib import Path
import hashlib,json,sys
OLD='cc1414e1883546c1eb1fe53ea449e81b721de3089c1689fc636b65fa0470459e'
VERSION='IRYS-V42.1-TRUSTED-RUNNER-DISPATCH-20261108'
raw=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(raw).hexdigest()==OLD,'EXACT_DEPLOYED_V42_REQUIRED'
a=raw.decode();s=a
old='IRYS-V42-DISPATCH-REVALIDATED-ACK-FEEDBACK-20261108';assert s.count(old)==1;s=s.replace(old,VERSION)
unit='\n'.join(l for l in (Path(__file__).resolve().parent/'v421_runner_quote.mjs').read_text().splitlines() if not l.startswith(('import ','export ')))
marker='\nasync function v30WorkerReview(';assert s.count(marker)==1;s=s.replace(marker,'\n'+unit+'\n'+marker)
old='options.refreshFinalQuote(r.item)';assert s.count(old)==1;s=s.replace(old,'options.refreshFinalQuote(r.item,doc)')
old=' return v42ReviewAndDeliver(env,state,now,{';assert s.count(old)==1;s=s.replace(old,' return v421ReviewAndDeliver(env,state,now,{')
old="mode:'CLOCK_SCHEDULED_ONLY',dispatchQuoteRevalidationEnabled:true,";assert s.count(old)==1
s=s.replace(old,"mode:'CLOCK_SCHEDULED_ONLY',trustedRunnerDispatchQuoteEnabled:true,dispatchQuoteRevalidationEnabled:true,")
for start,end in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('function v31EntryBudget(','function v31ShouldRecord('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST=')]:
 assert s[s.index(start):s.index(end)]==a[a.index(start):a.index(end)],('PRESERVED_POLICY_VIOLATION',start)
assert s.split('  async scheduled(_controller,env){')[1]==a.split('  async scheduled(_controller,env){')[1],'CRON_CHANGED'
s+='\nexport {v421ReadRunnerQuote,v421ReviewAndDeliver};\n'
out=Path(sys.argv[2]);out.write_text(s)
m={'version':VERSION,'previous_sha256':OLD,'source_sha256':hashlib.sha256(s.encode()).hexdigest(),'original_direction_and_risk_preserved':True,
 'cron_preserved':True,'bitget_dispatch_uses_trusted_existing_github_runner':True,'requires_new_provider_quote_within_15_seconds':True,
 'forecast_accuracy_improvement_proven':False}
out.with_suffix('.manifest.json').write_text(json.dumps(m,indent=2));print('V421_BUILD',json.dumps(m))
