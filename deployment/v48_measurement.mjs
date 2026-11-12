/** V48 research evidence semantics. No alert permission, trading or inferred fills. */
export const V48_MEASUREMENT_VERSION = 'V48_CLOSED_MINUTE_AT_OR_AFTER_TARGET_V1';
export const V48_MINUTE = 60000;
export const V48_HORIZONS = Object.freeze([5, 15, 30, 60]);
const MIN = V48_MINUTE;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const positive = x => finite(x) && x > 0;
const clock = x => Number.isSafeInteger(x) && x >= 0;
export function v48ValidIdentity(e) {
  return e?.venue === 'bithumb'
    ? /^KRW-[A-Z0-9]{1,25}$/.test(e.symbol) && e.direction === 'BUY'
    : e?.venue === 'bitget' && /^[A-Z0-9]{1,25}USDT$/.test(e.symbol) && ['LONG','SHORT'].includes(e.direction);
}
export function v48ValidEvent(e, now) {
  return clock(now) && clock(e?.issued_at_ms) && e.issued_at_ms <= now && positive(e.entry_price)
    && ['BUY','LONG','SHORT'].includes(e.direction)
    && (e.venue === undefined || v48ValidIdentity(e))
    && clock(e.first_complete_start_ms) && e.first_complete_start_ms === Math.ceil(e.issued_at_ms / MIN) * MIN;
}
export function v48CandleMap(bars, start, end) {
  const map = new Map(), conflicts = new Set(), invalid = new Set();
  for (const b of bars || []) {
    const t = b?.start_ms;
    if (!clock(t) || t % MIN || t < start || t + MIN > end) continue;
    if (![b.open,b.high,b.low,b.close].every(positive) || b.low > Math.min(b.open,b.close)
        || b.high < Math.max(b.open,b.close)) { invalid.add(t); continue; }
    const row = {start_ms:t,open:b.open,high:b.high,low:b.low,close:b.close};
    if (map.has(t) && JSON.stringify(map.get(t)) !== JSON.stringify(row)) conflicts.add(t);
    else map.set(t, row);
  }
  return {map, conflicts, invalid};
}
export function v48LabelClose(e, bars, now, horizon = 15) {
  const result = (status, extra = {}) => ({status,horizon_minutes:horizon,
    measurement_version:V48_MEASUREMENT_VERSION,actual_execution_verified:false,...extra});
  if (!v48ValidEvent(e,now) || !Array.isArray(bars) || !V48_HORIZONS.includes(horizon)) return result('INVALID_INPUT');
  const target = e.issued_at_ms + horizon * MIN, closeAt = Math.ceil(target / MIN) * MIN;
  if (!clock(target) || !clock(closeAt)) return result('INVALID_INPUT');
  if (now < closeAt) return result('PENDING');
  const start = e.first_complete_start_ms, {map, conflicts, invalid} = v48CandleMap(bars,start,closeAt);
  const targetStart = closeAt - MIN;
  if (conflicts.has(targetStart) || invalid.has(targetStart)) return result('CONFLICTING_CANDLES');
  const candle = map.get(targetStart);
  if (!candle) return result('UNMEASURED_TARGET',{target_ms:target,expected_close_at_ms:closeAt});
  const sign = e.direction === 'SHORT' ? -1 : 1, change = sign * 100 * (candle.close / e.entry_price - 1);
  if (!finite(change)) return result('INVALID_INPUT');
  const expected = (closeAt - start) / MIN;
  const complete = map.size === expected && conflicts.size === 0 && invalid.size === 0;
  const extrema = [...map.values()].filter(b=>!conflicts.has(b.start_ms)&&!invalid.has(b.start_ms))
    .flatMap(b=>[sign*100*(b.high/e.entry_price-1),sign*100*(b.low/e.entry_price-1)]);
  const bounded = extrema.length > 0 && extrema.every(finite);
  const adverse = bounded ? Math.min(0,...extrema) : null, favorable = bounded ? Math.max(0,...extrema) : null;
  return result('MEASURED_DIRECTION', {close_at_ms:closeAt,target_ms:target,measurement_offset_ms:closeAt-target,
    horizon_reference:'FIRST_CLOSED_MINUTE_AT_OR_AFTER_TARGET',entry_quote_reference:e.entry_price,
    target_close:candle.close,signed_direction_pct:change,direction_positive:change>0,
    path_minutes_expected:expected,path_minutes_observed:map.size,path_complete:complete && bounded,
    max_adverse_pct:complete && bounded ? adverse : null,max_favorable_pct:complete && bounded ? favorable : null,
    observed_max_adverse_pct:adverse,observed_max_favorable_pct:favorable,
    path_scope:'FULL_POST_ISSUE_MINUTES_ONLY',entry_minute_partial_omitted:e.issued_at_ms % MIN !== 0,
    intraminute_order_known:false,observed_extrema_are_bounds_not_complete_tick_path:true,
    not_net_profit:true,not_fill_price:true});
}
/** Caller owns a deep clone. Preserve old measurements exactly instead of relabeling them silently. */
export function v48MigrateEvent(e, kind = 'v37') {
  const field = kind === 'v36' ? 'direction_outcomes' : 'outcomes';
  const legacy = kind === 'v36' ? 'legacy_direction_outcomes_v36' : 'legacy_outcomes_v37';
  if (e.direction_measurement_version === V48_MEASUREMENT_VERSION) { e[field] ??= {}; return; }
  if (e[legacy] !== undefined) throw Error('V48_LEGACY_ARCHIVE_ALREADY_PRESENT_WITH_UNKNOWN_VERSION');
  if (e[field] && Object.keys(e[field]).length) e[legacy] = structuredClone(e[field]);
  e[field] = {};
  e.direction_measurement_version = V48_MEASUREMENT_VERSION;
}
/** Merge different historical windows; never let the last page erase an earlier episode's candles. */
export function v48MergeNativePages(pages, now) {
  const by = new Map();
  for (const p of Array.isArray(pages) ? pages : []) {
    if (p?.source !== 'OFFICIAL_NATIVE_1M' || !clock(p.fetched_at_ms) || p.fetched_at_ms > now || !Array.isArray(p.bars)) continue;
    const key = p.venue + ':' + p.symbol;
    const group = by.get(key) || {bars:[],fetched_at_ms:0,requests:[]};
    group.bars.push(...p.bars.filter(b=>clock(b?.start_ms)&&b.start_ms+MIN<=p.fetched_at_ms));
    group.fetched_at_ms = Math.max(group.fetched_at_ms,p.fetched_at_ms);
    if (p.request_key) group.requests.push(p.request_key);
    by.set(key,group);
  }
  return by;
}
const terminal = new Set(['TARGET_FIRST','STOP_FIRST','AMBIGUOUS_BOTH','NO_TOUCH_TIMEOUT']);
export function v48PendingMarkets(events, now, max = 40, kind = 'v37') {
  if (!Array.isArray(events) || !clock(now) || !Number.isInteger(max) || max < 1) return [];
  const due = [];
  for (const e of events) {
    if (!v48ValidIdentity(e) || e.time_basis !== 'ACTUAL_EVALUATOR_DECISION_CLOCK' || !v48ValidEvent(e,now)
      || !clock(e.source_observed_at_ms) || e.source_observed_at_ms > e.issued_at_ms) continue;
    const outcomes = kind === 'v36' ? e.direction_outcomes : e.outcomes;
    const directionDue = V48_HORIZONS.some(h=>outcomes?.[h]?.status !== 'MEASURED_DIRECTION'
      && Math.ceil((e.issued_at_ms+h*MIN)/MIN)*MIN <= now);
    const barrierDue = kind === 'v36' && e.barriers_locked === true && e.first_complete_start_ms+MIN<=now
      && V48_HORIZONS.some(h=>!terminal.has(e.outcomes?.[h]?.status));
    if (!directionDue && !barrierDue) continue;
    const attempt = e.native_history_last_attempt_at_ms;
    due.push({venue:e.venue,symbol:e.symbol,issued_at_ms:e.issued_at_ms,
      history_end_ms:Math.min(Math.floor(now/MIN)*MIN,Math.ceil((e.issued_at_ms+60*MIN)/MIN)*MIN),
      last_attempt_at_ms:clock(attempt)&&attempt<=now ? attempt : 0});
  }
  due.sort((a,b)=>a.last_attempt_at_ms-b.last_attempt_at_ms||a.issued_at_ms-b.issued_at_ms
    ||(a.venue+':'+a.symbol).localeCompare(b.venue+':'+b.symbol));
  const selected = new Map();
  for (const {last_attempt_at_ms,...row} of due) {
    const key = row.venue+':'+row.symbol;
    if (!selected.has(key)) selected.set(key,row);
    if (selected.size >= max) break;
  }
  return [...selected.values()];
}
export function v48RecordHistoryAttempts(old, markets, now) {
  const state = structuredClone(old || {});
  if (!Array.isArray(state.events) || !Array.isArray(markets) || !clock(now)) return state;
  const key = e=>[e?.venue,e?.symbol,e?.issued_at_ms].join(':');
  const selected = new Set(markets.filter(m=>clock(m?.issued_at_ms)&&m.issued_at_ms<=now).map(key));
  for (const e of state.events) if (e && selected.has(key(e))) e.native_history_last_attempt_at_ms = now;
  return state;
}
/** This is deterministic episode spacing, NOT a statistical independence claim. */
export function v48SpacedEvents(events, spacing = 30*MIN) {
  const kept = [], last = new Map();
  for (const e of [...events].sort((a,b)=>a.issued_at_ms-b.issued_at_ms||String(a.id).localeCompare(String(b.id)))) {
    const key=e.venue+':'+e.symbol+':'+e.direction,previous=last.get(key);
    if (previous !== undefined && e.issued_at_ms-previous < spacing) continue;
    kept.push(e);last.set(key,e.issued_at_ms);
  }
  return kept;
}
export function v48Measured(e, h, field = 'outcomes') {
  const o=e?.[field]?.[h];
  if (e?.direction_measurement_version !== V48_MEASUREMENT_VERSION || o?.status !== 'MEASURED_DIRECTION'
      || o.measurement_version !== V48_MEASUREMENT_VERSION) return false;
  const at=o.at_ms ?? o.close_at_ms,change=o.signed_pct ?? o.signed_direction_pct;
  return clock(at) && at===Math.ceil((e.issued_at_ms+Number(h)*MIN)/MIN)*MIN && finite(change)
    && typeof o.direction_positive==='boolean' && o.direction_positive===(change>0)
    && positive(o.close_price ?? o.target_close) && o.actual_execution_verified===false;
}
