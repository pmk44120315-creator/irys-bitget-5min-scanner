/** V23 direct-first rapid market discovery (observations ONLY, not directional orders).
 *
 * One Cloudflare 5-minute Cron polls exchange public ticker feeds concurrently.
 * Unlike legacy 2-4 minute GitHub scans, a current trade/price change is
 * detected without waiting for the historical full-universe OI/CVD collector.
 * Uses prior actual observations stored in the ORIGINAL IRYS_KV state.
 * No orders, accounts, WebSocket leases, secrets, new cron or AI dependence.
 */
const V23_VER='IRYS_V23_1_VENUE_ISOLATED_SCOUT_V1';
const V23_MAX_HOURLY_NOTICES=2;  // transport anti-spam, never a candidate selection gate
const V23_NOTICE_COOLDOWN_MS=90*60000;
const V23_RECENT_MARKET_MS=150000;
const V23_QUOTE_GAP_MIN_MS=2.8*60000;
const V23_QUOTE_GAP_MAX_MS=9*60000;
const V23_HOUR_MS=3600000;
function v23N(x){if(x===null||x===undefined||x===''||typeof x==='boolean')return null;
  const v=Number(x);return Number.isFinite(v)?v:null;}
function v23Day(at){return new Date(at+9*3600000).toISOString().slice(0,10);}
function v23Code(sym,venue){return typeof sym==='string' &&
  (venue==='bithumb'?/^KRW-[A-Z0-9]{2,25}$/:/^[A-Z0-9]{2,25}USDT$/).test(sym);}
