/** V36 frozen targets and stops. OHLC is NOT execution or exact intraminute order. */
const V36_PATH_VERSION='V36_FROZEN_BARRIERS_V1',MIN=60000;
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function v36Freeze(item,now){
 const c=item?.candidate||{},a=item?.first||{},b=item?.second||{},f=item?.final||{};
 if(!Number.isSafeInteger(now)||!['LONG','SHORT','BUY'].includes(c.direction)||c.venue==='bithumb'&&c.direction!=='BUY'||
 !['bithumb','bitget'].includes(c.venue)||[a,b,f].some(x=>x.venue!==c.venue||x.symbol!==c.symbol))return null;
 if(!Number.isSafeInteger(f.observed_at_ms)||f.observed_at_ms>now||!Number.isSafeInteger(f.quote?.at_ms)||
 f.quote.at_ms>now||now-f.quote.at_ms>45000)return null;
 const bid=f.quote.bid,ask=f.quote.ask;if(!good(bid)||!good(ask)||ask<bid)return null;
 const trades=[...(Array.isArray(a.trades)?a.trades:[]),...(Array.isArray(b.trades)?b.trades:[])].filter(
 x=>Number.isSafeInteger(x.at_ms)&&x.at_ms<=now&&x.at_ms>=a.observed_at_ms-60000&&good(x.price));
 if(trades.length<3)return null;
 const range=Math.max(...trades.map(x=>x.price))-Math.min(...trades.map(x=>x.price)),spread=ask-bid,entry=c.direction==='SHORT'?bid:ask;
 const risk=Math.max(3*spread,range,entry*.00001);if(!Number.isFinite(risk)||risk<=0||risk/entry>.5)return null;
 const dir=c.direction==='SHORT'?-1:1;
 return {version:V36_PATH_VERSION,venue:c.venue,symbol:c.symbol,direction:c.direction,issued_at_ms:now,
 entry_price:entry,risk_price:risk,target_price:entry+dir*1.5*risk,stop_price:entry-dir*risk,
 original_bid:bid,original_ask:ask,first_complete_start_ms:Math.ceil(now/MIN)*MIN,label_source:'FROZEN_PRIOR_MARKET',barriers_locked:true,execution_verified:false};
}
function v36Label(e,bars,now,horizon=15){
 const result=(status,extra={})=>({status,horizon_minutes:horizon,version:V36_PATH_VERSION,actual_execution_verified:false,requires_intraminute_order:false,...extra});
 if(!e||e.version!==V36_PATH_VERSION||!Number.isSafeInteger(now)||![5,15,30,60].includes(horizon)||!Array.isArray(bars))return result('INVALID_INPUT');
 const start=e.first_complete_start_ms,limit=e.issued_at_ms+horizon*MIN,lastFull=Math.floor(Math.min(now,limit)/MIN)*MIN;
 if(!Number.isSafeInteger(start)||lastFull<start)return result(now<limit?'PENDING':'UNMEASURED_GAP');
 const map=new Map();let conflict=false;
 for(const b of bars){const t=b?.start_ms;if(!Number.isSafeInteger(t)||t%MIN||t<start||t+MIN>now)continue;
  const v=[b.open,b.high,b.low,b.close];if(!v.every(good)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))continue;
  const row={start_ms:t,open:b.open,high:b.high,low:b.low,close:b.close};
  if(map.has(t)&&JSON.stringify(map.get(t))!==JSON.stringify(row))conflict=true;map.set(t,row);
 }
 if(conflict)return result('CONFLICTING_CANDLES');
 const long=e.direction!=='SHORT';let seen=0;
 for(let s=start;s+MIN<=lastFull;s+=MIN){const x=map.get(s);if(!x)return result(now>=limit?'UNMEASURED_GAP':'PENDING_MISSING_CANDLE',{measured_candles:seen});seen++;
  const target=long?x.high>=e.target_price:x.low<=e.target_price,stop=long?x.low<=e.stop_price:x.high>=e.stop_price;
  if(target&&stop)return result('AMBIGUOUS_BOTH',{first_touch_minute_start_ms:s,measured_candles:seen});
  if(target||stop)return result(target?'TARGET_FIRST':'STOP_FIRST',{first_touch_minute_start_ms:s,measured_candles:seen});
 }
 return result(now>=limit?'NO_TOUCH_TIMEOUT':'PENDING',{measured_candles:seen});
}
export {V36_PATH_VERSION,v36Freeze,v36Label};
