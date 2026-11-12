import {researchClose,cohortConvention} from './v48_downstream_clock.mjs';
/**
 * Competing observations, frozen before outcomes are available.
 * This module has no network, Telegram, order, training or promotion capability.
 * A pressure/price disagreement is an absorption hypothesis, NOT proof of intent.
 */
const VERSION='IRYS_DIRECTION_RESPONSE_RESEARCH_V1';
const STRATEGIES=['price_response','flow_follow','agreement','absorption','market_relative'];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validDirection=(venue,direction)=>venue==='bitget'?['LONG','SHORT'].includes(direction):venue==='bithumb'&&direction==='BUY';
const observedSign=(value,resolution)=>Math.abs(value)<=resolution?0:Math.sign(value);
function directionResponseHypotheses(observation,now){
 const base={version:VERSION,status:'UNCONFIRMED',decided_at_ms:now,pattern:'INSUFFICIENT_EVIDENCE',hypotheses:{},
  venue:observation?.venue??null,symbol:observation?.symbol??null,baseline_direction:observation?.direction??null,source_observed_at_ms:observation?.observed_at_ms??null,
  probability:null,trade_permission:false,live_entry_approved:false,prediction_accuracy_proven:false,
  full_cvd_verified:false,absorption_verified:false};
 const o=observation,x=o?.evidence;
 if(!Number.isSafeInteger(now)||o?.status!=='OBSERVED'||!validDirection(o.venue,o.direction)||
 !Number.isSafeInteger(o.observed_at_ms)||o.observed_at_ms>now||x?.sampled_taker_not_full_cvd!==true||
 ![x.new_buy_share,x.signed_quote_move_pct,x.new_response_pct,x.spread_pct].every(finite)||
 x.new_buy_share<0||x.new_buy_share>1||x.spread_pct<0)return base;
 const orientation=o.direction==='SHORT'?-1:1;
 const quote=orientation*x.signed_quote_move_pct,tape=orientation*x.new_response_pct;
 // A move no larger than the observed spread is not confirmation of response.
 const quoteSign=observedSign(quote,x.spread_pct),tapeSign=observedSign(tape,x.spread_pct);
 const pressure=Math.sign(x.new_buy_share-.5);
 const price=quoteSign!==0&&quoteSign===tapeSign?quoteSign:0;
 const direction=s=>s===0?null:o.venue==='bithumb'?(s>0?'BUY':'NO_BUY'):(s>0?'LONG':'SHORT');
 let pattern;
 if(!quoteSign||!tapeSign)pattern='WITHIN_SPREAD_UNRESOLVED';
 else if(quoteSign!==tapeSign)pattern='PRICE_RESPONSE_DISAGREEMENT';
 else if(!pressure)pattern='PRICE_MOVE_WITHOUT_TAKER_DOMINANCE';
 else if(price===pressure)pattern=price>0?'BUY_PRESSURE_PRICE_UP':'SELL_PRESSURE_PRICE_DOWN';
 else pattern=price>0?'SELL_PRESSURE_PRICE_UP_ABSORPTION_CANDIDATE':'BUY_PRESSURE_PRICE_DOWN_ABSORPTION_CANDIDATE';
 const relative=x.market_baseline_available===true&&x.market_baseline_alignment==='MATCHED_QUOTE_INTERVAL'&&finite(x.relative_to_market_pct)?
 observedSign(orientation*x.relative_to_market_pct,x.spread_pct):0;
 return {...base,status:'OBSERVED_RESEARCH',venue:o.venue,symbol:o.symbol,baseline_direction:o.direction,source_observed_at_ms:o.observed_at_ms,
  pattern,hypotheses:{price_response:direction(price),flow_follow:direction(pressure),
   agreement:price!==0&&price===pressure?direction(price):null,
   absorption:price!==0&&pressure!==0&&price!==pressure?direction(price):null,market_relative:direction(relative)},
  observations:{raw_quote_move_pct:quote,raw_tape_response_pct:tape,buy_share:x.new_buy_share,spread_pct:x.spread_pct,
   sampled_taker_only:true,gross_turnover_is_not_net_flow:true}};
}

/**
 * Exploratory paired close-direction comparison; not a trade-return backtest.
 * Alternatives and their baseline use identical event/time/price references.
 * Missing outcomes, abstentions and flat outcomes remain explicitly separate.
 * No threshold optimization, p-value, calibration or superiority claim is made.
 */
