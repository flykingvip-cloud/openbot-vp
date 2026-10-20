# Core Implementation Recheck (v1.4)

Date: 2026-04-09

Purpose:

- Recheck only the planned core capabilities from PRD v1.1 + Technical Spec v1.4.
- Defer non-core expansion until core baseline is verified as stable.

## 1) Verification Commands

Executed:

- `pnpm --dir packages/cogniweave-sdk typecheck` -> pass
- `pnpm --dir packages/cogniweave-sdk test` -> pass (`83` tests)
- `python3 -m unittest discover -s tests -p "test_*.py"` (cwd `packages/cogniweave-sdk/python`) -> pass (`5` tests)
- `pnpm --dir packages/cogniweave-sdk run eval:mvp:gate` -> pass
- `pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate` -> pass
- `pnpm --dir packages/cogniweave-sdk run benchmark:longrun:gate` -> pass
- `pnpm --dir packages/cogniweave-sdk run benchmark:longrun:diff:gate` -> pass
- `pnpm --dir packages/cogniweave-sdk run benchmark:longrun:baseline:candidate` -> pass
- `pnpm --dir packages/cogniweave-sdk run benchmark:longrun:baseline:validate` -> pass
- `node --import tsx packages/cogniweave-sdk/bin/cogniweave.mjs --version --json` -> pass
- `node --import tsx packages/cogniweave-sdk/bin/cogniweave.mjs serve --dry-run --json` -> pass
- `pnpm --dir packages/cogniweave-sdk run smoke:serve` -> pass
- `pnpm --dir packages/cogniweave-sdk run integration:rollback` -> pass (`postgres/pgvector/neo4j` rollback checks all pass)

## 2) Core Module Status

| Module                 | Planned Core Goal                          | Status | Evidence                                                                                                                                    |
| ---------------------- | ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory Distiller       | Distill to canonical objects               | PASS   | `DistillationResult` includes `event/atoms/entities/scenarios/problems/relations/evidence/keys/writePlan`; staged rule pipeline implemented |
| Cognitive Graph Engine | Graph relations + conflict/version support | PASS   | graph relation model + derived sync + repair path available                                                                                 |
| Task Framer            | Task-driven structured input               | PASS   | `frameTask()` fixed-shape `TaskFrame`, rule+fallback strategy                                                                               |
| Path Reasoner          | Template-constrained retrieval and scoring | PASS   | template registry, constrained expansion, score, debug payload                                                                              |
| Memory Governance      | dedup/merge/conflict/confidence/lifecycle  | PASS   | merge decision model and governance APIs in engine                                                                                          |
| Evidence Resolver      | traceable evidence and explainability      | PASS   | trace/evidence resolve APIs with scope checks                                                                                               |

## 3) Core Flow Status

| Flow         | Planned Core Goal                                       | Status | Evidence                                                            |
| ------------ | ------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| Write-back   | `ingest -> distill -> canonical commit -> derived sync` | PASS   | two-phase write + journal + repair                                  |
| Reasoning    | `frame -> retrieve -> reason -> package`                | PASS   | template-constrained reasoning path + `CognitivePackage`            |
| Traceability | `atom -> event -> evidence`                             | PASS   | `trace`, `tracePackage`, `traceReasoningSession`, `resolveEvidence` |

## 4) Core Invariants

| Invariant                                  | Status | Notes                                             |
| ------------------------------------------ | ------ | ------------------------------------------------- |
| Metadata as source of truth                | PASS   | canonical-first commit model                      |
| Idempotent write path                      | PASS   | event/dedup/checksum key model + replay stability |
| Derived layer rebuildable                  | PASS   | `repairIndexes()` / `rebuildFromTruth()`          |
| Evidence out of hot path                   | PASS   | evidence lazy/explicit resolution only            |
| Reasoning uses latest/non-deprecated atoms | PASS   | latest filtering + deprecated exclusion           |
| Tentative/conflicted risk surfacing        | PASS   | `CognitivePackage.conflicts` risk markers         |

## 5) Freeze Recommendation

- Core runtime can be treated as feature-complete baseline.
- Keep `cogniweave-sdk-integration-rollback` CI job as continuous regression guard and artifact source.
- Keep `.github/workflows/cogniweave-sdk-nightly.yml` for sustained long-run benchmark artifact history.
- Keep `benchmark:longrun:diff:gate` enabled in nightly workflow for baseline regression detection.