function v23Pct(now,old){return now>0&&old>0?100*(now/old-1):null;}
function v23Round(v,d=3){return v===null?null:Number(v.toFixed(d));}
function v23Fresh(ts,now){return Number.isFinite(ts)&&ts<=now+60000&&now-ts<=V23_RECENT_MARKET_MS;}
function v23SpotTradeMs(row,now){
  // On the REAL Bithumb /v1/ticker feed, trade_timestamp and timestamp
  // currently encode a Korea-local wall clock as if UTC: +9h vs actual UTC.
  // Its 'trade_date'+'trade_time' fields themselves are explicitly UTC.
  // Construct the actual UTC instant from those fields, never blindly
  // subtract nine hours from every API timestamp.
  const d=row?.trade_date,t=row?.trade_time;
  const date=typeof d==='string'?d:'',time=typeof t==='string'?t:'';
  if(/^\d{8}$/.test(date)&&/^\d{6}$/.test(time)){
    const iso=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+
      'T'+time.slice(0,2)+':'+time.slice(2,4)+':'+time.slice(4,6)+'Z';
    const parsed=Date.parse(iso);
    return Number.isFinite(parsed)?parsed:null;
  }
  // A source lacking canonical UTC fields is accepted ONLY when its raw
  // timestamp is plausible against the actual receiving UTC clock.
  const raw=v23N(row?.trade_timestamp??row?.timestamp);
  return raw!==null&&v23Fresh(raw,now)?raw:null;
}
function v23TickerBundle(old,snapshot,now,availability={bithumb:true,bitget:true}){
  const day=v23Day(now),spotReady=availability.bithumb!==false,
    futuresReady=availability.bitget!==false;
  const spotOld=v23N(old?.spot_at_ms??old?.at_ms),futuresOld=v23N(old?.futures_at_ms??old?.at_ms);
  const spotElapsed=spotOld===null?null:now-spotOld;
  const futuresElapsed=futuresOld===null?null:now-futuresOld;
  const spotComparable=(spotReady&&spotElapsed!==null&&spotElapsed>=V23_QUOTE_GAP_MIN_MS&&
    spotElapsed<=V23_QUOTE_GAP_MAX_MS);
  const futuresComparable=(futuresReady&&futuresElapsed!==null&&
    futuresElapsed>=V23_QUOTE_GAP_MIN_MS&&futuresElapsed<=V23_QUOTE_GAP_MAX_MS);
  const comparable=spotComparable||futuresComparable;
  const elapsed=spotComparable?spotElapsed:futuresComparable?futuresElapsed:null;
  // A venue's failed source preserves both its prior book AND its true clock.
  // Do not misreport 10-minute recovered data as a 5-minute price move.
  const baseline={
    at_ms:now,kst_day:day,
    spot_at_ms:spotReady?now:spotOld,
    spot_kst_day:spotReady?day:(old?.spot_kst_day??old?.kst_day??null),
    futures_at_ms:futuresReady?now:futuresOld,
    spot:spotReady?{}:{...(old?.spot||{})},
    futures:futuresReady?{}:{...(old?.futures||{})}
  };
  const out={status:'WARMUP_OR_GAP',elapsed_min:elapsed===null?null:v23Round(elapsed/60000,2),
    compared:0,positive:0,negative:0,listed_spot:0,verified_futures:0,
    warnings_filtered:0,stale_filtered:0,candidates:[],all:[],
    venue_availability:{bithumb:spotReady,bitget:futuresReady},
    compared_venues:[],partial_venue_outage:!spotReady||!futuresReady};
  const activeMarkets=new Set((snapshot.bithumb_markets||[])
    .filter(x=>v23Code(x?.market,'bithumb')&&x.market_warning==='NONE')
    .map(x=>x.market));
  const risk=new Set((snapshot.bithumb_warnings||[]).map(x=>x?.market));
  for(const row of (spotReady?snapshot.bithumb_tickers:[])||[]){
    const sym=row?.market,price=v23N(row?.trade_price),
      cumulative=v23N(row?.acc_trade_price),stamp=v23SpotTradeMs(row,now);
    if(!v23Code(sym,'bithumb')||price===null||price<=0||cumulative===null||
       cumulative<0)continue;
    const pre=old?.spot?.[sym],lastPrice=Array.isArray(pre)?v23N(pre[0]):null,
      lastAcc=Array.isArray(pre)?v23N(pre[1]):null,oldEma=Array.isArray(pre)?v23N(pre[2]):null,
      oldMove=Array.isArray(pre)?v23N(pre[3]):null;
    const validTurn=(spotComparable&&(old?.spot_kst_day??old?.kst_day)===day&&lastAcc!==null&&cumulative>=lastAcc);
    const turn=validTurn?(cumulative-lastAcc)*300000/spotElapsed:null;
    const ema=turn!==null?(oldEma!==null&&oldEma>0?.25*turn+.75*oldEma:turn):oldEma;
    let change=lastPrice!==null&&spotComparable?v23Pct(price,lastPrice):null;
    baseline.spot[sym]=[price,cumulative,ema,v23Round(change??oldMove??0,5)];
    if(!activeMarkets.has(sym)||risk.has(sym)||row.is_trading_suspended===true||
        row.delisting_date||row.market_state&&row.market_state!=='ACTIVE'){
      out.warnings_filtered++;continue;
    }
    out.listed_spot++;
    if(!v23Fresh(stamp,now)){out.stale_filtered++;continue;}
    if(!spotComparable||change===null||turn===null)continue;
    out.compared++;
    const turnoverRatio=oldEma!==null&&oldEma>0?turn/oldEma:null;
    const accel=oldMove===null?null:change-oldMove;
    // Relative prior turnover is a priority feature, NOT a fixed 30m KRW cutoff.
    const score=(Math.abs(change)*1.5+
      Math.min(5,Math.log1p(Math.max(0,turn)/10_000_000))+
      (turnoverRatio===null?0:Math.min(4,Math.log1p(Math.max(0,turnoverRatio))))+
      .3*Math.max(-3,Math.min(3,accel??0)));
    const c={venue:'bithumb',symbol:sym,side_observed:change>=0?'UP':'DOWN',
      price,move_pct:v23Round(change),turnover5_est_krw:Math.round(turn),
      turnover_ratio:turnoverRatio===null?null:v23Round(turnoverRatio,2),
      price_acceleration_pct:accel===null?null:v23Round(accel),
      quote_24h_usdt:null,spread_pct:null,priority:v23Round(score),
      price_timestamp_ms:stamp,warning_checked:true,identity_verified:true,
      price_only_not_future_direction:true};
    out.all.push(c);
    if(change>0)out.positive++;else if(change<0)out.negative++;
  }
  const validCrypto=new Set((snapshot.bitget_instruments||[]).filter(x=>
    x&&String(x.symbolType||'').toLowerCase()==='crypto'&&
    String(x.instrumentType||'').toLowerCase()==='crypto'&&
    v23Code(x.symbol,'bitget')).map(x=>x.symbol));
  for(const row of (futuresReady?snapshot.bitget_tickers:[])||[]){
    const sym=row?.symbol,price=v23N(row?.lastPr),stamp=v23N(row?.ts);
    if(!v23Code(sym,'bitget')||price===null||price<=0||!validCrypto.has(sym))
      continue;
    const p=old?.futures?.[sym],prior=Array.isArray(p)?v23N(p[0]):null,
      pastMove=Array.isArray(p)?v23N(p[1]):null;
    const change=futuresComparable&&prior!==null?v23Pct(price,prior):null;
    baseline.futures[sym]=[price,v23Round(change??pastMove??0,5)];
    out.verified_futures++;
    if(!v23Fresh(stamp,now)){out.stale_filtered++;continue;}
    if(change===null)continue;
    const bid=v23N(row?.bidPr),ask=v23N(row?.askPr);
    const spread=bid!==null&&ask!==null&&bid>0&&ask>=bid?100*(ask/bid-1):null;
    if(spread===null||spread>1.5)continue; // Non-tradeable quoted books are not an early trade opportunity
    const acceleration=pastMove===null?null:change-pastMove;
    const volume24=v23N(row?.usdtVolume);
    const score=1.7*Math.abs(change)+.4*Math.log1p(Math.max(0,volume24??0)/100000)+
       .35*Math.max(-3,Math.min(3,acceleration??0))-.7*spread;
    out.compared++;
    const c={venue:'bitget',symbol:sym,side_observed:change>=0?'UP':'DOWN',
      price,move_pct:v23Round(change),turnover5_est_krw:null,turnover_ratio:null,
      price_acceleration_pct:acceleration===null?null:v23Round(acceleration),
      quote_24h_usdt:volume24,spread_pct:v23Round(spread,4),
      priority:v23Round(score),price_timestamp_ms:stamp,
      warning_checked:true,identity_verified:true,price_only_not_future_direction:true};
    out.all.push(c);
    if(change>0)out.positive++;else if(change<0)out.negative++;
  }
  out.status=comparable?'MARKET_COMPARISON_PASS':'WARMUP_OR_GAP';
  if(spotComparable)out.compared_venues.push('bithumb');
  if(futuresComparable)out.compared_venues.push('bitget');
  // No fixed trading turnover floor or 20-candle streak. It is just a market
  // observation, never a verified BUY/LONG/SHORT future prediction.
  out.all.sort((a,b)=>b.priority-a.priority);
  out.candidates=out.all.filter(x=>x.move_pct>=.70 &&
    (x.venue==='bitget'||x.turnover5_est_krw>0)).slice(0,12);
  return {next:baseline,observation:out};
}
function v23PlainNumber(n,d=2){return n===null||n===undefined||!Number.isFinite(n)?
  '미확인':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}).format(n);}
