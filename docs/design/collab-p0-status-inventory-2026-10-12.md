# Collaboration P0 status inventory (2026-10-12)

> Status: **code merged on `main`; flags remain OFF; N2 production cutover BLOCKED.**
>
> This note is the gap-only (path B) inventory for Floor Runtime v2.1 P0
> (tenant namespace isolation + RuntimeAuthority sole consumption + lint guards).
> It maps task-book names onto **existing** symbols. It does **not** authorize
> opening `collaboration.runtimeNamespace`, `collaboration.policySnapshot`,
> Floor live (`collaboration.floor.protocol=floor`), or Handoff defaults.

## 1. Task-book → existing symbols

| Task-book name                                       | Status                                | Existing symbol / file                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant namespace isolation for round-store / ledger  | **EXISTS** (flag OFF)                 | `resolveCollaborationRuntimeFactPaths`, `resolveRuntimeNamespace`, `RuntimeNamespaceTenantRequiredError` in `src/gateway/collaboration-dispatch/runtime-namespace.ts`; wired by `round-store.ts` / `collaboration-ledger/writer.ts` + `reader.ts` |
| Fail-closed when tenant context missing (managed)    | **EXISTS** (when flag ON)             | `RuntimeNamespaceTenantRequiredError`; G7 suite `runtime-namespace.g7.test.ts`                                                                                                                                                                    |
| organizationId / trusted runtime identity            | **EXISTS** as `tenantId` + trust      | `resolveCollaborationTenantResolution` / `CollaborationTenantTrustLevel` in `src/gateway/collaboration-learning/trusted-tenant.ts` (membership → actor_fallback → none). Request-declared org alone is not ACL SoT.                               |
| `resolveRoundEffectivePolicy`                        | **EXISTS** under group name           | `resolveGroupEffectivePolicy` / `compileAndFreezeGroupPolicyInput` in `resolve-effective-policy.ts` (clone → `deepFreeze` → `hashEffectiveCollaborationPolicy`)                                                                                   |
| PolicySnapshot per Episode                           | **EXISTS** (persist flag OFF)         | `RoundPolicySnapshot` / `createRoundPolicySnapshot*` in `round-policy-snapshot.ts`; in-memory always via `buildGroupRuntimeAuthority`                                                                                                             |
| RuntimeAuthority sole consumption entry              | **EXISTS**                            | `createRuntimeAuthority`, `buildGroupRuntimeAuthority`, `projectRuntimeFacts` in `runtime-authority.ts`; composition root `chat.ts`                                                                                                               |
| `authorize(action, trustedContext, snapshot)`        | **NOT added** (by design)             | Closest existing gate: `evaluateGovernanceGate` in `governance-gate.ts`. Path B forbids a parallel authorize API.                                                                                                                                 |
| CI / lint against policy-compiler bypass             | **EXISTS**                            | `pnpm lint:collab:runtime-authority` → `scripts/check-collab-runtime-authority.mjs`; `pnpm lint:collab:policy-consumption` → `scripts/check-collab-policy-consumption.mjs` (in `pnpm check`)                                                      |
| Cross-tenant same groupId / list overreach / history | **EXISTS** (+ named cases in this PR) | `runtime-namespace.test.ts`, `runtime-namespace.g7.test.ts`                                                                                                                                                                                       |
| Handoff contract                                     | **EXISTS** (flag OFF; P1+)            | `handoff-contract.ts` — out of P0 cutover                                                                                                                                                                                                         |
| Floor live cutover                                   | **OFF**                               | `floor-live-cutover.ts`; default protocol ≠ `floor`                                                                                                                                                                                               |

## 2. Defaults that must stay OFF

| Flag / constant                      | Default      | Note                                                             |
| ------------------------------------ | ------------ | ---------------------------------------------------------------- |
| `RUNTIME_NAMESPACE_CUTOVER_DEFAULT`  | `false`      | `runtime-namespace.ts` — do not flip in code or committed config |
| `collaboration.runtimeNamespace`     | unset/false  | N2 cutover runbook still blocks production enablement            |
| `collaboration.policySnapshot`       | unset/false  | In-memory snapshot still built; persistence gated                |
| `collaboration.floor.protocol`       | unset/legacy | Floor is not the live orchestrator                               |
| `collaboration.task.handoffContract` | unset/false  | P1+                                                              |

Cutover ops remain in
[`collab-floor-p0-0a-runtime-namespace-cutover-2026-10-05.md`](./collab-floor-p0-0a-runtime-namespace-cutover-2026-10-05.md).

## 3. Thin hardening in this PR (path B only)

1. **Docs** — this inventory (no second architecture).
2. **Chat composition root** — `chat.ts` calls `resolveCollaborationTenantResolution(client)` and passes `tenantTrust` into `buildGroupRuntimeAuthority({ tenantTrust })`. Reuses existing types; does not invent a second RuntimeAuthority or authorize API. `tenantId` still flows from `scope`.
3. **Named isolation tests** — flag ON list-overreach (`listPersistedRounds` / `readPersistedRound`) and history overreach (ledger archive) so tenant B cannot see tenant A for the same `groupId`.

## 4. Explicit non-goals (this PR)

- Parallel RuntimeAuthority / second policy compiler / new `authorize()` API
- Enabling namespace, policySnapshot, Floor live, or Handoff defaults
- Task board productization, Shadow-A/B as default, multi-beat
- Tip-prompt rule churn or Growth hot-path scoring

## 5. Acceptance checklist (for 执行效率合入验收)

1. Diff is thin: chat trust wiring + namespace overreach tests + this doc; no new orchestrator.
2. `RUNTIME_NAMESPACE_CUTOVER_DEFAULT === false`; Floor live still OFF; Handoff / policySnapshot defaults unchanged.
3. `pnpm lint:collab:runtime-authority` and `pnpm lint:collab:policy-consumption` pass.
4. Focused vitest: `runtime-namespace.test.ts` + `runtime-namespace.g7.test.ts` pass, including named list-overreach / history cases.
5. No HA / LIVE Floor / Path B deploy in this PR.
