# Actual Telegram outcome audit and evidence-driven upgrade implementation plan

Goal: evaluate actual delivered alerts, not shadow predictions, and correct demonstrated faults in discovery, evidence, timing or delivery without claiming guaranteed returns.
Architecture: read-only Cloudflare receipt extraction -> official venue-specific 1m price replay -> failure attribution -> separately tested improvement -> guarded integration when verified. Preserve current V24 operational state and original GPT watcher; V26 research is not Telegram performance.
Tech stack: Python stdlib, Node built-ins, GitHub Actions, Cloudflare Worker/KV. No trading or account API.

## Scope and design
User authorized autonomous inspection and implementation. Do not pause for design confirmation or re-ask existing requirements. Considered alternatives: (a) relax thresholds (rejected as no evidence of better direction); (b) add more indicator votes (rejected as repeating price-only proxies); (c) timestamp-correct actual-alert audit followed by a causal response/entry-quality mechanism. Choose (c), with detailed mechanics contingent on the observed failures, not post-hoc return optimization. New idea is a project-specific proposal, not a claim of worldwide novelty.

## Task 1: actual delivery evidence
- Read current Worker settings/source and KV via existing authorized Actions secrets, read only.
- Export only sanitized market/receipt fields; never token, account ID or chat ID. Exhaust receipt pagination.
- Preserve original issue timestamp, channel, venue, direction availability and message acknowledgement ID. Separate neutral WATCH and explicit direction; no invention of old message body/entry prices.
- Keep read failures visible. No test Telegram messages.

## Task 2: outcome audit
- Unit tests first: UTC/KST boundary, post-ACK entry proxy, missing minute candle, incomplete interval, asymmetric long/short returns, no pre-ACK high/low counted, no pending win.
- Audit 5/15/30/60m and adverse/favorable excursion from official market candles, quoting measurement precision. Label proxy vs actual alert/quote price clearly. Include flat/missing as separate outcomes.
- Reconcile duplicates and sample coverage; compare recent actual alerts separately from old versions.

## Task 3: justified upgrade
- Identify the failed component from actual evidence. Prefer observed market-response/remaining opportunity and real trade sampling to extra boolean filters or V26 shadow-only additions.
- Write failing tests for demonstrated faults, implement focused changes, run regression and original-policy preservation tests.
- Confirm on real public data; prototype vs deployment vs operating evidence must remain distinct.
- Apply only code proven safe by tests using exact-source lease and original binding/Cron backup; otherwise leave operational code intact and report exact blocking evidence.

## Review focus
1. Honest direction semantics for WATCH and absent historical message body.
2. Timestamp alignment and insufficient historical coverage.
3. Exact-source protection against concurrent deployment.
4. Telegram acknowledgement/dedupe/receipt persistence independent of market hypotheses.
5. Neither attractive retrospective segment nor passing software tests constitutes prospective predictive improvement.
