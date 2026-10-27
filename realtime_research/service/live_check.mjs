/** One complete observed minute, not a 24/7 reliability or prediction test. */
import {DatabaseSync} from 'node:sqlite';
import {EvidenceStore,parseFrame} from './core.mjs';
import {fetchWalletWindow} from './integrations.mjs';
import {readFile} from 'node:fs/promises';
const db=new DatabaseSync(':memory:');
const sql={exec(q,...a){return {toArray:()=>db.prepare(q).all(...a)};}};
const store=new EvidenceStore(sql),markets=['KRW-BTC','KRW-WLD'];
const start=Date.now(),minute=(Math.floor(start/60000)+1)*60000,end=minute+60000;
const ws=new WebSocket('wss://ws-api.bithumb.com/websocket/v1');ws.binaryType='arraybuffer';
for(const m of markets)store.start(m,start);
let frames=0;
await new Promise((resolve,reject)=>{
  ws.addEventListener('open',()=>{ws.send(JSON.stringify([{ticket:crypto.randomUUID()},{type:'trade',codes:markets,isOnlyRealtime:true},{type:'orderbook',codes:markets,isOnlyRealtime:true},{format:'DEFAULT'}]));resolve();},{once:true});
  ws.addEventListener('error',()=>reject(Error('PUBLIC_WS_CONNECT_FAILED')),{once:true});
});
ws.addEventListener('message',event=>{const raw=typeof event.data==='string'?event.data:new TextDecoder().decode(event.data);const at=Date.now();if(parseFrame(raw,at))store.ingest(raw,at);else for(const m of markets)store.quality(m,at,at+1,'INVALID_OR_UNEXPECTED_FRAME');frames++;});
ws.addEventListener('close',()=>{for(const m of markets)store.stop(m,Date.now(),'LIVE_CHECK_CLOSE');});
// Completion is defined by the first fully observed, closed exchange minute.
await new Promise(resolve=>setTimeout(resolve,Math.max(0,end+5000-Date.now())));
const reports=[];
for(const market of markets){
  try{
    const r=await fetch('https://api.bithumb.com/v1/candles/minutes/1?market='+market+'&count=5',{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error('CANDLE_HTTP');const candles=await r.json();
    const candle=candles.find(c=>Date.parse(c.candle_date_time_utc+'Z')===minute);
    if(candle)store.reconcile(market,minute,Number(candle.candle_acc_trade_price),Date.now());
    reports.push(store.summary(market,end+5000,1));
  }catch{reports.push({market,verified:false,reasons:['LIVE_CANDLE_UNAVAILABLE']});}
}
ws.close();
console.log(JSON.stringify({check:'COMPLETE_MINUTE_STREAM_RECONCILIATION',start_ms:start,minute_ms:minute,frames,windows:reports,verified_15m:false,verified_30m:false}));
try{
  const r=await fetch('https://irys-surge-monitor.vhehwpfl.workers.dev/',{signal:AbortSignal.timeout(20000)});const h=await r.json();
  console.log(JSON.stringify({check:'EXISTING_V7_READ_ONLY_HEALTH',http:r.status,code_version:h.last?.codeVersion,last_time:h.last?.time,transport_test:h.telegramTransportTest?.status,prior_send_verified:h.last?.telegramSendVerified,new_pipeline_delivery_verified:false}));
}catch{console.log(JSON.stringify({check:'EXISTING_V7_READ_ONLY_HEALTH',status:'UNAVAILABLE'}));}
const registry=JSON.parse(await readFile(new URL('./known_wallets.json',import.meta.url),'utf8'));
const chain=await fetchWalletWindow(registry,Date.now());
console.log(JSON.stringify({check:'KNOWN_ADDRESS_CHAIN_READ',status:chain.status,error_code:chain.error_code??null,wallets:chain.wallets,transfer_count:chain.transfers.length,coverage_complete:chain.coverage_complete,all_exchange_coverage:false}));
console.log(JSON.stringify({check:'DEPLOYMENT_CREDENTIAL_PRESENCE_ONLY',cloudflare_token_present:Boolean(process.env.IRYS_REALTIME_CF_API_TOKEN),cloudflare_account_present:Boolean(process.env.IRYS_REALTIME_CF_ACCOUNT_ID),telegram_token_present:Boolean(process.env.IRYS_REALTIME_TELEGRAM_BOT_TOKEN),telegram_chat_present:Boolean(process.env.IRYS_REALTIME_TELEGRAM_CHAT_ID),standard_cloudflare_token_present:Boolean(process.env.CLOUDFLARE_API_TOKEN),standard_cloudflare_account_present:Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),standard_telegram_token_present:Boolean(process.env.TELEGRAM_BOT_TOKEN),standard_telegram_chat_present:Boolean(process.env.TELEGRAM_CHAT_ID),twin_telegram_token_present:Boolean(process.env.AI_TWIN_TELEGRAM_BOT_TOKEN),twin_telegram_chat_present:Boolean(process.env.AI_TWIN_TELEGRAM_CHAT_ID),secret_values_printed:false,telegram_send_attempted:false}));
if(!reports.some(r=>r.verified))process.exitCode=2;
