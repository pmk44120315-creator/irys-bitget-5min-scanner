/** Post-event V37 vs public V30 READY timing. Not equal opportunity/actual Telegram evidence. */
const median=a=>{const x=a.filter(Number.isFinite).sort((m,n)=>m-n);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null};
function v37CompareToReady(early=[],baseline=[],maxLeadMs=3600000){
 const matches=[],seen=new Set(),usedReady=new Set(),validReady=new Map();
 for(const b of baseline||[]){if(b?.model!=='V31_PAIRED_TIMELY_ENTRY_V1'||b.evidence_status!=='READY_CURRENT_EVIDENCE'||
  !Number.isSafeInteger(b.issued_at_ms)||!['BUY','LONG','SHORT'].includes(b.direction)||!['bitget','bithumb'].includes(b.venue)||
  b.venue==='bithumb'&&b.direction!=='BUY')continue;
  const entry=b.direction==='SHORT'?b.entry_quote?.bid:b.entry_quote?.ask;
  if(typeof entry!=='number'||!Number.isFinite(entry)||entry<=0)continue;
  const k=b.venue+':'+b.symbol+':'+b.direction;
  (validReady.get(k)||validReady.set(k,[]).get(k)).push({...b,baseline_entry_reference:entry});
 }
 for(const group of validReady.values())group.sort((a,b)=>a.issued_at_ms-b.issued_at_ms);
 const rows=(early||[]).filter(e=>e?.source_label==='PUBLIC_PRIOR_OBSERVATIONS_ONLY'&&e.trade_permit===false&&
 e.time_basis==='ACTUAL_EVALUATOR_DECISION_CLOCK'&&Number.isSafeInteger(e.source_observed_at_ms)&&
 Number.isSafeInteger(e.issued_at_ms)&&e.source_observed_at_ms<=e.issued_at_ms&&typeof e.entry_price==='number'&&Number.isFinite(e.entry_price)&&e.entry_price>0).sort((a,b)=>a.issued_at_ms-b.issued_at_ms||String(a.id).localeCompare(String(b.id)));
 for(const e of rows){if(seen.has(e.id))continue;seen.add(e.id);
  const k=e.venue+':'+e.symbol+':'+e.direction;
  const b=(validReady.get(k)||[]).find(x=>!usedReady.has(k+':'+x.issued_at_ms)&&x.issued_at_ms>=e.issued_at_ms&&x.issued_at_ms-e.issued_at_ms<=maxLeadMs);
  if(!b)continue;usedReady.add(k+':'+b.issued_at_ms);
  const sign=e.direction==='SHORT'?-1:1,drift=sign*100*(b.baseline_entry_reference/e.entry_price-1);
  matches.push({id:e.id,venue:e.venue,symbol:e.symbol,direction:e.direction,
   early_asof_ms:e.issued_at_ms,baseline_ready_ms:b.issued_at_ms,lead_ms:b.issued_at_ms-e.issued_at_ms,
   early_quote_proxy:e.entry_price,baseline_ready_quote_proxy:b.baseline_entry_reference,
   signed_price_progress_pct:drift,baseline_was_ready:true,actual_execution_verified:false});
 }
 const leads=matches.map(x=>x.lead_ms),drifts=matches.map(x=>x.signed_price_progress_pct);
 return {version:'V37_PUBLIC_READY_TIMING_COMPARISON_V1',comparison_revision:'V48_ONE_TO_ONE',comparison_unit:'ONE_TO_ONE_SIGNAL_EPISODE',early_events:rows.length,matched:matches.length,
  unmatched:rows.length-matches.length,legacy_unverified_clock:(early||[]).length-rows.length,source_quote_proxy_only:true,median_lead_ms:median(leads),median_signed_progress_pct:median(drifts),
  actual_telegram_ack_matches_verified:false,equal_signal_budget_verified:false,accuracy_proven:false,
  price_progress_is_not_profit:true,causal_direction_comparison_proven:false,
  matches:matches.slice(-80)};
}
export {v37CompareToReady};
