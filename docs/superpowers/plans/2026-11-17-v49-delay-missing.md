# V49 delayed admission and missing measurement implementation plan
> For agentic workers: execute task-by-task with superpowers:executing-plans, test-driven-development, and verification-before-completion.

**Goal:** Restore fresh prospective enrollment and make measurement gaps diagnosable and recoverable without changing live alerts.
**Architecture:** Freeze research decisions in the V30 producer workflow immediately after current observation, publish append-only compressed capture receipts with the source packet, and ingest validated receipts in the independent V36 evaluator. Keep history requests separate and retain unknown/missing outcomes.
**Tech Stack:** Node.js 22, Python tests, GitHub Actions, official unauthenticated market GET endpoints.
**Spec:** docs/superpowers/specs/2026-11-17-v49-delay-missing.md

## Global Constraints
- No live Worker/Telegram/order modifications or automatic promotion.
- Keep 45000ms quote freshness and actual decision clock. No future information, backdated decisions, made-up candles or fills.
- Preserve original events, append-only archives, hash-bound publication, no force push or stale data overwrite.
- Same symbol/direction/episode is not a new independent sample. Missing/ambiguous results never become success.
- Preserve V30 producer source/digest and publish its normal outputs even when research capture fails.

## Review Focus
- Capture later imported after newer packets: frozen clock preserved, no skipped receipt or state reset.
- Duplicate/conflicting receipt and stale/future quote: fail closed, do not rewrite existing event.
- Sparse official candles versus transport outage: distinct evidence, no synthetic OHLC.
- Historical missing windows must not starve fresh due measurements; retries continue fairly.
- Research failures must not disable successful live quote transport or hide starvation behind OBSERVED.

## Tasks
### 1. Admission accounting and fast capture
Files: deployment/v36_shadow.mjs, deployment/v49_capture.mjs, tests/test_v49_capture.mjs.
- [x] Reproduce stale packet admitted as OBSERVED with zero unexplained enrollment; require reason counts.
- [x] Implement reason-coded admission preserving unknown/invalid cases and existing state metadata.
- [x] Test capture clock, 45000ms boundary, duplicate bytes, no side effects, original packet unchanged.
- [x] Implement immutable hash-bound capture output; small frozen event receipt, source packet hash, source commit.
### 2. Delayed import and producer integration
Files: deployment/v49_ingest.mjs, deployment/v36_runner.mjs, .github/workflows/v30-public-direction-producer.yml, .github/workflows/v36-public-shadow.yml, tests/test_v49_ingest.mjs.
- [x] Tests for delayed receipt import, old last_asof, duplicate episodes, tampering, future/stale capture, eviction preservation, consumer restart.
- [x] Import receipts without changing decision time. Keep consumption ledger, timestamps and diagnostics.
- [x] Place capture immediately after V30 producer and publish independent files with current data; preserve producer source digest and transport behavior.
### 3. Missing history classification and recovery
Files: deployment/v49_recovery.mjs, deployment/v36_runner.mjs, tests/test_v49_recovery.mjs.
- [x] Inspect bounded official Bithumb responses for existing missing targets; record raw evidence.
- [x] Reproduce starvation/repeated unchanged gaps and missing reason invisibility in tests.
- [x] Add explicit response coverage/missing diagnostics and fair recovery scheduling; preserve semantics and continue retries.
- [x] Test recovery, outage, invalid schema/identity, future candles, sparse paths, horizon/clock boundaries, same-bar ambiguity.
### 4. Verification and deployment
Files: .github/workflows/v49-repair-verification.yml and evidence/report documentation.
- [x] Run related tests and whole available suites; distinguish inherited fixture failures.
- [ ] Verify frozen cohorts unchanged, independent recomputation, no side-effect paths.
- [ ] Execute isolated branch CI with read-only official market evidence, inspect logs/artifacts.
- [ ] Review diff, merge exact reviewed branch without overwriting moving main data.
- [ ] Verify natural capture/import and latest main outputs against deployed commit; no accuracy/promotion claim.
