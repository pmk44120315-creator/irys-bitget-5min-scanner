# V42 dispatch evidence and complete actual-ACK feedback implementation plan

Goal: revalidate paired direction using a genuinely newer official quote immediately before an existing Telegram send; evaluate every retained genuine server ACK, not only latest sampled messages.

Architecture: original V30 qualification, risk lane, pacing and Cron remain authoritative. Fail closed without stale quote fallback, preserve other eligible candidates, record new public quote as entry reference. Public ACK projection excludes private message contents, Telegram identifiers and secrets. Existing V39 periodic job persists full outcomes on its existing dedicated data branch; no new recurring job. Legacy V39 evidence stays unchanged.

User approved execution and deployment within existing IRYS scope. No orders, account API, manual Telegram tests or forced market scans.

Implemented and locally tested: dispatch reversal rejection; provider identity and timestamp checks; reservation delay freshness; compiled actual send adapter; safe full cohort; no 2-hour abandonment of unresolved labels; future minute must close at/after target; favorable/adverse path versus final close separated; exact source lease, unchanged bindings/Cron and rollback on failed natural proof.

Remaining release gate: fresh independent full regression; exact built Worker SHA; code-only upload to the existing Worker; natural scheduled version/health confirmation; complete original ACK cohort reconciliation and separate branch byte-for-byte readback; main integration. No assertion of improved out-of-sample accuracy from code tests or these safeguards alone.
