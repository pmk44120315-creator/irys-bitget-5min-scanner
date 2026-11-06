/** V38 early pullback watch, public data only, independent of live V35.1/V34/V36/V37. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {v38Detect,v38ParseBitgetCandles,V38_VERSION} from './v38_continuation.mjs';
import {v38Enroll,v38Settle,v38Summary} from './v38_shadow.mjs';
const STEP=300000;
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function v38Universe({fastFeed,tickers,prior={},now,maxSymbols=72}={}){
 const info={provider_total:0,crypto_verified:0,valid_tickers:0,selected:[],not_scanned:0,errors:[]};
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(fastFeed?.at_ms)||fastFeed.at_ms>now||now-fastFeed.at_ms>240000||
 fastFeed?.venue!=='bitget'||!fastFeed.prices||typeof fastFeed.prices!=='object')return {...info,errors:['STALE_VETTED_CRYPTO_UNIVERSE']};
 if(!Array.isArray(tickers))return {...info,errors:['OFFICIAL_TICKER_SCHEMA']};
 info.provider_total=tickers.length;const vetted=new Set(Object.keys(fastFeed.prices));info.crypto_verified=vetted.size;
 const rows=[];
 for(const t of tickers){
  if(!vetted.has(t?.symbol)||!/^[A-Z0-9]{1,25}USDT$/.test(t?.symbol))continue;
  const price=Number(t.lastPr),at=Number(t.ts),bid=Number(t.bidPr),ask=Number(t.askPr),
  change=Number(t.change24h),turnover=Number(t.usdtVolume??t.quoteVolume);
  if(!Number.isSafeInteger(at)||at>now||now-at>120000||!good(price)||!good(bid)||!good(ask)||ask<bid||
  !Number.isFinite(change)||!Number.isFinite(turnover)||turnover<0)continue;
  rows.push({symbol:t.symbol,price,at_ms:at,bid,ask,change24h:change,turnover_24h:turnover,spread_pct:100*(ask/bid-1)});
 }
 info.valid_tickers=rows.length;const bySymbol=new Map(rows.map(x=>[x.symbol,x]));
 const selected=new Map(),why=new Map();
 const add=(list,reason)=>{for(const x of list){const r=bySymbol.get(typeof x==='string'?x:x?.symbol);if(r&&!selected.has(r.symbol)){selected.set(r.symbol,r);why.set(r.symbol,reason);}}};
 add((prior.events||[]).filter(x=>x?.venue==='bitget'&&now-x.issued_at_ms>=0&&now-x.issued_at_ms<=65*60000).map(x=>x.symbol).slice(-18),'PROSPECTIVE_FOLLOWUP');
 add((fastFeed.candidates||[]).slice(0,12),'FAST_MOVEMENT_MEMORY');
 add([...rows].filter(x=>x.change24h>0).sort((a,b)=>b.change24h-a.change24h).slice(0,22),'24H_STRENGTH');
 add([...rows].filter(x=>x.change24h<0).sort((a,b)=>a.change24h-b.change24h).slice(0,22),'24H_WEAKNESS');
 add([...rows].sort((a,b)=>b.turnover_24h-a.turnover_24h).slice(0,12),'ACTIVE_TURNOVER');
 const sorted=[...rows].sort((a,b)=>a.symbol.localeCompare(b.symbol)),rot=sorted.length?Math.floor(now/STEP)*11%sorted.length:0;
 add([...sorted.slice(rot),...sorted.slice(0,rot)].slice(0,16),'ROTATING_UNIVERSE');
 info.selected=[...selected.values()].slice(0,Math.max(1,Math.min(120,maxSymbols))).map(x=>({...x,selection_source:why.get(x.symbol)}));
 info.not_scanned=Math.max(0,rows.length-info.selected.length);
 return info;
}
function v38RunCycle({fastFeed,tickers,prior={},now,pages=[],selection=null}={}){
 const universe=selection||v38Universe({fastFeed,tickers,prior,now});
 const observed=[],reasonCount={},pageBySymbol=new Map(pages.filter(p=>p?.source==='OFFICIAL_NATIVE_5M'&&Array.isArray(p.bars)).map(p=>[p.symbol,p]));
 for(const target of universe.selected){
  const p=pageBySymbol.get(target.symbol);if(!p)continue;
  for(const direction of ['LONG','SHORT']){
   const x=v38Detect({venue:'bitget',symbol:target.symbol,direction,bars:p.bars,now});
   reasonCount[x.status]=(reasonCount[x.status]||0)+1;
   if(['EARLY_TURN_WATCH','EARLY_RECLAIM'].includes(x.status))observed.push(x);
  }
 }
 const enrolled=v38Enroll(prior,observed,now),state=v38Settle(enrolled.state,pages,now),summary=v38Summary(state);
 const output={version:V38_VERSION,at_ms:now,status:universe.errors.length?'SOURCE_PARTIAL':'OBSERVED',
  active_market_total:universe.provider_total,verified_crypto_universe:universe.crypto_verified,
  valid_current_tickers:universe.valid_tickers,inspected_symbols:universe.selected.length,
  markets_not_scanned:universe.not_scanned,history_success:pages.length,
  watch_candidates:observed.filter(x=>x.status==='EARLY_TURN_WATCH').length,
  reclaim_candidates:observed.filter(x=>x.status==='EARLY_RECLAIM').length,
  new_events:enrolled.added.length,tracked:state.events.length,
  diagnostic_statuses:reasonCount,source_errors:universe.errors,
  summary,latest_events:enrolled.added.slice(-12).map(e=>({id:e.id,symbol:e.symbol,direction:e.direction,
    phase:e.phase,issued_at_ms:e.issued_at_ms,source_closed_at_ms:e.source_closed_at_ms,
    source_to_selection_delay_ms:e.source_to_selection_delay_ms,close_reference:e.entry_close_proxy,
    entry_reference_is_executable:false})),research_only:true,live_signal_modified:false,
  actual_telegram_acks:0,telegram_sent:false,orders_sent:false,prediction_accuracy_proven:false,auto_promote:false};
 return {state,output,universe};
}
function load(path,fallback){
 try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e?.code==='ENOENT')return fallback;throw e;}
}
async function publicJSON(url){
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='api.bitget.com')throw Error('INVALID_PUBLIC_PROVIDER');
 const resp=await fetch(url,{headers:{accept:'application/json','User-Agent':'IRYS-V38-PUBLIC-RESEARCH'},signal:AbortSignal.timeout(17000)});
 if(!resp.ok)throw Error('PUBLIC_HTTP_'+resp.status);return resp.json();
}
async function main(){
 const prior=load('data/v38_continuation_state.json',{events:[]});
 const fastFeed=load('data/v24_bitget_fast_latest.json',{}),now=Date.now(),errors=[];let tickers=[];
 try{const t=await publicJSON('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
  if(t.code!=='00000'||!Array.isArray(t.data))throw Error('PROVIDER_TICKERS_INVALID');tickers=t.data;}
 catch(e){errors.push('OFFICIAL_FUTURES_TICKERS_UNAVAILABLE');}
 const universe=v38Universe({fastFeed,tickers,prior,now,maxSymbols:72}),pages=[];
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,universe.selected.length)},async()=>{while(next<universe.selected.length){
  const t=universe.selected[next++];
  try{
   const url='https://api.bitget.com/api/v3/market/history-candles?'+new URLSearchParams({category:'USDT-FUTURES',
    symbol:t.symbol,interval:'5m',endTime:String(Math.floor(now/STEP)*STEP),limit:'100',type:'market'});
   const raw=await publicJSON(url),parsed=v38ParseBitgetCandles(raw,now);
   if(parsed.status!=='OBSERVED')throw Error(parsed.reason||'CANDLES_INVALID');
   pages.push({venue:'bitget',symbol:t.symbol,source:'OFFICIAL_NATIVE_5M',fetched_at_ms:now,bars:parsed.bars});
  }catch(e){errors.push('NATIVE_5M_'+t.symbol+'_UNAVAILABLE');}
 }}));
 const result=v38RunCycle({fastFeed,tickers,prior,now,pages,selection:universe});
 const output={...result.output,source_errors:[...universe.errors,...errors],history_requested:universe.selected.length,history_success:pages.length,
   history_failed:errors.length,all_source_errors_explicit:true};
 for(const [name,value] of [['v38_continuation_state.json',result.state],['v38_continuation_latest.json',output]]){
  const tmp='data/.'+name;writeFileSync(tmp,JSON.stringify(value));renameSync(tmp,'data/'+name);
 }
 console.log('V38_EARLY_CONTINUATION_SHADOW',JSON.stringify({at_ms:now,universe:universe.crypto_verified,inspected:output.inspected_symbols,
  closed_history_pages:pages.length,watch:output.watch_candidates,reclaims:output.reclaim_candidates,new_events:output.new_events,
  tracked:output.tracked,provider_errors:output.source_errors.length,measured5:output.summary.horizons['5'],
  verified_live_direction_accurate:false,orders:false,telegram:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('V38_RESEARCH_RUN_FAILED',String(e?.message||e));process.exitCode=1});
export {v38Universe,v38RunCycle};
