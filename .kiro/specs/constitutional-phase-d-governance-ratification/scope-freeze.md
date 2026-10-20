# Scope freeze — SUPERSEDE_PHASE_C_BOUNDED retention surface

assessedAt: 2026-09-27T10:31:00+08:00 (Asia/Shanghai)  
mainSha: `d8379ed919424c50d04c3be92cd2ef671f5e4580` (setup tip was `618fc8eb2e16cd04910615085b2ce3a1fa0c5694`; advanced by unrelated #120)  
Owner Choice: `SUPERSEDE_PHASE_C_BOUNDED` (Option A) — retention of existing default-off / not-hot-path code only  
Material Owner: grok-bot (amanuensis; not authorizer)

## Precision rule

This freeze lists **actual directories and files** observed on the recorded mainSha. Vague scopes such as `packages/**`, “all of Phase D”, or “constitutional-\*” without paths are **banned** as authorization language.

## IN SCOPE — retained surfaces (read/retain only; no further extension this round)

### A. `@openbot/constitutional-contracts` (sole implementation package)

Directory: `packages/constitutional-contracts/`

| Path                                                                     | Role                                 |
| ------------------------------------------------------------------------ | ------------------------------------ |
| `packages/constitutional-contracts/package.json`                         | package manifest                     |
| `packages/constitutional-contracts/README.md`                            | package docs                         |
| `packages/constitutional-contracts/tsconfig.json`                        | tsconfig                             |
| `packages/constitutional-contracts/tsconfig.build.json`                  | build tsconfig                       |
| `packages/constitutional-contracts/vitest.config.ts`                     | tests config                         |
| `packages/constitutional-contracts/src/index.ts`                         | public exports                       |
| `packages/constitutional-contracts/src/flags.ts`                         | fail-closed consts + shadow env name |
| `packages/constitutional-contracts/src/fixtures.ts`                      | fixtures                             |
| `packages/constitutional-contracts/src/constitutional-contracts.test.ts` | package tests                        |
| `packages/constitutional-contracts/src/schemas/common.ts`                | schemas                              |
| `packages/constitutional-contracts/src/schemas/contract.ts`              | schemas                              |
| `packages/constitutional-contracts/src/schemas/evidence.ts`              | schemas                              |
| `packages/constitutional-contracts/src/schemas/identity.ts`              | schemas                              |
| `packages/constitutional-contracts/src/schemas/index.ts`                 | schemas barrel                       |
| `packages/constitutional-contracts/src/adapters/index.ts`                | adapters                             |
| `packages/constitutional-contracts/src/adapters/map-sources.ts`          | adapters                             |
| `packages/constitutional-contracts/src/adapters/source-records.ts`       | adapters                             |
| `packages/constitutional-contracts/src/read-model/ledger-view.ts`        | read-model over injected snapshots   |
| `packages/constitutional-contracts/src/evaluator/shadow-report.ts`       | shadow evaluator                     |
| `packages/constitutional-contracts/src/path-gap/report.ts`               | path-gap report-only                 |
| `packages/constitutional-contracts/src/path-gap/report.test.ts`          | tests                                |
| `packages/constitutional-contracts/src/runtime-facade/shadow.ts`         | runtime façade shadow                |
| `packages/constitutional-contracts/src/runtime-facade/shadow.test.ts`    | tests                                |
| `packages/constitutional-contracts/src/legal-path/select.ts`             | selectLegalPath (default-off)        |
| `packages/constitutional-contracts/src/legal-path/select.test.ts`        | tests                                |
| `packages/constitutional-contracts/src/legal-path/execute.ts`            | executeLegalPath stub (default-off)  |
| `packages/constitutional-contracts/src/legal-path/execute.test.ts`       | tests                                |
| `packages/constitutional-contracts/src/legal-path/registry.ts`           | package-local path registry          |

### B. Product-split scaffolds (thin re-exports; not deployable products)

| Path                                                       | Role                               |
| ---------------------------------------------------------- | ---------------------------------- |
| `packages/constitutional-registry/package.json`            | scaffold manifest                  |
| `packages/constitutional-registry/README.md`               | docs                               |
| `packages/constitutional-registry/tsconfig.json`           | tsconfig                           |
| `packages/constitutional-registry/tsconfig.build.json`     | build tsconfig                     |
| `packages/constitutional-registry/vitest.config.ts`        | tests                              |
| `packages/constitutional-registry/src/index.ts`            | re-export boundary                 |
| `packages/constitutional-registry/src/boundary.ts`         | boundary marker                    |
| `packages/constitutional-registry/src/scaffold.test.ts`    | tests                              |
| `packages/constitutional-conformance/package.json`         | scaffold manifest                  |
| `packages/constitutional-conformance/README.md`            | docs                               |
| `packages/constitutional-conformance/tsconfig.json`        | tsconfig                           |
| `packages/constitutional-conformance/tsconfig.build.json`  | build tsconfig                     |
| `packages/constitutional-conformance/vitest.config.ts`     | tests                              |
| `packages/constitutional-conformance/src/index.ts`         | re-export boundary                 |
| `packages/constitutional-conformance/src/boundary.ts`      | boundary marker                    |
| `packages/constitutional-conformance/src/scaffold.test.ts` | tests                              |
| `packages/constitutional-runtime/package.json`             | scaffold manifest                  |
| `packages/constitutional-runtime/README.md`                | docs                               |
| `packages/constitutional-runtime/tsconfig.json`            | tsconfig                           |
| `packages/constitutional-runtime/tsconfig.build.json`      | build tsconfig                     |
| `packages/constitutional-runtime/vitest.config.ts`         | tests                              |
| `packages/constitutional-runtime/src/index.ts`             | re-export `runRuntimeFacadeShadow` |
| `packages/constitutional-runtime/src/boundary.ts`          | boundary marker                    |
| `packages/constitutional-runtime/src/scaffold.test.ts`     | tests                              |

### C. Observe facades under `src/` (present; **not** wired into hot-path barrels)

| Path                                                                   | Export                              | Notes                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/task-orchestration/constitutional-runtime-facade.ts`              | `observeOrchestrationRuntimeFacade` | calls `runRuntimeFacadeShadow`; imported by its `*.test.ts` only; tests assert `dispatch.ts` / `gateway-hook.ts` do not contain the string |
| `src/task-orchestration/constitutional-runtime-facade.test.ts`         | tests                               | isolation assertions                                                                                                                       |
| `src/agents/execution-preflight/constitutional-runtime-facade.ts`      | `observePreflightRuntimeFacade`     | calls `runRuntimeFacadeShadow`; not imported by production preflight barrel/builder                                                        |
| `src/agents/execution-preflight/constitutional-runtime-facade.test.ts` | tests                               | isolation assertions                                                                                                                       |

### D. This ratification packet (docs only)

| Path                                                            | Role                          |
| --------------------------------------------------------------- | ----------------------------- |
| `.kiro/specs/constitutional-phase-d-governance-ratification/**` | materials only                |
| `.loom/registry.yaml`                                           | via `pnpm loom register` only |

## OUT OF SCOPE / EXPLICIT BANS (remain in force)

1. **New global FSM** — no new hot-path authority state machine; façade is not a fifth execution story.
2. **New auth center** — no new centralized authorization product replacing gateway/preflight/CTR.
3. **New ledger** — no new production writer ledger; read-model is over injected snapshots only.
4. **Default execute** — `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` remains unset/off; execute stub must not become default-on.
5. **sessionKey as auth** — sessionKey remains routing-only; never capability/auth proof.
6. **receipt as proof** — receipt ≠ proof (non-equivalence frozen).
7. **workflow as Path** — workflow ≠ Path (non-equivalence frozen).
8. **plugin installed as capability auth** — plugin-installed ≠ capability-authorized.
9. **Flag enable / deploy / gateway wiring / live execute / further extension** — not approved by Option A.
10. **Vague scope language** as authorization — ban `packages/**`, “Phase D all”, “everything constitutional” without the precise paths above.
11. **Edits this round** under `src/**`, `packages/**`, `ui/**`, `extensions/**` (ratification is docs-only).
12. **Rewriting Phase C NO-GO bodies** or fabricating tripartite `AGREE_*` receipts.

## Claim ceiling (fixed for this packet)

`code-present` / `default-off` / `not-wired` / `not-runtime-enabled` / `not-production-proven`
