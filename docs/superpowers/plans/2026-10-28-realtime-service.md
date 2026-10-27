# IRYS realtime evidence service implementation plan

Goal: extend PR #2 into an isolated, deployable read-only evidence collector without altering V7, existing main collection, automation schedules or live notification policy.
Architecture: a separate Cloudflare Worker + SQLite Durable Object. Core analysis is platform-neutral ES modules tested with Node SQLite. Outbound feed sessions, gaps, events and receipts survive restarts. No trading endpoints.
Spec: realtime_research/OPERATING_DESIGN_KO.md in existing PR #2.

Constraints: data insufficiency is never a buy signal; snapshots do not prove absorption; no hidden duration/test-count limits; no secrets in source/logs/artifacts; existing worker name and bindings must not be reused; no deployment/paid resources without available account authorization.

Task 1: persistent flow and book evidence. Write RED tests for time units, large sequential IDs, distinct fills sharing IDs, duplicate ambiguity, independent minutes, gaps/restarts, same-price execution/replenishment and candle reconciliation. Implement and run GREEN tests.
Task 2: known-address-only on-chain classifier and authenticated, idempotent Telegram TEST receipt. RED/GREEN tests for unknown labels, chain/token mismatch, internal transfer, pagination/finality, missing secrets, API failure, timeout uncertainty, duplicate attempts.
Task 3: separate Worker lifecycle and deployment config. POST authenticated control only; GET health read-only; reconnect/alarm recovery, persistent state, no automatic signals. Test SQLite restart, control auth and dry-run build.
Task 4: remote existing regression + new tests; read-only live stream/candle reconciliation and existing V7 health. Check credential presence only. Pin exact tested SHA. Preserve existing main and PR #2 draft until deployment evidence exists.

Review focus: no future timestamps/overflow; no last-minute zero-fill; no CVD validity across gaps; no read receipt inferred from Telegram API acceptance; no all-exchange claim from a labelled subset.

Ruling: local GitHub clone failed (DNS unavailable); connector remains authoritative. Local tests cover new modules; whole-repository regression runs in GitHub Actions, never inferred from this partial checkout.
