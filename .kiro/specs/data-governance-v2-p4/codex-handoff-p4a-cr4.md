# Data Governance v2 — P4-a Codex Handoff CR4

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a CR3 Changes Required on `2a600bec7622948f60e97748f38ebad015971fc3` / impl `cf6ab7efcf45ca06b81b49913e002f9a4f0225c2`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                                                                                        | Fix                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyResourceConsentScope` / `verifySubjectConsent` / `reverifySubjectConsent` accepted a caller `catalog` or `store`. Any production module could pass a temporary object and mint a WeakSet-branded proof. | Those params are gone. Catalog and consent store are module-private bindings set only by `bindPlacementAuthority` (composition root). `verify*` reads the bound instances. Extra keys such as `catalog` / `store` fail closed.                                                                                                          |
| `bindPlacementAuthority` could become a new public mint                                                                                                                                                        | Not exported from the public barrel. Static scan: production files other than `placement-platform-verify.ts` must not mention `bindPlacementAuthority` or `resetPlacementAuthorityBindings`. Test harness is the only allowed installer in this slice.                                                                                  |
| `authTenantId` was a plain string                                                                                                                                                                              | Tenant identity comes from `GovernanceAuthenticatedCall` (`placementAuthTenantId`). A raw `{ callerTenantId }` object, a string `authTenantId`, or a branded call for another tenant cannot issue scope/proof/receipt. `trustedRegionDefaultFromReceipt` takes the same branded `call` and rejects extra keys including `authTenantId`. |

Retained from CR3: server clock (`Date.now()`), expiry on the opaque proof, `reverifySubjectConsent` re-reads the store, region HMAC, offline cannot be relaxed, consent binds tenant / resource / purpose / version and every authoritative subject.

---

## Implementation SHA

| Milestone                         | SHA                                        |
| --------------------------------- | ------------------------------------------ |
| Prior P4-a CR3 (Changes Required) | `cf6ab7efcf45ca06b81b49913e002f9a4f0225c2` |
| Prior CR3 review tip              | `2a600bec7622948f60e97748f38ebad015971fc3` |
| **This CR4 implementation**       | `2fa96ed2cbb395a0d261b613dfb00ca17b7fa22b` |
| **This review tip**               | `78e4b932ae5f301b667b4d6f1aa00ebc9c552be4` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr4 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
```

**76 passed** (1 file). Cache dir is explicit so this worktree does not depend on `.vite-temp` write permission.

New coverage:

- production caller injecting a forged `catalog` / `store` extra key cannot issue scope or proof
- raw `authTenantId`, unbranded `{ callerTenantId }`, and a branded call for another tenant all fail
- composition-root catalog + store still issue opaque proofs; revoke mutates the **bound** store and `reverifySubjectConsent` sees it
- barrel does not export `bindPlacementAuthority`

Gate CR3 contract tests still pass (`node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs`, 2 passed). Frozen design snippet still includes `trustedRegionDefault: string | null;`.

---

## Fail-before / pass-after

**Fail-before** (impl `cf6ab7efcf45ca06b81b49913e002f9a4f0225c2`):

1. `verifyResourceConsentScope({ authTenantId, resourceId, catalog })` accepted any caller loader. The test harness minted proofs that way, so production had the same raw-mint hole.
2. `authTenantId` was a plain string. A caller could pass another tenant id without a `GovernanceAuthenticatedCall`.

**Pass-after** (impl `2fa96ed2cbb395a0d261b613dfb00ca17b7fa22b`):

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr4 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
# Test Files  1 passed (1)
# Tests  76 passed (76)
```

1. `verify*` has no `catalog` / `store` / `authTenantId` parameters. Extra keys fail closed. Bind is composition-root only and not in the barrel.
2. Tenant comes from `GovernanceAuthenticatedCall`. Cross-tenant and unbranded auth fail.

---

## Stop

P4-a CR4 is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
