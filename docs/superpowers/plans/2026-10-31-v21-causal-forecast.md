# IRYS V21 Causal Forecast Implementation Plan

**Goal:** improve actual 5/15-minute direction forecasting rather than repeatedly turning Telegram off/on.
**Architecture:** preserve existing 5-minute collectors and Telegram credentials. Train separate venue/horizon models from immutable market snapshots, including contradictory flow observations; compare learned predictions to momentum, reversal and V20 baselines. Use time-ordered training/selection/untouched testing, with labels known before training cutoff, non-overlapping predictions and conservative disclosed cost scenarios. No unconditional LONG/SHORT from a current price/taker sign or an LLM answer.
**Tech stack:** Python 3.12; fixed scikit-learn training dependency in an isolated GitHub Actions job; standard-library runtime/integrity code. No orders or account APIs.
**Spec:** this document records the delegated design choice. The user authorized reimplementation and does not want repeated design-approval questions.

## Approaches considered
1. Loosen V20 conditions/re-enable V19: rejected; verified bad direction forecasts and alert flood.
2. Always reverse the previous 5m direction: rejected as a production policy; post-hoc short history is not proof of generalization.
3. Conditional supervised learning with strict chronological validation and return/risk accounting: selected. Price/flow disagreement must be a learned feature, not an automatic rejection before study. Venue/horizon/side evidence must remain separate.

## Global constraints
- Preserve existing 5m Cron, ChatGPT hourly watcher, Cloudflare bindings, Telegram bot and existing main market files.
- Never fake full-market CVD, continuous OFI, orderbook absorption or a fill price from sampled data.
- No illegal access, leaked private data, orders, trading-account keys or secret exports.
- No arbitrary test-run limits; fix failures and retest.
- Record absence of measurable advantage explicitly. Test success is not profitability or deployment proof.
- No 20 consecutive candles, fixed turnover floors, OI-sign prerequisites or required first-retest strategy.

## Review focus
- Future label leakage through publication/entry timing.
- Overlapping same-symbol observations and same-time assets overstating evidence.
- Missing flow versus genuine zero flow; last-book snapshot versus verified 2-book observations.
- Bithumb DOWN results accidentally counted as BUY performance.
- Data collection and model completion mistaken for successful Telegram delivery or accuracy.

## Tasks
- [ ] Write failing tests for source-only features, contradiction retention, exact future-label availability, purged chronological splits and economic delivery classification.
- [ ] Implement focused pure feature/validation functions.
- [ ] Read all immutable relevant Git market/evidence snapshots at a pinned source SHA. Record real data coverage, versions and missingness.
- [ ] Fit a small predeclared set of regularized/nonlinear models. Select only on validation; freeze before examining final holdout. Keep 5m and 15m evaluation and spot BUY separate.
- [ ] Execute full tests and retrospective study on actual records. Report costs as scenarios, not actual account costs. Never optimize again on the disclosed test slice.
- [ ] Integrate verified improvements into existing automatic research execution with separate state/output, without replacing working collection or silently forcing notifications.
- [ ] Replace permanent-off notification semantics only if a candidate has credible forward evidence and fresh executable quote checks; otherwise do not assert a successful signal service. Preserve exact blocked reasons and signal lifecycle.
- [ ] Verify production readbacks and generated files before final completion claims.
