/** Bitget UTA public WS evidence probe (research only, no writes, no Telegram, no orders). */
const symbols=['BTCUSDT','ETHUSDT'];
const url='wss://ws.bitget.com/v3/ws/public';
if(typeof WebSocket!=='function')throw Error('NODE_WEBSOCKET_UNAVAILABLE');
const ws=new WebSocket(url);
const stats={opened:false,ack:[],data_messages:0,unknown_data:0,tradeticks:0,buy:0,sell:0,dup:0,
  books:0,ping_sent:0,pong_received:0,symbols:{},first_message_types:[],close:null,error:null};
const recent=new Map();
let done=false;
const started=Date.now(),samplePeriodMs=75000;
function finish(){
 if(done)return;done=true;
 clearInterval(heart);clearTimeout(stop);
 try{ws.close(1000,'research complete')}catch{}
 stats.elapsed_ms=Date.now()-started;
 console.log('BITGET_PUBLIC_WS_RESEARCH_ONLY',JSON.stringify(stats));
 if(!stats.opened||!stats.ack.some(x=>x.topic==='publicTrade')||stats.tradeticks===0)
   process.exitCode=2;
}
ws.addEventListener('open',()=>{
 stats.opened=true;
 const args=symbols.flatMap(symbol=>[
  {instType:'usdt-futures',topic:'publicTrade',symbol},
  {instType:'usdt-futures',topic:'books5',symbol},
 ]);
 ws.send(JSON.stringify({op:'subscribe',args}));
});
ws.addEventListener('error',e=>{stats.error=String(e?.message||e?.type||'WS_ERROR')});
ws.addEventListener('close',e=>{stats.close={code:e.code,reason:e.reason};finish()});
ws.addEventListener('message',e=>{
 try{
  const raw=typeof e.data==='string'?e.data:Buffer.from(e.data).toString('utf8');
  if(raw==='pong'){stats.pong_received++;return;}
  if(raw==='ping'){ws.send('pong');return;}
  const obj=JSON.parse(raw);
  if(obj.event){stats.ack.push({event:obj.event,topic:obj.arg?.topic,code:obj.code??null});return;}
  stats.data_messages++;
  const topic=obj.arg?.topic||obj.topic||'unknown';
  if(stats.first_message_types.length<8)stats.first_message_types.push({topic,data_type:Array.isArray(obj.data)?'array':typeof obj.data,
     example_keys:Array.isArray(obj.data)?Object.keys(obj.data[0]||{}).slice(0,12):Object.keys(obj).slice(0,12)});
  if(topic==='books5'){stats.books++;return;}
  if(topic!=='publicTrade'||!Array.isArray(obj.data)){stats.unknown_data++;return;}
  for(const row of obj.data){
   const entries=Array.isArray(row)?row:[row];
   for(const q of entries){
     const side=String(q?.S??q?.side??'').toLowerCase();
     const px=Number(q?.p??q?.price),qty=Number(q?.v??q?.size),time=Number(q?.T??q?.ts??q?.timestamp);
     const id=String(q?.i??q?.tradeId??q?.execId??'');
     const sym=obj.arg?.symbol||q?.symbol||'UNKNOWN';
     if(!['buy','sell'].includes(side)||!Number.isFinite(px)||!Number.isFinite(qty)||
        px<=0||qty<=0||!Number.isSafeInteger(time)||Math.abs(time-Date.now())>60000||!id){stats.unknown_data++;continue;}
     let cache=recent.get(sym);if(!cache){cache=new Set();recent.set(sym,cache);}
     if(cache.has(id)){stats.dup++;continue;}cache.add(id);
     if(cache.size>50000)cache.clear();
     stats.tradeticks++;stats[side]++;
     const record=stats.symbols[sym]||(stats.symbols[sym]={count:0,buy_quote:0,sell_quote:0,first_ts:time,last_ts:time});
     record.count++;record[side+'_quote']+=px*qty;record.first_ts=Math.min(record.first_ts,time);
     record.last_ts=Math.max(record.last_ts,time);
   }
  }
 }catch(e){stats.unknown_data++;if(!stats.error)stats.error=String(e?.message||e).slice(0,100);}
});
const heart=setInterval(()=>{if(ws.readyState===1){ws.send('ping');stats.ping_sent++}},23000);
const stop=setTimeout(finish,samplePeriodMs);
