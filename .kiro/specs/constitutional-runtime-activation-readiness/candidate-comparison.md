# Candidate comparison — Checkpoint B

assessedAt: 2026-09-28T12:34:00+08:00
Outcome: **A selected; B eliminated** (see `design-decision.md`)

## Candidates

### A — Execution-preflight post-decision observe (preferred)

| Field                              | Value                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Existing façade                    | `src/agents/execution-preflight/constitutional-runtime-facade.ts`                        |
| Entry                              | `observePreflightRuntimeFacade`                                                          |
| Placement                          | After `buildExecutionPreflight(...)` returns a result (primary: embedded attempt runner) |
| Mutates?                           | Must not: allow/deny, receipt, trace, capability auth, delivery hold                     |
| On observe error                   | Ignore Constitutional; keep existing preflight / business flow                           |
| Reads process.env in façade today? | No — caller-supplied snapshot / options only                                             |

### B — Orchestration post-dispatch observe (eliminated)

| Field            | Value                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Existing façade  | `src/task-orchestration/constitutional-runtime-facade.ts`                           |
| Entry            | `observeOrchestrationRuntimeFacade`                                                 |
| Placement        | After dispatch consideration (near `considerDispatch` / gateway-hook)               |
| Mutates?         | Must not: considerDispatch result, enqueue, invoke, node/browser choice, user reply |
| On observe error | Keep dispatch outcome unchanged                                                     |
| Extra risk       | Adjacent to orch flags and future live-invoke surface                               |

## Comparison matrix

| Criterion                         | A                                 | B                                  | Winner |
| --------------------------------- | --------------------------------- | ---------------------------------- | ------ |
| Post-decision clarity             | After preflight result exists     | After dispatch consideration       | A      |
| Distance from mutation APIs       | Receipt/trace writers separate    | Same package as `considerDispatch` | A      |
| Flag namespace collision          | New RUNTIME_SHADOW only           | Near ORCH\_\*/WEB_READ_SHADOW      | A      |
| Fail-open wording ambiguity       | Low                               | Medium ("keep dispatch")           | A      |
| Existing façade hard-false fields | `wroteReceipt`/`wroteTrace` false | `dispatchInvoked`/`enqueued` false | Tie    |
| Checkpoint A wiring posture       | Unwired; barrel excludes façade   | Unwired; dispatch excludes façade  | Tie    |
| Packet preference                 | Evaluate first                    | Eliminate unless lower risk        | A      |
| Evidence B is lower risk?         | —                                 | None found on tip                  | A      |

## Elimination statement

Candidate B is **eliminated** for Checkpoint B/C planning. Only Candidate A may proceed to design review and, after separate authorization, to Checkpoint C implementation.
