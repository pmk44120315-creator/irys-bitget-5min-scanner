"""Exact V29 -> V30 selective evidence delivery. No private extraction routes."""
from pathlib import Path
import hashlib, json, sys
source=Path(sys.argv[1]).read_text(encoding='utf-8')
OLD='28dc5922e54f9e69d4a8150f03184417d0ea46409d82fe9130bbf648ac17309e'
assert hashlib.sha256(source.encode()).hexdigest()==OLD,'V29_SOURCE_LEASE_MISMATCH'
root=Path(__file__).resolve().parent
files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs','v31_quality.mjs','v31_outcomes.mjs']
h=hashlib.sha256()
for name in files:h.update((name+'\0').encode());h.update((root/name).read_bytes())
digest=h.hexdigest();s=source;changes=[]
def rep(a,b,label):
 global s
 assert s.count(a)==1,(label,s.count(a));s=s.replace(a,b);changes.append(label)
rep('IRYS-V29-PAIRED-EVIDENCE-DELIVERY-HOLD-20261103','IRYS-V31-TIMELY-ENTRY-AND-OUTCOMES-20261104','version')
rep("async function telegram(env,messageText){\n  throw Error('V29_NO_UNVALIDATED_MARKET_ALERTS');",
    "async function telegram(env,messageText,permit){\n  if(!v30ConsumePermit(permit,Date.now()))throw Error('V30_SIGNAL_PERMIT_REQUIRED');",'one-use-qualified-transport')
rep("  let v29Run;\n  try{v29Run=await v29Review(state,futuresRun.signals,{read:requestJson});}\n  catch(_e){v29Run={status:'REVIEW_SOURCE_UNAVAILABLE',sent:0,telegram_enabled:false,future_accuracy_improvement_proven:false};}",
"""  const v29Run={status:'REPLACED_BY_V30_PUBLIC_PAIRED_SOURCE',sent:0,telegram_enabled:false};
  let v30Run;
  try{v30Run=await v30WorkerReview(env,state,now);}
  catch(_e){v30Run={status:'DIRECTION_DELIVERY_RUNTIME_ERROR',sent:0,market_notifications_enabled:true,forecast_accuracy_proven:false};}""",'working-public-source-and-per-signal-delivery')
rep('  if(aiRun.alerts_sent>0||v21Run.sent>0||v23Fast.sent>0)state.telegramConnectionVerified=true;',
    '  if(v30Run.sent>0||aiRun.alerts_sent>0||v21Run.sent>0||v23Fast.sent>0)state.telegramConnectionVerified=true;','new-ACK-connection-evidence')
rep('    telegramApiAckedThisRun:(v23Fast.sent||0)+sent+futuresSent+',
    '    telegramApiAckedThisRun:(v30Run.sent||0)+(v23Fast.sent||0)+sent+futuresSent+','actual-ACK-count')
rep("    v29DirectionalReview:v29Run,marketNotificationsEnabled:false,directionalQualityStatus:'FORWARD_QUALITY_UNPROVEN',",
    "    v29DirectionalReview:v29Run,v30DirectionalDelivery:v30Run,marketNotificationsEnabled:true,directionalQualityStatus:'CURRENT_EVIDENCE_ONLY_FORECAST_ACCURACY_UNPROVEN',",'live-selective-policy')
rep("      mode:'CLOCK_SCHEDULED_ONLY',marketNotificationsEnabled:false,directionalQualityStatus:'FORWARD_QUALITY_UNPROVEN',kvConfigured:!!env.IRYS_KV,",
    "      mode:'CLOCK_SCHEDULED_ONLY',marketNotificationsEnabled:true,directionalQualityStatus:'CURRENT_EVIDENCE_ONLY_FORECAST_ACCURACY_UNPROVEN',kvConfigured:!!env.IRYS_KV,",'read-only-health-policy')
rep("    alertContract:'V15_EXACT_SAME_MINUTE_PRICE_TAKER_CONTEXT_2_BOOK_15M_REAL_CVD',aiDirectTransportEnabled:AI_ALERT_TRANSPORT_ENABLED,",
    "    alertContract:'V30_INDEPENDENT_NEW_TRADES_AND_QUOTES_PLUS_FINAL_RECHECK',aiDirectTransportEnabled:false,",'truthful-current-contract')
