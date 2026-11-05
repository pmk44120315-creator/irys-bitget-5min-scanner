/** Public GitHub runner: official independent samples on the working network.
 * Does not send Telegram, access account/trading APIs or export private state.
 */
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {v28Discover} from './v28_discovery.mjs';
import {v29ReadSnapshot} from './v29_runtime.mjs';
import {v29Quote} from './v29_direction_gate.mjs';
import {V30_VERSION,V30_MODEL,v30ParsePublicJSON,v30Qualify,v30FuturesCandidates,v30Settle} from './v30_core.mjs';
import {v31ReadPairs,v31ShouldRecord} from './v31_quality.mjs';
import {v35FollowupMarkets} from './v35_lifecycle.mjs';
import {v31FetchHistory,v31SettleMinute,v31MinuteSummary} from './v31_outcomes.mjs';
async function pooled(items,fn,concurrency=6){
 const out=new Array(items.length);let index=0;
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(index<items.length){const i=index++;out[i]=await fn(items[i],i)}}));return out;
}
function briefError(e){return /^PUBLIC_HTTP_\d+$/.test(e?.message||'')?e.message:'PUBLIC_SOURCE_UNAVAILABLE';}
async function universes(read,clock){
 const out={spot:null,futures:null,errors:{}};
 await Promise.all([
 (async()=>{try{const [m,w]=await Promise.all([read('https://api.bithumb.com/v1/market/all?isDetails=true'),read('https://api.bithumb.com/v1/market/virtual_asset_warning')]);
  if(!Array.isArray(m)||m.length<100||!Array.isArray(w))throw Error('MARKET_SCHEMA');out.spot={markets:m,warnings:w,at_ms:clock()};
 }catch(e){out.errors.bithumb=briefError(e)}})(),
 (async()=>{try{const [i,c]=await Promise.all([read('https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES'),read('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES')]);
  if(i?.code!=='00000'||c?.code!=='00000'||!Array.isArray(i.data)||!Array.isArray(c.data)||i.data.length<100||c.data.length<100)throw Error('MARKET_SCHEMA');out.futures={instruments:i.data,contracts:c.data,at_ms:clock()};
 }catch(e){out.errors.bitget=briefError(e)}})()]);return out;
}
function riskFor(c,u){
 if(c.venue==='bithumb'&&u.spot)return {source:'BITHUMB_OFFICIAL_MARKETS_AND_WARNINGS',at_ms:u.spot.at_ms,market:u.spot.markets.find(r=>r.market===c.symbol),warnings:u.spot.warnings.filter(w=>w.market===c.symbol)};
 if(c.venue==='bitget'&&u.futures)return {source:'BITGET_OFFICIAL_V2_V3',at_ms:u.futures.at_ms,instrument:u.futures.instruments.find(r=>r.symbol===c.symbol),contract:u.futures.contracts.find(r=>r.symbol===c.symbol)};
 return null;
}
function futureSet(u){const x=u.futures;if(!x)return new Set();const crypto=new Set(x.instruments.filter(r=>r.symbolType==='crypto'&&r.instrumentType==='crypto').map(r=>r.symbol));return new Set(x.contracts.filter(r=>crypto.has(r.symbol)&&r.symbolStatus==='normal'&&r.symbolType==='perpetual'&&r.quoteCoin==='USDT').map(r=>r.symbol));}
async function spotTickers(u,read){
 if(!u.spot)return [];const names=u.spot.markets.map(r=>r.market).filter(s=>/^KRW-[A-Z0-9]{1,25}$/.test(s)),out=[];
 for(let i=0;i<names.length;i+=100){const r=await read('https://api.bithumb.com/v1/ticker?markets='+encodeURIComponent(names.slice(i,i+100).join(',')));if(!Array.isArray(r))throw Error('TICKER_SCHEMA');out.push(...r)}return out;
}
async function futureTickers(u,read){if(!u.futures)return [];const r=await read('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');if(r?.code!=='00000'||!Array.isArray(r.data))throw Error('TICKER_SCHEMA');return r.data;}
async function finalQuotes(candidates,u,read,clock){
 const quotes=[],errors={};
 const spot=[...new Set(candidates.filter(c=>c.venue==='bithumb').map(c=>c.symbol))];
 await Promise.all([
 (async()=>{if(!spot.length||!u.spot)return;try{for(let i=0;i<spot.length;i+=50){const raw=await read('https://api.bithumb.com/v1/orderbook?markets='+encodeURIComponent(spot.slice(i,i+50).join(',')));if(!Array.isArray(raw))throw Error('BOOK_SCHEMA');const now=clock();for(const b of raw){if(!spot.includes(b.market))continue;const q=b.orderbook_units?.[0];if(q)quotes.push({venue:'bithumb',symbol:b.market,observed_at_ms:now,quote:{bid:Number(q.bid_price),ask:Number(q.ask_price),at_ms:Number(b.timestamp)}})}}}catch(e){errors.bithumb=briefError(e)}})(),
 (async()=>{if(!u.futures)return;try{const raw=await futureTickers(u,read),now=clock();for(const b of raw)quotes.push({venue:'bitget',symbol:b.symbol,observed_at_ms:now,quote:{bid:Number(b.bidPr),ask:Number(b.askPr),at_ms:Number(b.ts)}})}catch(e){errors.bitget=briefError(e)}})()]);
 return {quotes,errors};
}
function summaryForward(rows){
 const result={scope:'ROLLING_2000_PUBLIC_HYPOTHESES_NOT_ALL_TIME',current_model:V30_MODEL,legacy_records:rows.filter(r=>r.model!==V30_MODEL).length,actual_execution_verified:false,forecast_accuracy_proven:false,groups:{}};
 rows=rows.filter(r=>r.model===V30_MODEL);
 for(const venue of ['bithumb','bitget'])for(const direction of venue==='bithumb'?['BUY']:['LONG','SHORT'])for(const stage of ['READY_CURRENT_EVIDENCE','NOT_READY']){
  const group=rows.filter(r=>r.venue===venue&&r.direction===direction&&r.evidence_status===stage);const horizons={};
  for(const h of [5,15,30,60]){const a=group.map(r=>r.outcomes?.[String(h)]),measured=a.filter(x=>x?.status==='MEASURED_PUBLIC_QUOTE');horizons[h]={measured:measured.length,missing:a.filter(x=>x?.status==='UNMEASURED_TARGET_QUOTE').length,pending:a.filter(x=>!x).length,net_positive:measured.filter(x=>x.net_scenario_pct>0).length,mean_net_scenario_pct:measured.length?measured.reduce((s,x)=>s+x.net_scenario_pct,0)/measured.length:null};}
  result.groups[venue+':'+direction+':'+stage]={events:group.length,horizons};
 }return result;
}
async function v30Produce({read,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),previous={},priorSpot={},priorFutures={},modelDigest,historyMode='inline',cachedHistory=[]}){
 if(typeof read!=='function'||!modelDigest)throw Error('PUBLIC_READER_AND_MODEL_REQUIRED');
 const started=clock(),state=structuredClone(previous||{}),u=await universes(read,clock);
 let spot=[],ft=[];await Promise.all([
 (async()=>{try{spot=await spotTickers(u,read)}catch(e){u.errors.bithumb=briefError(e);u.spot=null}})(),
 (async()=>{try{ft=await futureTickers(u,read)}catch(e){u.errors.bitget=briefError(e);u.futures=null}})()]);
 const snapshotAt=clock(),ids=futureSet(u);
 const fs=ft.map(x=>({symbol:x.symbol,price:Number(x.lastPr),at_ms:Number(x.ts),quote_volume:Number(x.usdtVolume)}));
 const prev=state.market?.futures||priorFutures;
 const fCandidates=v30FuturesCandidates(fs,prev,snapshotAt,ids);
 // Preserve all coverage; shortlist distinct largest current LONG and SHORT
 // opportunities without a .70% entry threshold. Every shortlisted item is checked.
 const futures=[...fCandidates.filter(c=>c.direction==='LONG').slice(0,12),...fCandidates.filter(c=>c.direction==='SHORT').slice(0,12)];
 const spotScan=u.spot?v28Discover(state.v28||{},{bithumb_markets:u.spot.markets,bithumb_tickers:spot,bithumb_warnings:u.spot.warnings},snapshotAt,priorSpot):null;
 if(spotScan?.summary.status==='OBSERVED')state.v28=spotScan.next;
 const spots=(spotScan?.candidates||[]).map(c=>({venue:'bithumb',symbol:c.symbol,direction:'BUY',anchor_price:c.baseline_price,discovery_price:c.price,change_pct:c.move_pct,priority:c.priority,discovery_is_signal:false}));
 const candidates=[...spots,...futures],errors=[];
 const followupMarkets=v35FollowupMarkets(state.records||[],clock());
 const present=new Set(candidates.map(c=>c.venue+':'+c.symbol));
 const observed=[...candidates,...followupMarkets.filter(c=>!present.has(c.venue+':'+c.symbol))];
 const pairs=await v31ReadPairs(observed,c=>v29ReadSnapshot(c,read,clock),clock,sleep);
 const first=pairs.map(x=>x.first),second=pairs.map(x=>x.second);
 // History reads run before final quotes; they cannot age a just-validated entry.
 const history=historyMode==='cached'?{pages:Array.isArray(cachedHistory)&&cachedHistory.length?cachedHistory:(state.minute_history||[]),errors:[]}:await v31FetchHistory(state.records||[],read,clock,state.minute_history||[]);
 state.minute_history=history.pages;
 const finalRisk=await universes(read,clock);
 const oldRows=state.records||[],atBeforeFinal=clock();
 const due=oldRows.filter(r=>[5,15,30,60].some(h=>!r.outcomes?.[String(h)]&&Math.abs(atBeforeFinal-(r.issued_at_ms+h*60000))<=150000));
 const end=await finalQuotes([...observed,...due],finalRisk,read,clock),now=clock();
 const byQuote=new Map(end.quotes.map(x=>[x.venue+':'+x.symbol,x]));
 const items=[],checks=[];
 for(let i=0;i<candidates.length;i++){const c=candidates[i];
  if(first[i].error||second[i].error){checks.push({...c,status:'NOT_READY',reason:first[i].error?'FIRST_'+first[i].error:'SECOND_'+second[i].error});continue;}
  const item={candidate:c,first:first[i],second:second[i],final:byQuote.get(c.venue+':'+c.symbol)||null,risk:riskFor(c,finalRisk)};
  const result=v30Qualify(item,now);checks.push({...c,status:result.status,reason:result.reason,allowed:result.allowed});items.push(item);
 }
 state.market??={};
 if(u.futures)state.market.futures={at_ms:snapshotAt,prices:Object.fromEntries(fs.filter(x=>ids.has(x.symbol)&&Number.isFinite(x.price)&&x.price>0&&x.at_ms<=snapshotAt&&snapshotAt-x.at_ms<=90000).map(x=>[x.symbol,x.price]))};
 // Freeze all evaluable hypotheses before their future horizons, including
 // rejections. No retrospective conversion of rejected rows to published alerts.
 let records=v30Settle(oldRows,end.quotes.map(x=>({...x.quote,venue:x.venue,symbol:x.symbol})),now);
 records=v31SettleMinute(records,history.pages,now);
 for(const x of items){const c=x.candidate,q=v29Quote(x.final?.quote,now,45000);if(!q)continue;
  const recent=[...records].reverse().find(r=>r.venue===c.venue&&r.symbol===c.symbol&&r.direction===c.direction);
  const quality=v30Qualify(x,now);
  if(!v31ShouldRecord(recent,quality,now))continue;
  records.push({id:[V30_MODEL,c.venue,c.symbol,c.direction,now].join(':'),model:V30_MODEL,model_digest:modelDigest,venue:c.venue,symbol:c.symbol,direction:c.direction,issued_at_ms:now,entry_quote:q,evidence_status:quality.status,reason:quality.reason,outcomes:{},telegram_status:'NOT_KNOWN_TO_PUBLIC_PRODUCER'});
 }
 state.records=records.slice(-2000);state.at_ms=now;state.version=V30_VERSION;
 const reasons={};for(const r of checks)if(r.reason)reasons[r.reason]=(reasons[r.reason]||0)+1;
 const providerErrors={...u.errors,...finalRisk.errors,...end.errors};
 const report={version:V30_VERSION,source:'OFFICIAL_PUBLIC_RUNNER',model_digest:modelDigest,started_at_ms:started,at_ms:now,
  summary:{status:Object.keys(providerErrors).length?'PARTIAL_SOURCES':'SOURCES_AVAILABLE',listed_spot:u.spot?.markets.filter(x=>x.market.startsWith('KRW-')).length||0,listed_futures:ids.size,
   selected:candidates.length,evaluated:checks.length,paired_complete:items.length,unreviewed:candidates.length-checks.length,ready:checks.filter(x=>x.allowed).length,
   selected_by_direction:{BUY:spots.length,LONG:futures.filter(x=>x.direction==='LONG').length,SHORT:futures.filter(x=>x.direction==='SHORT').length},
   rejection_reasons:reasons,provider_errors:providerErrors,spot_discovery:spotScan?.summary||{status:'SOURCE_UNAVAILABLE'},future_accuracy_proven:false},
  checks,items,followups:observed.map((c,i)=>({venue:c.venue,symbol:c.symbol,first:first[i],second:second[i],final:byQuote.get(c.venue+':'+c.symbol)||null})),
  outcome_quotes:end.quotes.map(q=>({...q.quote,venue:q.venue,symbol:q.symbol})),
  outcome_candles:history.pages,history_errors:history.errors,
  timing:{discovery_at_ms:snapshotAt,paired_completed_ms:Math.max(snapshotAt,...second.filter(x=>!x.error).map(x=>x.observed_at_ms)),finished_at_ms:now,
   pair_separations_ms:pairs.filter(x=>!x.first.error&&!x.second.error).map(x=>x.second.observed_at_ms-x.first.observed_at_ms),cadence_ms:300000,barrier_removed:true,history_reads_in_live_path:historyMode!=='cached',followup_markets:followupMarkets.length},
  forward:{...summaryForward(state.records),minute_close_proxies:v31MinuteSummary(state.records)},orders_sent:false,telegram_sent:false};
 return {report,state};
}
function v30ModelDigest(){
 const files=['v30_core.mjs','v30_producer.mjs','v29_direction_gate.mjs','v29_runtime.mjs','v28_discovery.mjs','v31_quality.mjs','v31_outcomes.mjs','v35_lifecycle.mjs'];
 const h=createHash('sha256');for(const name of files){h.update(name+'\0');h.update(readFileSync(new URL(name,import.meta.url)));}return h.digest('hex');
}
function publicReader(clock=Date.now){
 const next=new Map();return async function read(raw){
  const u=new URL(raw);if(!['api.bithumb.com','api.bitget.com'].includes(u.hostname)||u.protocol!=='https:')throw Error('PUBLIC_HOST_NOT_ALLOWED');
  const at=Math.max(clock(),next.get(u.hostname)||0);next.set(u.hostname,at+220);const wait=at-clock();if(wait>0)await new Promise(r=>setTimeout(r,wait));
  const res=await fetch(raw,{headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error('PUBLIC_HTTP_'+res.status);return v30ParsePublicJSON(await res.text());
 };
}
async function main(){
 const readJSON=(p,otherwise={})=>{try{return JSON.parse(readFileSync(p,'utf8'))}catch{return otherwise}};
 const legacy=readJSON('data/state.json').spot_fast||{},oldF=readJSON('data/v24_bitget_fast_latest.json');
 const cache=readJSON('data/v35_outcome_history.json');
 const historyPages=cache.version==='V35_NATIVE_HISTORY_CACHE_V1'&&Array.isArray(cache.pages)?cache.pages:[];
 const result=await v30Produce({read:publicReader(),historyMode:'cached',cachedHistory:historyPages,previous:readJSON('data/v30_state.json'),priorSpot:{spot_at_ms:legacy.time_ms,spot:legacy.prices||{}},priorFutures:{at_ms:oldF.at_ms,prices:oldF.prices||{}},modelDigest:v30ModelDigest()});
 for(const [name,obj] of [['v30_direction_latest.json',result.report],['v30_state.json',result.state]]){writeFileSync('data/.'+name,JSON.stringify(obj));renameSync('data/.'+name,'data/'+name);}
 console.log('V30_PUBLIC_PRODUCER',JSON.stringify({at_ms:result.report.at_ms,model_digest:result.report.model_digest,...result.report.summary,check_results:result.report.checks,orders_sent:false,telegram_sent:false}));
 if(result.report.summary.listed_spot===0&&result.report.summary.listed_futures===0)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V30_PRODUCER_FAILED',briefError(e));process.exitCode=1});
export {v30Produce,v30Settle,v30ModelDigest,publicReader,summaryForward};
