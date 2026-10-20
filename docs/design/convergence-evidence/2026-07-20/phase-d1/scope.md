# Phase D1 — scope

**Agent:** `cursor-convergence-phase-d1`  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`  
**Base:** `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (+ D0 tip `cdc439e051`)

## Included

| Area                               | Change                                                                                                                | Source                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `enterprise.organization.snapshot` | Switch to `requireResolvedEnterpriseTenantId` (reject forged `tenantId`)                                              | Local rewrite on locked base (parity with enterprise-data seat context) |
| `requireEnterpriseScope`           | After scope resolve, reject explicit `tenantId`/`enterpriseId` mismatch vs `isScopeAuthorizedForTenant`               | Local rewrite (D1 negative gate)                                        |
| `method-scopes.ts`                 | Register `enterprise.organization.snapshot` under operator **read**                                                   | Hotfile wiring (minimal +1 line)                                        |
| Tests                              | `enterprise-organization.tenant-scope.test.ts` — forged reject + match accept for snapshot + `requireEnterpriseScope` | New                                                                     |

## Excluded (DEFER)

- Control UI / mobile login UX
- Knowledge import, CogniWeave product
- Evolution governance / skill-auto
- Agent roster catalog product pack
- Closing pre-existing unclassified RPC holes: `platform-capability.return-for-modification`, `platform-capability.approve-enterprise-only`, `knowledge.personal.uploadFolder`
- UI shell-slices (23) / enterprise-data-m1 (9) tsgo noise
- Shared-tree WIP (monthly-usage / `app.ts`) — **discarded**, not landed

## Dirty WIP handling

On start and mid-flight, discarded unrelated dirty/untracked: `method-scopes` monthly-seat-usage, `server-methods.ts` monthly handlers, `ui/**` organization monthly-usage, `src/gateway/organization/**`.
