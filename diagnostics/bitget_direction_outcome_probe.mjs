/** Read-only Bitget official v3 candle forward-direction outcome audit; NOT live fills/PNL. */
const events=[
 ['UNIUSDT','LONG',1793152706973],
 ['INJUSDT','SHORT',1793156004784],
 ['ARXUSDT','SHORT',1793158422523],
 ['BANKUSDT','SHORT',1793160503834],
 ['ARBUSDT','SHORT',1793161103387],
 ['UNIUSDT','LONG',1793162603402],
 ['AAVEUSDT','LONG',1793168305033]
];
async function request(u){
 const res=await fetch(u,{headers:{accept:'application/json','user-agent':'IRYS-research-only-outcome'},signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('PUBLIC_BITGET_HTTP_'+res.status);
 const j=await res.json();
 if(j.code!=='00000'||!Array.isArray(j.data))throw Error('PUBLIC_BITGET_SCHEMA');
 return j.data;
}
const now=Date.now(),minute=60000;
for(const [symbol,dir,at] of events){
 const entry=Math.ceil(at/minute)*minute;
 const url='https://api.bitget.com/api/v3/market/candles?'+
  new URLSearchParams({category:'USDT-FUTURES',symbol,interval:'1m',
    startTime:String(entry-2*minute),endTime:String(entry+40*minute),limit:'100'});
 try{
  const raw=await request(url);
  const bars=new Map();
  for(const b of raw)if(Array.isArray(b)&&b.length>=5&&Number.isFinite(Number(b[0]))){
    const ts=Number(b[0]),vals=b.slice(1,5).map(Number);
    if(vals.every(Number.isFinite)&&ts%minute===0&&ts+minute<=now)bars.set(ts,vals);
  }
  const base=bars.get(entry);
  if(!base||base[0]<=0)throw Error('ENTRY_CANDLE_UNAVAILABLE');
  const out={symbol,dir,event_kst:new Date(at+9*3600000).toISOString().slice(0,16).replace('T',' '),
    reference:'first closed 1m candle opening after snapshot',base_open:base[0],
    future_5m:null,future_15m:null,future_30m:null};
  const mult=dir==='LONG'?1:-1;
  for(const m of [5,15,30]){
    const end=entry+(m-1)*minute;
    const b=bars.get(end);
    out['future_'+m+'m']=b?{dir_adjusted_pct:+(mult*100*(b[3]/base[0]-1)).toFixed(3),
      raw_price_pct:+(100*(b[3]/base[0]-1)).toFixed(3)}:
      {status:'UNVERIFIED_MISSING_CLOSED_CANDLE'};
  }
  console.log('BITGET_HISTORICAL_OUTCOME',JSON.stringify(out));
 }catch(e){console.log('BITGET_HISTORICAL_OUTCOME',JSON.stringify({symbol,dir,
    event_utc:new Date(at).toISOString(),status:'UNVERIFIED',error:String(e).slice(0,130)}));}
}
