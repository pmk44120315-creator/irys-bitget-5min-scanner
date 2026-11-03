"""Build from exact verified V28.1. No private-data extraction route is added."""
from pathlib import Path
import hashlib,sys
source=Path(sys.argv[1]).read_text(encoding='utf-8')
assert hashlib.sha256(source.encode()).hexdigest()=='932845cb6cf1949e453e52bbf6c75387820c6981fdb91ebc45b2e086a6fe176d','V28_1_SOURCE_LEASE_MISMATCH'
root=Path(__file__).resolve().parent;s=source;changes=[]
def rep(a,b,label):
 global s
 assert s.count(a)==1,(label,s.count(a))
 s=s.replace(a,b);changes.append(label)
rep('IRYS-V28.1-MARKET-RELATIVE-BUILDUP-20261102','IRYS-V29-PAIRED-EVIDENCE-DELIVERY-HOLD-20261103','version')
rep('async function telegram(env,messageText){',"async function telegram(env,messageText){\n  throw Error('V29_NO_UNVALIDATED_MARKET_ALERTS');",'central-delivery-policy')
rep("   if(result.observation.status!=='MARKET_COMPARISON_PASS'){", """   state.v29DiscoveryInput={at_ms:clock(),items:result.observation.status==='MARKET_COMPARISON_PASS'?result.observation.candidates:[]};
   output.status='V29_DISCOVERY_INTERNAL_ONLY';
   output.market_notifications_enabled=false;
   return output;
   if(result.observation.status!=='MARKET_COMPARISON_PASS'){""",'discovery-kept-independent-of-delivery')
rep('    for(const signal of confirmed){', '    for(const signal of []){ // V29_LEGACY_SENDER_DISABLED; confirmed data remain recorded.', 'legacy-spot-sender')
rep('  for(const proof of futuresRun.signals){', '  for(const proof of []){ // V29_LEGACY_SENDER_DISABLED; proofs remain inputs to paired review.', 'legacy-futures-sender')
a="""  const directionalRun=status==='PASS'&&source?
    await sendSpotDirectional(env,state,source.snap,now,Math.max(0,MAX_ALERTS-sent-futuresSent-(v23Fast.sent||0))):
    {status:'DIRECTION_SOURCE_NOT_READY',sent:0,send_error:null,proof_passed:0};"""
b="""  const directionalRun={status:'V29_LEGACY_SENDER_DISABLED',sent:0,send_error:null,proof_passed:0};"""
rep(a,b,'legacy-direction-send-branch')
a="""  const v21Run=(base&&dispatch.status==='ACCEPTED')?
    await sendV21Forecasts(env,state,base.snap,Date.now(),
      Math.max(0,MAX_ALERTS-sent-futuresSent-directionalRun.sent-(v23Fast.sent||0))):
    {status:'SOURCE_NOT_READY',sent:0,send_error:null};"""
b="""  const v21Run={status:'V29_LEGACY_SENDER_DISABLED',sent:0,send_error:null};
  let v29Run;
  try{v29Run=await v29Review(state,futuresRun.signals,{read:requestJson});}
  catch(_e){v29Run={status:'REVIEW_SOURCE_UNAVAILABLE',sent:0,telegram_enabled:false,future_accuracy_improvement_proven:false};}"""
rep(a,b,'new-paired-research-review')
rep('  if(shouldRunExpensiveAi(status,source,confirmed)){','  if(false&&shouldRunExpensiveAi(status,source,confirmed)){ // No unvalidated AI sender.', 'legacy-model-sender')
rep('    v23DirectFastScout:v23Fast,',"    v23DirectFastScout:v23Fast,\n    v29DirectionalReview:v29Run,marketNotificationsEnabled:false,directionalQualityStatus:'FORWARD_QUALITY_UNPROVEN',",'honest-live-policy-telemetry')
rep("      mode:'CLOCK_SCHEDULED_ONLY',kvConfigured:!!env.IRYS_KV,", "      mode:'CLOCK_SCHEDULED_ONLY',marketNotificationsEnabled:false,directionalQualityStatus:'FORWARD_QUALITY_UNPROVEN',kvConfigured:!!env.IRYS_KV,",'immediate-health-policy')
rep('    const transportProof=await telegramTransportProofOnce(env,now);', "    const transportProof={status:'V29_NO_UNREQUESTED_TRANSPORT_TEST'};",'no-unsolicited-test-message')
for a,b in [('function futuresSnapshotProof(','function evaluateFutures('),('function validDirectionalProof(','async function officialDirectionalRiskCheck(')]:
 assert s[s.index(a):s.index(b)]==source[source.index(a):source.index(b)],'LEGACY_PROOF_MUTATION'
gate=(root/'v29_direction_gate.mjs').read_text().split('\nexport {')[0]
runtime=(root/'v29_runtime.mjs').read_text();runtime='\n'.join(line for line in runtime.splitlines() if not line.startswith('import ')).split('\nexport {')[0]
s=gate+'\n'+runtime+'\n'+s+'\nexport {telegram,v29CheckPair,v29Review,v29Summary};\n'
assert '__v29Audit' not in s and 'private-audit' not in s
Path(sys.argv[2]).write_text(s,encoding='utf-8')
print('V29_BUILD_SHA256',hashlib.sha256(s.encode()).hexdigest(),'bytes',len(s.encode()),'changes',','.join(changes))
