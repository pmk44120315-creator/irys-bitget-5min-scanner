const V23_HOUR_MS=3600000;
const V23_MAX_HOURLY_NOTICES=2;
const v23N=(x)=>x===null||x===undefined||x===''||typeof x==='boolean'?null:(Number.isFinite(Number(x))?Number(x):null);
// V25 isolated notice distribution (market WATCH only, never a trade signal).
// Retain the original two-notices-per-hour TOTAL and 90m per-symbol cooldown.
function v25BalancedTop(rows,max=12){
  const ordered=[...(Array.isArray(rows)?rows:[])].sort((a,b)=>
    (Number(b.priority)||0)-(Number(a.priority)||0));
  const chosen=ordered.slice(0,max);
  if(chosen.length!==max)return chosen;
  for(const venue of ['bithumb','bitget']){
    if(chosen.some(x=>x.venue===venue))continue;
    const best=ordered.find(x=>x.venue===venue);
    if(best){
      const replace=chosen.findLastIndex(x=>x.venue!==venue);
      if(replace>=0)chosen[replace]=best;
    }
  }
  return chosen.sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0));
}
function v25HourlyView(existing,notices,now){
  const hour=Math.floor(now/V23_HOUR_MS);
  if(!existing||existing.hour!==hour)return {hour,count:0,by_venue:{bithumb:0,bitget:0}};
  const count=Number.isSafeInteger(existing.count)?Math.max(0,Math.min(V23_MAX_HOURLY_NOTICES,existing.count)):0;
  const by={bithumb:0,bitget:0};
  if(existing.by_venue&&typeof existing.by_venue==='object'){
    for(const venue of Object.keys(by)){
      const n=existing.by_venue[venue];
      by[venue]=Number.isSafeInteger(n)?Math.max(0,Math.min(count,n)):0;
    }
  }else{
    // Upgrade a live V24 hourly state from its real successful notice timestamps.
    for(const [key,value] of Object.entries(notices||{})){
      const venue=key.split(':',1)[0];
      const at=v23N(value);
      if(Object.hasOwn(by,venue)&&at!==null&&Math.floor(at/V23_HOUR_MS)===hour)
        by[venue]++;
    }
  }
  const sum=by.bithumb+by.bitget;
  if(sum>count){
    // Never restore more counters than actually acknowledged in the hour.
    by.bithumb=Math.min(by.bithumb,count);
    by.bitget=Math.min(by.bitget,count-by.bithumb);
  }
  return {hour,count,by_venue:by};
}
function v25ChooseNotice(choices,hourly,venueReady){
  if(hourly.count>=V23_MAX_HOURLY_NOTICES)
    return {status:'DELIVERY_RATE_PACED',target:null};
  if(!choices.length)return {status:'DUPLICATE_EPISODE_PACED',target:null};
  const dual=venueReady.bithumb===true&&venueReady.bitget===true;
  const perVenueCap=dual?1:V23_MAX_HOURLY_NOTICES;
  const chosen=choices.find(c=>['bithumb','bitget'].includes(c.venue)&&
    (hourly.by_venue[c.venue]||0)<perVenueCap);
  return chosen?{status:'PASS',target:chosen}:
    {status:'DELIVERY_VENUE_RESERVED',target:null};
}

export {v25BalancedTop,v25HourlyView,v25ChooseNotice};
