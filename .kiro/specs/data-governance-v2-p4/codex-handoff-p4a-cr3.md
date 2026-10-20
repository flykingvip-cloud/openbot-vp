# Data Governance v2 — P4-a Codex Handoff CR3

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a CR2 Changes Required on `f6c42967455bea9be9bdf8db69fac4294f2bae97` / impl `1405eff0ac9acca5f19cd7150894961971d83691`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WeakSets were writable only by `registerVerified*ForTests`. Production had no way to rebuild a verified proof from a signed receipt, Catalog scope, or consent record. Restart emptied the sets. | New production adapter `placement-platform-verify.ts`: HMAC-verify a platform-signed deployment-region receipt (`OPENBOT_PLACEMENT_REGION_HMAC_KEY`); construct `resourceConsentScope` from `PlacementCatalogScopeLoader`; load consent from `PlacementConsentStore` (version, revoke, expiry vs server clock). Success binds an opaque frozen proof. Missing key, bad signature, revoked, or expired fail closed and issue nothing.                                         |
| `registerVerified*ForTests` / raw mint lived next to production types                                                                                                                            | Those register APIs are gone. Unauthenticated fixture mint exists only in `placement-resolve.test-harness.ts`, which signs a receipt or loads Catalog/store fixtures and then calls the **production** `verify*` APIs. Static scan: production `src/gateway/**/*.ts` must not import `issue*` / `mint*ForTests` / `registerVerified*` / the harness. `placement-platform-verify.ts` source contains no `ForTests`. Barrel exports `verify*` / `reverifySubjectConsent` only. |
| `evaluationTime` was a caller string; a past time could revive expired consent                                                                                                                   | Field removed from `PlacementResolverInput`. Freshness uses `placementTrustedNowMs()` (`Date.now()`). Proofs bind `verifiedAt`; consent also binds `consentEpoch`. `isSubjectConsentProof` re-checks `expiresAt > Date.now()` and `!revoked`, so a previously bound object expires when the server clock advances.                                                                                                                                                           |
| P4-b would have to trust a stale WeakSet object                                                                                                                                                  | `reverifySubjectConsent` re-reads the store. P4-b must call it before execute and must not permanently trust a prior proof object.                                                                                                                                                                                                                                                                                                                                           |

Retained from CR2: offline request cannot relax tenant `offlineRequired=true`; consent binds tenant / `resourceId` / purpose / `consentVersion` and must cover every authoritative subject; missing scope, cross-resource, partial subject, revoked, expired all deny; unregistered / grant-shaped objects cannot pass the verifier.

---

## Implementation SHA

| Milestone                         | SHA                                        |
| --------------------------------- | ------------------------------------------ |
| Prior P4-a CR2 (Changes Required) | `1405eff0ac9acca5f19cd7150894961971d83691` |
| Prior CR2 review tip              | `f6c42967455bea9be9bdf8db69fac4294f2bae97` |
| **This CR3 implementation**       | `cf6ab7efcf45ca06b81b49913e002f9a4f0225c2` |
| **This review tip**               | `cb6f6cdae9f2369f4c6e09446bf63ac5c274f0cb` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
```

**74 passed** (1 file).

New coverage:

- signed platform receipt verifies; bad signature and missing HMAC key fail closed
- Catalog loader + consent store produce opaque proofs; revoked / expired store records issue nothing
- `reverifySubjectConsent` sees a later revoke
- fake timers: a bound proof is valid, then `expiresAt` passes on the server clock → resolver `consent_required`
- production files must not import harness / `issue*` / `mint*ForTests` / `registerVerified*`
- `placement-platform-verify.ts` source must not contain `ForTests` or `registerVerified`

Gate CR3 contract tests still pass (`node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs`, 2 passed). Frozen design snippet still includes `trustedRegionDefault: string | null;`.

---

## Fail-before / pass-after

**Fail-before** (impl `1405eff0ac9acca5f19cd7150894961971d83691`):

1. Only `registerVerified*ForTests` could populate the WeakSets. There was no HMAC / Catalog / consent-store verify entry. Production could not rebuild a proof after restart.
2. `PlacementResolverInput.evaluationTime` was a caller string. A past time made expired consent look valid.

**Pass-after** (impl `cf6ab7efcf45ca06b81b49913e002f9a4f0225c2`):

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
# Test Files  1 passed (1)
# Tests  74 passed (74)
```

1. Production `verifyPlatformDeploymentRegionReceipt` / `verifyResourceConsentScope` / `verifySubjectConsent` rebuild opaque proofs from signed receipts, Catalog, and the consent store. `reverifySubjectConsent` re-reads the store.
2. `evaluationTime` is gone. Expiry and revoke are judged against the server clock; a bound proof expires when that clock advances.

---

## Stop

P4-a CR3 is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
