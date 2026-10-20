# Authority map — Checkpoint A

assessedAt: 2026-09-28T12:10:00+08:00
Code SHA: `6628f4bf364bd6d0560847b938b00e74035a8947`

Constitutional code is present. It is default-off, not wired into the authorities below, and not runtime-enabled. `runtimeEnabled: false`. `productionProven: unknown`.

## Map

| Authority                    | Where it lives                                                      | Relation to Constitutional on this SHA                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway chat / tool / server | `src/gateway/**`                                                    | No import of `constitutional-contracts`, `selectLegalPath`, `executeLegalPath`, `runRuntimeFacadeShadow`, or either `observe*` façade (`evidence/rg-authority.txt`).                                                                                                                                                                                    |
| Execution preflight          | `src/agents/execution-preflight/index.ts`, `resolve.ts`, `trace.ts` | Hot files do not mention `constitutional`. The observe module exists beside them and is not imported (test `constitutional-runtime-facade.test.ts:27-38`). It does not write receipts or traces.                                                                                                                                                        |
| Orchestration dispatch       | `src/task-orchestration/dispatch.ts`, `gateway-hook.ts`             | Do not contain `constitutional-runtime-facade` or `constitutional-contracts` (test `constitutional-runtime-facade.test.ts:13-20`). `ORCHESTRATION_LIVE_INVOKE` stays `false` (`types.ts:22`).                                                                                                                                                           |
| ConversationTask (CTR)       | `src/conversation-task/**`                                          | No import of Constitutional select/execute/façade. Five CTR env flags and the config store are a separate fail-closed surface (`feature.ts`, `config-store.ts:191-217`). Activation rows start `forced_off = 1` (`control-plane.ts:216-220`).                                                                                                           |
| Tenant / Profile A           | `personal_local` in `src/gateway/security-profile.ts:12`, `:71-72`  | Resolved by `resolveSecurityProfile` (`:120-149`) from env, then `gateway.security.profile`, then data mode. Client hints are rejected (`:124-125`). Constitutional packages do not call this function.                                                                                                                                                 |
| Tenant / Profile B           | `managed_enterprise` in `security-profile.ts:12`, `:74-75`          | Requires `OPENBOT_TENANT_EXECUTION_BOUNDARY=dedicated` (`:189-194`) and a tenants root (`:200-208`). `shared_process` is not accepted as that boundary (`:98-100` returns `shared_process`, then `:190` records `SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY`). Constitutional select/execute does not read `OPENBOT_TENANTS_ROOT` or the boundary env. |

## What Constitutional is allowed to say about profiles

`CONTRACT_PROFILES` is a schema label set: `personal_local`, `managed_enterprise`, `unspecified` (`packages/constitutional-contracts/src/schemas/contract.ts:16`). `crossDomainWriter` is the literal `false` (`contract.ts:30`). The file comment states the view does not merge Profile A with Profile B (`contract.ts:4-6`). The sample fixture uses `profile: "personal_local"` (`fixtures.ts:69`). That is fixture data, not a call into `resolveSecurityProfile`, and not a tenant write.

`executeLegalPath` documents that it does not write gateway or tenant data and does not mutate registry `executionAuthorized` (`execute.ts:10-12`).

## Posture

| Check                 | Result                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| code-present          | Yes. Contracts, select, execute stub, shadow façade, and two unwired observe wrappers are in the tree.                |
| default-off           | Yes. See `constitutional-flag-inventory.md`.                                                                          |
| not-wired             | Yes. Gateway, preflight barrel, dispatch, gateway-hook, and CTR do not call select, execute, or the observe wrappers. |
| not-runtime-enabled   | Yes. `runtimeEnabled: false`. No flag default was turned on. No hot path invokes the façade.                          |
| not-production-proven | Yes. Live gateway SHA is unknown. `productionProven` stays `unknown`.                                                 |

Checkpoint A does not authorize moving any row of this map.
