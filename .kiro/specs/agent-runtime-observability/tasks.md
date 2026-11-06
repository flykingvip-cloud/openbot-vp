# Agent Runtime observability implementation

## Agents

- codex-observe-owner · role: owner · scope: P0/P1 integration and acceptance · paths: src/observation/**, src/gateway/agent-runtime-store.ts, src/gateway/agent-runtime-seed.ts, src/gateway/agent-runtime-telemetry.test.ts, ui/src/ui/observation/stream.node.test.ts, .kiro/specs/agent-runtime-observability/** · since: 2026-11-06

Registry is authoritative. Contributors: codex-observe-backend (telemetry), codex-observe-contract (metric dictionary), codex-observe-ui (stream contract tests). Only owner commits.

## Checkpoints

- [x] Read-only source review and fresh origin/main ancestry verification at 9850e00c9; unrelated command execution WIP preserved. — codex-observe-owner
- [x] P0 telemetry snapshot window and provenance compatibility; 8e7cab7a1. — codex-observe-owner
- [x] P0 versioned metric dictionary and UI semantic contracts; 389aa7f43. — codex-observe-owner
- [ ] P1 immutable-version sample assembly, scoped query and incremental UI evidence.

## Frozen decisions

- Telemetry snapshot window is [now-duration, now]; invalid/future timestamps excluded. Seven-day aggregate fields are not recomputed. Missing provenance is unknown, never implicitly live.
- Existing connection stream algorithm and execution_only semantics remain unchanged.
- Business closure cohort includes cancelled tips; cancellation remains cancellation. Delivery and acceptance remain independent.
- Link coverage attempted count includes deduplicated invalid candidates; invalidCount is explicit; zero denominator is unknown.
- fully_linked is linkage eligibility, never a positive outcome or automatic promotion authorization.
- No push, PR, deployment, production config writes or automatic experiments authorized.

## Evidence gaps

- Original sixteen-material manifest is unavailable; four abbreviated references cannot prove complete material review.
- Live telemetry writer is not established. Observation bridge has no task/version/attempt keys and no durable history.
- No production or real gateway verification performed.

## Acceptance checkpoints

- P0 owner rerun: 4 suites / 25 tests PASS; changed-file lint and format PASS. Chromium regression 7 PASS; UI build PASS with existing import/chunk warnings, pinned Control UI sync skipped. — codex-observe-owner
- P1 reader: 065001e6c, hardened by e5fc10e32; 12 tests PASS including fail-before/pass-after scope and same-version conflict cases. No store writes or recovery. — codex-observe-owner
- P1 assembler: d9f214b77; 17 tests PASS; reader + assembler joint 29 PASS. Fully-linked fixtures are not live validation. — codex-observe-owner
- No production/real gateway validation, push, PR, deployment or automatic experiment. P1 RPC and host UI remain unconnected. — codex-observe-owner
- Telemetry rollback: revert 8e7cab7a1. No database migration; missing/invalid provenance reads unknown. Old JSON disk reload was not specifically tested. — codex-observe-owner
