/** Native closed-minute price proxies. Separate from executable bid/ask labels. */
const MINUTE=60000;
function finite(x){return x!==null&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x))?Number(x):null;}
function v31ParseBars(raw,venue,symbol,now){
 if(!Array.isArray(raw)||!['bithumb','bitget'].includes(venue))return [];
 const by=new Map(),conflicts=new Set();
 for(const r of raw){
  let t,o,h,l,c;
  if(venue==='bithumb'){
   if(r.market!==symbol||typeof r.candle_date_time_utc!=='string')continue;
   const stamp=r.candle_date_time_utc;t=Date.parse(stamp.endsWith('Z')?stamp:stamp+'Z');
   [o,h,l,c]=[r.opening_price,r.high_price,r.low_price,r.trade_price].map(finite);
  }else{if(!Array.isArray(r)||r.length<5)continue;t=Number(r[0]);[o,h,l,c]=r.slice(1,5).map(finite);}
  if(!Number.isSafeInteger(t)||t%MINUTE||t+MINUTE>now||[o,h,l,c].some(x=>x===null||x<=0)||!(l<=Math.min(o,c)&&h>=Math.max(o,c)))continue;
  const row={start_ms:t,open:o,high:h,low:l,close:c};
  if(by.has(t)&&JSON.stringify(by.get(t))!==JSON.stringify(row))conflicts.add(t);
  by.set(t,row);
 }
 return [...by.values()].filter(r=>!conflicts.has(r.start_ms)).sort((a,b)=>a.start_ms-b.start_ms);
}
function v31SettleMinute(old,pages,now){
 const rows=structuredClone(old||[]),by=new Map();
 for(const p of pages||[]){
  if(p?.source!=='OFFICIAL_NATIVE_1M'||!['bithumb','bitget'].includes(p.venue)||typeof p.symbol!=='string'||!Array.isArray(p.bars)||!Number.isSafeInteger(p.fetched_at_ms)||p.fetched_at_ms>now)continue;
  by.set(p.venue+':'+p.symbol,p);
 }
 for(const r of rows){
  if(!Number.isSafeInteger(r.issued_at_ms)||!['LONG','SHORT','BUY'].includes(r.direction))continue;
  const p=by.get(r.venue+':'+r.symbol);if(!p)continue;
  const quote=r.entry_quote,ref=finite(r.direction==='SHORT'?quote?.bid:quote?.ask);
  if(ref===null||ref<=0||!Number.isSafeInteger(quote?.at_ms)||quote.at_ms>r.issued_at_ms||r.issued_at_ms-quote.at_ms>45000)continue;
  const bars=v31ParseBars(p.bars.map(x=>[x.start_ms,x.open,x.high,x.low,x.close]),'bitget',r.symbol,Math.min(now,p.fetched_at_ms));
  const indexed=new Map(bars.map(x=>[x.start_ms,x]));r.minute_outcomes??={};
  for(const h of [5,15,30,60]){
   const k=String(h),target=r.issued_at_ms+h*MINUTE,closeAt=Math.ceil(target/MINUTE)*MINUTE;
   if(r.minute_outcomes[k]?.status==='MEASURED_MINUTE_CLOSE_PROXY'||closeAt>now)continue;
   const b=indexed.get(closeAt-MINUTE);
   if(!b){r.minute_outcomes[k]={status:'TARGET_MINUTE_UNAVAILABLE',target_ms:target,actual_execution_verified:false};continue;}
   const pct=r.direction==='SHORT'?100*(ref-b.close)/ref:100*(b.close/ref-1);
   r.minute_outcomes[k]={status:'MEASURED_MINUTE_CLOSE_PROXY',target_ms:target,close_at_ms:closeAt,target_offset_ms:closeAt-target,
    reference_quote:structuredClone(quote),exit_close:b.close,gross_reference_pct:pct,net_cost_scenario_pct:pct-.20,cost_scenario_pct:.20,
    executable_exit_verified:false,actual_execution_verified:false,source:p.source,observed_at_ms:p.fetched_at_ms};
  }
 }
 return rows;
}
function v31MinuteSummary(rows){
 const out={scope:'SEPARATE_NATIVE_MINUTE_CLOSE_PROXY',actual_execution_verified:false,horizons:{}};
 for(const h of [5,15,30,60]){
  const a=(rows||[]).map(r=>r.minute_outcomes?.[String(h)]),m=a.filter(x=>x?.status==='MEASURED_MINUTE_CLOSE_PROXY');
  out.horizons[h]={measured:m.length,unavailable:a.filter(x=>x?.status==='TARGET_MINUTE_UNAVAILABLE').length,pending:a.filter(x=>!x).length,
   directional_positive:m.filter(x=>x.gross_reference_pct>0).length,net_positive_scenario:m.filter(x=>x.net_cost_scenario_pct>0).length,
   mean_gross_reference_pct:m.length?m.reduce((s,x)=>s+x.gross_reference_pct,0)/m.length:null};
 }return out;
}
async function v31FetchHistory(records,read,clock,oldPages=[]){
 const cache=new Map((oldPages||[]).filter(p=>p.source==='OFFICIAL_NATIVE_1M').map(p=>[p.venue+':'+p.symbol,structuredClone(p)]));
 const now=clock(),jobs=new Map(),errors=[];
 // Only pre-issued READY public hypotheses: no private recipients/ACK export.
 for(const r of records||[]){
  if(r.evidence_status!=='READY_CURRENT_EVIDENCE'||!Number.isSafeInteger(r.issued_at_ms)||r.issued_at_ms>now||now-r.issued_at_ms>24*3600000)continue;
  if([5,15,30,60].every(h=>r.minute_outcomes?.[h]?.status==='MEASURED_MINUTE_CLOSE_PROXY'))continue;
  const end=Math.min(Math.floor(now/MINUTE)*MINUTE,Math.ceil((r.issued_at_ms+62*MINUTE)/MINUTE)*MINUTE);
  jobs.set([r.venue,r.symbol,end].join(':'),{venue:r.venue,symbol:r.symbol,end});
 }
 const work=[...jobs.values()];let index=0;
 await Promise.all(Array.from({length:Math.min(3,work.length)},async()=>{while(index<work.length){const c=work[index++];
  try{
   const params=c.venue==='bitget'?{symbol:c.symbol,productType:'USDT-FUTURES',granularity:'1m',endTime:String(c.end),limit:'120'}:
     {market:c.symbol,to:new Date(c.end+9*3600000).toISOString().slice(0,19),count:'120'};
   const url=(c.venue==='bitget'?'https://api.bitget.com/api/v2/mix/market/history-candles':'https://api.bithumb.com/v1/candles/minutes/1')+'?'+new URLSearchParams(params);
   const doc=await read(url);if(c.venue==='bitget'&&doc?.code!=='00000')throw Error('SOURCE');
   const raw=c.venue==='bitget'?doc.data:doc;if(!Array.isArray(raw))throw Error('HISTORY_SCHEMA');
   const bars=v31ParseBars(raw,c.venue,c.symbol,clock());
   const key=c.venue+':'+c.symbol,previous=cache.get(key),merged=new Map((previous?.bars||[]).map(x=>[x.start_ms,x]));
   for(const b of bars){if(merged.has(b.start_ms)&&JSON.stringify(merged.get(b.start_ms))!==JSON.stringify(b)){merged.delete(b.start_ms);errors.push({symbol:c.symbol,reason:'CONFLICTING_CLOSED_BAR'});}else merged.set(b.start_ms,b);}
   cache.set(key,{venue:c.venue,symbol:c.symbol,source:'OFFICIAL_NATIVE_1M',fetched_at_ms:clock(),bars:[...merged.values()].sort((a,b)=>a.start_ms-b.start_ms).slice(-1440)});
  }catch{errors.push({venue:c.venue,symbol:c.symbol,reason:'OFFICIAL_HISTORY_UNAVAILABLE'});}
 }}));
 return {pages:[...cache.values()],errors};
}
export {v31ParseBars,v31SettleMinute,v31MinuteSummary,v31FetchHistory};
