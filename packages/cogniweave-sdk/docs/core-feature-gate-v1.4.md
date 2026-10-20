# Core Feature Gate (PRD v1.1 + Technical Spec v1.4)

Date: 2026-04-08

Scope:

- Product contract baseline: `docs/prd-v1.1.md`
- System contract baseline: `docs/technical-spec-v1.4.md`
- Implementation target: `packages/cogniweave-sdk`

## Gate Rule

Status definition:

- `PASS`: usable and contract-aligned for MVP core path.
- `PARTIAL`: available but not fully aligned with declared contract.
- `FAIL`: missing or unusable.

## A. Core Runtime Modules

| Module                 | Expected                                                  | Status | Notes                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory Distiller       | `ingest/distill` + canonical outputs                      | PASS   | Distillation outputs full canonical objects (`event/atoms/entities/scenarios/problems/relations/evidence/keys/writePlan`) and runs staged rule-based pipeline (segmentation/context/normalization/repair/dedup) |
| Cognitive Graph Engine | relation management + graph sync                          | PASS   | Relation records + graph/vector derived sync + journal repair in place                                                                                                                                          |
| Task Framer            | structured `TaskFrame` + retrieval steering               | PASS   | Rule + cache + fallback path implemented, fixed-shape `TaskFrame`                                                                                                                                               |
| Path Reasoner          | seed retrieval + template-constrained expansion + scoring | PASS   | Template registry + DSL alias + constrained expansion + scoring + debug payload                                                                                                                                 |
| Memory Governance      | dedup/merge/conflict/confidence/lifecycle                 | PASS   | `upsertAtoms` decision model + conflict/confidence/deprecate/supersede/merge APIs                                                                                                                               |
| Evidence Resolver      | atom/event/evidence trace + access control                | PASS   | Resolver + trace chain + scope guard on cold-read path                                                                                                                                                          |

## B. Core User Flows

| Flow        | Expected                                             | Status | Notes                                                               |
| ----------- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| Write flow  | Input -> distill -> canonical commit -> derived sync | PASS   | Two-phase write + `WriteBackResult` canonical/derived split         |
| Reason flow | Task frame -> seed -> path reasoning -> package      | PASS   | Template-based path reasoning + explainable package output          |
| Trace flow  | Atom -> Event -> Evidence                            | PASS   | `trace`, `tracePackage`, `traceReasoningSession`, `resolveEvidence` |

## C. System Invariants (v1.4)

| Invariant                                        | Status | Notes                                                                                                                  |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Metadata DB as source of truth                   | PASS   | Runtime commit model and repair flow are metadata-first                                                                |
| Idempotent writes                                | PASS   | Canonical IDs/keys for event/atom/entity/scenario/problem/evidence/relation; replay no object explosion in core stores |
| Graph/Vector fully rebuildable                   | PASS   | `repairIndexes` + `rebuildFromTruth` implemented                                                                       |
| Evidence not in hot path                         | PASS   | Reasoning uses atoms/relations; evidence only on explicit resolve/trace                                                |
| Reasoning uses latest + non-deprecated           | PASS   | Deprecated filtered, latest selector applied before reasoning                                                          |
| Tentative/conflicted must be explicit in package | PASS   | Risk markers surfaced in `CognitivePackage.conflicts`                                                                  |

## D. SDK/REST Core Surface

| Surface                         | Status | Notes                                                                                     |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| TypeScript SDK core contracts   | PASS   | Core objects and result contracts are stable and typed                                    |
| REST 1:1 mapping                | PASS   | Endpoints map to engine contracts; write-back status mapped to HTTP                       |
| Idempotency/Journal exposure    | PASS   | `Idempotency-Key` propagated; `x-cogniweave-journal-id`/`x-cogniweave-event-key` returned |
| Scope enforcement on cold reads | PASS   | Scope required for trace/evidence/journal reads (request header or payload scope)         |

## E. MVP Deliverables (Product-Level)

| Deliverable                   | Status | Notes                                                                                                    |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| TypeScript/Python SDK         | PASS   | TypeScript SDK + Python REST client are available                                                        |
| REST API                      | PASS   | Node HTTP surface and service mapping available                                                          |
| Graph + Metadata adapters     | PASS   | Memory + placeholder + Postgres/Neo4j/PgVector adapter layer present                                     |
| Local development environment | PASS   | CLI + examples + tests available                                                                         |
| Example agent project         | PASS   | Minimal and writeback-repair examples available                                                          |
| Example dataset               | PASS   | `datasets/mvp-core-eval.json` added                                                                      |
| Evaluation scripts            | PASS   | `scripts/eval-mvp.ts` + `eval:mvp`/`eval:mvp:gate` scripts added                                         |
| Benchmark scripts             | PASS   | `scripts/benchmark-mvp.ts` + `benchmark:mvp`/`benchmark:mvp:gate` scripts added                          |
| Documentation                 | PASS   | PRD/spec/runtime/REST/CLI/audit docs are present                                                         |
| CI quality gate               | PASS   | `cogniweave-sdk-core-gate` runs TS tests + Python tests + `eval:mvp:gate` + `benchmark:mvp:gate`         |
| Install smoke gate            | PASS   | `build` + tarball install smoke validate independent import and CLI startup path                         |
| Publishable package boundary  | PASS   | package manifest now targets compiled `dist` output and is no longer restricted to private workspace use |

## Final Gate Decision

Core runtime and MVP deliverable status: **PASS**.

Current non-blocking notes:

1. Evaluation metrics are baseline-only and should be tracked as regression guardrails (not final production targets).
2. Next phase should focus on quality lift rather than surface expansion.

Recommended freeze point:

- Freeze current runtime/contract surface as `core-runtime baseline`.
- Open a separate deliverables track for Python SDK + dataset + evaluation tooling.
