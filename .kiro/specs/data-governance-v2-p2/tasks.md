# Data Governance v2 — P2 Implementation

## Agents

- cursor-data-governance · role: owner · scope: P2 Lifecycle Command (Gate Pass → P2 Accepted) · paths: .kiro/specs/data-governance-v2-p2/**, src/gateway/data-governance/**, src/gateway/server-methods/data-governance\*.ts, src/data/conversation-archive\*, src/memory/\*\* · since: 2026-08-12

## Prerequisites

- [x] P1-2 Accepted (`5779ffb1e4`)
- [x] **P2 Gate Round 4 Pass** — Phase C unlocked
- [x] P2-a foundation + Rounds 2–5 — cursor-data-governance
- [x] **P2-a Accepted** — codex-data-governance

## Phase C

- [x] P2-a foundation (CAS / receipts / markers / resumePurge attempt)
- [x] P2-b conversation_archive two-phase + domain adapter + compensation — cursor-data-governance
- [x] P2-b CR (hold-race CAS retry + auto compensate handle / index / restore runtime) — cursor-data-governance
- [x] P2-b CR2 (domain verify snapshot TOCTOU + archive index lock) — cursor-data-governance
- [x] P2-b CR3 (full non-whitelist envelope fingerprint + index written-entry FP) — cursor-data-governance
- [x] P2-b CR4 (index FP mismatch keeps archive; lock return typing) — cursor-data-governance
- [x] **P2-b Accepted** — codex-data-governance
- [x] P2-c memory forget two-phase — cursor-data-governance
- [x] P2-c independent handoff (compensate + snapshot/hold races) — `.kiro/specs/data-governance-v2-p2/codex-handoff-p2c.md` — cursor-data-governance
- [x] P2-c CR (durable staging + crash recovery; filesystem/markdown_root only) — cursor-data-governance
- [x] P2-c CR2 (durable unlink dir fsync + restore keep_prior only on success) — cursor-data-governance
- [x] P2-c CR3 (resume parent fsync + staging mkdir parent chain) — cursor-data-governance
- [x] **P2-c Accepted** — codex-data-governance
- [x] P2-d purge closure stages (no success stub; Catalog → purged) — cursor-data-governance
- [x] P2-e adapter contracts + A7 matrix (workspace/agent/knowledge/operational_identity) — cursor-data-governance
- [x] P2 final acceptance package submitted — `.kiro/specs/data-governance-v2-p2/codex-handoff-p2-accepted.md` — cursor-data-governance
- [x] P2-d CR (durable parent-dir fsync + postgres/sqlite routing + purged-receipt heal) — `.kiro/specs/data-governance-v2-p2/codex-handoff-p2d.md` — cursor-data-governance
- [x] P2-d CR2 (allowed-root containment; locator cannot self-authorize) — cursor-data-governance
- [x] P2-d CR3 (trusted tenant root; no caller allowedRoots; bound handle) — cursor-data-governance
- [ ] **P2 Accepted** — codex-data-governance ← implementation owner does not claim Accept

## Notes

- Gate Pass ≠ P2 Accepted. — cursor-data-governance
- P2-a/b/c Accepted. P2-e narrow adapter contract accepted. P2-d CR3 resubmitted after caller-root P0 (`688b3e2ea2`). P3 not started. — cursor-data-governance
