"""Exact deployed V35 -> delivery-first V35.1. Prediction and risk rules unchanged."""
from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parent
source=Path(sys.argv[1]).read_text();old='949cc9b7392e7f6bbf7ce710509b804ce734cf6b123294b1a2c530cfdc2669aa'
assert hashlib.sha256(source.encode()).hexdigest()==old,'EXACT_DEPLOYED_V35_REQUIRED'
s=source.replace('IRYS-V35-SIGNAL-LIFECYCLE-20261106','IRYS-V35.1-DELIVERY-FIRST-LIFECYCLE-20261106')
a=s.index('const V30_FEED=');b=s.index('\nasync function v30WorkerReview(',a)
unit='\n'.join(x for x in (root/'v30_delivery.mjs').read_text().splitlines() if not x.startswith('import ') and not x.startswith('export '));unit=unit[unit.index('const V30_FEED='):]
s=s[:a]+unit+'\n'+s[b:]
a="mode:'CLOCK_SCHEDULED_ONLY',signalLifecycleEnabled:true,";assert s.count(a)==1;s=s.replace(a,"mode:'CLOCK_SCHEDULED_ONLY',deliveryFirstLifecycleEnabled:true,signalLifecycleEnabled:true,")
for a,b in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST=')]:assert s[s.index(a):s.index(b)]==source[source.index(a):source.index(b)],('UNCHANGED_RULE_VIOLATION',a)
assert s.split('  async scheduled(_controller,env){')[1]==source.split('  async scheduled(_controller,env){')[1],'CRON_CHANGED'
assert "const V30_PRODUCER_DIGEST='baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9'" in s
out=Path(sys.argv[2]);out.write_text(s)
manifest={'old_sha256':old,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'producer_digest':'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9','entry_prediction_logic_unchanged':True,'risk_lane_unchanged':True,'cron_unchanged':True,'prediction_improvement_proven':False}
out.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
