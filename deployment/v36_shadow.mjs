/** Immutable prospective shadow. Never sends market alerts or orders. */
import {v36Evidence} from './v36_hypotheses.mjs';
import {v36Freeze,v36Label} from './v36_paths.mjs';
const V36_VERSION='V36_CONTRA_PROSPECTIVE_SHADOW_V1',MAX_EVENTS=3000,EPISODE_MS=1800000;
const key=e=>`${e.venue}:${e.symbol}:${e.direction}:${Math.floor(e.issued_at_ms/EPISODE_MS)}`;
function validPacket(p,now,digest){
 return p?.version==='IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1'&&p?.source==='OFFICIAL_PUBLIC_RUNNER'&&p.model_digest===digest&&
 p.orders_sent===false&&p.telegram_sent===false&&Array.isArray(p.items)&&Number.isSafeInteger(p.at_ms)&&p.at_ms<=now&&now-p.at_ms<=90000&&
 Number.isSafeInteger(p.started_at_ms)&&p.started_at_ms<=p.at_ms;
}
function v36Observe(old={}, {packet,now,baselineDigest,benchmark=null}={}){
 const state={version:V36_VERSION,events:Array.isArray(old.events)?structuredClone(old.events):[],last_asof_ms:old.last_asof_ms||0};
 if(!validPacket(packet,now,baselineDigest))return {status:'SOURCE_NOT_ELIGIBLE',events:[],state,source_asof_ms:packet?.at_ms??null};
 const ids=new Set(state.events.map(e=>e.id)),added=[];
 for(const item of packet.items){
  const frozen=v36Freeze(item,packet.at_ms);if(!frozen)continue;
  const evidence=v36Evidence(item,packet.at_ms,benchmark||{});if(evidence.status!=='OBSERVED')continue;
  const id=key(frozen);if(ids.has(id))continue;ids.add(id);
  const rec={...frozen,id,observed_hypothesis:evidence,baseline_model_digest:packet.model_digest,
   baseline_ready:packet.checks?.some(x=>x.venue===frozen.venue&&x.symbol===frozen.symbol&&x.direction===frozen.direction&&x.allowed===true)||false,
   outcomes:{},created_from_public_packet_at_ms:packet.at_ms};
  added.push(rec);state.events.push(rec);
 }
 state.events=state.events.slice(-MAX_EVENTS);state.last_asof_ms=Math.max(state.last_asof_ms,packet.at_ms);
 return {status:'OBSERVED',events:added,state,source_asof_ms:packet.at_ms};
}
function v36Advance(old={},pages=[],now){
 const state={version:V36_VERSION,events:structuredClone(old.events||[]),last_asof_ms:old.last_asof_ms||0};
 const by=new Map(pages.filter(p=>p?.source==='OFFICIAL_NATIVE_1M'&&Number.isSafeInteger(p.fetched_at_ms)&&p.fetched_at_ms<=now&&Array.isArray(p.bars)).map(p=>[`${p.venue}:${p.symbol}`,p]));
 for(const e of state.events){const p=by.get(`${e.venue}:${e.symbol}`);if(!p)continue;e.outcomes??={};
  for(const h of [5,15,30,60]){
   if(e.outcomes[h]&&['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT'].includes(e.outcomes[h].status))continue;
   const result=v36Label(e,p.bars,Math.min(now,p.fetched_at_ms),h);
   if(!['PENDING','PENDING_MISSING_CANDLE'].includes(result.status))e.outcomes[h]=result;
  }
 }
 return state;
}
function v36Gate({pairs=0,correct=0,total=0,baselineCorrect=0,coverage=0}={}){
 const enough=Number.isInteger(pairs)&&pairs>=300&&Number.isInteger(total)&&total>=300&&coverage>=.85;
 const lift=enough&&correct>=baselineCorrect+Math.ceil(total*.05);
 return {promote:false,eligible_for_review:!!lift,reason:!enough?'INSUFFICIENT_PROSPECTIVE_MATCHED_COVERAGE':!lift?'NO_ROBUST_SUPERIORITY':'INDEPENDENT_REVIEW_REQUIRED',
 required_manual_rollout:true};
}
function v36Summary(state){
 const events=state?.events||[],out={version:V36_VERSION,events:events.length,actual_alerts:0,signals_sent:0,orders_sent:false,auto_promote:false,directions:{}};
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT']){
  const rows=events.filter(r=>r.venue===venue&&r.direction===direction),s={issued:rows.length,baseline_ready:rows.filter(r=>r.baseline_ready).length,horizons:{}};
  for(const h of [5,15,30,60]){
   const labels=rows.map(r=>r.outcomes?.[h]?.status);
   s.horizons[h]={target_first:labels.filter(x=>x==='TARGET_FIRST').length,stop_first:labels.filter(x=>x==='STOP_FIRST').length,
    ambiguous:labels.filter(x=>x==='AMBIGUOUS_BOTH').length,no_touch:labels.filter(x=>x==='NO_TOUCH_TIMEOUT').length,
    missing:labels.filter(x=>x?.startsWith('UNMEASURED')||x==='CONFLICTING_CANDLES').length,
    pending:labels.filter(x=>!x||x==='PENDING').length};
  }
  out.directions[`${venue}:${direction}`]=s;
 }return out;
}
export {V36_VERSION,v36Observe,v36Advance,v36Gate,v36Summary};
