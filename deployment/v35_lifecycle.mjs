/** Acknowledged-signal state, not a new price forecast or an order instruction. */
import {v29Quote} from './v29_direction_gate.mjs';
const V35_HORIZON_MS=15*60000;
const v35EditPermits=new WeakSet();
function v35ConsumeEditPermit(p){if(!p||typeof p!=='object'||!v35EditPermits.has(p))return false;v35EditPermits.delete(p);return p.message_id===p.signal.message_id&&p.text===v35StatusText(p.signal,p.proof);}
function v35FollowupMarkets(rows,now){
 const map=new Map();
 for(const r of rows||[]){if(r?.evidence_status!=='READY_CURRENT_EVIDENCE'||!Number.isSafeInteger(r.issued_at_ms)||r.issued_at_ms>=now||now-r.issued_at_ms>V35_HORIZON_MS)continue;
  if(!['bitget','bithumb'].includes(r.venue)||typeof r.symbol!=='string')continue;
  map.set(r.venue+':'+r.symbol,{venue:r.venue,symbol:r.symbol});
 }return [...map.values()];
}
function v35ReviewSignal(r,f,now){
 const result=(status,editable=false,extra={})=>({status,editable,forecast_accuracy_proven:false,direction_reversed:false,...extra});
 if(!r||!Number.isSafeInteger(r.message_id)||r.message_id<=0||!Number.isSafeInteger(r.issued_at_ms)||r.issued_at_ms>now||!['LONG','SHORT','BUY'].includes(r.direction)||!(Number.isFinite(r.invalidation_reference)&&r.invalidation_reference>0)||typeof r.original_text!=='string'||!r.original_text)return result('LEGACY_UNVERIFIED');
 if(now-r.issued_at_ms>=V35_HORIZON_MS)return result('EXPIRED',true,{checked_at_ms:now});
 if(!f||f.venue!==r.venue||f.symbol!==r.symbol)return result('UNVERIFIED');
 const a=f.first,b=f.second,z=f.final;
 for(const x of [a,b,z])if(!x||x.venue!==r.venue||x.symbol!==r.symbol||!Number.isSafeInteger(x.observed_at_ms)||x.observed_at_ms<=r.issued_at_ms||x.observed_at_ms>now)return result('UNVERIFIED');
 if(b.observed_at_ms-a.observed_at_ms<8000||b.observed_at_ms-a.observed_at_ms>45000||z.observed_at_ms<b.observed_at_ms)return result('UNVERIFIED');
 const qa=v29Quote(a.quote,a.observed_at_ms),qb=v29Quote(b.quote,b.observed_at_ms),qz=v29Quote(z.quote,now,45000);
 if(!qa||!qb||!qz||qa.at_ms<=r.issued_at_ms||qb.at_ms<=a.observed_at_ms||qz.at_ms<qb.at_ms||qz.at_ms>z.observed_at_ms||now-b.observed_at_ms>90000)return result('UNVERIFIED');
 const adverse=q=>r.direction==='SHORT'?q.bid>r.invalidation_reference:q.ask<r.invalidation_reference;
 if([qa,qb,qz].every(adverse))return result('INVALIDATED',true,{checked_at_ms:now,first_quote:qa,second_quote:qb,final_quote:qz,reference:r.invalidation_reference,reason:'ORIGINAL_REFERENCE_BROKEN_IN_TWO_NEW_QUOTES'});
 return result('OBSERVED_NO_CONFIRMED_BREACH',false,{checked_at_ms:now});
}
function v35StatusText(r,proof){
 const at=new Date(proof.checked_at_ms+9*3600000).toISOString().slice(0,19).replace('T',' ')+' KST';
 const line=proof.status==='INVALIDATED'?'⚠️ 기존 방향 근거 무효 — 이후 새 진입 신호로 사용하지 마세요.':'⌛ 방향 가설 관찰기간 종료 — 과거 신호를 신규 진입에 재사용하지 마세요.';
 return (r.original_text+'\n\n'+line+'\n확인 '+at+'\n반대 방향 추천·자동청산 지시가 아닙니다.').slice(0,4000);
}
async function v35Reconcile(state,doc,options={}){
 const now=(options.clock||Date.now)(),map=new Map();
 for(const x of Array.isArray(doc?.followups)?doc.followups:[]){if(!x||typeof x.venue!=='string'||typeof x.symbol!=='string')continue;const key=x.venue+':'+x.symbol;if(map.has(key)&&JSON.stringify(map.get(key))!==JSON.stringify(x))map.set(key,null);else if(!map.has(key))map.set(key,x);}
 const summary={tracked:0,invalidated:0,expired:0,unverified:0,edits_verified:0,edit_errors:0,new_messages_sent:0,forecast_accuracy_proven:false,cadence_ms:300000};
 for(const r of state.v30ActualForecasts||[]){
  if(!r.lifecycle&&(!r.message_id||!r.invalidation_reference||!r.original_text))continue;
  summary.tracked++;r.lifecycle??={status:'ACTIVE'};
  let proof=r.lifecycle.pending_proof||v35ReviewSignal(r,map.get(r.venue+':'+r.symbol),now);
  if(r.lifecycle.edit_verified){if(r.lifecycle.status==='INVALIDATED')summary.invalidated++;else if(r.lifecycle.status==='EXPIRED')summary.expired++;continue;}
  r.lifecycle.last_review_status=proof.status;r.lifecycle.last_reviewed_at_ms=now;
  if(!proof.editable){if(['UNVERIFIED','LEGACY_UNVERIFIED'].includes(proof.status))summary.unverified++;continue;}
  r.lifecycle.status=proof.status;r.lifecycle.pending_proof=proof;r.lifecycle.edit_verified=false;
  if(proof.status==='INVALIDATED')summary.invalidated++;else summary.expired++;
  try{
   if(typeof options.edit!=='function')throw Error('EDITOR_UNAVAILABLE');
   const permit={message_id:r.message_id,text:v35StatusText(r,proof),signal:r,proof};v35EditPermits.add(permit);
   let result;try{result=await options.edit(permit)}finally{v35EditPermits.delete(permit)}
   if(result?.verified!==true)throw Error('EDIT_ACK_NOT_VERIFIED');
   r.lifecycle.edit_verified=true;r.lifecycle.edit_verified_at_ms=now;delete r.lifecycle.pending_proof;summary.edits_verified++;
  }catch{summary.edit_errors++;}
 }
 return summary;
}
export {v35ConsumeEditPermit,V35_HORIZON_MS,v35FollowupMarkets,v35ReviewSignal,v35StatusText,v35Reconcile};
