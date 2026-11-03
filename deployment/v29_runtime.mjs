/** Public-market independent checking. Does not send notifications or use secrets. */
import {v29CheckPair,v29DeliveryPolicy,v29Record,v29Settle,v29Summary,v29Quote} from './v29_direction_gate.mjs';
async function v29ReadSnapshot(candidate,read,clock=Date.now){
 const {venue,symbol}=candidate;
 if(!['bitget','bithumb'].includes(venue)||typeof symbol!=='string')throw Error('INVALID_SAMPLE_IDENTITY');
 let quote,trades;
 if(venue==='bithumb'){
  const [books,raw]=await Promise.all([
   read('https://api.bithumb.com/v1/orderbook?markets='+encodeURIComponent(symbol)),
   read('https://api.bithumb.com/v1/trades/ticks?market='+encodeURIComponent(symbol)+'&count=500')]);
  const b=Array.isArray(books)?books.find(x=>x.market===symbol):null,u=b?.orderbook_units?.[0];
  if(!u)throw Error('QUOTE_IDENTITY_OR_SCHEMA');if(!Array.isArray(raw))throw Error('TAPE_SCHEMA');
  quote={bid:Number(u.bid_price),ask:Number(u.ask_price),at_ms:Number(b.timestamp)};
  if(raw.some(x=>x.market&&x.market!==symbol))throw Error('TAPE_IDENTITY_MISMATCH');
  trades=raw.map(x=>({id:String(x.sequential_id??''),at_ms:Number(x.timestamp??x.trade_timestamp),price:Number(x.trade_price),size:Number(x.trade_volume),side:x.ask_bid==='BID'?'BUY':x.ask_bid==='ASK'?'SELL':'UNKNOWN'}));
 }else{
  const query='?symbol='+encodeURIComponent(symbol)+'&productType=USDT-FUTURES';
  const [r,t]=await Promise.all([read('https://api.bitget.com/api/v2/mix/market/ticker'+query),read('https://api.bitget.com/api/v2/mix/market/fills'+query+'&limit=100')]);
  const b=r?.code==='00000'&&Array.isArray(r.data)?r.data.find(x=>x.symbol===symbol):null;
  if(!b)throw Error('QUOTE_IDENTITY_OR_SCHEMA');if(t?.code!=='00000'||!Array.isArray(t.data))throw Error('TAPE_SCHEMA');
  if(t.data.some(x=>x.symbol&&x.symbol!==symbol))throw Error('TAPE_IDENTITY_MISMATCH');
  quote={bid:Number(b.bidPr),ask:Number(b.askPr),at_ms:Number(b.ts)};
  trades=t.data.map(x=>({id:typeof x.tradeId==='string'?x.tradeId:String(x.tradeId??''),at_ms:Number(x.ts),price:Number(x.price),size:Number(x.size),side:String(x.side).toUpperCase()}));
 }
 return {venue,symbol,observed_at_ms:clock(),quote,trades};
}
async function v29RiskUniverse(venues,read){
 const valid=new Set(),errors={};
 if(venues.has('bithumb'))try{
  const [m,w]=await Promise.all([read('https://api.bithumb.com/v1/market/all?isDetails=true'),read('https://api.bithumb.com/v1/market/virtual_asset_warning')]);
  if(!Array.isArray(m)||m.length<100||!Array.isArray(w))throw Error('SCHEMA');
  const warning=new Set(w.map(x=>x.market));
  for(const x of m)if(x.market_warning==='NONE'&&/^KRW-[A-Z0-9]{1,25}$/.test(x.market)&&!warning.has(x.market))valid.add('bithumb:'+x.market);
 }catch(_e){errors.bithumb='RISK_IDENTITY_SOURCE_UNAVAILABLE';}
 if(venues.has('bitget'))try{
  const [m,c]=await Promise.all([read('https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES'),read('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES')]);
  if(m?.code!=='00000'||c?.code!=='00000'||!Array.isArray(m.data)||!Array.isArray(c.data))throw Error('SCHEMA');
  const crypto=new Set(m.data.filter(x=>x.symbolType==='crypto'&&x.instrumentType==='crypto').map(x=>x.symbol));
  for(const x of c.data)if(crypto.has(x.symbol)&&x.symbolStatus==='normal'&&x.symbolType==='perpetual'&&x.quoteCoin==='USDT')valid.add('bitget:'+x.symbol);
 }catch(_e){errors.bitget='RISK_IDENTITY_SOURCE_UNAVAILABLE';}
 return {valid,errors};
}
async function v29Review(state,futuresSignals=[],options={}){
 const clock=options.clock||Date.now,sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms))),read=options.read;
 if(typeof read!=='function')throw Error('PUBLIC_READER_REQUIRED');
 const started=clock(),input=state.v29DiscoveryInput||{},pool=[];
 if(Number.isSafeInteger(input.at_ms)&&input.at_ms<=started&&started-input.at_ms<=150000){
  for(const c of input.items||[]){const direction=c.venue==='bithumb'?'BUY':'LONG';
   if(c.venue==='bithumb'&&(!c.identity_verified||!c.warning_checked||c.risks?.length))continue;
   if(c.venue==='bitget'&&c.identity_verified_v3_crypto!==true&&c.source!=='BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST')continue;
   pool.push({venue:c.venue,symbol:c.symbol,direction,anchor_price:c.baseline_price,priority:Number(c.priority)||0});}
 }
 for(const p of futuresSignals){if(['LONG','SHORT'].includes(p?.direction))pool.push({venue:'bitget',symbol:p.symbol,direction:p.direction,anchor_price:p.price,priority:0});}
 const unique=[...new Map(pool.map(c=>[c.venue+':'+c.symbol+':'+c.direction,c])).values()];
 state.v29LastChecked??={};
 // This is a disclosed provider-work queue, not an eligibility or history-streak condition.
 const chosen=[...unique].sort((a,b)=>(state.v29LastChecked[a.venue+':'+a.symbol]||0)-(state.v29LastChecked[b.venue+':'+b.symbol]||0)||b.priority-a.priority).slice(0,6);
 const output={status:'RESEARCH_ONLY_NO_VALIDATED_FORECAST',policy:'NO_UNVALIDATED_MARKET_ALERTS',candidate_count:unique.length,evaluated:chosen.length,
  deferred:Math.max(0,unique.length-chosen.length),double_checked:0,sent:0,telegram_enabled:false,results:[],future_accuracy_improvement_proven:false};
 const now=clock();const due=(state.v29Forward?.records||[]).filter(r=>[5,15,30,60].some(h=>!r.outcomes?.[String(h)]&&r.issued_at_ms+h*60000<=now&&now<=r.issued_at_ms+h*60000+150000));
 const endpoints=[...new Map([...chosen,...due].map(c=>[c.venue+':'+c.symbol,c])).values()];
 const risks=chosen.length?await v29RiskUniverse(new Set(chosen.map(c=>c.venue)),read):{valid:new Set(),errors:{}};
 const first=new Map(),second=new Map(),quotes=[];
 for(const c of chosen){const key=c.venue+':'+c.symbol;state.v29LastChecked[key]=clock();
  if(!risks.valid.has(key)){output.results.push({...c,status:'NOT_CONFIRMED',reason:risks.errors[c.venue]||'RISK_OR_IDENTITY_NOT_CLEAR'});continue;}
  c.identity_verified=true;c.risk_checked=true;c.risk_flags=[];
  try{first.set(key,await v29ReadSnapshot(c,read,clock));}catch(_e){output.results.push({...c,status:'NOT_CONFIRMED',reason:'FIRST_OFFICIAL_SAMPLE_UNAVAILABLE'});}
 }
 if(first.size)await sleep(8000);
 for(const c of chosen){const key=c.venue+':'+c.symbol,a=first.get(key);if(!a)continue;
  try{const b=await v29ReadSnapshot(c,read,clock);second.set(key,b);quotes.push({...b.quote,venue:c.venue,symbol:c.symbol});
   const result=v29CheckPair(c,a,b,clock());output.results.push({...result,delivery:v29DeliveryPolicy(result)});
   if(result.status==='DOUBLE_CHECKED_CURRENT_EVIDENCE'){output.double_checked++;state.v29Forward=v29Record(state.v29Forward,result,result.checked_at_ms);}
  }catch(_e){output.results.push({...c,status:'NOT_CONFIRMED',reason:'SECOND_OFFICIAL_SAMPLE_UNAVAILABLE'});}
 }
 // Measure prior frozen forecasts even when they have left the current candidate pool.
 for(const c of endpoints){if(second.has(c.venue+':'+c.symbol)||!due.some(r=>r.venue===c.venue&&r.symbol===c.symbol))continue;
  try{const b=await v29ReadSnapshot(c,read,clock);quotes.push({...b.quote,venue:c.venue,symbol:c.symbol});}catch(_e){}
 }
 state.v29Forward=v29Settle(state.v29Forward,quotes,clock());output.forward=v29Summary(state.v29Forward);
 output.finished_at_ms=clock();output.elapsed_ms=clock()-started;
 state.v29RecentChecks=[...(state.v29RecentChecks||[]),{at_ms:clock(),...output}].slice(-24);
 return output;
}
export {v29ReadSnapshot,v29RiskUniverse,v29Review};
