# Design decision — Checkpoint B shadow wiring candidate

assessedAt: 2026-09-28T20:05:00+08:00
Decision: **Select Candidate A; reject Candidate B**
Review state: freeze cycle 2 — Checkpoint B **REVISE**; cycle-1 Architecture `AGREE_SHADOW_WIRING` applies only to the superseded digest; cycle-1 Security **REVISE**; cycle-1 Execution-chain **REVISE**; cycle-2 reviews **PENDING**

## Decision

**Selected:** Candidate A — Execution-preflight post-decision observe via existing
`src/agents/execution-preflight/constitutional-runtime-facade.ts` (`observePreflightRuntimeFacade`).

**Rejected:** Candidate B — Orchestration post-dispatch observe via
`src/task-orchestration/constitutional-runtime-facade.ts` (`observeOrchestrationRuntimeFacade`).

The cycle-1 Security and Execution-chain REVISE findings do not change the candidate choice. They tighten the Candidate A dependency, failure, profile and caller contracts (see "Cycle-2 binding" below).

## Why A

1. **Post-decision clarity** — A observes only after `buildExecutionPreflight` has produced a result. That matches R11 and keeps Constitutional outside the decision maker.
2. **Lower mutation adjacency** — Preflight allow/deny/hold already exist; observe sits beside them. Orchestration `considerDispatch` / enqueue / node|browser choice is a higher-blast surface even when `ORCHESTRATION_LIVE_INVOKE` is false.
3. **Façade shape** — Preflight façade already documents `wroteReceipt: false` / `wroteTrace: false` and maps injected rows without writing back. Fit for minimized post-decision projection.
4. **Authority map (Checkpoint A)** — Preflight barrel / resolve / trace do not import the façade today; wiring A is a deliberate, reviewable import edge. B would sit next to dispatch/gateway-hook where orch shadow already has separate semantics (`OPENBOT_CONVERSATION_TASK_ORCH_*`), raising flag-confusion risk.
5. **Fail-open story** — "Ignore Constitutional observe; keep existing preflight flow" is unambiguous. B's "keep dispatch" is easy to misread as softening dispatch gates.
6. **Sync first-slice fit** — A’s post-decision observe can be a fully synchronous, total call without dispatch queues.
7. **Bounded caller surface** — `runEmbeddedAttempt` has exactly three direct callers at the verification baseline (one production, two tests), so explicit deps injection can be locked by an exact allowlist.

## Why not B (elimination)

| Risk                   | Evidence                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Dispatch adjacency     | `considerDispatch` lives in the same module family; accidental coupling is higher.                 |
| Flag confusion         | ORCH_SHADOW / WEB_READ_SHADOW / LIVE_INVOKE already occupy orchestration mental model.             |
| Dormant-but-dangerous  | Orchestration is dormant (`ORCHESTRATION_LIVE_INVOKE=false`) but still a future execution surface. |
| No lower-risk evidence | Checkpoint A inventories show B is not safer; packet prefers A unless B is clearly lower risk.     |

Candidate B remains archived as rejected. Checkpoint C must not implement B without a new design decision that supersedes this document.

## Injection binding

`runEmbeddedPiAgent` (`run.ts`) reads `process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` once, parses it with `parseConstitutionalRuntimeShadowFlag`, and freezes `ConstitutionalRuntimeShadowDeps = { runtimeShadowEnabled, sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK, now: performance.now.bind(performance) }`. It passes that object on the required `EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps` field to every `runEmbeddedAttempt`. `attempt.ts` reads `params.constitutionalRuntimeShadowDeps` only — no factory, no default, no `process.env`.

Forbidden: global setter, module-level mutable deps, prototype patch, environment objects or maps in deps or params, optional deps field, deep `process.env` reads in attempt/gate/projection/observe/sink, test-only backdoors or fallbacks.

Gate-off: one boolean check on `deps.runtimeShadowEnabled`; no attempt-level sink create, no `sink.record` / `sink.recordError`, no projection, no façade, no metrics. The module-level `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK` is reused by the outer runner and does not count as attempt-level init.

## Cycle-2 binding (Security + Execution-chain REVISE)

| Finding                      | Decision in cycle 2                                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 full `process.env`        | Withdraw `env` from deps and the `createDefault…Deps({ env })` factory. Deps carry only `runtimeShadowEnabled: boolean`; the one flag key is read once in `run.ts`; untrusted inputs cannot set it (B-24, B-27, B-29, B-30, B-39). |
| S2 sink double fault         | All sink calls go through `safeRecord` / `safeRecordError`; projection/façade throw → `safeRecordError`; `sink.record` throw never triggers `recordError`; no fallback channel (B-31, B-32, B-33, B-38).                           |
| S3 profile source            | First slice emits `profileCategory: "unspecified"` only; no Profile resolution dependency; never synthesizes Profile A/B (B-34, B-35).                                                                                             |
| Execution-chain caller scope | Add `run/attempt.spawn-workspace.test.ts` and `run/execution-router-shadow.test.ts` to the exact-path scope; both pass deps explicitly; required field; direct-caller allowlist lock (B-36, B-37).                                 |

## Binding claims

| Claim                                               | Value                                          |
| --------------------------------------------------- | ---------------------------------------------- |
| Checkpoint B design                                 | **REVISE** (freeze cycle 2)                    |
| Architecture (cycle 1)                              | `AGREE_SHADOW_WIRING` on the superseded digest |
| Security (cycle 1)                                  | **REVISE**                                     |
| Execution-chain (cycle 1)                           | **REVISE**                                     |
| Architecture / Security / Execution-chain (cycle 2) | **PENDING**                                    |
| `runtimeEnabled`                                    | `false`                                        |
| `productionProven`                                  | `unknown`                                      |
| `checkpointCImplementationAuthorized`               | `false`                                        |
| This document authorizes implementation?            | **No**                                         |
| PR #181 merge authorizes implementation?            | **No**                                         |
