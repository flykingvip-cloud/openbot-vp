# Data Governance v2 — P4-a Codex Handoff

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** P4 Gate Accepted (planning only, 2026-08-16); CR3 package `c58652f74e` / pin `8df8f84126`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Scope

P4-a only: placement / residency resolver as a **pure decision**.

| In                                                      | Out                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `src/gateway/data-governance/placement-resolve.ts`      | Catalog writes                                                  |
| `src/gateway/data-governance/placement-resolve.test.ts` | Adapter calls                                                   |
| barrel export from `index.ts`                           | Grant consume                                                   |
| `trustedRegionDefaultFromReceipt`                       | Cognitive scores / `CognitiveTier` / `PreservationPriority`     |
| §5.3 first-deny-wins                                    | P4-b promotion protocol                                         |
| §5.4 first-wave map                                     | P4-c key/adapter selection                                      |
|                                                         | Client / Envelope / CogniWeave / tenant-contract default region |

`ok: true` never returns tenant-cloud / BYOS / dedicated / cold-archive. `keyRef` is `null` (P4-c owns key material).

---

## Implementation SHA

| Milestone               | SHA                                        |
| ----------------------- | ------------------------------------------ |
| P4 Gate CR3 package     | `c58652f74e`                               |
| P4 Gate CR3 pin         | `8df8f84126`                               |
| **P4-a implementation** | `bb6ed632465ef9ce611588a270bdaa1a1272cc1d` |
| **This review tip**     | `ee9e042dca55430b1ef983ba62932a4e8f601f79` |

---

## Contract implemented

- `PlacementResolverInput` / `PlacementResolverOutput` / full `PlacementDenyReason` union.
- Evaluate `design-p4.md` §5.3 in order; first deny wins.
- `trustedRegionDefault` is branded. The only constructor is `trustedRegionDefaultFromReceipt(platform deployment-region receipt, auth.tenantId)`. Raw strings and unbranded objects fail closed as `missing_trusted_region` when a cloud write is implied.
- Missing classification, placement policy, or sync classification → fail closed.
- First-wave reject: tenant-cloud / BYOS / archive / dedicated / regional / multi-region.
- `offlineRequired=true` never returns a cloud writable canonical. Offline + `encrypted-cloud` + `openbot` → local canonical + managed projection.
- Resolver does not read cognitive scores and does not write.

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
```

**56 passed** (1 file).

Coverage:

- every deny reason (17)
- precedence conflict combinations (first deny wins)
- forged / default region rejected (client, envelope, CogniWeave, tenant contract, raw string, unbranded object)
- region intersection (`allowedRegions ∩ residency`)
- offline + encrypted-cloud → local canonical + projection
- later-wave mode fail-closed
- tenant isolation
- input permutation / cost-recovery objectives do not change the result
- source guard: no cognitive-score or write-path dependencies

---

## Fail-before / pass-after

**Fail-before** (parent `a6a9b5a19a94b8e6d1d96e1b83c3424b32edec05`):

```text
git cat-file -e a6a9b5a19a:src/gateway/data-governance/placement-resolve.ts
# fatal: path exists on disk, but not in 'a6a9b5a19a'
```

The module and its tests did not exist. The P4-a contract was therefore unenforceable.

**Pass-after** (impl `bb6ed632465ef9ce611588a270bdaa1a1272cc1d`):

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
# Test Files  1 passed (1)
# Tests  56 passed (56)
```

---

## Stop

P4-a is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
