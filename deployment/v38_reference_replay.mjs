/** Reproduce user-provided ONEUSDT chart from official Bitget closed public 5m OHLCV.
 * Uses data up to each replay moment for detection, never future candles.
 * Historical illustration only; no live alert, quote fill, permission or account API.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {v38Detect,v38ParseBitgetCandles} from './v38_continuation.mjs';
const STEP=300000;
const start=Date.parse('2026-11-06T08:30:00Z'),end=Date.parse('2026-11-06T11:45:00Z');
const url='https://api.bitget.com/api/v3/market/history-candles?'+new URLSearchParams({
 category:'USDT-FUTURES',symbol:'ONEUSDT',interval:'5m',endTime:String(end),limit:'100',type:'market'});
const response=await fetch(url,{headers:{accept:'application/json','User-Agent':'IRYS-V38-ONE-read-only-replay'},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('BITGET_HISTORY_HTTP_'+response.status);
const raw=await response.json(),parsed=v38ParseBitgetCandles(raw,Date.now());
if(parsed.status!=='OBSERVED'||parsed.bars.length<50)throw Error('HISTORICAL_SOURCE_INCOMPLETE_'+parsed.reason);
const bars=parsed.bars.filter(b=>b.start_ms<end),all=[],distinct=new Set(),events=[];
for(const b of bars){
 const at=b.start_ms+STEP;
 if(at<start||at>end)continue;
 const result=v38Detect({venue:'bitget',symbol:'ONEUSDT',direction:'LONG',bars,now:at});
 all.push({at_ms:at,status:result.status,reason:result.reason,close:b.close});
 if(result.status!=='EARLY_RECLAIM')continue;
 const id=[result.direction,result.impulse_peak_at_ms].join(':');
 if(distinct.has(id))continue;distinct.add(id);
 const after=bars.filter(x=>x.start_ms>=at),outcomes={};
 for(const h of [5,15,30,60]){
  const stop=at+h*60000,last=after.find(x=>x.start_ms+STEP===stop);
  const path=after.filter(x=>x.start_ms+STEP<=stop);
  const high=path.length?Math.max(...path.map(x=>x.high)):null,low=path.length?Math.min(...path.map(x=>x.low)):null;
  const pct=last?100*(last.close/result.close_reference-1):null;
  outcomes[h]={status:last?'MEASURED_CLOSE':'UNMEASURED',signed_pct:pct,max_favorable_pct:high===null?null:100*(high/result.close_reference-1),
   max_adverse_pct:low===null?null:100*(low/result.close_reference-1),actual_execution_verified:false};
 }
 events.push({at_ms:at,signal:result,outcomes});
}
mkdirSync('v38_review',{recursive:true});
const proof={version:'V38_ONEUSDT_5M_ASOF_REPLAY_V1',symbol:'ONEUSDT',source:'BITGET_OFFICIAL_PUBLIC_V3_HISTORY_CANDLES',
 retrieved_at_utc:new Date().toISOString(),source_url:url,full_source_candle_count:parsed.bars.length,asof_checks:all.length,
 asof_min_ms:start,asof_max_ms:end,candidate_count:events.length,events,inspection:all,
 pullback_low_was_not_known_in_advance:true,detector_saw_only_closed_past_candles:true,
 screenshot_is_context_not_training_label:true,retro_backtest_is_not_prospective_accuracy:true,
 original_live_telegram_sent:false,orders_sent:false,account_fill_verified:false};
writeFileSync('v38_review/ONEUSDT_historical_replay.json',JSON.stringify(proof,null,2));
console.log('V38_ONE_HISTORICAL_REPLAY_SUMMARY',JSON.stringify({candles:parsed.bars.length,checks:all.length,
 candidate_count:events.length,entries:events.map(e=>({at_kst:new Date(e.at_ms+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST',
 price:e.signal.close_reference,prior_high:e.signal.previous_impulse_high,
 risk_reference:e.signal.stop_reference,after_15m:e.outcomes[15].signed_pct,after_60m:e.outcomes[60].signed_pct})),
 no_test_telegram:true,no_trade_permission:true}));
