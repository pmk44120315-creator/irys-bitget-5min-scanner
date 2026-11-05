"""Surgical, source-leased V31 -> V34 risk lane. Entry-model sources unchanged."""
from pathlib import Path
import hashlib,sys,json
root=Path(__file__).resolve().parent
old=Path(sys.argv[1]).read_text(encoding='utf8')
BASE='20c730063705ffa9fdbafa000621bbd8db94a71e3e926fa915c88fa56db44a3a'
assert hashlib.sha256(old.encode()).hexdigest()==BASE,'EXACT_V31_SOURCE_REQUIRED'
h=hashlib.sha256()
for name in ['v34_crash.mjs','v34_producer.mjs']:
 h.update((name+'\0').encode());h.update((root/name).read_bytes())
digest=h.hexdigest();s=old;changes=[]
def rep(a,b,label):
 global s
 assert s.count(a)==1,(label,s.count(a));s=s.replace(a,b);changes.append(label)
rep('IRYS-V31-TIMELY-ENTRY-AND-OUTCOMES-20261104','IRYS-V34-CROSS-VENUE-CRASH-WARNING-20261106','version')
rep("  if(!v30ConsumePermit(permit,Date.now()))throw Error('V30_SIGNAL_PERMIT_REQUIRED');", "  if(!v30ConsumePermit(permit,Date.now())&&!v34ConsumeRiskPermit(permit,Date.now()))throw Error('V30_SIGNAL_PERMIT_REQUIRED');",'strict-new-risk-permit-only')
rep('  const v31DeliveryTask=v30WorkerReview(env,state,now).catch(', "  const v34RiskTask=v34WorkerReview(env,state,now).catch(()=>({status:'RISK_RUNTIME_ERROR',sent:0,trade_entry_permit:false}));\n  const v31DeliveryTask=v30WorkerReview(env,state,now).catch(",'parallel-independent-risk-read')
rep('  let v30Run;','  const v34RiskRun=await v34RiskTask;\n  let v30Run;','join-risk-on-natural-tick')
rep('  if(v30Run.sent>0||aiRun.alerts_sent>0||v21Run.sent>0||v23Fast.sent>0)', '  if(v34RiskRun.sent>0||v30Run.sent>0||aiRun.alerts_sent>0||v21Run.sent>0||v23Fast.sent>0)','ACK-connection')
rep('    telegramApiAckedThisRun:(v30Run.sent||0)+', '    telegramApiAckedThisRun:(v34RiskRun.sent||0)+(v30Run.sent||0)+','actual-physical-ACK-count')
rep('    v29DirectionalReview:v29Run,v30DirectionalDelivery:v30Run,marketNotificationsEnabled:true,', '    v34MarketRisk:v34RiskRun,v29DirectionalReview:v29Run,v30DirectionalDelivery:v30Run,marketNotificationsEnabled:true,','independent-public-risk-status')
rep("      mode:'CLOCK_SCHEDULED_ONLY',marketNotificationsEnabled:true,", "      mode:'CLOCK_SCHEDULED_ONLY',marketRiskWarningsEnabled:true,marketNotificationsEnabled:true,",'public-capability')
for a,b in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy(')]:
 assert s[s.index(a):s.index(b)]==old[old.index(a):old.index(b)]
assert s.split('  async scheduled(_controller,env){')[1]==old.split('  async scheduled(_controller,env){')[1]
def module(name,exports):
 raw='\n'.join(line for line in (root/name).read_text().splitlines() if not line.startswith('import ') and not line.startswith('export '))
 return 'const {'+exports+'}=(()=>{\n'+raw+'\nreturn {'+exports+'};\n})();\n'
helper=f"const V34_RISK_DIGEST='{digest}';\n"+module('v34_crash.mjs','v34Evaluate,v34ParseBars,V34_POLICY')+module('v34_delivery.mjs','v34Review,v34ConsumeRiskPermit,v34Message')
helper+='''
async function v34WorkerReview(env,state,now,options={}){
 return v34Review(env,state,now,{
  expectedDigest:V34_RISK_DIGEST,clock:options.clock||Date.now,sleep:options.sleep,maxWaitMs:options.maxWaitMs,
  read:options.read||requestJson,send:(text,permit)=>telegram(env,text,permit),
  onAck:async(proof,doc,ack,at)=>{
   ack.market_snapshot={version:'V34_ACTUAL_RISK_ACK_V1',notification_kind:'OBSERVED_RISK_NOT_TRADE',
     forecast_direction:null,trade_entry_permit:false,source_at_ms:doc.at_ms,observed_assets:proof.assets,
     missing_assets:proof.missing_assets,policy:proof.policy,future_direction_proven:false};
   const first=proof.assets[0];const symbol=first?first.asset+'USDT':'MARKET_RISK';
   const row=recordReceipt(state,'V34_MARKET_DROP_RISK',symbol,at,ack);
   row.kv_receipt_persisted=await persistReceiptEvent(env,row,at);
   if(!row.kv_receipt_persisted)throw Error('RISK_ACK_PERSISTENCE_FAILED');
  }
 });
}
'''
s=helper+s+'\nexport {V34_RISK_DIGEST,v34WorkerReview,v34Evaluate,v34ConsumeRiskPermit};\n'
out=Path(sys.argv[2]);out.write_text(s,encoding='utf8');result={'old_sha256':BASE,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'risk_model_digest':digest,'changes':changes}
out.with_suffix('.manifest.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
