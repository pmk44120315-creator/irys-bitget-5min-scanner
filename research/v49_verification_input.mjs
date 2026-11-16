/** The live smoke uses actual recent public baselines, not the repair branch's old data. */
import assert from 'node:assert/strict';
export function v49VerifyPriorState(previous,now){
 assert(Number.isSafeInteger(now)&&now>=0,'V49_VERIFY_CLOCK');
 const f=previous?.market?.futures,spot=previous?.v28;
 assert(Number.isSafeInteger(f?.at_ms)&&f.prices&&Object.keys(f.prices).length,'V49_VERIFY_PRIOR_FUTURES_MISSING');
 assert(Number.isSafeInteger(spot?.at_ms),'V49_VERIFY_PRIOR_SPOT_MISSING');
 const fgap=now-f.at_ms,sgap=now-spot.at_ms;
 assert(fgap<=540000&&sgap<=540000,'V49_VERIFY_STALE_BASELINE');
 assert(fgap>=168000&&sgap>=168000,'V49_VERIFY_BASELINE_INTERVAL');
 return {futures_gap_ms:fgap,spot_gap_ms:sgap,source_timestamps_unchanged:true};
}
