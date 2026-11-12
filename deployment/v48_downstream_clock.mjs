/** Version-aware compatibility for archived research; never pool different label clocks. */
import {V48_MEASUREMENT_VERSION as V} from './v48_measurement.mjs';
export function researchConvention(event,label){
 const ev=event?.direction_measurement_version,lv=label?.measurement_version;
 if(ev===V&&lv===V)return 'FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET';
 if(ev===undefined&&lv===undefined)return 'LAST_CLOSED_MINUTE_AT_OR_BEFORE_TARGET';
 return null;
}
export function researchClose(event,label,target){
 const convention=researchConvention(event,label);
 return convention==='FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET'?Math.ceil(target/60000)*60000:
 convention==='LAST_CLOSED_MINUTE_AT_OR_BEFORE_TARGET'?Math.floor(target/60000)*60000:NaN;
}
export function cohortConvention(events){
 const kinds=new Set();
 for(const e of events)for(const label of Object.values(e?.direction_outcomes||{})){
  if(label?.status!=='MEASURED_DIRECTION')continue;
  const kind=researchConvention(e,label);if(kind)kinds.add(kind);
 }
 if(kinds.size>1)throw Error('MIXED_MEASUREMENT_SEMANTICS');
 return [...kinds][0]??'NO_VALID_MEASUREMENT';
}
