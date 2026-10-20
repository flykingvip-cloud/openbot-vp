# Phase 1B Item 7 retirement preflight

This round reports an **independent retirement preflight**. It does **not** delete the 37 `productionWriteWatchIndex` call-sites.

`rollbackProof=true` and `quarantineProof=true` are exercised in tests. `independentRetirementReviewAccepted=false` until independent review.

| Field                               | Value                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| status                              | retirement-preflight                                        |
| item7 / itemMet                     | not-met / false                                             |
| rollbackProof                       | true                                                        |
| quarantineProof                     | true                                                        |
| independentRetirementReviewAccepted | false                                                       |
| phase1bUnlock / fullUnlock          | not-issued                                                  |
| phase1bExecutionBlocked             | true                                                        |
| deployAuthorized                    | false                                                       |
| wiredToProductionResolver           | false                                                       |
| productionCatalogWrite              | none                                                        |
| schemaV2Write                       | disabled                                                    |
| live                                | forbidden                                                   |
| deleteCallSites                     | false                                                       |
| retiredThisChange                   | 0                                                           |
| liveWriteWatchIndex                 | 37                                                          |
| liveCallSiteCount                   | 37                                                          |
| replacement                         | `resolveWorkspaceLocator`                                   |
| depends on                          | #592                                                        |
| originMainSha                       | `e894568ab7f1b6a162d55d6fd84196b392876109`                  |
| runtime                             | `src/gateway/data-governance/item7-retirement-preflight.ts` |
| PR URL                              | https://github.com/gmood2008/openbot/pull/593               |

## Allowed this round

- Prove rollback (lift tombstone, restore legacy, no production write)
- Prove quarantine on dual-read mismatch without Catalog miss=deny
- Tenant isolation, duplicate slug, missing TenantContext, catalog missing/ambiguous/multi-binding
- Legacy caller compatibility matrix
- Fail-before / pass-after replacement-path verification for each of the 37 live call-sites

## Forbidden this round

- deleting any of the 37 live call-sites
- rewriting `liveWriteWatchIndex` 37 to 0
- wiring `resolveWorkspaceLocator` into production callers
- self-issuing `independentRetirementReviewAccepted=true`
- changing canonical unlock receipts or LIVE

## Requested review

**Item 7 Retirement Preflight Review only.**

Not requested: Retirement execute, call-site deletion, Item 7 met, Phase 1B full unlock, LIVE cutover.

Batched replacement PRs stay forbidden until this preflight is independently accepted.
