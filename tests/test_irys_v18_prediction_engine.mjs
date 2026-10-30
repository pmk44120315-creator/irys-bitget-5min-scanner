import test from 'node:test';
import assert from 'node:assert/strict';
import {marketFeaturesV18,forecastV18,FEATURE_ORDER_V18} from '../research/v18_prediction_engine.mjs';
import {spotFeaturesV18,spotScoreV18,SPOT_FEATURES_V18} from '../research/v18_spot_prediction_engine.mjs';
const finish=Date.parse('2026-10-30T06:55:00Z');
const end=finish-60000;
const src={asset_identity:'VERIFIED_CRYPTO',venue:'bitget',symbol:'ALTUSDT',
 oi:{change_pct_from_previous_run:.4},funding_rate:.00005,
 windows:{end_utc_ms:end,
  '1m':{price_change_pct:.05},
  '5m':{open:1.5,close:1.55,high:1.56,low:1.49,coverage:1,
        price_change_pct:3.333,adjacent_ratio:2,quote_turnover:40000,
        upper_wick_ratio:.1},
  '15m':{open:1.43,close:1.55,high:1.57,low:1.4,price_change_pct:8.4,
        adjacent_ratio:1.5,upper_wick_ratio:.25},
  '60m':{price_change_pct:5.2}}};
const flow={symbol:'ALTUSDT',price_context_end_ms:end,
 price_context_status:'ALIGNED_REAL_OFFICIAL_1M_CONTEXT',
 taker_flow_15m:{verified:true},
 recent5_pressure_shift_research:{status:'REAL_15M_RECONCILED_RECENT5_VS_PRIOR10',
  price_time_alignment_verified:true,recent_5m_buy_share:.63,
  buy_share_delta:.12,recent_5m_net_taker_usdt:12500,
  recent_5m_trades:125,recent_flow_price_same_sign:true}};
test('full 29-feature vector from ACTUAL input schema; no returns from future',()=>{
 const a=marketFeaturesV18(src,flow,finish);
 assert.equal(a.status,'READY_RESEARCH_FEATURES');
 assert.equal(a.vector.length,FEATURE_ORDER_V18.length);
 assert.equal(a.evidence.verified_recent5_taker,true);
 assert.equal(a.evidence.future_fields_used,false);
 const injected=structuredClone(src);
 injected.future_15m_return_pct=-99;
 injected.future_price=0.001;
 injected.results={correct:false};
 assert.deepEqual(marketFeaturesV18(injected,flow,finish).vector,a.vector);
});
test('missing/unaligned venue taker is a feature missingness, not invented CVD',()=>{
 const a=marketFeaturesV18(src,{...flow,price_context_end_ms:end+10*60000},finish);
 assert.equal(a.evidence.verified_recent5_taker,false);
 assert.equal(a.vector[FEATURE_ORDER_V18.indexOf('verified_recent5_flow_available')],0);
 assert.equal(a.vector[FEATURE_ORDER_V18.indexOf('verified_recent5_taker_bias')],0);
});
test('source candle later than model invocation time must be rejected',()=>{
 assert.equal(marketFeaturesV18({...src,windows:{...src.windows,end_utc_ms:finish+60000}},
 flow,finish).status,'CAUSAL_SNAPSHOT_CLOCK_INVALID');
});
test('unverified asset or missing price cannot produce predictive score',()=>{
 assert.equal(marketFeaturesV18({...src,asset_identity:'UNKNOWN'},flow,finish).vector,null);
 assert.equal(marketFeaturesV18({...src,windows:{...src.windows,'5m':{close:0,coverage:1}}},flow,finish).vector,null);
});
test('independent model has fixed feature order and does not claim calibrated accuracy',()=>{
 const feature=marketFeaturesV18(src,flow,finish).vector;
 const m={schema:'IRYS_V18_CAUSAL_LOGISTIC_V1',feature_order:FEATURE_ORDER_V18,
  weights:FEATURE_ORDER_V18.map(()=>0),intercept:0,horizon_min:15};
 const r=forecastV18(m,feature);
 assert.equal(r.score_up,.5);
 assert.equal(r.verified_accuracy,null);
 assert.throws(()=>forecastV18({...m,feature_order:FEATURE_ORDER_V18.slice(1)},feature),/SCHEMA/);
});
test('Bithumb spot model uses separate stable feature schema and no futures weights',()=>{
 const seed={market:'KRW-ALT',price_krw:120,observed_5m_price_change_pct:1.2,
  five_minute_equivalent_turnover_krw:45000000,
  five_minute_prior_ema_krw:14000000,review_priority_score:.4};
 const z=spotFeaturesV18(seed);
 assert.equal(z.vector.length,SPOT_FEATURES_V18.length);
 assert.equal(z.evidence.no_futures_weights,true);
 const m={schema:'IRYS_V18_SPOT_LOGISTIC_V1',
  feature_order:SPOT_FEATURES_V18,weights:SPOT_FEATURES_V18.map(()=>0),
  intercept:0,horizon_min:15};
 assert.equal(spotScoreV18(m,z.vector).score_buy,.5);
 assert.throws(()=>spotScoreV18({...m,schema:'IRYS_V18_CAUSAL_LOGISTIC_V1'},z.vector));
});

test('continuation-vs-reversal learns both directions and removes global SHORT-only bias',()=>{
 const f=marketFeaturesV18(src,flow,finish).vector;
 const base={schema:'IRYS_V18_CAUSAL_LOGISTIC_V1',feature_order:FEATURE_ORDER_V18,
  weights:FEATURE_ORDER_V18.map(()=>0),intercept:Math.log(4),
  horizon_min:15,target_mode:'CONTINUATION_VS_REVERSAL'};
 const up=forecastV18(base,f);
 assert.ok(up.score_up>.5);
 const negative=f.slice();negative[FEATURE_ORDER_V18.indexOf('ret5m')]=-1;
 const down=forecastV18(base,negative);
 assert.ok(down.score_down>.5);
 assert.equal(up.verified_accuracy,null);
});
test('spot continuation-prediction direction flips when historical momentum is downward',()=>{
 const seed={market:'KRW-ALT',price_krw:120,observed_5m_price_change_pct:-1.2,
  five_minute_equivalent_turnover_krw:45000000,
  five_minute_prior_ema_krw:14000000};
 const x=spotFeaturesV18(seed).vector;
 const m={schema:'IRYS_V18_SPOT_LOGISTIC_V1',feature_order:SPOT_FEATURES_V18,
  weights:SPOT_FEATURES_V18.map(()=>0),intercept:Math.log(4),
  target_mode:'CONTINUATION_VS_REVERSAL',horizon_min:15};
 assert.ok(spotScoreV18(m,x).score_buy<.5);
});
