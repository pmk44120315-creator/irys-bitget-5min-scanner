# V35 Signal Lifecycle Implementation Plan

Goal: keep issued directional claims accountable, remove history reads from live publication, preserve V34 risk lane. User delegated implementation and deployment; no additional approval loop. Node ES modules/Python exact-source builder/GitHub Actions/Cloudflare KV remain.

Research: fresh public actual-ACK summary has34events,27measured5m minute-close proxies,8positive. Symmetric drift filter replay changed0of19 originalREADY cases and was rejected. Counterpressure rescue hypothesis was not supported by sufficiently measured independent data and is not enabled. No future accuracy claim.

Chosen design: follow recent originalREADY public hypotheses even when not in new candidates. Worker matches only actual ACK records with explicit original message/side/reference; two subsequent fresh quotes plus final quote must be beyond reference to mark INVALIDATED. Mark EXPIRED after15m. Edit own original message once, never send a fake reverse-entry or extra message. Missing evidence=UNVERIFIED. Prior quotes/labels remain immutable. Historical outcome APIs run after live packet publication and have a separate cache, not in its critical path.

Constraints: existing5minuteCron, source-age/identity/risk checks, quotas, V34 cross-venue risk and all unrelated data unchanged. No orders/private exports/secrets in artifacts/artificial scans or test Telegram. Actual live editing is unverified until it occurs naturally. Not real-time tick monitoring.

Review focus: no wrong-market edit; quote timestamp reuse; original ACK only; failed edit visible/retry idempotent; cached prices not turned into new prediction; malformed followups cannot kill entry review; output-data writes limited to designated files.

- [x] Fail then pass11 lifecycle tests; two live-path tests and4 compiled Worker adapter tests.
- [x] Preserve exact V34 risk/entry/Cron bodies and build reproducible V35.
- [x] Local178Python+247Node pass.
- [ ] Remote exact-source full regression and official public provider smoke.
- [ ] Scope-only merge, new producer publication, original-source lease deployment and natural proof.
- [ ] Preserve research failures, deployment failures and remaining direction-performance limits in final handoff.
