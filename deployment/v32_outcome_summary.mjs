/** Side-effect-free audit accounting. No forecast policy or live sender changes.
 * "Pending" means the target minute has not closed, not an absent old label.
 * Candidate outcome evidence must never be presented as actual Telegram results.
 */
const HORIZONS=[5,15,30,60];
const clock=x=>Number.isSafeInteger(x)&&x>=0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function summarizeOutcomes(records,asofMs){
 if(!Array.isArray(records)||!clock(asofMs))throw new TypeError('VALID_RECORDS_AND_ASOF_REQUIRED');
 const out={version:'V32_OUTCOME_ACCOUNTING_V1',asof_ms:asofMs,scope:'PUBLIC_CANDIDATE_RECORDS_NOT_TELEGRAM_ACKS',
  events:records.length,actual_execution_verified:false,forecast_accuracy_proven:false,horizons:{}};
 for(const h of HORIZONS){
  const v={measured:0,target_unavailable:0,overdue_unmeasured:0,pending:0,invalid:0,
   directional_positive:0,net_positive_scenario:0,mean_gross_reference_pct:null,partition_total:0};
  let total=0;
  for(const r of records){
   if(!clock(r?.issued_at_ms)||r.issued_at_ms>asofMs){v.invalid++;continue;}
   const target=Math.ceil((r.issued_at_ms+h*60000)/60000)*60000;
   const a=r.minute_outcomes?.[String(h)];
   if(a?.status==='MEASURED_MINUTE_CLOSE_PROXY'){
    if(!finite(a.gross_reference_pct)||!clock(a.close_at_ms)||a.close_at_ms>asofMs||a.close_at_ms<target){v.invalid++;continue;}
    v.measured++;total+=a.gross_reference_pct;
    if(a.gross_reference_pct>0)v.directional_positive++;
    if(finite(a.net_cost_scenario_pct)&&a.net_cost_scenario_pct>0)v.net_positive_scenario++;
   }else if(target>asofMs){v.pending++;}
   else if(a?.status==='TARGET_MINUTE_UNAVAILABLE'){v.target_unavailable++;}
   else if(a==null){v.overdue_unmeasured++;}
   else {v.invalid++;}
  }
  v.mean_gross_reference_pct=v.measured?total/v.measured:null;
  v.partition_total=v.measured+v.target_unavailable+v.overdue_unmeasured+v.pending+v.invalid;
  if(v.partition_total!==records.length)throw new Error('ACCOUNTING_PARTITION_FAILURE');
  out.horizons[h]=v;
 }
 return out;
}
export {summarizeOutcomes};
