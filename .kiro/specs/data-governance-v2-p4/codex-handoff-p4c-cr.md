# Data Governance v2 — P4-c Codex Handoff CR (authorization closed loop)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `3b6f04db9d2d10b3039a012f47ac3161f69d908b` (P4-c pin)  
**This document does not claim P4-c Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-d was not started. P4-d stays locked until P4-c Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

Codex Changes Required on the first P4-c submission. This CR closes the production authorization loop around apply, tombstone, and serve.

| Finding                                                                     | Fix                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply did not bind grant to receipt (kind / scope / grantId / ownership)    | Apply now requires `auth.approvalGrant.grantId === receipt.grantId`, `grantKind: cognitive_promotion_apply`, resource scope = `receipt.resourceId`, stored grant re-read, Catalog `envelope.tenantId === callerTenantId`, and ownership proof vs Catalog owner |
| Tombstone could CAS another tenant's Catalog by `resourceId`                | Tombstone requires `grantKind: cognitive_projection_tombstone`, matching resource scope, Catalog envelope tenant, and ownership proof before any projection/Catalog write                                                                                      |
| Tombstone returned a forged in-memory `cpr_tombstone` receipt               | Unique-create durable `cognitive_projection_tombstone_receipt` first; refuse without it; never return a fake success object                                                                                                                                    |
| `serveCloudProjection` took raw `tenantId`                                  | API is now `{ call, resourceId }`; tenant from `call.callerTenantId`; Catalog envelope tenant checked before projection read                                                                                                                                   |
| Apply accepted wire `consentVersion` / `policyVersion` and did not reverify | Prepare persists verified consent/policy on the receipt; apply removes wire fields; apply reverifies consent and returns `consent_required` if revoked                                                                                                         |

---

## Implementation SHA

| Milestone                   | SHA                                        |
| --------------------------- | ------------------------------------------ |
| Prior review tip (P4-c pin) | `3b6f04db9d2d10b3039a012f47ac3161f69d908b` |
| Prior P4-c implementation   | `25970a468f7770bbd10aa0989957b1a3652feb69` |
| **This CR implementation**  | `a0ae9ddf0a3147f807e2fbf7dc12a169ce3141e0` |
| **This review tip**         | `70b7f0a5e9efc580671239e67bc57e7bf8061544` |

---

## Files changed

- `src/gateway/data-governance/cognitive-promotion-apply.ts`
- `src/gateway/data-governance/cognitive-promotion-apply.test.ts`
- `src/gateway/data-governance/cognitive-promotion-store.ts`
- `src/gateway/data-governance/cognitive-promotion.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/types.ts`
- `src/gateway/data-governance/index.ts`
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4c-cr.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

Barrel still does not export `writeApplyTxnJournal` / `finalizePromotionReceipt` / `uniqueCreatePreparedPromotionReceipt` / tombstone store internals.

---

## Apply grant / ownership / tenant

Order after branded actor + tenant match:

1. Load receipt by `replayId`
2. `grant.grantId === receipt.grantId` else `grant_mismatch`
3. `grantKind === cognitive_promotion_apply` else `grant_kind_mismatch`
4. grant resource scope === `receipt.resourceId` else `grant_scope_mismatch`
5. Re-read stored grant (revoked / expired / kind / scope / tenant)
6. Load Catalog; `envelope.tenantId === callerTenantId` else `envelope_tenant_mismatch`
7. Ownership proof matches Catalog owner (write-gate, plus tenant-user proof for user-scoped tenant rows)
8. Then applied replay / prepared apply

A same-tenant, same-actor auth for a **different** grant cannot apply this receipt.

---

## Tombstone lifecycle auth + durable receipt

- Grant kind is **`cognitive_projection_tombstone`**, resource-scoped. Promotion grants are `grant_kind_mismatch`.
- Catalog envelope tenant + ownership are checked before tombstone write or Catalog CAS.
- Durable receipt `kind: cognitive_projection_tombstone_receipt` in `data-governance/cognitive-promotions/tombstones.json`, unique by `sha256(grantId + resourceId + projection_tombstone)`.
- Unique-create `prepared` first. After §6.5 order, finalize `applied` with checksum. Missing unique-create → deny. No in-memory `cpr_tombstone`.

§6.5 order unchanged: tombstone `N+1` → checksum → Catalog CAS → hide body. Tombstone still wins on serve.

---

## serveCloudProjection

```ts
serveCloudProjection({ call: GovernanceAuthenticatedCall; resourceId: string; stateDir?: string })
```

- Tenant is `call.callerTenantId` only.
- Catalog load, then `envelope.tenantId === tenantId`, then projection/tombstone files under that tenant.
- Cross-tenant call against another tenant's `resourceId` is `envelope_tenant_mismatch`.

---

## Consent

- Prepare writes `policyVersion` from the recommendation and `consentVersion` from `reverifySubjectConsent` when the path is `eligible-with-consent`.
- Apply params no longer accept `consentVersion` / `policyVersion`.
- If the prepared receipt has `consentVersion`, apply calls `verifyResourceConsentScope` + `reverifySubjectConsent` **before** adapter writes. Revoked / missing / mismatch → `consent_required`.

---

## Tests and commands

`cognitive-promotion-apply.test.ts` now **20** tests. New negatives:

- grantId ≠ receipt.grantId → `grant_mismatch`
- grant kind `cognitive_merge_apply` → `grant_kind_mismatch`
- stored grant scope ≠ resourceId → `grant_scope_mismatch`
- Catalog owner ≠ proof → `ownership_mismatch`
- Catalog envelope tenant ≠ caller → `envelope_tenant_mismatch`
- tombstone with promotion grant → `grant_kind_mismatch`, no durable tombstone receipt
- consent revoked between prepare and apply → `consent_required`
- `serveCloudProjection` other-tenant call → `envelope_tenant_mismatch`

Scoped vitest: **154 passed / 5 files** (apply 20, promotion 42, placement 81, platform-root 4, cas-boundary 7).

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4c-cr \
pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  5 passed (5)
# Tests  154 passed (154)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` is not claimed. Scoped `oxlint --type-aware` and `oxfmt --check` on this CR's files: 0 warnings, 0 errors.

---

## Stop

P4-c authorization closed-loop CR is submitted for Codex Accept.

**未启动 P4-d。未宣称 P4-c Accepted / P4 first-wave Accepted / P4 Accepted。**

Do **not** start P4-d until Codex explicitly writes **P4-c Accept**.
