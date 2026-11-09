/** Original public stream normalization. No signals, private APIs or orders.
 * Large IDs stay exact; history snapshots and reconnects never invent CVD.
 */
export const STREAM_VERSION='V43_PUBLIC_STREAM_EVIDENCE_V1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safe=x=>Number.isSafeInteger(x)&&x>=0;
export function parseExactJSON(text){
 if(typeof text!=='string')throw Error('RAW_JSON_STRING_REQUIRED');
 return JSON.parse(text,(key,value,context)=>{
  if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)){
   if(context?.source&&/^-?\d+$/.test(context.source))return context.source;
   throw Error('UNSAFE_INTEGER_WITHOUT_RAW_SOURCE');
  }
  return value;
 });
}
export function marketKey(venue,symbol){
 if(!(venue==='bitget'?/^[A-Z0-9]{1,25}USDT$/.test(symbol):venue==='bithumb'&&/^KRW-[A-Z0-9]{1,25}$/.test(symbol)))throw Error('MARKET_IDENTITY');
 return venue+':'+symbol;
}
function number(x){const n=typeof x==='string'&&x.trim()!==''?Number(x):x;if(!finite(n))throw Error('INVALID_NUMBER');return n;}
function timestamp(x,unit,received){
 const n=number(x);if(!safe(n))throw Error('PROVIDER_CLOCK_INVALID');
 const us=unit==='microseconds'?n:n*1000,ms=Math.floor(us/1000);
 if(!safe(us)||ms<1577836800000||ms>4102444800000)throw Error('PROVIDER_CLOCK_UNIT');
 if(ms>received)throw Error('PROVIDER_FUTURE_TIME');
 return {at_ms:ms,at_us:us,provider_time_raw:String(x),provider_time_unit:unit};
}
function identifier(x){if(typeof x==='number'&&!Number.isSafeInteger(x))throw Error('UNSAFE_TRADE_ID');const s=String(x??'');if(!s||s.length>128)throw Error('TRADE_ID_MISSING');return s;}
function levels(raw,side){
 if(!Array.isArray(raw)||!raw.length)throw Error('BOOK_LEVELS_MISSING');
 const out=raw.map(x=>{if(!Array.isArray(x)||x.length<2)throw Error('BOOK_LEVEL_SCHEMA');const p=number(x[0]),q=number(x[1]);if(p<=0||q<0)throw Error('BOOK_LEVEL_VALUE');return [p,q]}).filter(x=>x[1]>0);
 if(!out.length)throw Error('BOOK_EMPTY_SIDE');
 for(let i=1;i<out.length;i++)if(side==='bid'?out[i][0]>=out[i-1][0]:out[i][0]<=out[i-1][0])throw Error('BOOK_UNSORTED_OR_DUPLICATE');
 return out;
}
function book(venue,symbol,bids,asks,t,received,seq=null){
 const b=levels(bids,'bid'),a=levels(asks,'ask');if(b[0][0]>=a[0][0])throw Error('BOOK_CROSSED_OR_LOCKED');
 return {kind:'book',venue,symbol,...t,received_at_ms:received,bid:b[0][0],ask:a[0][0],bid_size:b[0][1],ask_size:a[0][1],
  bids:b,asks:a,sequence:seq===null?null:identifier(seq),snapshot:true,level_scope:'RECEIVED_TOP_DEPTH_NOT_FULL_ORDER_EVENTS'};
}
export function normalizeFrame(venue,text,received){
 if(!safe(received))throw Error('RECEIVE_CLOCK_INVALID');if(text==='pong')return [];
 const d=parseExactJSON(text);if(d?.event==='error'||d?.error)throw Error('PROVIDER_SUBSCRIPTION_ERROR');if(d?.event)return [];
 if(venue==='bitget'){
  if(d?.arg?.instType!=='USDT-FUTURES')throw Error('PRODUCT_IDENTITY');
  const symbol=d.arg.instId;marketKey(venue,symbol);if(!Array.isArray(d.data))throw Error('FRAME_DATA_SCHEMA');
  if(d.arg.channel==='trade'){
   if(!['snapshot','update'].includes(d.action))throw Error('TRADE_ACTION');
   return d.data.map(x=>{const p=number(x.price),q=number(x.size),side=String(x.side).toUpperCase();if(p<=0||q<=0||!['BUY','SELL'].includes(side))throw Error('TRADE_VALUE');
    return {kind:'trade',venue,symbol,...timestamp(x.ts,'milliseconds',received),received_at_ms:received,trade_id:identifier(x.tradeId),price:p,size:q,side,historical_snapshot:d.action==='snapshot'};});
  }
  if(d.arg.channel==='books5'){
   if(d.action!=='snapshot')throw Error('BOOK_SNAPSHOT_REQUIRED');
   return d.data.map(x=>book(venue,symbol,x.bids,x.asks,timestamp(x.ts,'milliseconds',received),received,x.seq??null));
  }
  throw Error('UNSUBSCRIBED_CHANNEL');
 }
 if(venue==='bithumb'){
  const symbol=d?.code;marketKey(venue,symbol);
  if(d.type==='trade'){
   const p=number(d.trade_price),q=number(d.trade_volume),side=d.ask_bid==='BID'?'BUY':d.ask_bid==='ASK'?'SELL':null;
   if(p<=0||q<=0||!side||!['REALTIME','SNAPSHOT'].includes(d.stream_type))throw Error('TRADE_VALUE');
   return [{kind:'trade',venue,symbol,...timestamp(d.trade_timestamp,'milliseconds',received),received_at_ms:received,trade_id:identifier(d.sequential_id),price:p,size:q,side,historical_snapshot:d.stream_type==='SNAPSHOT'}];
  }
  if(d.type==='orderbook'){
   if(!Array.isArray(d.orderbook_units))throw Error('BOOK_SCHEMA');
   return [book(venue,symbol,d.orderbook_units.map(x=>[x.bid_price,x.bid_size]),d.orderbook_units.map(x=>[x.ask_price,x.ask_size]),timestamp(d.timestamp,'microseconds',received),received)];
  }
  throw Error('UNSUBSCRIBED_CHANNEL');
 }
 throw Error('VENUE_IDENTITY');
}
export class StreamState{
 constructor({retention_ms=180000}={}){this.markets=new Map();this.connections=new Map();this.retention_ms=retention_ms;}
 open(venue,id,at){if(!safe(at)||!id)throw Error('CONNECTION_CLOCK');const prior=this.connections.get(venue);this.connections.set(venue,{id,opened_at_ms:at,closed_at_ms:null,reconnects:(prior?.reconnects??-1)+1});}
 close(venue,id,at,reason){const s=this.connections.get(venue);if(s?.id!==id)return;s.closed_at_ms=at;s.close_reason=String(reason);}
 forgetMarket(venue,symbol){this.markets.delete(marketKey(venue,symbol));}
 accept(e,connection){
  const con=this.connections.get(e.venue);if(!con||con.id!==connection||con.closed_at_ms!==null)throw Error('CONNECTION_NOT_ACTIVE');
  if(!safe(e.at_ms)||!safe(e.received_at_ms)||e.at_ms>e.received_at_ms||e.received_at_ms<con.opened_at_ms)throw Error('EVENT_CLOCK_INVALID');
  const key=marketKey(e.venue,e.symbol);let s=this.markets.get(key);
  if(!s){s={rows:[],seen:new Map(),initial_history_count:0,duplicates:0,conflicts:0,out_of_order_books:0,preconnection_events:0,lastBook:null,lastPrune:0};this.markets.set(key,s)}
  if(s.segment!==connection){s.rows=[];s.seen.clear();s.lastBook=null;s.segment=connection;s.initial_history_count=0;s.duplicates=0;s.conflicts=0;s.out_of_order_books=0;s.observed_since_ms=null;}
  if(e.kind==='trade'){
   const fp=JSON.stringify([e.at_us,e.price,e.size,e.side]),old=s.seen.get(e.trade_id);
   if(old){if(old.fp!==fp){s.conflicts++;throw Error('CONFLICTING_TRADE_ID')}s.duplicates++;return false;}
   s.seen.set(e.trade_id,{fp,received_at_ms:e.received_at_ms});
   if(e.historical_snapshot){s.initial_history_count++;return false;}
  }
  if(e.at_ms<con.opened_at_ms){s.preconnection_events++;return false;}
  if(e.kind==='book'&&s.lastBook){
   const old=s.lastBook;if(e.at_us<old.at_us||(e.at_us===old.at_us&&e.sequence&&old.sequence&&BigInt(e.sequence)<BigInt(old.sequence))){s.out_of_order_books++;return false;}
   if(e.at_us===old.at_us&&e.sequence===old.sequence){
    if(JSON.stringify([e.bids,e.asks])===JSON.stringify([old.bids,old.asks])){s.duplicates++;return false;}
    s.conflicts++;throw Error('CONFLICTING_BOOK_TIMESTAMP');
   }
  }
  if(e.kind==='book'){s.lastBook=e;s.observed_since_ms??=e.received_at_ms;}
  s.rows.push({...e,segment:connection});
  if(e.received_at_ms-s.lastPrune>5000){const limit=e.received_at_ms-this.retention_ms;s.rows=s.rows.filter(x=>x.received_at_ms>=limit);for(const [id,v] of s.seen)if(v.received_at_ms<limit)s.seen.delete(id);s.lastPrune=e.received_at_ms;}
  return true;
 }
 snapshot(venue,symbol,now,window_ms=60000){
  if(!safe(now)||!safe(window_ms)||window_ms<=0)throw Error('ASOF_CLOCK');
  const s=this.markets.get(marketKey(venue,symbol)),c=this.connections.get(venue),start=now-window_ms;
  const rows=(s?.rows||[]).filter(x=>x.segment===c?.id&&x.received_at_ms<=now&&x.at_ms>=start&&x.at_ms<=now);
  const b=rows.filter(x=>x.kind==='book').sort((a,b)=>a.at_us-b.at_us),t=rows.filter(x=>x.kind==='trade');
  let buy=0,sell=0;for(const x of t){if(x.side==='BUY')buy+=x.price*x.size;else sell+=x.price*x.size;}
  let ofi=0,bidAdd=0,askAdd=0;
  for(let i=1;i<b.length;i++){const x=b[i],p=b[i-1];ofi+=(x.bid>=p.bid?x.bid_size:0)-(x.bid<=p.bid?p.bid_size:0)-(x.ask<=p.ask?x.ask_size:0)+(x.ask>=p.ask?p.ask_size:0);
   if(x.bid===p.bid)bidAdd+=Math.max(0,x.bid_size-p.bid_size);if(x.ask===p.ask)askAdd+=Math.max(0,x.ask_size-p.ask_size);}
  const first=b[0],last=b.at(-1),mid=q=>(q.bid+q.ask)/2;
  const quote=x=>x?{bid:x.bid,ask:x.ask,at_ms:x.at_ms,at_us:x.at_us,received_at_ms:x.received_at_ms,bid_size:x.bid_size,ask_size:x.ask_size}:null;
  const bidDepth=last?.bids.reduce((a,x)=>a+x[1],0)??null,askDepth=last?.asks.reduce((a,x)=>a+x[1],0)??null;
  return {version:STREAM_VERSION,venue,symbol,asof_ms:now,window_ms,segment:c?.id??null,connected_since_ms:c?.opened_at_ms??null,
   unbroken_window:!!c&&c.closed_at_ms===null&&s?.segment===c.id&&safe(s?.observed_since_ms)&&s.observed_since_ms<=start,
   market_observed_since_ms:s?.segment===c?.id?s?.observed_since_ms??null:null,
   market_observation_span_ms:s?.segment===c?.id&&safe(s?.observed_since_ms)?Math.max(0,now-s.observed_since_ms):0,reconnects:c?.reconnects??0,
   book_count:b.length,trade_count:t.length,first_quote:quote(first),last_quote:quote(last),quote_age_ms:last?now-last.at_ms:null,
   buy_quote_notional:buy,sell_quote_notional:sell,signed_quote_flow:buy-sell,buy_share:buy+sell>0?buy/(buy+sell):null,
   observed_mid_change_pct:first&&last?100*(mid(last)/mid(first)-1):null,
   long_executable_change_pct:first&&last?100*(last.bid/first.ask-1):null,
   short_executable_change_pct:first&&last?100*(first.bid-last.ask)/first.bid:null,
   spread_pct:last?100*(last.ask/last.bid-1):null,
   top_depth_imbalance:bidDepth+askDepth>0?(bidDepth-askDepth)/(bidDepth+askDepth):null,
   order_flow_imbalance_base:ofi,observed_bid_replenishment:bidAdd,observed_ask_replenishment:askAdd,
   initial_history_count:s?.initial_history_count??0,duplicates:s?.duplicates??0,conflicts:s?.conflicts??0,out_of_order_books:s?.out_of_order_books??0,
   complete_exchange_tape_verified:false,book_cancellation_or_fill_attribution_verified:false,intent_verified:false,
   forecast_accuracy_proven:false,trade_permission:false};
 }
}
