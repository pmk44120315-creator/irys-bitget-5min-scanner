/** Actual delivery quality, not candidate backtest or account profit.
 * Join only exact immutable ACK identities. Keep price direction, executable
 * bid/ask reference, maturity, missingness and version/role denominators separate.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const VERSION='V46_ACTUAL_DELIVERY_QUALITY_V1',H=[5,15,30,60];
const finite=x=>typeof x==='number'&&Number.isFinite(x),clock=x=>Number.isSafeInteger(x)&&x>=0;
const key=e=>[e.venue,e.symbol,e.issued_at_ms].join(':');
const basis=e=>JSON.stringify([e.venue,e.symbol,e.direction,e.issued_at_ms,e.entry_quote?.bid,e.entry_quote?.ask,e.entry_quote?.at_ms]);
function valid(e,now){return clock(e?.issued_at_ms)&&e.issued_at_ms<=now&&clock(e.entry_quote?.at_ms)&&e.entry_quote.at_ms<=e.issued_at_ms&&finite(e.entry_quote.bid)&&finite(e.entry_quote.ask)&&0<e.entry_quote.bid&&e.entry_quote.bid<=e.entry_quote.ask&&typeof e.symbol==='string'&&(e.venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(e.symbol)&&['LONG','SHORT'].includes(e.direction):e.venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(e.symbol)&&e.direction==='BUY');}
function cohort(e){const c=e.entry_context_v45;if(c?.version!=='V45_RSI_ENTRY_CONTEXT_V1')return 'LEGACY_NO_RSI';const role=['DIRECTION_OBSERVATION','CAUTION_OBSERVATION','CONTEXT_UNVERIFIED'].includes(c.role)?c.role:'CONTEXT_UNVERIFIED';return (c.source_context_revision==='V46_SPARSE_SOURCE_DISCLOSED'?'V46_':'V45_')+role;}
function index(rows){const m=new Map();for(const e of Array.isArray(rows)?rows:[]){const k=key(e);if(m.has(k)&&JSON.stringify(m.get(k))!==JSON.stringify(e))m.set(k,null);else if(!m.has(k))m.set(k,e);}return m;}
function metric(values,pending,total){const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return {measured:n,positive:values.filter(x=>x>0).length,negative:values.filter(x=>x<0).length,flat:values.filter(x=>x===0).length,pending,missing:total-pending-n,mean_pct:n?values.reduce((a,b)=>a+b,0)/n:null,median_pct:n?(sorted[Math.floor(n/2)]+sorted[Math.floor((n-1)/2)])/2:null};}
export function buildActualQuality({history,minute,quotes,asof_ms}){
 if(!clock(asof_ms)||history?.version!=='V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1'||history.private_messages_exported!==false||!Array.isArray(history.records)||!clock(history.asof_ms)||history.asof_ms>asof_ms)throw Error('VERIFIED_PUBLIC_ACK_HISTORY_REQUIRED');
 const diagnostics={invalid_ack:0,conflicting_ack:0,entry_conflicts:0,invalid_outcomes:0};const ack=new Map(),bad=new Set();
 for(const e of history.records){if(e.api_ack_recorded!==true||e.actual_execution_verified!==false||!valid(e,asof_ms)){diagnostics.invalid_ack++;continue;}const k=key(e);if(ack.has(k)&&basis(ack.get(k))!==basis(e))bad.add(k);else if(!ack.has(k))ack.set(k,e);}
 for(const k of bad)ack.delete(k);diagnostics.conflicting_ack=bad.size;
 const mi=index(minute?.events),qi=index(quotes?.events),rows=[];
 for(const e of ack.values()){
  const k=key(e),sign=e.direction==='SHORT'?-1:1,entryMid=(e.entry_quote.bid+e.entry_quote.ask)/2;let a=mi.get(k),b=qi.get(k);
  for(const x of [a,b])if(x&&basis(x)!==basis(e))diagnostics.entry_conflicts++;
  if(a&&basis(a)!==basis(e))a=null;if(b&&basis(b)!==basis(e))b=null;
  const r={id:k,venue:e.venue,symbol:e.symbol,direction:e.direction,issued_at_ms:e.issued_at_ms,cohort:cohort(e),entry_quote:{bid:e.entry_quote.bid,ask:e.entry_quote.ask,at_ms:e.entry_quote.at_ms},entry_confirmed:e.entry_context_v45?.entry_confirmed===true,horizons:{}};
  for(const h of H){const target=e.issued_at_ms+h*60000,closeEnd=Math.ceil(target/60000)*60000,x=a?.outcomes?.[h],y=b?.quote_outcomes?.[h];let close=null,exec=null;
   if(x?.status==='MEASURED_MINUTE_CLOSE_PROXY'){
    if(x.target_ms===target&&x.closed_at_ms===closeEnd&&closeEnd<=asof_ms&&finite(x.target_close)&&x.target_close>0&&x.actual_execution_verified===false)close=sign*100*(x.target_close/entryMid-1);else diagnostics.invalid_outcomes++;
   }
   if(y?.status==='MEASURED_WS_QUOTE'){
    if(y.target_ms===target&&clock(y.provider_at_ms)&&y.provider_at_ms>=target&&y.provider_at_ms-target<=5000&&clock(y.received_at_ms)&&y.received_at_ms>=y.provider_at_ms&&y.received_at_ms<=asof_ms&&finite(y.exit_quote?.bid)&&finite(y.exit_quote?.ask)&&0<y.exit_quote.bid&&y.exit_quote.bid<=y.exit_quote.ask&&y.actual_execution_verified===false){exec=e.direction==='SHORT'?100*(e.entry_quote.bid-y.exit_quote.ask)/e.entry_quote.bid:100*(y.exit_quote.bid/e.entry_quote.ask-1);
      if(!finite(y.signed_quote_return_pct)||Math.abs(exec-y.signed_quote_return_pct)>1e-7){diagnostics.invalid_outcomes++;exec=null;}
    }else diagnostics.invalid_outcomes++;
   }
   r.horizons[h]={target_ms:target,closed_price_direction_pct:close,executable_quote_return_pct:exec,closed_price_status:close!==null?'MEASURED_CLOSE_PROXY':asof_ms<closeEnd?'PENDING':'MISSING',executable_quote_status:exec!==null?'MEASURED_PUBLIC_BID_ASK':asof_ms<target+5000?'PENDING':'MISSING',actual_execution_verified:false};
  }
  if(b?.observed_path)r.observed_path={max_adverse_pct:b.observed_path.max_adverse_pct??null,max_favorable_pct:b.observed_path.max_favorable_pct??null,coverage_start_delay_ms:b.observed_path.coverage_start_delay_ms??null,max_observed_quote_gap_ms:b.observed_path.max_observed_quote_gap_ms??null,complete_tick_path_verified:false};
  rows.push(r);
 }
 rows.sort((a,b)=>a.issued_at_ms-b.issued_at_ms||a.id.localeCompare(b.id));const groups={};
 for(const name of ['all',...new Set(rows.map(r=>r.cohort))]){const own=name==='all'?rows:rows.filter(r=>r.cohort===name),out={records:own.length,entry_confirmed_records:own.filter(r=>r.entry_confirmed).length,horizons:{}};
  for(const h of H){const os=own.map(r=>r.horizons[h]);const c=metric(os.map(x=>x.closed_price_direction_pct).filter(finite),os.filter(x=>x.closed_price_status==='PENDING').length,own.length),q=metric(os.map(x=>x.executable_quote_return_pct).filter(finite),os.filter(x=>x.executable_quote_status==='PENDING').length,own.length);out.horizons[h]={closed_price_direction:c,executable_quote:{...q,mean_after_assumed_0_20pct_cost:q.mean_pct===null?null:q.mean_pct-.2,fee_schedule_verified:false}};}
  groups[name]=out;
 }
 return {version:VERSION,asof_ms,input_asof_ms:{history:history.asof_ms,minute:minute?.asof_ms??null,quotes:quotes?.asof_ms??null},diagnostics,groups,records:rows,price_direction_definition:'SIGNED_FUTURE_CLOSED_PRICE_VERSUS_ACK_MID_REFERENCE_NOT_EXECUTION',executable_definition:'LONG_OR_BUY_ENTRY_ASK_EXIT_BID_SHORT_ENTRY_BID_EXIT_ASK',all_time_history_complete:false,forecasts_and_candidates_not_interchangeable:true,forecast_accuracy_improvement_proven:false,account_profit_verified:false,orders_sent:false,telegram_sent:false};
}
async function main(){const h=await fetch('https://irys-surge-monitor.vhehwpfl.workers.dev/?v46readonly='+Date.now(),{signal:AbortSignal.timeout(20000)});if(!h.ok)throw Error('HEALTH_HTTP_'+h.status);const health=await h.json(),history=health.last?.v30DirectionalDelivery?.public_ack_history;
 const load=p=>JSON.parse(readFileSync(p,'utf8'));
 const report=buildActualQuality({history,minute:load('data/v42_actual_ack_evaluation.json'),quotes:load('data/v43_actual_quote_outcomes.json'),asof_ms:Date.now()});
 mkdirSync('v46_quality',{recursive:true});writeFileSync('v46_quality/v46_actual_quality.json',JSON.stringify(report,null,2)+'\n');console.log('V46_ACTUAL_QUALITY',JSON.stringify({asof_ms:report.asof_ms,diagnostics:report.diagnostics,groups:report.groups}));
 if(report.diagnostics.entry_conflicts||report.diagnostics.conflicting_ack||report.diagnostics.invalid_outcomes)throw Error('QUALITY_SOURCE_CONFLICTS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V46_QUALITY_FAILED',e.message);process.exitCode=1});
