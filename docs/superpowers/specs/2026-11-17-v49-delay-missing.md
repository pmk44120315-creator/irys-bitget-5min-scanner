# V49 delayed admission and missing measurement repair
Authorized request: repair updates, delay/missing errors, choose improvement direction, deploy final verified change.
Baseline upstream main: e9333fcdb678a32fb2ba62af81e34b575689448b.
Research-only rollout. Preserve the live Worker, Telegram transports, trading permissions, V30 model digest, quote-age gate (45000ms), existing frozen events and measurement semantics.
Record a V36 decision immediately after V30 finishes current observations, before publication/history/transport delays. Persist a hash-bound immutable capture; import later without pretending the delayed importer made an earlier decision. Retain real capture time and transport delay separately. No invented alerts/fills/accuracy.
Classify candidate rejections and history gaps. Repair recovery scheduling without forward-filling candles, deleting missing cases, changing historical entry/target, or declaring missing candles successful. Verify Bithumb gaps with bounded official responses before choosing treatment. Preserve same-bar ambiguity.
Require regression tests, exact source/record integrity, branch CI and natural main readback. Source deployment is not live model promotion. Report existing whole-suite/environment failures honestly.
