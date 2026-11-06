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

## Scope watermark and real host closure

- 8220c43e2: bounded per-scope tracking epochs and retained sequence/time ranges; expiration and capacity counts only cover that tracking epoch; prior history remains unknown. Disabled queries keep a stable epoch until state transition. — codex-observe-owner
- b0d84a543: enterprise shell forwards actual connection/auth scopes/session kind/method discovery; panel accepts only explicit complete safe-integer task references, clears partial drafts, and reuses evidence rendering on platform role without widening ACL. — codex-observe-owner
- Owner tests: observation 8 suites / 64 PASS; enterprise surface + panel Chromium 13 PASS. Contributor full Chromium regression 16 PASS; final UI build PASS with pin sync skipped. Changed-file lint/format PASS. — codex-observe-owner
- Full tsgo still reports 57 diagnostics; no diagnostics in this round observation/enterprise host/panel paths. No all-repository green claim. — codex-observe-owner
- Correction to earlier acceptance: previous component-only tests did not prove real enterprise host wiring. This round adds the actual surface integration test and fixes missing props. — codex-observe-owner
- Provenance remains unknown for outcomes; independent live execution does not relabel results live. P2 stays closed. No production/gateway verification, push, PR, deploy or observation flag enablement. — codex-observe-owner
- Rollback: revert b0d84a543 for host wiring and 8220c43e2 for scope statistics; no database migration. — codex-observe-owner

## Explicit supporting evidence windows

- f8556e635: optional evidenceLookupWindow contains cohort, is bounded to 30 days and server projectedAt; exact-version supporting events outside cohort are marked without increasing candidate denominator. Default unchanged. — codex-observe-owner
- f769c033a: UI distinguishes cohort and supporting evidence lookup windows; missing lookup does not imply expansion. — codex-observe-owner
- 4ecaf87b5: test fixture aligned with UUID, unknown eviction, improvement gate and scope watermark DTO. — codex-observe-owner
- Owner validation: 9 suites / 73 tests PASS; cross-window query contracts 35 PASS; evidence panel Chromium PASS; changed-file lint/format PASS. UI build PASS with pin sync skipped. — codex-observe-owner
- Final tsgo remains nonzero for other paths, with no observation/evidence path diagnostics after fixture correction. No production/gateway validation or release actions. Outcome provenance and improvement gates unchanged; P2 unopened. — codex-observe-owner
- Rollback: revert f8556e635 and f769c033a; no database migration. — codex-observe-owner

## P2 isolated control handoff

- User explicitly authorized entering P2 development; production writes, deployment and automatic experiments remain unauthorized. — codex-observe-owner
- 77625a93e: correlation-only ActionIntent reducer with explicit revisions, approval scope/diff/version binding, receipts, readback, verification and rollback evidence. Ordinary production transition remains evidence-blocked; isolated injected tests use a construction-bound factory. — codex-observe-owner
- e1937d8d7: isolated temporary-directory bridge reuses original Working DNA evolution apply/readback/rollback. No locally fabricated accepted receipt; applied-but-unrecorded retains application and doNotRetry after authorization withdrawal. Baseline checks are not atomic CAS. — codex-observe-owner
- 829ad9fd4: independent read-only status component; no apply/approval/experiment controls, no write RPC. Host integration and persistent correlation record are not implemented. — codex-observe-owner
- Owner validation: 11 suites / 100 tests PASS; P2 joint 30 PASS; Chromium component PASS; UI build PASS with pin sync skipped. Full tsgo 53 diagnostics remain, no action-intent path diagnostics. — codex-observe-owner
- Residual: production evidence qualification, atomic expected-version protection in original control plane, durable intent association, governance host/query integration and full rollback UI validation. No production or real gateway validation. — codex-observe-owner
- Rollback: remove three P2 module commits; no database migration, production configuration or task-result schema change. Shared registry P2 increments remain mixed with another task WIP and are not committed by this owner. — codex-observe-owner

## Ordered P1 P2 P3 acceptance 2026-11-07

- 4903a15dc and 13b394a78: bounded durable execution journal and default-off runtime/query wiring; exact agent/scope, restart reads, immutable identity conflicts, unknown write/read failures. Original synchronous query remains compatible. — codex-observe-owner
- 7538c1efb: async input/cfg/caller snapshot, current-tip consistency, original source identities and unconditional final membership recheck. Fail-before input mutation and stale-tip cases reproduced. — codex-observe-owner
- 5d3b2f50c: explicitly authorized association recovery appends original application receipt and independent readback under journal revision CAS, without apply/rollback/verify or factory authority restoration. Original application time and command digest retained; replay rechecks authorization and bindings. — codex-observe-owner
- 95e618042: authoritative immutable task-contract cohort dimensions, validator normalization, opaque cohort digest and version fingerprints; missing/unknown dimensions, provenance and improvement gates remain blockers. — codex-observe-owner
- Owner joint validation: 28 suites / 217 tests PASS, Chromium 5 suites / 25 PASS, pnpm tsgo PASS, UI build PASS with pinned sync skipped. Changed-file type-aware lint and formatting PASS. This is scoped code/isolated acceptance, not production validation. — codex-observe-owner
- Remaining: reliable task cost attribution, external reasoning role integration/quality evidence, actual gateway and production coverage, continuous liveness and authoritative balance collection. Default-off journal and bounded retention do not prove full history. P4 heartbeat activity remains an uncommitted separate module and is not liveness. — codex-observe-owner
- No push, PR, deployment, production config change, observation flag enablement or automatic experiment performed. Shared registry has concurrent-task increments and is not landed by this task. — codex-observe-owner
