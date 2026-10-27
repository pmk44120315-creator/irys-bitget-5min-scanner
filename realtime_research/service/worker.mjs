import {EvidenceStore,parseFrame} from './core.mjs';
import {fetchWalletWindow,telegramTest} from './integrations.mjs';
const VERSION='IRYS_REALTIME_SHADOW_V1';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const routes=new Set(['/status','/evidence','/onchain','/control/start','/control/stop','/telegram/test']);
async function authenticated(request,token){
  if(typeof token!=='string'||token.length<32)return false;
  const got=request.headers.get('authorization')||'';
  const bytes=new TextEncoder(),a=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode(got))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode('Bearer '+token)));
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if((path==='/'||path==='/health')&&request.method==='GET')return json({version:VERSION,mode:'SHADOW_ONLY',production_worker_untouched:true,trade_alerts_enabled:false});
    if(!routes.has(path))return json({error:'NOT_FOUND'},404);
    if(typeof env.IRYS_RT_ADMIN_TOKEN!=='string'||env.IRYS_RT_ADMIN_TOKEN.length<32)return json({error:'ADMIN_NOT_CONFIGURED'},503);
    if(!await authenticated(request,env.IRYS_RT_ADMIN_TOKEN))return json({error:'UNAUTHORIZED'},401);
    if(!env.IRYS_RT)return json({error:'SEPARATE_DURABLE_OBJECT_NOT_CONFIGURED'},503);
    const stub=env.IRYS_RT.get(env.IRYS_RT.idFromName('irys-realtime-evidence-v1'));
    return stub.fetch(request);
  },
  async scheduled(_event,env,ctx){
    if(!env.IRYS_RT)return;
    const stub=env.IRYS_RT.get(env.IRYS_RT.idFromName('irys-realtime-evidence-v1'));
    ctx.waitUntil(stub.fetch(new Request('https://internal.invalid/wake',{method:'POST'})));
  }
};
export class RealtimeEvidenceDO {
  constructor(ctx,env,deps={}){
    this.ctx=ctx;this.env=env;this.net=deps.fetch??globalThis.fetch;this.now=deps.now??Date.now;
    this.generation=0;this.commandId=0;this.socket=null;this.opening=null;this.lastMessage=0;this.lastReconcile=0;this.lastChain=0;
    this.ready=ctx.blockConcurrencyWhile(async()=>{this.db=new EvidenceStore(ctx.storage.sql);this.config=await ctx.storage.get('rt:config')??{enabled:false,markets:[]};this.risk=await ctx.storage.get('rt:risk')??{status:'UNVERIFIED'};});
  }
  async requestJson(url){const r=await this.net(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('PUBLIC_API_HTTP');return r.json();}
  async connect(){
    if(!this.config.enabled||this.socket)return;
    if(this.opening)return this.opening.promise;
    const generation=this.generation,markets=[...this.config.markets],attempt={};this.opening=attempt;
    attempt.promise=(async()=>{
      try{
        const r=await this.net('https://ws-api.bithumb.com/websocket/v1',{headers:{Upgrade:'websocket'},signal:AbortSignal.timeout(20000)});
        const ws=r.webSocket;if(!ws)throw Error('WS_UPGRADE_FAILED');
        ws.accept();
        if(generation!==this.generation||!this.config.enabled){ws.close(1000,'STALE_CONNECTION');return;}
        this.socket=ws;this.lastMessage=this.now();
        for(const market of markets)this.db.start(market,this.lastMessage);
        ws.addEventListener('message',event=>{
          if(this.socket!==ws)return;
          const at=this.now();this.lastMessage=at;
          try{
            const raw=typeof event.data==='string'?event.data:new TextDecoder().decode(event.data);
            const parsed=parseFrame(raw,at);
            if(parsed&&this.config.markets.includes(parsed.market))this.db.ingest(raw,at);
            else for(const market of this.config.markets)this.db.quality(market,at,at+1,'INVALID_OR_UNEXPECTED_FRAME');
          }catch{for(const market of this.config.markets)this.db.quality(market,at,at+1,'FRAME_PARSE_FAILED');}
        });
        const close=()=>{if(this.socket!==ws)return;this.socket=null;for(const market of this.config.markets)this.db.stop(market,this.now());if(this.config.enabled)this.ctx.waitUntil(this.ctx.storage.setAlarm(this.now()+5000));};
        ws.addEventListener('close',close);ws.addEventListener('error',close);
        ws.send(JSON.stringify([{ticket:'irys-rt-'+crypto.randomUUID()},{type:'trade',codes:this.config.markets,isOnlyRealtime:true},{type:'orderbook',codes:this.config.markets,isOnlyRealtime:true},{format:'DEFAULT'}]));
        await this.ctx.storage.put('rt:connection',{status:'CONNECTED',at_ms:this.now()});
      }catch{
        if(generation!==this.generation)return;
        this.disconnect('CONNECT_FAILED');
        await this.ctx.storage.put('rt:connection',{status:'CONNECT_FAILED',at_ms:this.now()});
      }finally{if(this.opening===attempt)this.opening=null;}
    })();return attempt.promise;
  }
  disconnect(reason){this.generation++;this.opening=null;const ws=this.socket;this.socket=null;if(ws){try{ws.close(1000,reason);}catch{}}
    for(const market of this.config.markets)this.db.stop(market,this.now(),reason);
  }
  async refreshEvidence(){
    const now=this.now();
    for(const market of this.config.markets){
      try{
        const raw=await this.requestJson('https://api.bithumb.com/v1/candles/minutes/1?market='+encodeURIComponent(market)+'&count=40');
        if(!Array.isArray(raw))throw Error('CANDLE_SCHEMA');
        for(const c of raw){
          const stamp=String(c.candle_date_time_utc||''),ts=Date.parse(stamp.endsWith('Z')?stamp:stamp+'Z'),q=Number(c.candle_acc_trade_price);
          if(Number.isSafeInteger(ts)&&ts%60000===0&&ts+60000<=now&&ts>=now-31*60000&&Number.isFinite(q)&&q>=0)this.db.reconcile(market,ts,q,now);
        }
      }catch{await this.ctx.storage.put('rt:candle_error:'+market,{status:'UNVERIFIED',at_ms:now});}
    }
    try{
      const warnings=await this.requestJson('https://api.bithumb.com/v1/market/virtual_asset_warning');
      if(!Array.isArray(warnings))throw Error('RISK_SCHEMA');
      this.risk={status:'OFFICIAL_FEED_READ',at_ms:now,markets:[...new Set(warnings.map(x=>x.market).filter(x=>typeof x==='string'))],does_not_cover_all_incidents:true};
    }catch{this.risk={status:'UNVERIFIED',at_ms:now};}
    await this.ctx.storage.put('rt:risk',this.risk);this.lastReconcile=now;this.db.prune(now);
  }
  async refreshChain(){
    let labels=[];try{labels=JSON.parse(this.env.KNOWN_WALLETS_JSON||'[]');if(!Array.isArray(labels))labels=[];}catch{}
    const result=await fetchWalletWindow(labels,this.now(),this.net);
    await this.ctx.storage.put('rt:onchain',result);this.lastChain=this.now();
  }
  async alarm(){
    await this.ready;if(!this.config.enabled)return;
    try{
      if(this.socket&&this.now()-this.lastMessage>10000)this.disconnect('NO_FRESH_FEED');
      await this.connect();
      if(this.now()-this.lastReconcile>=60000)await this.refreshEvidence();
      if(this.env.ENABLE_ONCHAIN==='true'&&this.now()-this.lastChain>=300000)await this.refreshChain();
    }finally{if(this.config.enabled)await this.ctx.storage.setAlarm(this.now()+5000);}
  }
  async fetch(request){
    await this.ready;const u=new URL(request.url),path=u.pathname;
    if(path==='/wake'&&request.method==='POST'){if(this.config.enabled)await this.ctx.storage.setAlarm(this.now()+100);return json({enabled:this.config.enabled});}
    if(path==='/status'&&request.method==='GET')return json({version:VERSION,enabled:this.config.enabled,markets:this.config.markets,live_trade_alerts_enabled:false,connection:await this.ctx.storage.get('rt:connection')??{status:'NOT_STARTED'},risk:this.risk,read_only_market_data:true});
    if(path==='/evidence'&&request.method==='GET')return json({version:VERSION,observation_only:true,send_allowed:false,risk:this.risk,windows:this.config.markets.flatMap(m=>[1,5,15,30].map(n=>this.db.summary(m,this.now(),n)))});
    if(path==='/onchain'&&request.method==='GET')return json(await this.ctx.storage.get('rt:onchain')??{status:'NOT_COLLECTED',all_exchange_coverage:false});
    if(path==='/control/stop'&&request.method==='POST'){this.commandId++;this.config.enabled=false;this.disconnect('MANUAL_STOP');await this.ctx.storage.put('rt:config',this.config);await this.ctx.storage.put('rt:connection',{status:'STOPPED',at_ms:this.now()});await this.ctx.storage.deleteAlarm();return json({enabled:false});}
    if(path==='/control/start'&&request.method==='POST'){
      const command=++this.commandId;
      let body;try{body=await request.json();}catch{return json({error:'INVALID_JSON'},400);}
      const markets=body.markets;
      if(!Array.isArray(markets)||markets.length<1||markets.length>20||markets.some(m=>typeof m!=='string'||!/^KRW-[A-Z0-9]+$/.test(m))||new Set(markets).size!==markets.length)return json({error:'INVALID_MARKETS'},400);
      try{const listings=await this.requestJson('https://api.bithumb.com/v1/market/all?isDetails=true');if(!Array.isArray(listings)||markets.some(m=>!listings.some(l=>l.market===m)))return json({error:'MARKET_NOT_LISTED'},400);}catch{return json({error:'LISTING_UNVERIFIED'},503);}
      if(command!==this.commandId)return json({error:'COMMAND_SUPERSEDED'},409);
      this.disconnect('SUBSCRIPTION_CHANGED');this.config={enabled:true,markets};await this.ctx.storage.put('rt:config',this.config);
      if(command!==this.commandId||!this.config.enabled)return json({error:'COMMAND_SUPERSEDED'},409);
      await this.connect();
      if(command!==this.commandId||!this.config.enabled)return json({error:'COMMAND_SUPERSEDED'},409);
      await this.ctx.storage.setAlarm(this.now()+5000);
      return json({enabled:true,connected:Boolean(this.socket),mode:'SHADOW_ONLY',live_trade_alerts_enabled:false});
    }
    if(path==='/telegram/test'&&request.method==='POST'){
      let body;try{body=await request.json();}catch{return json({error:'INVALID_JSON'},400);}
      try{return json(await telegramTest({ALLOW_TELEGRAM_TEST:this.env.ALLOW_TELEGRAM_TEST,TELEGRAM_BOT_TOKEN:this.env.IRYS_RT_TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID:this.env.IRYS_RT_TELEGRAM_CHAT_ID},this.ctx.storage,body.nonce,this.net));}
      catch{return json({status:'TEST_RECEIPT_UNAVAILABLE',automatic_retry_allowed:false},503);}
    }
    return json({error:'NOT_FOUND'},404);
  }
}
