# V48.1 archive capacity hardening — 2026-11-13 KST

V48 main deployment PR #62 succeeded, and both natural production publication runs 43305349274 (V36) and 43305349272 (V37) completed successfully. Independent read-only run 43307226231 verified source identity, state/report SHA256/revisions, actual archive chains, unchanged V43/V47 source leases, and HTTP200 from the existing live Cloudflare Worker. Artifact 13983163905 SHA256 a585c3673720612e5bffa5f55b29d60d09806a95fa9a61bfc3568396f382295e.

The actual V36 daily archive had already reached 31,012,121 bytes. Prevent future individual-file growth failures with bounded UTF-8 JSONL shards (16 MiB maximum for new or extended files). Existing larger legacy file bytes remain unchanged; new revisions use numbered shards. Candidate identities, revision chains, old labels and total evidence are preserved; no old records are deleted. This bounds individual files, NOT unlimited total repository storage or all future runtime costs.

New seven regression tests fail against the prior archive module and pass after this correction: bounded files, cross-shard revisions and restart idempotence, oversized legacy preservation, UTF-8 byte accounting, all-or-nothing rejection of oversized records, limits validation and tamper detection in later shards.

Complete remote regression run 43308280738 succeeded on dc73e2a7c78ccaaca6b73c0c54c111a362bfe869: Node727 + Python227 + workflow9 + research25 + ai_twin22 = 1010 tests passed. Artifact13984507831 SHA256 e4dcc9ac58457fc5a7fc199439bccab1c003a9919ba4419c383a8ef2586b437e. Actual published V36 and V37 archives were also read and validated by the revised reader without changing original bytes.

This delta modifies only the archive module, adds seven tests and this evidence note. It does not replace the V46 live direction model, alter alert thresholds, write a Cloudflare deployment, send Telegram tests, or place trades.

Important live-health limitation: the readback HTTP200 is not an all-clear. At the 06:05 KST live cycle the root status reported PARTIAL with BITHUMB_SPOT_EVIDENCE_STALE_OR_PARTIAL and direct Bitget HTTP403 observations; the active V30 paired feed separately reported SOURCES_AVAILABLE, 36 paired_complete, 0 ready and 0 sent. Preserve these channel distinctions; do not claim every live data source is healthy or directional superiority is proven.