function v23Message(row,taker,now){
 const kst=x=>new Date(x+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
 const isSpot=row.venue==='bithumb';
 const body=(isSpot?'빗썸 KRW 현물 ':'비트겟 USDT 선물 ')+row.symbol+
   ' · '+kst(now)+'\n현재 관측가 '+v23PlainNumber(row.price,8)+(isSpot?'원':' USDT')+
   '\n최근 실시간 시세 비교 상승 '+v23PlainNumber(row.move_pct,2)+'%'+
   '\n이전 시점 대비 상승속도 변화 '+v23PlainNumber(row.price_acceleration_pct,2)+'%p'+
   (isSpot?'\n5분 환산 실제 거래대금 '+v23PlainNumber(row.turnover5_est_krw,0)+
     '원 · 이전 기준대비 '+v23PlainNumber(row.turnover_ratio,2)+'배':
     '\n호가 스프레드 '+v23PlainNumber(row.spread_pct,3)+'% · 24시간 거래대금 '+
       v23PlainNumber(row.quote_24h_usdt,0)+' USDT (5분 거래대금 아님)');
 let extra='\n최근 실제 체결 방향: 자료 부족';
 if(taker?.status==='SAMPLE_AVAILABLE'){
   extra='\n표본 공격매수 비중 '+v23PlainNumber(taker.buy_share*100,1)+
      '% · 최근 표본 '+taker.trades+'건'+
      '\n※ 일부 체결 표본이며 전체 CVD·세력 매집 증거는 아님';
 }
 return '🔎 [V23 빠른 급등 초입 포착 · 방향 예측 아님]\n'+body+extra+
  '\n⚠️ 현재 거래소 가격·체결 관측입니다. 매수·롱·숏 진입 신호나 미래 수익 보장은 아닙니다. 자동매매 없음.';
}
function v23SampleTaker(raw,venue,now){
 const rows=venue==='bitget'?(raw?.code==='00000'?raw.data:raw):raw;
 if(!Array.isArray(rows))return {status:'NO_PUBLIC_SAMPLE'};
 let buy=0,sell=0,seen=new Set(),count=0,latest=0;
 for(const x of rows){
   const at=v23N(venue==='bitget'?x.ts:(x.timestamp??x.trade_timestamp)),
      price=v23N(venue==='bitget'?x.price:x.trade_price),
      size=v23N(venue==='bitget'?x.size:x.trade_volume),
      side=String(venue==='bitget'?x.side:x.ask_bid).toUpperCase();
   if(at===null||at<now-120000||at>now+60000||price===null||price<=0||
      size===null||size<=0||!['BUY','SELL','BID','ASK'].includes(side))continue;
   const id=String(x.tradeId??x.sequential_id??at+':'+side+':'+price+':'+size);
   if(seen.has(id))continue;seen.add(id);count++;latest=Math.max(latest,at);
   if(side==='BUY'||side==='BID')buy+=price*size;else sell+=price*size;
 }
 return count>0&&v23Fresh(latest,now)?{status:'SAMPLE_AVAILABLE',
   buy_share:buy/(buy+sell),trades:count,net_quote:buy-sell,marketwide:false}:
   {status:'NO_FRESH_PUBLIC_SAMPLE'};
}
async function v23ReadFeeds(read){
 const specs=[
   ['bithumb_markets','https://api.bithumb.com/v1/market/all?isDetails=true'],
   ['bithumb_warnings','https://api.bithumb.com/v1/market/virtual_asset_warning'],
   ['bitget_instruments','https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES'],
   ['bitget_tickers','https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES']
 ];
 const r=await Promise.allSettled(specs.map(([,url])=>read(url)));
 const feeds={},failures=[];
 for(let i=0;i<specs.length;i++){
   const [name]=specs[i],x=r[i];
   let body=x.status==='fulfilled'?x.value:null;
   if(name.startsWith('bitget')&&body?.code==='00000')body=body.data;
   if(!Array.isArray(body)){
    feeds[name]=[];
    const reason=x.status==='rejected'?
      String(x.reason?.message||'READ_EXCEPTION').match(/HTTP_[0-9]{3}|AbortError|TimeoutError|TypeError/)?.[0]||'READ_EXCEPTION':
      'INVALID_PUBLIC_RESPONSE';
    failures.push(name+'_FAILED_'+reason);
  }
   else feeds[name]=body;
 }
 if(feeds.bithumb_markets.length>=100){
   const krw=feeds.bithumb_markets.filter(x=>v23Code(x?.market,'bithumb'));
   const segments=[];
   for(let i=0;i<krw.length;i+=180){
     const markets=krw.slice(i,i+180).map(x=>x.market).join(',');
     segments.push(read('https://api.bithumb.com/v1/ticker?markets='+encodeURIComponent(markets)));
   }
   const quotes=await Promise.allSettled(segments);
   feeds.bithumb_tickers=quotes.flatMap((x,i)=>x.status==='fulfilled'&&
     Array.isArray(x.value)?x.value:[]);
   if(feeds.bithumb_tickers.length<krw.length*.95)failures.push('BITHUMB_TICKER_COVERAGE_LOW');
 }else{
   feeds.bithumb_tickers=[];failures.push('BITHUMB_LISTING_UNAVAILABLE');
 }
 if(feeds.bitget_instruments.length<100||feeds.bitget_tickers.length<100)
   failures.push('BITGET_UNIVERSE_UNAVAILABLE');
 const bithumbOk=feeds.bithumb_markets.length>=100 &&
   Array.isArray(feeds.bithumb_warnings) &&
   !failures.some(x=>x.startsWith('bithumb_')||x.startsWith('BITHUMB_'));
 const bitgetOk=feeds.bitget_instruments.length>=100 &&
   feeds.bitget_tickers.length>=100 &&
   !failures.some(x=>x.startsWith('bitget_')||x.startsWith('BITGET_'));
 return {feeds,failures,availability:{bithumb:bithumbOk,bitget:bitgetOk}};
}
async function v23ScoutTick(env,state,now,options={}){
 const output={version:V23_VER,status:'INITIAL',market_status:'UNKNOWN',observed:0,
  candidate_count:0,sent:0,chosen:[],reasons:[],send_error:null,read_errors:[],
  elapsed_min:null,actual_taker:null,original_directional_channels_untouched:true};
 const read=options.read||requestJson;
 try{
   const {feeds,failures,availability}=await v23ReadFeeds(read);
   output.read_errors=failures;
   output.venue_availability=availability;
   // A single exchange outage must NOT disable the other exchange.
   // Both failed = do not mutate either venue's previous valid baseline.
   if(!availability.bithumb&&!availability.bitget){
     output.status='BOTH_VENUES_UNAVAILABLE_NO_BASELINE_CHANGE';
     output.market_status='UNAVAILABLE';return output;
   }
   const result=v23TickerBundle(state.v23ScoutTape||{},feeds,now,availability);
   state.v23ScoutTape=result.next;
   output.market_status=result.observation.status;
   output.compared_venues=result.observation.compared_venues;
   output.partial_venue_outage=result.observation.partial_venue_outage;
   output.elapsed_min=result.observation.elapsed_min;
   output.observed=result.observation.compared;
   output.candidate_count=result.observation.candidates.length;
   output.chosen=result.observation.candidates.slice(0,3).map(c=>({
      venue:c.venue,symbol:c.symbol,move_pct:c.move_pct,
      observed_direction:c.side_observed,has_future_direction_proof:false}));
   if(result.observation.status!=='MARKET_COMPARISON_PASS'){
     output.status='BASELINE_WARMING_OR_TIME_GAP';return output;
   }
   if(!result.observation.candidates.length){
     output.status='NO_SIGNIFICANT_FIRST_IMPULSE';return output;
   }
   const hour=Math.floor(now/V23_HOUR_MS);
   state.v23ScoutHourly=state.v23ScoutHourly?.hour===hour?
      state.v23ScoutHourly:{hour,count:0};
   if(state.v23ScoutHourly.count>=V23_MAX_HOURLY_NOTICES){
      output.status='DELIVERY_RATE_PACED';
      return output;
   }
   const last=state.v23ScoutNotices||{};
   const choices=result.observation.candidates.filter(c=>
     now-(v23N(last[c.venue+':'+c.symbol])||0)>=V23_NOTICE_COOLDOWN_MS);
   if(!choices.length){output.status='DUPLICATE_EPISODE_PACED';return output;}
   // Only one information-first notice per scan. This is not an entry signal.
   const target=choices[0];
   const sampleUrl=target.venue==='bitget'?
     'https://api.bitget.com/api/v2/mix/market/fills?symbol='+encodeURIComponent(target.symbol)+
       '&productType=USDT-FUTURES&limit=100':
     'https://api.bithumb.com/v1/trades/ticks?market='+encodeURIComponent(target.symbol)+'&count=500';
   let sample={status:'NO_FRESH_PUBLIC_SAMPLE'};
   try{sample=v23SampleTaker(await read(sampleUrl),target.venue,now);}
   catch(e){output.reasons.push('TAKER_SAMPLE_UNAVAILABLE');}
   output.actual_taker={status:sample.status,
     buy_share:sample.status==='SAMPLE_AVAILABLE'?v23Round(sample.buy_share,4):null,
     sampled_trades:sample.trades||null};
   // Mixed/opposite public takers are important information but cannot make
   // an UP movement into a verified future BUY/LONG forecast.
   if(sample.status==='SAMPLE_AVAILABLE'&&sample.buy_share<.40){
      output.reasons.push('PRICE_UP_WITH_RECENT_AGGRESSIVE_SELLING');
   }
   if(options.sendEnabled===false){
     output.status='SHADOW_NO_DELIVERY';
     return output;
   }
   const send=options.send||telegram;
   try{
     const ack=await send(env,v23Message(target,sample,now));
     if(!ack||!Number.isSafeInteger(ack.message_id))
       throw Error('TELEGRAM_API_ACK_MISSING_MESSAGE_ID');
     last[target.venue+':'+target.symbol]=now;
     state.v23ScoutNotices=last;
     state.v23ScoutHourly.count++;
     const rc=options.receipt||recordReceipt;
     const row=rc(state,'V23_DIRECT_FAST_MARKET_WATCH',
        target.symbol,now,ack);
     if(options.persistReceipt){
       row.kv_receipt_persisted=await options.persistReceipt(env,row,now);
     }else if(typeof persistReceiptEvent==='function'){
       row.kv_receipt_persisted=await persistReceiptEvent(env,row,now);
     }
     output.sent=1;output.status='TELEGRAM_API_ACK';
     output.sent_symbol=target.symbol;
     output.sent_venue=target.venue;
     output.message_id=ack.message_id;
   }catch(e){
     output.send_error=String(e?.message||e).slice(0,120);
     output.status='TELEGRAM_SEND_NOT_VERIFIED';
   }
   return output;
 }catch(e){
   output.status='DIRECT_SCOUT_EXCEPTION';
   output.send_error=String(e?.message||e).slice(0,120);
   return output;
 }
}
export {v23TickerBundle,v23SpotTradeMs,v23ReadFeeds,v23SampleTaker,v23Message,v23ScoutTick,V23_VER};
