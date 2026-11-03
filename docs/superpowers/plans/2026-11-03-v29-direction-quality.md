# V29 directional-delivery quality repair

User request: inspect actual sent alerts and subsequent prices, stop inaccurate bulk observations and select only double-checked directional candidates. This authorizes a focused software update, not real trading or a guarantee of future outcomes.

## Observed fault
The current V28.1 compiled source accepts candidate bundles after only a current-quote check. Missing tape and BUY_PRESSURE_FAILED / SELL_PRESSURE_FAILED are descriptions, not vetoes, so a candidate can be sent with adverse or unknown contemporaneous response. Prior retrospective results are not a new-model validation.

## Access boundary
The attempted new temporary private-receipt route was blocked by the tool safety check. That request was not applied. Do not reconstruct that route or work around the block. Use already accessible artifacts, normal public health and public exchange data, ordinary source/test changes and supported deployment mechanisms only. Never assert a current private receipt audit or production change without evidence.

## Chosen change
Separate discovery from delivery. Preserve broad all-market candidate tracking, existing identity and risk checks, and original schedulers. Remove automatic rank-only / batch candidate notifications. Directional delivery requires two distinct, time-ordered official snapshots with fresh executable quotes, new trades that do not merely reuse the first sample, consistent price response and a current invalidation test. A repeated cached sample is one observation, not two confirmations. Missing or contradictory data is an explicit non-send reason; failed checks do not consume a successful-send slot or claim Telegram ACK.

A passing present-market check is not proof of future profitability. Any experimental model must retain prospective evidence and must not be described as certain. New checks are mechanical source-integrity and directional-consistency checks, not calibrated probabilities.

## Steps
1. Record current public health and available latest message metadata using read-only public APIs. Audit accessible stored actual receipts with same-venue official candles and label their date range, missing intervals and neutral WATCH status.
2. Write failing tests for missing/opposing flow, cached second read, old quotes, price reversal, symbol/venue mismatch, new nonoverlapping prints, and failed ACK.
3. Implement a single shared send-permit checker and enforce it at the transport boundary so no older path bypasses it. Preserve the candidate ledger and distinguish shadow results from live messages.
4. Run original tests plus targeted new regressions. Inspect live public samples without sending test market alerts. Only code whose exact hash and test results are recorded is eligible for deployment.
5. Attempt ordinary supported release without private-data extraction; report actual source deployment and natural-run results separately. If execution is unavailable, preserve the tested patch and report NOT_DEPLOYED, never a fabricated completion.
