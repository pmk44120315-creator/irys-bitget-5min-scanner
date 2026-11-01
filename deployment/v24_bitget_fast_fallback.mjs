/** Read GitHub's actually recorded Bitget V2/V3 public data ONLY when
 * Cloudflare's direct Bitget official API returns HTTP 403.
 * Never fabricate a current Bitget price or a confirmed future direction.
 */
const V24_FAST_URL='https://raw.githubusercontent.com/pmk44120315-creator/irys-bitget-5min-scanner/main/data/v24_bitget_fast_latest.json';
function v24FastFallback(doc,now){
 const unavailable=(reason)=>({status:reason,age_min:null,candidates:[],observed:0});
 if(doc?.version!=='IRYS_V24_BITGET_GITHUB_FAST_PUBLIC_V1'||
    doc.venue!=='bitget'||doc.source_identity!=='V2_ACTIVE_PERPETUAL_AND_V3_VERIFIED_CRYPTO'||
    doc.not_full_orderbook_or_marketwide_cvd!==true||
    doc.not_profitable_future_direction_proof!==true||
    doc.trade_data_included!==false||
    !Array.isArray(doc.candidates)||
    !Number.isInteger(doc.active_verified_crypto_count)||doc.active_verified_crypto_count<100||
    !Number.isInteger(doc.actual_official_tickers_count)||doc.actual_official_tickers_count<100){
   return unavailable('UNTRUSTED_SOURCE_SCHEMA');
 }
 if(doc.status!=='MARKET_COMPARISON_PASS'){
   return unavailable('BASELINE_WARMUP_NOT_READY');
 }
 const at=v23N(doc.at_ms);
 if(at===null||!Number.isSafeInteger(at)||Date.parse(doc.at_utc||'')!==at||
    at>now+60000||now-at>8*60000||now-at<0)return unavailable('STALE_FAST_SOURCE');
 const bySym=new Map();
 for(const c of doc.candidates.slice(0,20)){
   if(!v23Code(c?.symbol,'bitget')||c.venue!=='bitget'||
      c.identity_verified_v3_crypto!==true||
      c.active_contract_verified_v2!==true||
      c.price_only_not_future_direction!==true||
      c.source!=='BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST')continue;
   const p=v23N(c.price),delta=v23N(c.move_pct),spread=v23N(c.spread_pct),
      priceAt=v23N(c.price_timestamp_ms),rank=v23N(c.priority),
      quote24=v23N(c.quote_24h_usdt);
   if(p===null||p<=0||delta===null||delta<.7||
      spread===null||spread<0||spread>1.5||
      priceAt===null||!Number.isSafeInteger(priceAt)||
      priceAt>at+60000||at-priceAt>120000||rank===null)continue;
   const obs={venue:'bitget',symbol:c.symbol,price:p,
     side_observed:'UP',move_pct:delta,spread_pct:spread,
     priority:rank,price_timestamp_ms:priceAt,quote_24h_usdt:quote24,
     price_acceleration_pct:v23N(c.price_acceleration_pct),
     turnover5_est_krw:null,turnover_ratio:null,warning_checked:true,
     identity_verified:true,price_only_not_future_direction:true,
     source:'BITGET_OFFICIAL_GITHUB_RUNNER_PUBLIC_FAST',
     source_age_min:Number(((now-at)/60000).toFixed(2)),
     direct_current_Bitget_API_verified:false};
   if(!bySym.has(c.symbol))bySym.set(c.symbol,obs);
 }
 const rows=[...bySym.values()].sort((a,b)=>b.priority-a.priority);
 return {status:'PASS',age_min:Number(((now-at)/60000).toFixed(2)),
   observed:doc.actual_official_tickers_count,candidates:rows};
}

export {v24FastFallback,V24_FAST_URL};
