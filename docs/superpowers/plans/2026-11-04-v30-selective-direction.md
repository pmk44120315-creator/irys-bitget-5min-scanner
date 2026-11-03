# V30 selective direction implementation plan

Goal: a working sparse evidence-verified alert path, with public-provider independence and auditable future labels.
Architecture: v30_core.mjs (selection/proof/contracts) -> v30_producer.mjs (official public source pairs and final quotes) -> v30_delivery.mjs (fresh GitHub packet, revalidation, dedupe/ACK) -> exact V29 builder. Separate state/outcome file; no account orders.
Spec: docs/superpowers/specs/2026-11-04-v30-selective-direction.md

Review focus: opposite/fake current evidence; cross-symbol/venue mixups; numeric ID precision and source clocks; old-generation cache; ACK ambiguity and durable dedupe; SHORT symmetry; unavailable provider vs legitimate no-signal; missing target outcomes.

- [x] Test V30 core missing; implement bidirectional selection, exact-risk pair recheck and final quote invalidation.
- [x] Test public producer first/second/new-trade ordering and venue error isolation; implement parallel source acquisition without a six-candidate cap.
- [x] Test rejected/expired reports cannot send, good fixtures can, failed ACK never counts, replay cannot duplicate.
- [x] Build exact V29 -> V30; retain legacy disabled channels and all unrelated state/schedules.
- [x] Local original and new regression: Python178 / Node169 passing. No live predictive result inferred.
- [ ] GitHub regression and real official API source smoke; correct actual discovered defects.
- [ ] Merge only scoped code/producer workflow; guarded source lease deployment and actual scheduled verification.
- [ ] Report exact verified evidence, without promising future hit rate.
