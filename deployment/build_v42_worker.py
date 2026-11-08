"""Exact V35.1 code-only upgrade: live dispatch quote and sanitized actual ACKs."""
from pathlib import Path
import hashlib,json,sys
OLD='6356cf5919e5dd05808d9b84bf92378393cc0b9a9da31e964d93566cc86c0d13'
VERSION='IRYS-V42-DISPATCH-REVALIDATED-ACK-FEEDBACK-20261108'
root=Path(__file__).resolve().parent
raw=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(raw).hexdigest()==OLD,'DEPLOYED_V351_SOURCE_LEASE_REQUIRED'
source=raw.decode();s=source
old='IRYS-V35.1-DELIVERY-FIRST-LIFECYCLE-20261106';assert s.count(old)==1;s=s.replace(old,VERSION)
def unit(name):return '\n'.join(l for l in (root/name).read_text().splitlines() if not l.startswith(('import ','export ')))
a=s.index('const V30_FEED=');b=s.index('\nasync function v30WorkerReview(',a)
delivery=unit('v30_delivery.mjs');delivery=delivery[delivery.index('const V30_FEED='):]
s=s[:a]+unit('v42_dispatch_evidence.mjs')+'\n'+delivery+'\n'+s[b:]
a=' return v30ReviewAndDeliver(env,state,now,{';assert s.count(a)==1;s=s.replace(a,' return v42ReviewAndDeliver(env,state,now,{')
a="issued_at_ms:ack.ack_received_at_ms||at,entry_quote:proof.final_quote,outcomes:{},evidence_id:proof.evidence_id,"
b="issued_at_ms:ack.ack_received_at_ms||at,entry_quote:proof.final_quote,outcomes:{},evidence_id:proof.evidence_id,\n    source_packet_at_ms:doc.at_ms,dispatch_snapshot:item.dispatch_snapshot||null,"
assert s.count(a)==1;s=s.replace(a,b)
a="mode:'CLOCK_SCHEDULED_ONLY',deliveryFirstLifecycleEnabled:true,"
b="mode:'CLOCK_SCHEDULED_ONLY',dispatchQuoteRevalidationEnabled:true,completeAckEvidenceEnabled:true,deliveryFirstLifecycleEnabled:true,"
assert s.count(a)==1;s=s.replace(a,b)
for a,b in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('function v31EntryBudget(','function v31ShouldRecord('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST=')]:
 assert s[s.index(a):s.index(b)]==source[source.index(a):source.index(b)],('UNCHANGED_QUALIFICATION_OR_RISK_VIOLATION',a)
assert s.split('  async scheduled(_controller,env){')[1]==source.split('  async scheduled(_controller,env){')[1],'CRON_CHANGED'
assert "const V30_PRODUCER_DIGEST='baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9'" in s
s+='\nexport {v42ReadFinalQuote,v42PublicAckHistory,v42ReviewAndDeliver};\n'
out=Path(sys.argv[2]);out.write_text(s)
manifest={'version':VERSION,'old_sha256':OLD,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),
 'producer_digest':'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9',
 'paired_direction_rule_unchanged':True,'dispatch_now_uses_new_official_quote':True,'risk_lane_unchanged':True,'cron_unchanged':True,
 'private_messages_exported':False,'forecast_accuracy_improvement_proven':False}
out.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));print('V42_BUILD',json.dumps(manifest))
