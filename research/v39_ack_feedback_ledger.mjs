/** Durable, sanitized public ACK directional feedback ledger.
 * Research branch writer stores ONLY public symbol/time/direction/pre-ACK features
 * and official post-ACK closed-minute outcomes. It NEVER touches live Cloudflare,
 * Telegram, private KV, trading/account API or the production main branch.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {replay} from './v39_latest_ack_replay.mjs';
const VERSION='IRYS_V39_PUBLIC_ACK_FEEDBACK_LEDGER_V1',H=[5,15,30,60],DAY=86400000;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function publicValid(x,now){
 return x?.same_pre_ack_evidence_verified===true&&x.read_only===true&&x.telegram_sent===false&&x.orders_sent===false&&
 Number.isSafeInteger(x.ack_at_ms)&&x.ack_at_ms>0&&x.ack_at_ms<=now&&
 typeof x.symbol==='string'&&/^(KRW-)?[A-Z0-9]{1,25}(USDT)?$/.test(x.symbol)&&
 ['bitget','bithumb'].includes(x.venue)&&
 (x.venue==='bithumb'?x.direction==='BUY':['LONG','SHORT'].includes(x.direction))&&
 typeof x.source_commit==='string'&&/^[0-9a-f]{40}$/.test(x.source_commit)&&
 Number.isSafeInteger(x.source_at_ms)&&x.source_at_ms<=x.ack_at_ms;
}
function sanitizedOutcome(o,h,issued,now){
 if(!o||o.status!=='MEASURED_MINUTE_CLOSE_PROXY')return {status:o?.status||'UNKNOWN'};
 const target=issued+h*60000;
 if(o.target_ms!==target||now<target||!Number.isSafeInteger(o.closed_at_ms)||
 o.closed_at_ms>now||o.actual_execution_verified!==false||
 !finite(o.signed_price_pct)||!finite(o.scenario_after_0_20pct_cost))
 return {status:'UNVERIFIED_MEASUREMENT'};
 return {status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:target,
  closed_at_ms:o.closed_at_ms,signed_price_pct:o.signed_price_pct,
  scenario_after_0_20pct_cost:o.scenario_after_0_20pct_cost,
  path_minutes_observed:o.path_minutes_observed??null,
  path_minutes_expected:o.path_minutes_expected??null,
  actual_execution_verified:false};
}
function empty(){
 return {version:VERSION,asof_ms:0,events:[],source:'PUBLIC_ACK_FROZEN_V30_AND_OFFICIAL_CLOSED_MINUTES',
  research_only:true,telegram_sent:false,orders_sent:false,
  actual_execution_verified:false,all_alerts_captured_proven:false};
}
function incorporate(old,proof,now){
 if(!Number.isSafeInteger(now))throw new TypeError('INVALID_TIME');
 const base=old?.version===VERSION&&Array.isArray(old.events)?structuredClone(old):empty();
 const out={ledger:base,added:0,updated:0,conflicts:0,ignored:0};
 if(!publicValid(proof,now)){out.ignored++;return out;}
 const id=proof.venue+':'+proof.symbol+':'+proof.ack_at_ms;
 let event=base.events.find(x=>x.id===id);
 if(event&&(event.source_commit!==proof.source_commit||event.direction!==proof.direction)){
  out.conflicts++;return out;
 }
 if(!event){
  event={id,venue:proof.venue,symbol:proof.symbol,direction:proof.direction,
   ack_at_ms:proof.ack_at_ms,source_commit:proof.source_commit,
   source_at_ms:proof.source_at_ms,source_to_ack_ms:proof.source_to_ack_ms??null,
   quote_to_ack_ms:proof.quote_to_ack_ms??null,
   preselection_5m_move_pct:proof.preselection_5m_move_pct??null,
   first_taker_buy_share:proof.independent_first_taker_share??null,
   second_taker_buy_share:proof.independent_second_taker_share??null,
   outcomes:{}};
  base.events.push(event);out.added++;
 }
 for(const h of H){
  const key=String(h),n=sanitizedOutcome(proof.outcomes?.[key],h,proof.ack_at_ms,now),
   oldO=event.outcomes[key];
  if(n.status!=='MEASURED_MINUTE_CLOSE_PROXY'){
   if(!oldO){event.outcomes[key]=n;if(!out.added)out.updated++;}
   continue;
  }
  if(oldO?.status==='MEASURED_MINUTE_CLOSE_PROXY'){
   if(oldO.signed_price_pct!==n.signed_price_pct||oldO.closed_at_ms!==n.closed_at_ms)out.conflicts++;
   continue;
  }
  event.outcomes[key]=n;if(!out.added)out.updated++;
 }
 if(out.added||out.updated){
  base.events=base.events.sort((a,b)=>a.ack_at_ms-b.ack_at_ms).slice(-600);
  base.asof_ms=now;
 }
 return out;
}
function ledgerStats(x,now){
 const rows=x?.events||[],r={events:rows.length,horizons:{},latest_ack_at_ms:rows.at(-1)?.ack_at_ms??null,
  captured_full_history_proven:false,trade_execution_verified:false};
 for(const h of H){
  const m=rows.map(x=>x.outcomes?.[String(h)]).filter(x=>x?.status==='MEASURED_MINUTE_CLOSE_PROXY');
  r.horizons[h]={measured:m.length,positive:m.filter(x=>x.signed_price_pct>0).length,
   scenario_positive:m.filter(x=>x.scenario_after_0_20pct_cost>0).length,
   mean_signed_pct:m.length?m.reduce((a,b)=>a+b.signed_price_pct,0)/m.length:null,
   missing_or_pending:rows.length-m.length};
 }
 return r;
}
async function run({state,latest,now,read,githubToken=null,maxRechecks=8}){
 let ledger=state?.version===VERSION&&Array.isArray(state.events)?state:empty();
 const report={new_proofs:0,updated_proofs:0,conflicts:0,unverified:0,rechecked:0};
 const adopt=p=>{const v=incorporate(ledger,p,now);ledger=v.ledger;report.new_proofs+=v.added;report.updated_proofs+=v.updated;report.conflicts+=v.conflicts;report.unverified+=v.ignored;};
 adopt(latest);
 const pending=[...ledger.events].reverse().filter(x=>x.ack_at_ms+5*60000<=now&&x.ack_at_ms>=now-2*DAY&&
   H.some(h=>x.outcomes?.[h]?.status!=='MEASURED_MINUTE_CLOSE_PROXY'&&now>=x.ack_at_ms+h*60000));
 for(const e of pending.slice(0,Math.max(0,Math.min(30,maxRechecks)))){
  try{adopt(await replay({ack:{last_api_ack_ms:e.ack_at_ms,last_api_ack_symbol:e.symbol},snapshotAtMs:now,githubToken,read}));}
  catch{report.unverified++;}
  report.rechecked++;
 }
 return {ledger,report,summary:ledgerStats(ledger,now)};
}
async function main(){
 const get=p=>{try{return JSON.parse(readFileSync(p,'utf8'))}catch{return null}};
 const now=Date.now(),old=get('data/v39_ack_feedback.json')||empty(),
 latest=get('v39_direction_audit/latest_ack_replay.json');
 const v=await run({state:old,latest,now,githubToken:process.env.GITHUB_TOKEN||null});
 mkdirSync('v39_direction_audit',{recursive:true});
 writeFileSync('v39_direction_audit/v39_ack_feedback_next.json',JSON.stringify(v.ledger,null,2)+'\n');
 writeFileSync('v39_direction_audit/feedback_receipt.json',JSON.stringify({asof_ms:now,...v.report,summary:v.summary},null,2)+'\n');
 console.log('V39_DURABLE_PUBLIC_ACK_LEDGER',JSON.stringify({at_ms:now,...v.report,summary:v.summary}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V39_LEDGER_AUDIT_ERROR',e?.name||'Error');process.exitCode=1;});
export {empty,incorporate,ledgerStats,run};
