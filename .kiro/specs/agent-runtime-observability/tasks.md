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
- No production/real gateway validation, push, PR, deployment or automatic experiment. P1 RPC and host UI connected in 32a341d03 and 29ca914a2; live execution linkage remains unavailable. — codex-observe-owner
- Telemetry rollback: revert 8e7cab7a1. No database migration; missing/invalid provenance reads unknown. Old JSON disk reload was not specifically tested. — codex-observe-owner

- P1 internal query c83d871df and RPC 32a341d03: explicit task/version/window, fresh membership and object ACL; missing execution source and unknown provenance remain explicit. — codex-observe-owner
- Final owner node run: 8 suites / 62 PASS; pack and adapter 6 PASS; Chromium 3 suites / 9 PASS; final UI build PASS with pin sync skipped. — codex-observe-owner
- Broader method-scopes suite: 10 PASS / 1 FAIL listing 8 unrelated unclassified methods; full-suite green not claimed. — codex-observe-owner
- P1 scope remains partial: no queryable trustworthy live execution history, live fully_linked sample, cost attribution or durable execution projection. P2 is not opened. — codex-observe-owner
- Query rollback: revert 32a341d03 and 29ca914a2 for RPC/UI integration; projection modules require no data migration. — codex-observe-owner
- Shared registry has concurrent command-budget task changes; subsequent observation registration increments remain uncommitted rather than landing another owner WIP. — codex-observe-owner

## Continued P1 execution evidence
- 198eec855: phantom attempt and conflicting outcome regressions fixed; improvementEligible remains false. — codex-observe-owner
- 420426f1c: stale identity/method/tenant/version response protection; Chromium 13 PASS. — codex-observe-owner
- 4f15a0745: independent actual CLI/embedded lifecycle facts plus explicit committed-version receipts; default flag off, 1000 facts, 15-minute process memory TTL. Not durable audit. — codex-observe-owner
- cd294b774: trusted retained facts and exact-version receipts feed scoped query; outcome provenance stays unknown, mixed-source samples remain invalid and improvement blocked. — codex-observe-owner
- c4019312b: UI shows execution references, retention, TTL, capacity, epoch and unknown continuity. — codex-observe-owner
- Owner validation: observation 8 suites / 59 PASS; original admitted runner/outcome 3 suites / 13 PASS; changed-file lint/format PASS. UI contributor build PASS with pin sync skipped. — codex-observe-owner
- Full tsgo: 54 diagnostics remain; no diagnostics in observation or modified admitted runner/outcome/diagnosis-panel paths. No full-green claim. — codex-observe-owner
- No live gateway or production verification, no observation flag enabled, no push/PR/deploy. P2 remains blocked by unverified live provenance and no real improvement-qualified sample. — codex-observe-owner
- Remaining: per-scope exact retention watermark, durable history, model-internal retries, command entrance coverage, reliable cost attribution, platform-role evidence rendering and original sixteen-material manifest. — codex-observe-owner
- Rollback: revert cd294b774 and 4f15a0745 for query/runtime collection; flag remains default off. No database migration. — codex-observe-owner
