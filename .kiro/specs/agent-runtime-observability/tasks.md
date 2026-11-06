# Agent Runtime observability implementation

## Agents

- codex-observe-owner · role: owner · scope: P0/P1 integration and acceptance · paths: src/observation/**, src/gateway/agent-runtime-store.ts, src/gateway/agent-runtime-seed.ts, src/gateway/agent-runtime-telemetry.test.ts, ui/src/ui/observation/stream.node.test.ts, .kiro/specs/agent-runtime-observability/** · since: 2026-11-06

Registry is authoritative. Contributors: codex-observe-backend (telemetry), codex-observe-contract (metric dictionary), codex-observe-ui (stream contract tests). Only owner commits.

## Checkpoints

- [x] Read-only source review and fresh origin/main ancestry verification at 9850e00c9; unrelated command execution WIP preserved. — codex-observe-owner
- [ ] P0 telemetry snapshot window and provenance compatibility.
- [ ] P0 versioned metric dictionary and UI semantic contracts.
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