rep("    note:'V15 causal alignment requires selected Bitget completed price candles and venue-local 15m fills to share exact end timestamp. Separate real books plus price/taker proof remain required. No zero-fill, no all-exchange CVD, no guaranteed future accuracy, no orders.'};",
    "    note:'V30 sends only independently rechecked current directional evidence, never general WATCH or calibrated-profit claims. Current evidence is not a guaranteed future forecast. No synthetic prices, private export or account orders.'};",'truthful-current-semantics')
for a,b in [('function futuresSnapshotProof(','function evaluateFutures('),('function validDirectionalProof(','async function officialDirectionalRiskCheck(')]:
 assert s[s.index(a):s.index(b)]==source[source.index(a):source.index(b)],'LEGACY_PROOF_MUTATED'
assert s.split('  async scheduled(_controller,env){')[1]==source.split('  async scheduled(_controller,env){')[1],'ORIGINAL_SCHEDULE_MUTATED'
def embedded(name):
 lines=(root/name).read_text().splitlines()
 return '\n'.join(x for x in lines if not x.startswith('import ') and not x.startswith('export '))
helper="""
async function v30WorkerReview(env,state,now,options={}){
 return v30ReviewAndDeliver(env,state,now,{
  expectedDigest:V30_PRODUCER_DIGEST,read:options.read||requestJson,
  clock:options.clock||Date.now,sleep:options.sleep,maxWaitMs:options.maxWaitMs,
  send:(text,permit)=>telegram(env,text,permit),
  onAck:async(item,proof,ack,at,doc)=>{
   ack.market_snapshot={version:'V30_ACTUAL_ACK_EVIDENCE_V1',venue:proof.venue,symbol:proof.symbol,
    forecast_direction:proof.direction,evidence_id:proof.evidence_id,model_digest:doc.model_digest,
    observation_at_ms:proof.observed_at_ms,entry_quote:proof.final_quote,
    invalidation_reference:proof.invalidation_reference,pair:proof.pair,
    expires_at_ms:proof.expires_at_ms,future_accuracy_proven:false,actual_fill_verified:false};
   const row=recordReceipt(state,'V30_PAIRED_DIRECTION',proof.symbol,at,ack);
   state.v30ActualForecasts??=[];
   state.v30ActualForecasts.push({id:'ACK:'+ack.message_id,venue:proof.venue,symbol:proof.symbol,direction:proof.direction,
    issued_at_ms:ack.ack_received_at_ms||at,entry_quote:proof.final_quote,outcomes:{},evidence_id:proof.evidence_id});
   state.v30ActualForecasts=state.v30ActualForecasts.slice(-600);
   row.kv_receipt_persisted=await persistReceiptEvent(env,row,at);
   if(!row.kv_receipt_persisted)throw Error('V30_ACK_RECEIPT_PERSISTENCE_FAILED');
  }
 });
}
"""
s=f"const V30_PRODUCER_DIGEST='{digest}';\n"+embedded('v31_quality.mjs')+'\n'+embedded('v31_outcomes.mjs')+'\n'+embedded('v30_core.mjs')+'\n'+embedded('v30_delivery.mjs')+helper+'\n'+s+'\nexport {V30_PRODUCER_DIGEST,v30WorkerReview,v30Qualify,v30ConsumePermit};\n'
assert '__v30Audit' not in s and 'private-audit' not in s
# Start delivery-source waiting at dispatch time, not after unrelated legacy reads.
a='  const v23Fast=await v23ScoutTick(env,state,Date.now());'
b="  const v31DeliveryTask=v30WorkerReview(env,state,now).catch(()=>({status:'DIRECTION_DELIVERY_RUNTIME_ERROR',sent:0,market_notifications_enabled:true,forecast_accuracy_proven:false}));\n"+a
assert s.count(a)==1;s=s.replace(a,b)
a='try{v30Run=await v30WorkerReview(env,state,now);}'
assert s.count(a)==1;s=s.replace(a,'try{v30Run=await v31DeliveryTask;}')
out=Path(sys.argv[2]);out.write_text(s,encoding='utf-8')
manifest={'old_sha256':OLD,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'producer_digest':digest,'source_files':files,'changes':changes}
out.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2))
print('V31_BUILD_MANIFEST',json.dumps(manifest))
