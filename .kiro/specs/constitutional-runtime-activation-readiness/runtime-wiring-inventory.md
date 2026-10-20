# Runtime wiring inventory — Checkpoint A refresh

assessedAt: 2026-09-28T12:10:00+08:00
mainSha: `6628f4bf364bd6d0560847b938b00e74035a8947`
Supersedes the wiring notes frozen at `618fc8eb` inside `.kiro/specs/constitutional-phase-d-governance-ratification/runtime-wiring-inventory.md` for this newer tip. Method: `rg` on this worktree (`evidence/rg-constitutional-symbols.txt`, `evidence/rg-wiring.txt`, `evidence/rg-authority.txt`).

## Package entrypoints

| Export                          | File                                                | Default                                               | Reads `process.env`? | Side effects                                           |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | -------------------- | ------------------------------------------------------ |
| `isConstitutionalShadowEnabled` | `packages/constitutional-contracts/src/flags.ts:35` | false on empty snapshot                               | No                   | none                                                   |
| `reportPathGap`                 | `path-gap/report.ts:192`                            | inert unless `report: true` or path-gap snapshot      | No                   | report object only                                     |
| `runRuntimeFacadeShadow`        | `runtime-facade/shadow.ts:193`                      | inert unless shadow opt-in                            | No                   | `executed` false; `shadowCompared` false               |
| `selectLegalPath`               | `legal-path/select.ts:209`                          | inert unless `select: true` or SELECT snapshot        | No                   | `executed` false; registry `executionAuthorized` false |
| `executeLegalPath`              | `legal-path/execute.ts:102`                         | `executed` true only if selected and EXECUTE opted in | No                   | package-local marker string only                       |

Hard-false constants: `CONSTITUTIONAL_CONTRACTS_ENFORCE`, `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE`, `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON` (`flags.ts:18-20`).

`OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` is not implemented on this SHA.

## Call chains

### A. Package-local

| Chain              | Callers outside `packages/constitutional-contracts`                    | Hot path? |
| ------------------ | ---------------------------------------------------------------------- | --------- |
| `selectLegalPath`  | 0                                                                      | No        |
| `executeLegalPath` | 0                                                                      | No        |
| `reportPathGap`    | re-export plus scaffold tests in `@openbot/constitutional-conformance` | No        |

### B. Opt-in observe façades under `src/`

| Entry                               | File                                                                 | Calls                             | Imported by dispatch / gateway-hook / preflight barrel?    |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `observeOrchestrationRuntimeFacade` | `src/task-orchestration/constitutional-runtime-facade.ts:34`         | `runRuntimeFacadeShadow` at `:38` | No. Only its test. Does not forward `select` or `execute`. |
| `observePreflightRuntimeFacade`     | `src/agents/execution-preflight/constitutional-runtime-facade.ts:51` | `runRuntimeFacadeShadow` at `:54` | No. Only its test. Does not read `process.env`.            |

### C. Scaffolds

| Package                               | Role                                | Hot path? |
| ------------------------------------- | ----------------------------------- | --------- |
| `@openbot/constitutional-registry`    | re-exports adapters and read model  | No        |
| `@openbot/constitutional-conformance` | re-exports evaluator and path-gap   | No        |
| `@openbot/constitutional-runtime`     | re-exports `runRuntimeFacadeShadow` | No        |

### D. Separate orchestration / CTR flags

Unchanged relative to the older inventory, re-checked on this SHA:

| Flag / API                                  | Location                               | Relation                               |
| ------------------------------------------- | -------------------------------------- | -------------------------------------- |
| `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`     | `src/task-orchestration/feature.ts:25` | Not an `OPENBOT_CONSTITUTIONAL_*` flag |
| `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW` | `feature.ts:102`                       | Not a Constitutional flag              |
| `ORCHESTRATION_LIVE_INVOKE`                 | `types.ts:22` = `false`                | Façade echoes it                       |

PR #171 (`scripts/governance`) does not call these entrypoints and does not set Constitutional flags.

## Reachability

- Hot chat / tool / ACP / AOR does not call `executeLegalPath`.
- The shadow façade is not on the gateway, dispatch, or preflight hot path.
- Fail-closed defaults hold for the Constitutional snapshots and for the CTR / web-read / orchestration env flags when unset.
- `runtimeEnabled` is false. This inventory is not a wiring authorization.
