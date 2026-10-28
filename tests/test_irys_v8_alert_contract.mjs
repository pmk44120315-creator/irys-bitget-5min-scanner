import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSignal,runMorningAi,shouldRunExpensiveAi} from '../deployment/IRYS_V8_PROOF_GATED_WORKER.mjs';

const NOW=Date.parse('2026-10-28T04:00:00Z');
function valid(){
  return {
    venue:'bithumb', market:'KRW-TEST', direction:'SUSTAINED_BUY_OBSERVATION',
    observation_only:true,risk_status:'NO_OFFICIAL_WARNING_AT_COLLECTION',
    official_warning_checked:true,full_cvd_verified:false,orderbook_absorption_verified:false,
    timestamp_utc:new Date(NOW-90_000).toISOString(),
    price_krw:100,
    volume_ratio_5m:3.8,
    prior_55m_quiet:{sample_count:55,range_pct:2.2,drift_pct:.4},
    windows:{
      '5m':{quote_krw:35_000_000,price_change_pct:.7,upper_wick_ratio:.12},
      '15m':{quote_krw:95_000_000,price_change_pct:1.4,upper_wick_ratio:.16},
      '60m':{price_change_pct:2.6}
    },
    retrace_from_15m_high_pct:.2,
    spot_taker_sample_2m:{
      coverage:true,buy_share:.72,early_buy_share:.67,recent_buy_share:.69,
      net_buy_krw:18_000_000,recent_net_buy_krw:7_000_000,count:85
    },
    verification:{
      independent_5m_checks:4,elapsed_minutes:15,
      continuous_orderbook_absorption_verified:false,
      all_exchange_inout_verified:false,token_unlock_verified:false,
      alert_classification:'SUSTAINED_EARLY_SPOT_OBSERVATION_ONLY',
      book_snapshots:Array.from({length:4},(_,i)=>({
        timestamp_ms:NOW-(20-i*5)*60_000,spread_pct:.16,bid_ask_top5_ratio:1.3
      })),
      candle_reconciled_15m_spot_taker:{
        verified:true,marketwide_cvd_verified:false,candle_relative_error:.0013,
        start_ms:NOW-15*60_000,end_ms:NOW,
        blocks:[{trades:47,net_buy_krw:6_000_000,buy_share:.68},
                {trades:31,net_buy_krw:7_000_000,buy_share:.7},
                {trades:28,net_buy_krw:5_000_000,buy_share:.67}]
      }
    }
  };
}
test('no persisted, risk-checked sustained candidate means zero costly AI calls',()=>{
  assert.equal(shouldRunExpensiveAi('PASS',{},[]),false);
  assert.equal(shouldRunExpensiveAi('PASS',{},null),false);
  assert.equal(shouldRunExpensiveAi('PARTIAL',{},[{}]),false);
  assert.equal(shouldRunExpensiveAi('PASS',null,[{}]),false);
  assert.equal(shouldRunExpensiveAi('PASS',{},[valid()]),true);
});
test('verified 4x5m plus reconciled 15m sustained flow may pass a read-only observation',()=>{
  assert.equal(validateSignal(valid(),NOW),true);
});
test('old 2-minute BUY_OBSERVATION and no 15m proof cannot generate alerts',()=>{
  const old=valid();old.direction='BUY_OBSERVATION';delete old.verification;
  assert.equal(validateSignal(old,NOW),false);
});
test('AI model output cannot create a legacy direct telegram signal with a weak data contract',()=>{
  for(const key of ['candle_reconciled_15m_spot_taker','book_snapshots','alert_classification']){
    const x=valid();delete x.verification[key];assert.equal(validateSignal(x,NOW),false,key);
  }
});
test('missing closed candle, bad CVD interval, CVD mismatch and poor book all block',()=>{
  const cases=[
    x=>{x.verification.candle_reconciled_15m_spot_taker.verified=false;},
    x=>{x.verification.candle_reconciled_15m_spot_taker.blocks[1].net_buy_krw=-1;},
    x=>{x.verification.candle_reconciled_15m_spot_taker.candle_relative_error=.01;},
    x=>{x.verification.book_snapshots[1].spread_pct=1.1;},
    x=>{x.verification.independent_5m_checks=3;},
    x=>{x.verification.all_exchange_inout_verified=true;},
    x=>{x.verification.book_snapshots[2].timestamp_ms=x.verification.book_snapshots[1].timestamp_ms;},
    x=>{x.verification.candle_reconciled_15m_spot_taker.blocks[1].trades=3;},
    x=>{x.verification.candle_reconciled_15m_spot_taker.candle_relative_error=-.01;},
    x=>{x.verification.candle_reconciled_15m_spot_taker.end_ms-=60_000;}
  ];
  for(const bad of cases){const x=valid();bad(x);assert.equal(validateSignal(x,NOW),false);}
});
test('stale, opposite trend and risk warnings block even with positive proof',()=>{
  const cases=[
    x=>{x.timestamp_utc=new Date(NOW-11*60_000).toISOString();},
    x=>{x.windows['5m'].price_change_pct=-.6;},
    x=>{x.risk_status='OFFICIAL_WARNING';},
    x=>{x.spot_taker_sample_2m.recent_net_buy_krw=-2;}
  ];
  for(const bad of cases){const x=valid();bad(x);assert.equal(validateSignal(x,NOW),false);}
});
test('Workers AI directional UP may analyze but cannot send Telegram without independently implemented gate',async()=>{
  const saved=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>new Response(JSON.stringify([]),{status:200,headers:{'content-type':'application/json'}});
  try{
    const src={snap:{watchlist:[],early_pool:[{
      venue:'bitget',asset_identity:'VERIFIED_CRYPTO',
      symbol:'ABCUSDT',baseCoin:'ABC',early_volume_rank:25,
      funding_rate:.0001,oi:{status:'OK',change_pct_from_previous_run:1,elapsed_min_since_previous_snapshot:5},
      windows:{
        '1m':{price_change_pct:.14},
        '5m':{price_change_pct:.62,quote_turnover:95_000,adjacent_ratio:3,upper_wick_ratio:.11,coverage:1,close:1},
        '15m':{adjacent_ratio:2,coverage:1,price_change_pct:1.2},
        '60m':{price_change_pct:1.4}
      }
    }]}};
    const env={AI:{run:async()=>{calls++;return {response:JSON.stringify({decisions:[{
      venue:'bitget',symbol:'ABCUSDT',signal:'UP',strength:'STRONG',
      reason_ko:'모델의 과신 예시',counter_ko:'현물 검증 없음'
    }]})};}}};
    const result=await runMorningAi(env,src,{},NOW);
    assert.equal(calls,1);
    assert.equal(result.status,'AI_REVIEW_ONLY_ALERTS_SUPPRESSED');
    assert.equal(result.model_decisions,1);
    assert.equal(result.suppressed_directional_model_decisions,1);
    assert.equal(result.alerts_sent,0);
  }finally{globalThis.fetch=saved;}
});
