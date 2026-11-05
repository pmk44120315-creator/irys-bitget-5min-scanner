"""Add acknowledged-signal lifecycle to exact V34. Preserve entry model and risk lane."""
from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parent
old=Path(sys.argv[1]).read_text()
BASE='728b2d14d3543b79040d810cbfe290dbb14c6edb3987ee5b2db4d96b0d9de881'
assert hashlib.sha256(old.encode()).hexdigest()==BASE,'EXACT_V34_REQUIRED'
files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs','v31_quality.mjs','v31_outcomes.mjs','v35_lifecycle.mjs']
h=hashlib.sha256()
for name in files:h.update((name+'\0').encode());h.update((root/name).read_bytes())
digest=h.hexdigest();s=old;changes=[]
def rep(a,b,name):
 global s
 assert s.count(a)==1,(name,s.count(a));s=s.replace(a,b);changes.append(name)
def embedded(name):return '\n'.join(x for x in (root/name).read_text().splitlines() if not x.startswith('import ') and not x.startswith('export '))
rep('IRYS-V34-CROSS-VENUE-CRASH-WARNING-20261106','IRYS-V35-SIGNAL-LIFECYCLE-20261106','version')
rep("const V30_PRODUCER_DIGEST='0f5b9a9f4fff19d148901583c52d1b77b8f1b04be0512f778f4ee5c2f15526ec';",f"const V30_PRODUCER_DIGEST='{digest}';",'source-model-pin')
a=s.index('const V30_FEED=');b=s.index('\nasync function v30WorkerReview(',a)
# The whole delivery unit is replaced from its independently tested module.
new=embedded('v30_delivery.mjs');new=new[new.index('const V30_FEED='):]
s=s[:a]+new+'\n'+s[b:];changes.append('audited-delivery-with-lifecycle')
rep('  send:(text,permit)=>telegram(env,text,permit),\n  onAck:async(item,proof,ack,at,doc)=>{', '  send:(text,permit)=>telegram(env,text,permit),\n  editStatus:permit=>v35EditOwnSignal(env,permit),\n  onAck:async(item,proof,ack,at,doc)=>{','own-message-editor')
rep("    issued_at_ms:ack.ack_received_at_ms||at,entry_quote:proof.final_quote,outcomes:{},evidence_id:proof.evidence_id});", "    issued_at_ms:ack.ack_received_at_ms||at,entry_quote:proof.final_quote,outcomes:{},evidence_id:proof.evidence_id,\n    message_id:ack.message_id,original_text:ack.message_text,invalidation_reference:proof.invalidation_reference,lifecycle:{status:'ACTIVE'}});",'immutable-ACK-thesis')
rep("      mode:'CLOCK_SCHEDULED_ONLY',marketRiskWarningsEnabled:true,", "      mode:'CLOCK_SCHEDULED_ONLY',signalLifecycleEnabled:true,marketRiskWarningsEnabled:true,",'public-lifecycle-capability')
for a,b in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST=')]:
 assert s[s.index(a):s.index(b)]==old[old.index(a):old.index(b)],('PRESERVED_LOGIC_CHANGED',a)
assert s.split('  async scheduled(_controller,env){')[1]==old.split('  async scheduled(_controller,env){')[1],'CRON_HANDLER_CHANGED'
s=embedded('v35_lifecycle.mjs')+'\n'+embedded('v35_editor.mjs')+'\n'+s+'\nexport {v35ReviewSignal,v35Reconcile,v35EditOwnSignal};\n'
out=Path(sys.argv[2]);out.write_text(s)
manifest={'old_sha256':BASE,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'producer_digest':digest,'risk_lane_unchanged':True,'entry_qualification_unchanged':True,'changes':changes}
out.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
