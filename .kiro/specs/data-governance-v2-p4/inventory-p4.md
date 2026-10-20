# P4 Inventory — Governed Placement and Sync

**Date:** 2026-08-16  
**Baseline:** P3 Accepted tip `84a4165093`  
**Architecture target:** §12, §16 P4, §17.5  
**Gate:** CR3 after `20f548edde` (planning only; D1–D19 retained; trusted region + replay order amended in `design-p4.md`)

## Current vs target

| Architecture item                              | Current                                                                                                                       | Gap                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Placement / residency resolver (§12.1–12.2)    | Absent as a governance command. Envelope may carry residency-related policy fields from earlier phases; no dedicated resolver | P4-a: resolve mode from frozen inputs; fail closed on missing managed context                                |
| Sync classification (§12.3)                    | CogniWeave / shadow candidate may carry `syncEligibility`; P3 `decideShadowPromotion` already denies `blocked`                | Governance must treat authenticated tenant + policy as authority; envelope cannot self-assert another tenant |
| Cloud projection (§12.4)                       | Absent as governed projection envelope                                                                                        | P4-b/c: projection refs + checksum + consent/policy version + tombstone version; not an automatic mirror     |
| Shadow promotion decision                      | **Present:** `src/gateway/data-governance/cognitive-shadow-promotion.ts` (`decideShadowPromotion`)                            | **Reuse as-is.** P4 must not fork thresholds or invent a parallel judge                                      |
| Promotion **execution**                        | Absent. P3 records `recommend_admit` / `recommend_deny` only                                                                  | P4-b: signed protocol, `GovernanceApprovalAuth`, durable receipt, binding update                             |
| Local adapter                                  | Filesystem / sqlite bindings exist for Catalog resources                                                                      | P4-c: explicit local placement path with residency + offline rules                                           |
| Managed encrypted cloud adapter                | Absent for promotion; P2 purge fail-closes object-store/BYOS without adapter                                                  | P4-c first wave only; signed tenant-bound client                                                             |
| BYOS / tenant cloud / cold archive / dedicated | `storageKind` includes `byos`; purge adapters fail closed                                                                     | **Out of first wave.** Stay fail-closed until later unlock                                                   |
| Export / restore across placement              | No placement-aware export                                                                                                     | P4-d: change binding only; preserve `resourceId` / `agentAssetId`                                            |
| Cross-tenant false allow                       | TenantContext + membership auth exist for recommendations                                                                     | P4 matrix must prove false allow = 0                                                                         |
| Tombstone / revoke propagation                 | P2 tombstones for purge; cloud replica propagation incomplete for promotion                                                   | P4-b/c: end-to-end revoke + tombstone for promoted projections                                               |

## Authority map

| Concern                                   | Authority today                         | P4 target                                            |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Whether promotion is **allowed** (shadow) | `decideShadowPromotion`                 | Unchanged — sole decision entry                      |
| Whether promotion **executes**            | Missing                                 | `GovernanceApprovalAuth` + grant + signed protocol   |
| Where bytes live                          | Catalog binding `storageKind` / locator | Placement resolver + binding CAS; identity unchanged |
| Tenant of a cloud write                   | Must come from authenticated call       | Envelope tenant is never trusted as cloud authority  |
| Deletion of sources                       | P2 lifecycle only                       | Unchanged — P4 must not open purge/forget            |

## Proposed surfaces (not coded in Gate drop)

- `src/gateway/data-governance/placement-resolve.ts` (or equivalent) — P4-a
- `src/gateway/data-governance/cognitive-promotion.ts` — P4-b execution wrapping `decideShadowPromotion`
- `src/gateway/data-governance/cognitive-promotion-store.ts` — receipts
- Placement adapters under `src/gateway/data-governance/` or existing storage adapter layer — P4-c
- Export/restore helpers for binding rewrite — P4-d
- Directed tests: `cognitive-p4a.test.ts` … `cognitive-p4d.test.ts` (names freeze at implementation)

## Explicit non-inventory

- Forking `decideShadowPromotion` or copying `0.8` / `0.5` into the executor
- First-wave BYOS success paths
- Dual Catalog; identity-kernel flatten
- P5 schema ladder / key rotation coding
