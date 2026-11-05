/** Observed-risk transport is separate from SHORT-entry approval and quota. */
import {v34Evaluate} from './v34_crash.mjs';
const V34_URL='https://api.github.com/repos/pmk44120315-creator/irys-bitget-5min-scanner/contents/data/v34_crash_latest.json';
const PER_HOUR=3600000,RECOVERY=600000,permits=new WeakSet();
function v34ConsumeRiskPermit(p,now=Date.now()){
 if(!p||typeof p!=='object'||!permits.has(p))return false;
 permits.delete(p);return v34Evaluate(p.doc,now,p.digest).status==='OBSERVED_DROP';
}
function v34Message(proof,now){
 const kst=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ')+' KST';
 const lines=['⚠️ [동반 급락 위험경보 · 신규 숏 진입 신호 아님]',kst(now)];
 for(const row of proof.assets){const pct=v=>row.horizon_min===5?v.return_5m_pct:v.return_15m_pct;
  lines.push(`${row.asset} 최근 ${row.horizon_min}분: `+row.venues.map(v=>(v.venue==='bithumb'?'빗썸 ':'비트겟 ')+pct(v).toFixed(2)+'%').join(' / '));}
 lines.push('두 거래소의 닫힌 분봉과 최신 호가에서 동반 하락을 확인했습니다.');
 lines.push('이미 발생한 하락의 위험 통보입니다. 추가 하락·숏 수익을 예측하지 않으며 급락 뒤 추격 진입을 권하지 않습니다.');
 lines.push('5분 감시 주기 · 같은 급락 반복경보 억제');
 return lines.join('\n');
}
async function v34Read(env,options){
 const clock=options.clock||Date.now,sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms))),start=clock();
 const deadline=start+(options.maxWaitMs??90000);let reason='NO_CURRENT_RISK_SOURCE',reads=0;
 if(!env?.GITHUB_DISPATCH_TOKEN)return {ok:false,reason:'RISK_SOURCE_NOT_CONFIGURED',reads};
 do{
  try{const doc=await options.read(V34_URL+'?ref=main&t='+clock(),{headers:{authorization:'Bearer '+env.GITHUB_DISPATCH_TOKEN,accept:'application/vnd.github.raw+json','User-Agent':'IRYS-market-risk-reader','cache-control':'no-cache'},cf:{cacheTtl:0}},12000);
   reads++;const proof=v34Evaluate(doc,clock(),options.expectedDigest);
   if(!['UNTRUSTED_PACKET','STALE_OR_INVALID_PACKET'].includes(proof.status))return {ok:true,doc,proof,reads,wait_ms:clock()-start};
   reason=proof.status;
  }catch{reads++;reason='RISK_SOURCE_READ_FAILED';}
  const left=deadline-clock();if(left<=0)break;await sleep(Math.min(5000,left));
 }while(clock()<=deadline);
 return {ok:false,reason,reads,wait_ms:clock()-start};
}
async function v34Review(env,state,requestedAt,options){
 const clock=options.clock||Date.now,out={status:'RISK_CHECKING',sent:0,channel:'OBSERVED_MARKET_DROP_NOT_ENTRY',future_direction_proven:false,trade_entry_permit:false};
 const got=await v34Read(env,options);out.feed={ok:got.ok,reason:got.reason||null,reads:got.reads,wait_ms:got.wait_ms||0};
 if(!got.ok){out.status='RISK_SOURCE_UNAVAILABLE';return out;}
 const {doc}=got,proof=v34Evaluate(doc,clock(),options.expectedDigest);
 out.observation=proof;out.source_at_ms=doc.at_ms;
 const fresh=doc.at_ms>(state.v34LastSourceAt??-1);
 if(!fresh){out.status='RISK_SOURCE_ALREADY_PROCESSED';return out;}
 state.v34LastSourceAt=doc.at_ms;
 if(proof.status==='VERIFIED_QUIET'){
  const e=state.v34Episode;
  if(e?.active){e.recovery_since??=doc.at_ms;if(doc.at_ms-e.recovery_since>=RECOVERY)state.v34Episode={active:false,recovered_at_ms:doc.at_ms};}
  out.status='RISK_QUIET';return out;
 }
 if(proof.status!=='OBSERVED_DROP'){out.status='RISK_EVIDENCE_INCOMPLETE';return out;}
 let episode=state.v34Episode;
 if(!episode?.active){episode={active:true,first_at_ms:doc.at_ms,id:proof.evidence_id,attempted:false};state.v34Episode=episode;}
 delete episode.recovery_since;
 if(episode.attempted){out.status='RISK_EPISODE_ALREADY_NOTIFIED_OR_ATTEMPTED';return out;}
 if(!env.IRYS_KV?.get||!env.IRYS_KV?.put){out.status='RISK_STATE_UNAVAILABLE';return out;}
 const now=clock(),attemptKey='irys:v34:risk:last-attempt';
 try{
  const raw=await env.IRYS_KV.get(attemptKey);
  if(raw){const prior=JSON.parse(raw);if(!Number.isSafeInteger(prior.at_ms)||prior.at_ms>now)throw Error('INVALID_PRIOR');
   if(now-prior.at_ms<PER_HOUR){out.status='RISK_COOLDOWN';return out;}}
 }catch{out.status='RISK_STATE_UNVERIFIED';return out;}
 if(v34Evaluate(doc,clock(),options.expectedDigest).status!=='OBSERVED_DROP'){out.status='RISK_EVIDENCE_EXPIRED_BEFORE_SEND';return out;}
 try{await env.IRYS_KV.put(attemptKey,JSON.stringify({at_ms:clock(),episode_id:episode.id}),{expirationTtl:7200});}
 catch{out.status='RISK_RESERVATION_FAILED';return out;}
 episode.attempted=true;
 const latest=v34Evaluate(doc,clock(),options.expectedDigest);
 if(latest.status!=='OBSERVED_DROP'){out.status='RISK_EXPIRED_DURING_RESERVATION';return out;}
 const permit={doc,digest:options.expectedDigest};permits.add(permit);let ack;
 try{ack=await options.send(v34Message(latest,clock()),permit);}
 catch{permits.delete(permit);out.status='RISK_DELIVERY_UNCERTAIN';return out;}
 if(!Number.isSafeInteger(ack?.message_id)||ack.message_id<=0){permits.delete(permit);out.status='RISK_ACK_UNVERIFIED';return out;}
 episode.message_id=ack.message_id;episode.sent_at_ms=clock();out.sent=1;out.message_id=ack.message_id;out.status='RISK_TELEGRAM_API_ACK';
 let persisted=true;
 try{await env.IRYS_KV.put('irys:v34:risk:ack:'+episode.id,JSON.stringify({message_id:ack.message_id,at_ms:clock()}),{expirationTtl:86400});}
 catch{persisted=false;}
 try{if(options.onAck)await options.onAck(latest,doc,ack,clock());}catch{persisted=false;}
 if(!persisted)out.status='RISK_ACK_PERSISTENCE_PARTIAL';
 out.receipt_persistence_verified=persisted;out.device_delivery_verified=false;return out;
}
export {v34Review,v34Read,v34ConsumeRiskPermit,v34Message};
