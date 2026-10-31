# IRYS V22 Direction Performance Implementation Plan

> Implement with executing-plans, test-driven-development and verification-before-completion. The owner explicitly requested implementation, not another approval round.

**Goal:** improve actual forward direction and cost-aware outcomes for Bitget LONG/SHORT and Bithumb BUY, not notification volume.
**Architecture:** preserve V21.1 as baseline, diagnose input/target timing and train/serve mismatches, compare a small preregistered challenger family with consistent chronological targets, integrate only tested runtime changes. No account/order APIs or paid services.
**Tech stack:** existing Python forecasting/collector, scikit-learn offline study, existing Node Cloudflare transport.
**Pinned baseline:** 9ae70155bf019c4c72bef70319f8fde9bcdedd4d. Original frozen V21 training archive e240a447a9c5ea3b034c5e6f9549bd2d80276f0c.

## Design and approaches
A. Changing notification switches or thresholds alone is rejected: it does not improve predictive skill.
B. Larger unvalidated models are rejected: the existing limited independent history invites overfitting.
C. Preferred: audit matched original events, timestamps, feature parity and actual quote outcomes; repair confirmed defects; compare low-capacity time-aligned return models with unchanged V21 on the same time periods. Price-versus-taker divergence remains a feature, not an unconditional exclusion.

## Constraints
- Scope is this IRYS repository and existing monitor only; no CoinRadar, FLOW HUNTER, SKL or other automation changes.
- Existing collectors, Telegram credentials, Cron and public-data integrity are preserved.
- No fabricated CVD, no claim that two book snapshots prove absorption, no future outcome features.
- No unvalidated directional message floods, no newly imposed 20-bar streak rules.
- Use the original runtime and existing schedule rather than adding perpetual jobs.
- Test success, statistical improvement, production deployment and real alert reception must be reported separately.

## Tasks
- [ ] Audit: obtain exact baseline source, frozen historical features/price tapes and real V21 quote outcomes; record hashes and failure decomposition.
- [ ] Reproduce: add failing tests for any confirmed timing, feature, model-export or outcome-selection defect before changing its implementation.
- [ ] Challenger: freeze hypothesis family and chronological split before examining final period; compare against V21 on matched rows, retaining flats, spread/cost scenarios, coverage and block uncertainty. No post-hoc model tuning on final results.
- [ ] Implementation: use original modules where practical; keep reference records and model identities distinct. Save useful prediction diagnostics (input age, market regime and reason for non-notification) without secrets.
- [ ] Verification: run full legacy and new tests, Python/Node inference agreement, chronological replay and rollback checks. Use an isolated branch.
- [ ] Integration: deploy verified corrective changes and the improved evaluator/model where evidence supports it; do not equate deployment with profitable or accurate forecasting. Re-read actual scheduled results.

## Review focus
1. Training target begins at a delayed future completed price while runtime enters at current public quote; quantify this mismatch rather than assume a fix helps.
2. Market context is computed at different collector stages; verify exact same event features in training and inference.
3. Long/short profit must use the appropriate bid/ask and actual horizon; missing observations stay missing.
4. Runtime scores are not calibrated win probabilities; loss magnitude and flat cases matter as well as direction.
5. A model with good pooled metrics may fail by direction, venue, time regime or recent independent interval.
