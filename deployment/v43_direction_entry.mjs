/** Separate observed price direction from immediate entry-risk evidence.
 * Descriptive, frozen before outcomes. No calibrated probability or live gate.
 */
const num=x=>typeof x==='number'&&Number.isFinite(x);
export function assessDirectionAndEntry(f){
 if(f?.version!=='V43_PUBLIC_STREAM_EVIDENCE_V1'||!Number.isSafeInteger(f.asof_ms))throw Error('FEATURE_SCHEMA');
 if(f.last_quote&&(f.last_quote.at_ms>f.asof_ms||f.last_quote.received_at_ms>f.asof_ms))throw Error('FEATURE_FUTURE_CLOCK');
 const flags=[];let bias='UNKNOWN',pattern='INSUFFICIENT_OBSERVATION';
 const price=num(f.observed_mid_change_pct)?Math.sign(f.observed_mid_change_pct):0;
 const flow=f.trade_count>0&&num(f.buy_share)?Math.sign(f.buy_share-.5):null;
 if(f.book_count>=2&&num(f.observed_mid_change_pct)){bias=price>0?'UP':price<0?'DOWN':'FLAT';
  if(flow===null)pattern='PRICE_ONLY_NO_TAPE';else if(flow===0)pattern='PRICE_WITH_BALANCED_TAPE';
  else if(flow===price)pattern=price>0?'BUY_FLOW_PRICE_UP':'SELL_FLOW_PRICE_DOWN';
  else if(price>0&&flow<0)pattern='SELL_FLOW_PRICE_UP_ABSORPTION_CANDIDATE';
  else if(price<0&&flow>0)pattern='BUY_FLOW_PRICE_DOWN_ABSORPTION_CANDIDATE';else pattern='TAPE_WITHOUT_PRICE_PROGRESS';}
 if(flow===null)flags.push('NO_REALTIME_TAPE');
 if(flow>0&&price<0)flags.push('BUY_FLOW_WITH_FALLING_PRICE');
 if(flow<0&&price>0)flags.push('SELL_FLOW_WITH_RISING_PRICE');
 if(num(f.spread_pct)&&num(f.observed_mid_change_pct)&&Math.abs(f.observed_mid_change_pct)<=f.spread_pct)flags.push('MOVE_WITHIN_SPREAD');
 if(!f.last_quote||!num(f.quote_age_ms)||f.quote_age_ms>5000)flags.push('QUOTE_NOT_CURRENT');
 if(!f.unbroken_window)flags.push('OBSERVATION_WINDOW_INCOMPLETE');
 if(f.conflicts>0)flags.push('CONFLICTING_SOURCE_OBSERVATION');
 if(price>0&&f.top_depth_imbalance<0)flags.push('PRICE_UP_WITH_OPPOSING_VISIBLE_DEPTH');
 if(price<0&&f.top_depth_imbalance>0)flags.push('PRICE_DOWN_WITH_OPPOSING_VISIBLE_DEPTH');
 const venueAction=f.venue==='bithumb'?(bias==='UP'?'BUY_HYPOTHESIS':bias==='DOWN'?'NO_BUY':'UNRESOLVED'):(bias==='UP'?'LONG_HYPOTHESIS':bias==='DOWN'?'SHORT_HYPOTHESIS':'UNRESOLVED');
 return {version:'V43_DIRECTION_AND_ENTRY_OBSERVATION_V1',venue:f.venue,symbol:f.symbol,decided_at_ms:f.asof_ms,
  direction:{observed_bias:bias,pattern,venue_action_hypothesis:venueAction,probability:null,absorption_verified:false,future_direction_verified:false},
  entry:{risk_flags:flags,spread_pct:f.spread_pct,observed_long_quote_change_pct:f.long_executable_change_pct,
    observed_short_quote_change_pct:f.short_executable_change_pct,visible_depth_imbalance:f.top_depth_imbalance,
    observed_bid_replenishment:f.observed_bid_replenishment,observed_ask_replenishment:f.observed_ask_replenishment,
    observed_order_flow_imbalance:f.order_flow_imbalance_base,trade_permission:false},
  raw_feature_asof_ms:f.asof_ms,live_model_replaced:false,forecast_accuracy_proven:false,
  warning:'OBSERVED_DIRECTION_AND_ENTRY_RISK_ARE_NOT_FUTURE_TRADE_RECOMMENDATIONS'};
}
