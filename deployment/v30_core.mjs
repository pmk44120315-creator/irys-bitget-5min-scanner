/** V30: executable CURRENT directional evidence, not a calibrated forecast.
 * Every permitted alert needs two disjoint original samples plus a final quote.
 * No account API, private-state read, transport or secret is used here.
 */
import {v29CheckPair,v29Quote} from './v29_direction_gate.mjs';
import {v31EntryBudget} from './v31_quality.mjs';
const V30_VERSION='IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1';
const V30_MODEL='V31_PAIRED_TIMELY_ENTRY_V1';
const V30_PACKET_MAX_AGE_MS=90000,V30_FINAL_MAX_AGE_MS=45000;
function v30N(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function v30Clock(x){return Number.isSafeInteger(x)&&x>=0;}
function v30ParsePublicJSON(text){
 // These identifiers exceed IEEE754 exact integers. Quote their original JSON
 // integer token BEFORE parsing, not after Number() has already rounded it.
 return JSON.parse(text.replace(/("(?:sequential_id|tradeId)"\s*:\s*)(-?\d+)(\s*[,}])/g,'$1"$2"$3'));
}
function v30RiskOK(c,r,now){
 if(!r||!v30Clock(r.at_ms)||r.at_ms>now||now-r.at_ms>120000)return false;
 if(c.venue==='bithumb')return r.source==='BITHUMB_OFFICIAL_MARKETS_AND_WARNINGS'&&r.market?.market===c.symbol&&r.market.market_warning==='NONE'&&Array.isArray(r.warnings)&&!r.warnings.some(w=>w.market===c.symbol);
 return c.venue==='bitget'&&r.source==='BITGET_OFFICIAL_V2_V3'&&r.instrument?.symbol===c.symbol&&r.contract?.symbol===c.symbol&&r.instrument.symbolType==='crypto'&&r.instrument.instrumentType==='crypto'&&r.contract.symbolStatus==='normal'&&r.contract.symbolType==='perpetual'&&r.contract.quoteCoin==='USDT';
}
function v30Qualify(item,now){
 const c=item?.candidate||{},fail=reason=>({model:V30_MODEL,status:'NOT_READY',allowed:false,reason,symbol:c.symbol??null,venue:c.venue??null,direction:c.direction??null,future_accuracy_proven:false,trading_permit:false});
 if(!v30Clock(now)||!v30RiskOK(c,item?.risk,now))return fail('OFFICIAL_IDENTITY_OR_RISK_UNVERIFIED');
 const a=item.first,b=item.second,f=item.final;
 if(!v30Clock(b?.observed_at_ms)||b.observed_at_ms>now||now-b.observed_at_ms>V30_PACKET_MAX_AGE_MS)return fail('PAIRED_EVIDENCE_EXPIRED');
 const candidate={...c,identity_verified:true,risk_checked:true,risk_flags:[]};
 const pair=v29CheckPair(candidate,a,b,b.observed_at_ms);
 if(pair.status!=='DOUBLE_CHECKED_CURRENT_EVIDENCE')return fail(pair.reason);
 if(f?.venue!==c.venue||f?.symbol!==c.symbol||!v30Clock(f.observed_at_ms)||f.observed_at_ms<b.observed_at_ms||f.observed_at_ms>now)return fail('FINAL_QUOTE_IDENTITY_OR_CLOCK');
 const q=v29Quote(f.quote,now,V30_FINAL_MAX_AGE_MS);
 if(!q||q.at_ms<b.quote.at_ms||q.at_ms>f.observed_at_ms||now-f.observed_at_ms>V30_FINAL_MAX_AGE_MS)return fail('FINAL_QUOTE_STALE');
 const long=c.direction!=='SHORT';
 if(long?q.bid<b.quote.bid:q.ask>b.quote.ask)return fail('FINAL_QUOTE_RETREAT');
 if(long?q.bid<=a.quote.ask:q.ask>=a.quote.bid)return fail('FINAL_EXECUTABLE_PROGRESS_LOST');
 const entryBudget=v31EntryBudget(item);
 if(!entryBudget.allowed)return fail(entryBudget.reason);
 const progress=long?100*(q.bid/a.quote.ask-1):100*(a.quote.bid-q.ask)/a.quote.bid;
 const minResponse=Math.min(Math.abs(pair.first_response.response_pct),Math.abs(pair.new_trade_response.response_pct));
 const ratio=minResponse/Math.max(q.spread_pct,.000001);
 return {model:V30_MODEL,status:'READY_CURRENT_EVIDENCE',allowed:true,reason:null,venue:c.venue,symbol:c.symbol,direction:c.direction,
  evidence_id:[V30_MODEL,c.venue,c.symbol,c.direction,b.observed_at_ms].join(':'),
  observed_at_ms:f.observed_at_ms,expires_at_ms:q.at_ms+V30_FINAL_MAX_AGE_MS,
  pair,entry_budget:entryBudget,final_quote:q,entry_reference:long?q.ask:q.bid,invalidation_reference:long?a.quote.bid:a.quote.ask,
  quote_progress_pct:progress,priority:Math.min(10,ratio)+Math.min(5,Math.abs(progress)),
  confidence_probability:null,future_accuracy_proven:false,trading_permit:false,actual_fill_verified:false};
}
function v30FuturesCandidates(rows,previous,now,identities){
 const at=previous?.at_ms,gap=now-at;
 if(!v30Clock(at)||gap<168000||gap>540000||!Array.isArray(rows)||!(identities instanceof Set))return [];
 const all=[];
 for(const row of rows){
  const symbol=row?.symbol,p=v30N(row?.price),t=row?.at_ms,old=previous.prices?.[symbol];
  const prior=v30N(Array.isArray(old)?old[0]:old);
  if(!identities.has(symbol)||!/^[A-Z0-9]{1,25}USDT$/.test(symbol)||p===null||p<=0||prior===null||prior<=0||!v30Clock(t)||t>now||now-t>90000)continue;
  const change=100*(p/prior-1);if(Math.abs(change)<1e-9)continue;
  all.push({venue:'bitget',symbol,direction:change>0?'LONG':'SHORT',anchor_price:prior,discovery_price:p,
   source_at_ms:t,change_pct:change,priority:Math.abs(change),comparison_minutes:gap/60000,discovery_is_signal:false});
 }
 return all.sort((a,b)=>b.priority-a.priority||a.symbol.localeCompare(b.symbol));
}
function v30ValidatePacket(doc,now,expectedDigest){
 const fail=reason=>({ok:false,reason});
 if(doc?.version!==V30_VERSION||doc.source!=='OFFICIAL_PUBLIC_RUNNER'||doc.orders_sent!==false||doc.telegram_sent!==false)return fail('PACKET_CONTRACT_MISMATCH');
 if(!expectedDigest||doc.model_digest!==expectedDigest)return fail('UNREVIEWED_PRODUCER_MODEL');
 if(!v30Clock(doc.at_ms)||!v30Clock(doc.started_at_ms)||doc.started_at_ms>doc.at_ms||doc.at_ms>now||now-doc.at_ms>V30_PACKET_MAX_AGE_MS||doc.at_ms-doc.started_at_ms>240000)return fail('PACKET_CLOCK_OR_AGE');
 if(!Array.isArray(doc.items))return fail('PACKET_ITEMS_INVALID');
 return {ok:true,reason:null};
}
function v30Settle(old,quotes,now){
 const rows=structuredClone(old||[]),by=new Map(quotes.map(q=>[q.venue+':'+q.symbol,q]));
 for(const r of rows){r.outcomes??={};for(const h of [5,15,30,60]){const k=String(h),target=r.issued_at_ms+h*60000;if(r.outcomes[k]||now<target)continue;
  const raw=by.get(r.venue+':'+r.symbol),q=v29Quote(raw,now,45000),entry=v29Quote(r.entry_quote,r.issued_at_ms,45000);
  if(q&&entry&&q.at_ms>=target&&q.at_ms<=target+150000){const gross=r.direction==='SHORT'?100*(entry.bid-q.ask)/entry.bid:100*(q.bid/entry.ask-1);
   r.outcomes[k]={status:'MEASURED_PUBLIC_QUOTE',at_ms:q.at_ms,delay_ms:q.at_ms-target,gross_quote_pct:gross,cost_scenario_pct:.20,net_scenario_pct:gross-.20,exit_quote:q,actual_execution_verified:false};
  }else if(now>target+150000)r.outcomes[k]={status:'UNMEASURED_TARGET_QUOTE',actual_execution_verified:false};
 }}return rows;
}
function v30OutcomeSummary(rows){
 const result={scope:'ACTUAL_ACK_RECORDS_ONLY',events:rows.length,actual_execution_verified:false,forecast_accuracy_proven:false,horizons:{}};
 for(const h of [5,15,30,60]){const all=rows.map(r=>r.outcomes?.[String(h)]),measured=all.filter(x=>x?.status==='MEASURED_PUBLIC_QUOTE');
  result.horizons[h]={measured:measured.length,unmeasured:all.filter(x=>x?.status==='UNMEASURED_TARGET_QUOTE').length,pending:all.filter(x=>!x).length,
   net_positive_scenario:measured.filter(x=>x.net_scenario_pct>0).length,mean_net_scenario_pct:measured.length?measured.reduce((a,x)=>a+x.net_scenario_pct,0)/measured.length:null};
 }return result;
}

export {V30_VERSION,V30_MODEL,V30_PACKET_MAX_AGE_MS,V30_FINAL_MAX_AGE_MS,v30N,v30Clock,v30ParsePublicJSON,v30RiskOK,v30Qualify,v30FuturesCandidates,v30ValidatePacket,v30Settle,v30OutcomeSummary};
