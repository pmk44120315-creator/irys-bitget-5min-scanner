/** Public-only watch selection and overlap-safe evidence merge. */
import {marketKey} from './v43_stream_core.mjs';
import {QUOTE_VERSION,QuoteOutcomeTracker} from './v43_quote_outcomes.mjs';
export function selectWatchlist(packet,history,now){
 const sets={bitget:new Set(['BTCUSDT']),bithumb:new Set(['KRW-BTC'])};
 const reasons={};const add=(v,s,why)=>{const key=marketKey(v,s);sets[v].add(s);(reasons[key]??=[]).push(why)};
 const eligible=packet?.version==='IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1'&&packet.source==='OFFICIAL_PUBLIC_RUNNER'&&packet.orders_sent===false&&packet.telegram_sent===false&&
  Number.isSafeInteger(packet.at_ms)&&packet.at_ms<=now&&now-packet.at_ms<=600000;
 if(eligible)for(const x of packet.items||[])add(x.candidate.venue,x.candidate.symbol,'CURRENT_DISCOVERY_OBSERVATION');
 if(history?.version==='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'&&history.private_messages_exported===false&&Number.isSafeInteger(history.asof_ms)&&history.asof_ms<=now){
  for(const e of history.records||[])if(e.api_ack_recorded===true&&e.actual_execution_verified===false&&Number.isSafeInteger(e.issued_at_ms)&&e.issued_at_ms<=now&&now-e.issued_at_ms<=65*60000)add(e.venue,e.symbol,'ACTUAL_ACK_UNFINISHED_HORIZON');
 }
 return {asof_ms:now,bitget:[...sets.bitget].sort(),bithumb:[...sets.bithumb].sort(),reasons,source_packet_current:eligible,arbitrary_candidate_cap:false};
}
function checked(x){if(x===null||x===undefined)return null;if(x.version!==QUOTE_VERSION||!Array.isArray(x.events)||!Number.isSafeInteger(x.asof_ms))throw Error('LEDGER_SCHEMA');return x;}
export function mergeQuoteLedgers(old,incoming){
 checked(old);checked(incoming);if(!old&&!incoming)throw Error('LEDGER_SCHEMA_EMPTY');
 if(!old)return new QuoteOutcomeTracker(incoming).export(incoming.asof_ms);
 if(!incoming)return new QuoteOutcomeTracker(old).export(old.asof_ms);
 if(old.target_tolerance_ms!==incoming.target_tolerance_ms)throw Error('TARGET_CONTRACT_CHANGED');
 const rows=new Map(old.events.map(e=>[e.id,structuredClone(e)]));
 const immutable=e=>JSON.stringify([e.venue,e.symbol,e.direction,e.issued_at_ms,e.entry_quote]);
 for(const e of incoming.events){
  if(!rows.has(e.id)){rows.set(e.id,structuredClone(e));continue;}
  const a=rows.get(e.id);if(immutable(a)!==immutable(e))throw Error('ACK_ENTRY_CONFLICT');
  for(const [h,v] of Object.entries(e.quote_outcomes)){
   const prior=a.quote_outcomes[h];
   if(prior?.status==='MEASURED_WS_QUOTE'){
    if(v.status==='MEASURED_WS_QUOTE'&&v.provider_at_ms===prior.provider_at_ms&&JSON.stringify(v.exit_quote)!==JSON.stringify(prior.exit_quote))throw Error('MEASURED_SAME_TIME_QUOTE_CONFLICT');
    continue;
   }
   if(v.status==='MEASURED_WS_QUOTE'||!prior)a.quote_outcomes[h]=structuredClone(v);
  }
  const p=a.observed_path,q=e.observed_path;
  if(q.quote_observations>0){
   p.first_quote_ms=p.first_quote_ms===null?q.first_quote_ms:Math.min(p.first_quote_ms,q.first_quote_ms);
   p.last_quote_ms=p.last_quote_ms===null?q.last_quote_ms:Math.max(p.last_quote_ms,q.last_quote_ms);
   p.coverage_start_delay_ms=p.first_quote_ms-a.issued_at_ms;
   p.max_favorable_pct=p.max_favorable_pct===null?q.max_favorable_pct:Math.max(p.max_favorable_pct,q.max_favorable_pct);
   p.max_adverse_pct=p.max_adverse_pct===null?q.max_adverse_pct:Math.min(p.max_adverse_pct,q.max_adverse_pct);
   p.max_observed_quote_gap_ms=Math.max(p.max_observed_quote_gap_ms||0,q.max_observed_quote_gap_ms||0);
   p.segments=[...new Set([...p.segments,...q.segments])];
   p.quote_observations=Math.max(p.quote_observations,q.quote_observations);p.observation_count_is_lower_bound=true;
   if(q.first_observed_touch&&(!p.first_observed_touch||q.first_observed_touch.at_ms<p.first_observed_touch.at_ms))p.first_observed_touch=structuredClone(q.first_observed_touch);
  }
 }
 return new QuoteOutcomeTracker({...old,events:[...rows.values()]}).export(Math.max(old.asof_ms,incoming.asof_ms));
}