function compareDirectionHypotheses(events,{now,horizon=5}={}){
 if(!Array.isArray(events)||!Number.isSafeInteger(now)||![5,15,30,60].includes(horizon))throw new TypeError('INVALID_COMPARISON_INPUT');
 const horizon_reference=cohortConvention(events);
 const totals=()=>({positive:0,negative:0,flat:0,sum_signed_change_pct:0,mean_signed_change_pct:null});
 const strategies=Object.fromEntries(STRATEGIES.map(k=>[k,{supported_decisions:0,matched:0,coverage:0,decision_coverage:0,
  alternative:totals(),baseline:totals()}]));
 const excluded={duplicate_id:0,conflicting_duplicate_record:0,invalid_identity:0,unverified_clock:0,hypothesis_clock:0,pending_horizon:0,missing_label:0,invalid_label:0};
 let valid_decisions=0,measured_records=0;const seen=new Set();
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
 const fingerprints=new Map(),conflicts=new Set();
 for(const e of events){if(typeof e?.id!=='string')continue;const fp=JSON.stringify(canonical(e));
  if(fingerprints.has(e.id)&&fingerprints.get(e.id)!==fp)conflicts.add(e.id);else fingerprints.set(e.id,fp);
 }
 const bump=(out,value)=>{out[value>0?'positive':value<0?'negative':'flat']++;out.sum_signed_change_pct+=value;};
 for(const e of events){
  if(typeof e?.id!=='string'||!e.id||!validDirection(e?.venue,e?.direction)){excluded.invalid_identity++;continue;}
  if(conflicts.has(e.id)){excluded.conflicting_duplicate_record++;continue;}
  if(seen.has(e.id)){excluded.duplicate_id++;continue;}seen.add(e.id);
  if(e.time_basis!=='ACTUAL_EVALUATOR_DECISION_CLOCK'||!Number.isSafeInteger(e.issued_at_ms)||e.issued_at_ms>now||
   !Number.isSafeInteger(e.source_observed_at_ms)||e.source_observed_at_ms>e.issued_at_ms){excluded.unverified_clock++;continue;}
  const r=e.direction_response;
  if(r?.version!==VERSION||r.decided_at_ms!==e.issued_at_ms||r.venue!==e.venue||r.symbol!==e.symbol||
   r.baseline_direction!==e.direction||!r.hypotheses||r.trade_permission!==false){excluded.hypothesis_clock++;continue;}
  valid_decisions++;
  for(const k of STRATEGIES)if(validDirection(e.venue,r.hypotheses[k]))strategies[k].supported_decisions++;
  const target=e.issued_at_ms+horizon*60000;
  if(now<target){excluded.pending_horizon++;continue;}
  const label=e.direction_outcomes?.[horizon];
  if(label?.status!=='MEASURED_DIRECTION'){excluded.missing_label++;continue;}
  // Preserve archived semantics while accepting the explicit corrected V48 clock.
  const expectedClose=researchClose(e,label,target);
  if(!finite(e.entry_price)||e.entry_price<=0||label.entry_quote_reference!==e.entry_price||
   !finite(label.target_close)||label.target_close<=0||label.horizon_minutes!==horizon||label.target_ms!==target||
   label.close_at_ms!==expectedClose||label.close_at_ms>now||label.close_at_ms<=e.issued_at_ms||label.actual_execution_verified!==false){
   excluded.invalid_label++;continue;
  }
  const raw=100*(label.target_close/e.entry_price-1);if(!finite(raw)){excluded.invalid_label++;continue;}
  measured_records++;const original=(e.direction==='SHORT'?-1:1)*raw;
  for(const k of STRATEGIES){const d=r.hypotheses[k];if(!validDirection(e.venue,d))continue;
   const s=strategies[k];s.matched++;bump(s.baseline,original);bump(s.alternative,(d==='SHORT'?-1:1)*raw);
  }
 }
 for(const s of Object.values(strategies)){
  s.coverage=valid_decisions?s.matched/valid_decisions:0;s.decision_coverage=valid_decisions?s.supported_decisions/valid_decisions:0;
  if(s.matched){s.alternative.mean_signed_change_pct=s.alternative.sum_signed_change_pct/s.matched;s.baseline.mean_signed_change_pct=s.baseline.sum_signed_change_pct/s.matched;}
 }
 return {version:VERSION,horizon_minutes:horizon,asof_ms:now,valid_decisions,measured_records,excluded,strategies,
  horizon_reference,common_price_reference_not_executable:true,
  costs_included:false,actual_telegram_ack_verified:false,independent_samples_verified:false,
  prediction_accuracy_proven:false,auto_promote:false};
}
export {VERSION,directionResponseHypotheses,compareDirectionHypotheses};
