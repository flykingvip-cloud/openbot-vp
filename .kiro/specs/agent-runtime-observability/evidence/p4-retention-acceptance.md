# P4 local retention acceptance

Environment: isolated injected local probe, 2026-11-07 Asia/Shanghai. No production validation or configuration changes.

Reproduce from repo root: `bun .kiro/specs/agent-runtime-observability/capacity-probe.ts`. The script writes only temporary source data, removes it afterward, and prints JSON. Saved observed output: `p4-capacity-probe.json`.

Actual journal probe: 256 unique facts, capacity 64, retained 64, discardedThrough sequence 192. File size 69,177 bytes with identity tombstones. Recreating the journal preserved 64 facts. Advancing the injected clock to the TTL boundary returned zero retained facts and discardedThrough 256; the query did not modify disk. A partial temporary file was ignored. Corrupt committed JSON returned unknown. A 1,024-byte budget rejected further appends with journal_write_unknown, not the more specific journal_capacity. The script accepts either conservative rejection; it does not claim successful persistence after rejection.

Actual Fabric probe: 256 appends into a 64-record ring retained 64; a fresh store retained zero. Fabric has no TTL or loss watermark in this implementation and remains a non-durable retained-window view.

Existing verification command: `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/observation/execution-journal.test.ts src/gateway/agent-runtime-telemetry.test.ts src/fabric/audit-store.test.ts`: 3 files, 23 tests passed. Telemetry tests cover its 5,000-record insertion cap and real timestamp window filtering. Telemetry uses JSON snapshot persistence, not a durable event log, and has no complete-history watermark or physical TTL deletion.

Disk policy: journal default per-partition budget is 16 MiB, payload capacity 1,000 and TTL 15 minutes. Atomic replacement can temporarily require both old and replacement file space; no global partition-count or total disk quota is enforced. Identity tombstones survive payload TTL and stop new identities at max(capacity,10,000), so retention is bounded but ingestion can eventually fail closed. Query TTL is logical: expired payloads remain on disk until a later append rewrites the partition.

Limits: local timing is not a production throughput benchmark. No process-kill-at-rename or power-loss/fsync proof was performed. Missing/corrupt journals remain unknown; no recovery write is triggered by queries. Source code currently reads before checking maxBytes, so externally oversized files may incur read allocation; this is a reported hardening gap, not repaired in this evidence task. No online-rate, liveness, quota-headroom or business-success claim follows from retention tests.
