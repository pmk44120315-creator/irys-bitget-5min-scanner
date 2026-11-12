# V48 evidence-integrity release — 2026-11-13 KST

Scope: corrected V36/V37 research collection, causal closed-minute measurement, historical recovery, rolling event cooldown, append-only evidence, one-to-one actual-ACK matching and downstream label compatibility. This release does not replace the V46 Cloudflare live direction model, V34 alerts or V47 stream corrections, and sends no test orders or Telegram messages.

## Verified source
Source after complete downstream verification: `1e37cf243ac1aeec9337033d69ee52beef0ca95b` on isolated branch `upgrade/irys-v48-evidence-20261113`. Production integration uses only 28 reviewed source/workflow/test paths, based on current main, preserving concurrent market-data commits. Legacy evaluation results are retained separately and never silently combined with V48 results.

## Actual remote evidence
- GitHub Actions run 43303672021: complete regression succeeded. Node 720/720, Python stdlib 227/227, workflow 9/9, research 25/25, ai_twin 22/22; total 1003 cases, no failed or skipped test cases. Artifact 13982746678 `v48-downstream-complete-regression`, SHA256 `92cfc3814e510625bf114713258b1e7a63b455dd35bdb93b3399315a0e31a8bb`.
- GitHub Actions run 43302381212: real official Bithumb/Bitget historical-window smoke tests and frozen 3000-event V37 re-evaluation succeeded. Artifact 13983080993 `v48-full-regression-proof`, SHA256 `e793ab8182b46493a1cf0ffccd17cdcdf781ab6885c5be0c445cc3595b608b8a`. Includes original and corrected cohorts, raw official responses, normalized pages and report.
- 1817 requested historical windows, 1814 returned pages, three explicitly recorded source failures. Missing minute bars remain missing, never substituted with fabricated price or wins. Corrected 5/15/30/60-minute measured counts: 2293/2295/2268/2266 of 3000; positive counts: 815/915/927/972. These are reference-price direction outcomes, NOT fills or net profitability and NOT a like-for-like accuracy improvement over the legacy clock.
- Original candidate decisions and entry reference prices preserved. Actual ACK cohort 103; one one-to-one preceding match, zero exact-clock/exact-reference pairs. No comparative live model superiority is established.

## Changes
- Exact first closed minute at/after horizon; explicitly versioned semantics. A missing exact endpoint or incomplete path stays unverified.
- Due retained records remain eligible beyond the former 61/65-minute limit; historical windows are tied to each candidate. First migration revisits all retained windows; subsequent recovery rotates fairly.
- Daily append-only hash-chained event/revision archive preserves evicted hot-state records. Existing corrupt state aborts instead of silently resetting.
- Latest report and state are hash/revision bound. Natural workflow publication uses source leases and non-force conflict handling.
- Rolling 30-minute event cooldown replaces fixed-bucket duplicates. This is NOT proof of statistical independence.
- Complete-minute observed adverse/favorable excursions and missing coverage are reported separately. Partial entry-minute extrema and tick-order/fill assertions are not invented.
- V39/V40 consumers accept explicit V48 labels, reject unknown or mismatched versions, and preserve distinguishable legacy replay.

## Limits and post-integration checks
Tests are not proof of predictive improvement. Minute OHLC cannot establish intraminute touch ordering or actual executions. Market-onset latency and historical entry-orderbook freshness remain unverified. Historical V47 one-day raw replay artifact expired; this release verifies unchanged source leases and runs current regression tests but does NOT claim that original raw incident was replayed.

Main integration is not by itself proof that scheduled collection published successfully. Verify the resulting V36/V37 Actions, state/report publication hashes and archives. Existing Cloudflare V46 live model remains unchanged; do not describe this release as a new live direction model or guaranteed profit.
