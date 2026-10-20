# E5 Shadow — runtime auto / skill auto vs control-plane Application

Status: **shadow only**. Landed on `origin/main` at `8c3b5e5508` (#1209). Production execution path is unchanged.

## Why

Historical auto still mutates beside the Evolution Control Plane:

- `runEvolutionGovernancePipeline` calls `applyGovernanceRuntimeAction`
- `runSkillAutoEvolutionPass` calls `installSkillToRobotAsset`

E5 must not announce single-track evolution until those paths consume a control-plane `Application`. Cutover is a later, separately approved PR.

## What this checkpoint records

Each live mutation attempt also writes a shadow row under
`evolution-governance/control-plane-application-shadow.jsonl`.

| Live path                                         | Intended Application                                               |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| runtime auto pause / resume / limit / clear_limit | `system.runtime-binding-governance` + adapter `runtime-governance` |
| skill-auto install                                | `capability.skill-installation` + adapter `skill`                  |

Every shadow row has:

- `scope: "shadow"`
- `appliedToRuntime: false`
- `cutoverReady: false`

The shadow writer does not `registerProposal`, `startExperiment`, Adapter.apply, or install.

## What stays live (unchanged)

- Kill switch
- `autoInstallIntent` + approval audit
- compare-and-restore in `runtime-actions.ts`
- Default governance mode **assist** (zero mutation)
- `autoApply=false` on registered surfaces

## Go / No-Go

| Check                                               | Now                                |
| --------------------------------------------------- | ---------------------------------- |
| Shadow Application matches the live mutation target | yes                                |
| Assist still mutates nothing                        | yes                                |
| Live tick / skill-auto still use direct mutators    | yes — on purpose                   |
| Single-track evolution                              | **No-Go** until a later cutover PR |

## Tests

```
pnpm exec vitest run src/gateway/evolution-governance/control-plane-application-shadow.test.ts
pnpm exec vitest run src/gateway/evolution-governance/tick-pipeline.test.ts
pnpm exec vitest run src/gateway/evolution-governance/skill-auto-evolution.test.ts
```
