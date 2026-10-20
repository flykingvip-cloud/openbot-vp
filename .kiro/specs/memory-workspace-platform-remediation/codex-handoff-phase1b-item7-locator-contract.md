# Phase 1B Item 7 locator contract

This round reports a **strict resolver/locator contract** after stopping Item 7 retirement execute. It does **not** delete the 37 `productionWriteWatchIndex` call-sites.

`status=locator-contract-in-progress` means the contract and security tests landed. It does **not** mean Item 7 met.

| Field                               | Value                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| status                              | locator-contract-in-progress                                                 |
| item7 / itemMet                     | false / not-met                                                              |
| phase1bUnlock / fullUnlock          | not-issued                                                                   |
| phase1bExecutionBlocked             | true                                                                         |
| deployAuthorized                    | false                                                                        |
| wiredToProductionResolver           | false                                                                        |
| productionCatalogWrite              | none                                                                         |
| schemaV2Write                       | disabled                                                                     |
| live                                | forbidden                                                                    |
| deleteCallSites                     | false                                                                        |
| retiredThisChange                   | 0                                                                            |
| liveWriteWatchIndex                 | 37                                                                           |
| frozenWriteWatchIndex               | 38                                                                           |
| independentRetirementReviewAccepted | false                                                                        |
| rollbackProof / quarantineProof     | false                                                                        |
| originMainSha                       | `e894568ab7f1b6a162d55d6fd84196b392876109`                                   |
| runtime                             | `src/gateway/workspace-resolver/strict-locator.ts`                           |
| PR URL                              | https://github.com/gmood2008/openbot/pull/592                                |
| retirement execute                  | existing 37-call-site deletion worktree left uncommitted, unpushed, unmerged |

## Allowed this round

- Require TenantContext, tenantId, actor/user/grant, exact resourceId, exact agentAssetId, unique active canonical binding
- Return `{ ok: true, handle/locator }` or `{ ok: false, reasonCode }`
- Fail closed on managed miss / conflict / auth failure
- Security tests: tenant isolation, duplicate slug across tenants, missing TenantContext, catalog missing/ambiguous/multi-binding, legacy caller matrix

## Forbidden this round

- deleting any of the 37 live call-sites
- rewriting `liveWriteWatchIndex` 37 to 0
- wiring `resolveWorkspaceLocator` into production callers
- changing canonical unlock receipts or `unlock-current.json`
- LIVE cutover
- schema v2 production write
- Catalog miss returning `workspaceDir=""`

## Requested review

**Item 7 Locator Contract Review only.**

Not requested: Retirement execute, call-site deletion, Item 7 met, Phase 1B full unlock, LIVE cutover.

A later independent **retirement preflight PR** is still required before any batched replacement (`rollbackProof`, `quarantineProof`, `independentRetirementReviewAccepted`, and per-site fail-before/pass-after tests).
