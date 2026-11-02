# V28 Buildup Discovery Implementation Plan

Goal: broaden early discovery using real trajectory memory and market-relative money share without spam or fabricated direction.
Architecture: pure v28_discovery.mjs -> exact V27.2 source transform -> original scheduled Worker with bounded per-market ledger and batch observation.
Tech: ES modules/Node, Python stdlib, existing Cloudflare KV and public APIs.

User authorized autonomous continuation of the interrupted V28 upgrade. Do not restart V27.2, ask redundant approval or turn exploratory WATCH into guaranteed directions. Alternative 1: simply lower .70 threshold (insufficient: ignores trajectory and coverage). Alternative 2: add more indicator gates (repeats unvalidated vetoes). Chosen implementation: all-market trajectory/relative-traded-value evidence, coverage diagnostics and per-symbol bundle receipts. This is project-specific design, not a global novelty claim.

Review focus: stale clocks/counter reset; duplicate observations; warning visibility vs trade recommendation; per-message ACK and per-symbol dedupe; post-cap tracking; stable traded-value comparison universe and true elapsed-time return.

- [x] Audit fresh real ACKs and native official 5/15/30/60m outcomes; missing and neutral remain separate.
- [x] Run failing tests before implementing sub-.70 buildup, risk visibility, dayleader fading, median, counter reset, duplicate/gap and bundle dedupe.
- [x] Implement v28Discover, v28ChooseBundle and v28Brief.
- [x] Exact V27.2 builder preserves original direction proof functions, scheduling and hourly quota.
- [x] Local full original/new regression: Python177 and Node100 pass. New review failures fixed without fabricating money share or elapsed time.
- [ ] Repeat full regression in GitHub Actions, verify native saved all-market records and exact built hash.
- [ ] Guarded server update and natural Cron verification without artificial messages.
- [ ] Persist deployment receipt and actual outcomes; future predictive improvement remains unproven.
