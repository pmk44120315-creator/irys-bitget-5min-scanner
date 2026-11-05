/** Observed major-coin downside risk, not an executable SHORT recommendation. */
const V34_VERSION='IRYS_V34_CROSS_VENUE_DROP_V1';
const V34_POLICY={slow_minutes:15,slow_drop_pct:1,fast_minutes:5,fast_drop_pct:2,
  minimum_assets:2,packet_age_ms:90000,quote_age_ms:45000,closed_bar_age_ms:180000};
const ASSETS=['BTC','ETH','XRP'],VENUES=['bitget','bithumb'],UNIT=300000;
const num=x=>x===null||x===undefined||x===''||typeof x==='boolean'?null:Number.isFinite(Number(x))?Number(x):null;
const time=x=>Number.isSafeInteger(x)&&x>=0;
function v34ParseBars(raw,venue,symbol,now){
 if(!Array.isArray(raw))return [];
 const rows=new Map(),conflicts=new Set(),seen=new Map();
 for(const r of raw){let t,o,h,l,c;
  if(venue==='bithumb'){
   if(r?.market!==symbol||typeof r.candle_date_time_utc!=='string')continue;
   const s=r.candle_date_time_utc;t=Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s)?s:s+'Z');
   [o,h,l,c]=[r.opening_price,r.high_price,r.low_price,r.trade_price].map(num);
  }else if(venue==='bitget'&&Array.isArray(r)){t=num(r[0]);[o,h,l,c]=r.slice(1,5).map(num);}
  else continue;
  if(time(t)){const token=JSON.stringify([o,h,l,c]);if(seen.has(t)&&seen.get(t)!==token)conflicts.add(t);seen.set(t,token);}
  if(!time(t)||t%UNIT||t+UNIT>now||[o,h,l,c].some(x=>x===null||x<=0)||l>Math.min(o,c)||h<Math.max(o,c)||h<l)continue;
  const row={start_ms:t,open:o,high:h,low:l,close:c};
  if(rows.has(t)&&JSON.stringify(rows.get(t))!==JSON.stringify(row))conflicts.add(t);
  rows.set(t,row);
 }
 return [...rows.values()].filter(x=>!conflicts.has(x.start_ms)).sort((a,b)=>a.start_ms-b.start_ms);
}
function v34Item(item,now){
 if(!item||!ASSETS.includes(item.asset)||!VENUES.includes(item.venue)||item.source!=='OFFICIAL_NATIVE_5M_AND_QUOTES')return null;
 const symbol=item.venue==='bithumb'?'KRW-'+item.asset:item.asset+'USDT';
 if(item.symbol!==symbol||!time(item.fetched_at_ms)||item.fetched_at_ms>now||now-item.fetched_at_ms>V34_POLICY.packet_age_ms)return null;
 const raw=item.quote||{},bid=num(raw.bid),ask=num(raw.ask),at=raw.at_ms;
 if(bid===null||ask===null||bid<=0||ask<bid||!time(at)||at>item.fetched_at_ms||now-at>V34_POLICY.quote_age_ms)return null;
 const input=Array.isArray(item.bars)?item.bars:[];
 const bars=v34ParseBars(input.map(b=>[b?.start_ms,b?.open,b?.high,b?.low,b?.close]),'bitget',symbol,item.fetched_at_ms);
 if(bars.length<4)return null;
 const end=bars.at(-1).start_ms+UNIT;
 if(end>now||now-end>V34_POLICY.closed_bar_age_ms)return null;
 const by=new Map(bars.map(x=>[x.start_ms,x]));
 const path=[3,2,1,0].map(i=>by.get(end-(i+1)*UNIT));
 if(path.some(x=>!x))return null;
 const close=path.at(-1).close,prior5=path[2].close,prior15=path[0].close;
 const r5=100*(close/prior5-1),r15=100*(close/prior15-1);
 const live5=100*(ask/prior5-1),live15=100*(ask/prior15-1);
 const fast=r5<=-V34_POLICY.fast_drop_pct&&live5<=-V34_POLICY.fast_drop_pct;
 const slow=r15<=-V34_POLICY.slow_drop_pct&&r5<0&&live15<=-V34_POLICY.slow_drop_pct;
 return {asset:item.asset,venue:item.venue,symbol,end_ms:end,return_5m_pct:r5,return_15m_pct:r15,
  current_ask_return_5m_pct:live5,current_ask_return_15m_pct:live15,quote:{bid,ask,at_ms:at},
  fast,slow,first_reference_end_ms:path[0].start_ms+UNIT,current_reference_end_ms:end};
}
function v34Evaluate(doc,now,expectedDigest){
 const base={version:V34_VERSION,trade_entry_permit:false,future_direction_proven:false,policy:{...V34_POLICY}};
 if(!time(now)||doc?.version!==V34_VERSION||!expectedDigest||doc.model_digest!==expectedDigest||doc.source!=='OFFICIAL_PUBLIC_MARKETS'||doc.orders_sent!==false||doc.telegram_sent!==false||!Array.isArray(doc.items))return {...base,status:'UNTRUSTED_PACKET',assets:[]};
 if(!time(doc.at_ms)||!time(doc.started_at_ms)||doc.started_at_ms>doc.at_ms||doc.at_ms>now||now-doc.at_ms>V34_POLICY.packet_age_ms||doc.at_ms-doc.started_at_ms>180000)return {...base,status:'STALE_OR_INVALID_PACKET',assets:[]};
 const indexed=new Map(),duplicates=new Set();
 for(const item of doc.items){const key=item?.venue+':'+item?.asset;if(indexed.has(key))duplicates.add(key);indexed.set(key,item);}
 const assets=[],observations=[],missing=[];
 for(const asset of ASSETS){
  const pair=VENUES.map(v=>duplicates.has(v+':'+asset)?null:v34Item(indexed.get(v+':'+asset),now));
  if(pair.some(x=>!x)||pair[0].end_ms!==pair[1].end_ms){missing.push(asset);continue;}
  const fast=pair.every(x=>x.fast),slow=pair.every(x=>x.slow);
  observations.push(...pair);
  if(fast||slow)assets.push({asset,horizon_min:fast?5:15,end_ms:pair[0].end_ms,venues:pair});
 }
 const sameEnd=assets.length?assets.every(a=>a.end_ms===assets[0].end_ms):true;
 return {...base,status:assets.length>=V34_POLICY.minimum_assets&&sameEnd?'OBSERVED_DROP':missing.length?'INCOMPLETE_SOURCES':'VERIFIED_QUIET',
  assets,observations,missing_assets:missing,source_at_ms:doc.at_ms,observed_at_ms:now,
  evidence_id:assets.length?'V34:'+assets[0].end_ms+':'+assets.map(a=>a.asset).join(','):null};
}
export {V34_VERSION,V34_POLICY,v34ParseBars,v34Item,v34Evaluate};
