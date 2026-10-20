# Runtime wiring inventory — constitutional-contracts

assessedAt: 2026-09-27T10:20:00+08:00  
mainSha: `618fc8eb2e16cd04910615085b2ce3a1fa0c5694`  
Method: code `rg` across `src/`, `packages/`, `extensions/` (not docs alone)

## Package entrypoints

| Export / fn                     | File                                             | Default behavior                                                                      | Reads process.env?            | Side effects                                                        |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `isConstitutionalShadowEnabled` | `packages/constitutional-contracts/src/flags.ts` | false unless env snapshot truthy                                                      | **No** (caller snapshot only) | none                                                                |
| `reportPathGap`                 | `path-gap/report.ts`                             | inert unless `report:true` or `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT` snapshot       | No                            | none (report object only)                                           |
| `runRuntimeFacadeShadow`        | `runtime-facade/shadow.ts`                       | inert unless shadow opt-in; optional select bridge if SELECT also on                  | No                            | none; `executed` false; `shadowCompared` false                      |
| `selectLegalPath`               | `legal-path/select.ts`                           | inert unless `select:true` / SELECT env snapshot                                      | No                            | none; registry `executionAuthorized: false`                         |
| `executeLegalPath`              | `legal-path/execute.ts`                          | `executed=true` only if selectedPath≠null AND (`execute:true` / EXECUTE env snapshot) | No                            | package-local audit marker string only; **no** gateway/tenant write |

Hard-false constants: `CONSTITUTIONAL_CONTRACTS_ENFORCE`, `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE`, `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON`.

## Call chains (entry → execute)

### A. Package-local / tests only

| Chain              | Callers outside `packages/constitutional-contracts`                       | Hot-path?               |
| ------------------ | ------------------------------------------------------------------------- | ----------------------- |
| `selectLegalPath`  | **0** TypeScript callers outside package                                  | No — package tests only |
| `executeLegalPath` | **0** TypeScript callers outside package                                  | No — package tests only |
| `reportPathGap`    | re-exported by `@openbot/constitutional-conformance` + its scaffold tests | No                      |

### B. Opt-in observe facades under `src/` (present but isolated)

| Entry                               | File                                                              | Calls                    | Imported by production dispatch/gateway/preflight barrel?                                           |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `observeOrchestrationRuntimeFacade` | `src/task-orchestration/constitutional-runtime-facade.ts`         | `runRuntimeFacadeShadow` | **No** — only `*.test.ts`; tests assert `dispatch.ts` / `gateway-hook.ts` do not contain the string |
| `observePreflightRuntimeFacade`     | `src/agents/execution-preflight/constitutional-runtime-facade.ts` | `runRuntimeFacadeShadow` | **No** — only `*.test.ts`; tests assert builder/barrel sources do not contain the module            |

Both facades: do not read `process.env`; force `dispatchInvoked:false` / `wroteReceipt:false`; echo `ORCHESTRATION_LIVE_INVOKE` as false.

### C. Product-split scaffolds

| Package                               | Role                                | Hot-path?             |
| ------------------------------------- | ----------------------------------- | --------------------- |
| `@openbot/constitutional-registry`    | re-exports adapters/read-model      | No (scaffold + tests) |
| `@openbot/constitutional-conformance` | re-exports evaluator + path-gap     | No                    |
| `@openbot/constitutional-runtime`     | re-exports `runRuntimeFacadeShadow` | No                    |

### D. Related but separate (pre-existing orchestration shadows)

| Flag / API                                  | Location                                    | Relation to constitutional-contracts                                     |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`     | `src/task-orchestration/feature.ts`         | Distinct from `OPENBOT_CONSTITUTIONAL_*`; Gate C observe in gateway-hook |
| `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW` | same                                        | Distinct                                                                 |
| `ORCHESTRATION_LIVE_INVOKE`                 | `src/task-orchestration/types.ts` = `false` | Frozen; façade echoes it                                                 |

## Reachability conclusion

- **Actual execute path on hot chat/tool/ACP/AOR?** **No.** `executeLegalPath` has zero outside callers; when invoked in tests with EXECUTE on, side effect is only the string `package-local-execute-allowed`.
- **Shadow façade on hot path?** **No.** Observe helpers exist under `src/` but are not wired into dispatch/gateway-hook/preflight builder.
- **Fail-closed defaults?** **Yes** for constitutional flags (unset = off; enforce/live/fabric hard false).

## Authority FSM assessment

Package cannot independently complete/send/tool-call on gateway. `executeLegalPath` is a **package-local stub** gated by default-off EXECUTE and does not mutate registry `executionAuthorized` (stays false). Facade docs state "not a fifth execution story". **No new global authority FSM in production hot-path**; residual risk is future wiring of observe/execute into hot path without new authorization.
