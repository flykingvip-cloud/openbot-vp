# Data Governance v2 — P4-a Codex Handoff CR

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a Changes Required on `bb6ed632465ef9ce611588a270bdaa1a1272cc1d`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                            | Fix                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform region receipt was a plain `{ issuer: "platform" }` object; `trustedRegionDefaultFromReceipt` minted a real brand from it | Receipt is now a branded `PlatformDeploymentRegionReceipt`. Production verifier accepts only `isPlatformDeploymentRegionReceipt`. Structurally correct unbranded objects fail closed as `missing_trusted_region`.    |
| Test mint and production verifier were the same public function                                                                    | Mint lives in `placement-platform-authority.ts` (platform boundary) and `placement-resolve.test-mint.ts` (test mint). Neither is exported from the public barrel. `placement-resolve.ts` only verifies.              |
| `requestedOfflineRequired ?? policy.offlineRequired` let a caller `false` relax tenant `offlineRequired=true`                      | Effective offline is `policy.offlineRequired \|\| requestedOfflineRequired === true`. Request may strengthen, never relax.                                                                                           |
| `eligible-with-consent` + `openbot` returned encrypted-cloud with no consent proof                                                 | New deny `consent_required`. Requires branded `subjectConsent` bound to `auth.tenantId`. Governance approval / grant is not consent. Local-only fallback when `openbot` is not allowed still needs no cloud consent. |

---

## Implementation SHA

| Milestone                                    | SHA                                        |
| -------------------------------------------- | ------------------------------------------ |
| Prior P4-a implementation (Changes Required) | `bb6ed632465ef9ce611588a270bdaa1a1272cc1d` |
| **This CR implementation**                   | `e06f69b228e503ca4d2bf9fa915213789ad23d04` |
| **This review tip**                          | `70700075ddd302af251afd499ebaf651307d48d9` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
```

**65 passed** (1 file).

CR-specific coverage now present:

- structurally correct but unbranded `{ issuer: "platform" }` receipt
- tenant `offlineRequired=true` + `requestedOfflineRequired=false`
- `eligible-with-consent` missing / unbranded / grant-shaped consent
- barrel does not export `issue*` or `mint*ForTests`

Gate CR3 contract tests still pass (`gate-p4-cr2.test.mjs`, 2 passed).

---

## Fail-before / pass-after

**Fail-before** (impl `bb6ed632465ef9ce611588a270bdaa1a1272cc1d`):

1. `trustedRegionDefaultFromReceipt({ receipt: { kind, issuer: "platform", tenantId, region, receiptId }, authTenantId })` returned `ok: true` and a branded `trustedRegionDefault`.
2. `policy.offlineRequired=true` + `requestedOfflineRequired=false` + `encrypted-cloud` emitted `canonicalHome=managed_encrypted_cloud`.
3. `eligible-with-consent` + `openbot` + `subjectConsent=null` emitted encrypted-cloud projection.

Those three cases were not in the original 56 tests.

**Pass-after** (impl `e06f69b228e503ca4d2bf9fa915213789ad23d04`):

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
# Test Files  1 passed (1)
# Tests  65 passed (65)
```

1. Forged `{ issuer: "platform" }` → `missing_trusted_region`.
2. Tenant offline + request `false` → `canonicalHome=local` + projection.
3. Missing / unbranded / grant-shaped consent → `consent_required`.

---

## Stop

P4-a CR is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
