# Data Governance v2 — P4-d Codex Handoff CR (binding image integrity)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `fd82ec5cc9a58903903428873933824731dc4bd8` (P4-d pin)  
**This document does not claim P4-d Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

Codex Changes Required on the first P4-d submission: Restore trusted `parsed.bindings` after checking only four receipt fields, so a holder of a legitimate restore grant could rewrite locator / objectKey / contentVersion / state / replica attributes through ordinary Catalog CAS.

| Finding                                                 | Fix                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restore did not authenticate the binding image          | Receipt now carries `bindingsChecksum` (sha256 of canonicalized bindings). Durable store also keeps the immutable image. Restore hashes wire bindings **before** replay or CAS; mismatch → `bindings_integrity_mismatch`                                                                        |
| Restore compared only four receipt fields               | Wire receipt must match durable on identity **and** placement: `receiptId`, `replayId`, `grantId`, `resourceId`, `agentAssetId`, `tenantId`, `fromBindingId`, `toCanonicalBindingId`, `projectionBindingId`, `canonicalHome`, `mode`, `contentVersion`, `checksum`, `bindingsChecksum`, `state` |
| CAS wrote attacker-supplied bindings                    | Catalog `compareAndPut` applies the **durable** image only, never `parsed.bindings`                                                                                                                                                                                                             |
| Weak `bindingsMatchImage` could replay a locator tamper | Replay compares full canonical hashes. Integrity check runs first, so a tampered bundle cannot return `replay: true`                                                                                                                                                                            |
| `tenantId` on the wire receipt was unbound              | `parsed.receipt.tenantId` is compared to durable; restore still returns the durable receipt                                                                                                                                                                                                     |

`replayId` now includes `bindingsChecksum`, so a different image cannot collide with an existing export identity.

---

## Implementation SHA

| Milestone                   | SHA                                        |
| --------------------------- | ------------------------------------------ |
| Prior review tip (P4-d pin) | `fd82ec5cc9a58903903428873933824731dc4bd8` |
| Prior P4-d implementation   | `e92c35f806d23bec12819411bbdb7b0601ae45b0` |
| **This CR implementation**  | `1dffe292a4320ef134cc3291b180d2a11ab46908` |
| **This review tip**         | `84860c7448ed9b0e30a5bb904f906820ad2b5357` |

---

## Files changed

- `src/gateway/data-governance/placement-export.ts`
- `src/gateway/data-governance/placement-export-store.ts`
- `src/gateway/data-governance/placement-export.test.ts`
- `src/gateway/data-governance/types.ts`
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4d-cr.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

Barrel still does not export store internals (`uniqueCreatePlacementExportReceipt`, `finalizePlacementExportReceipt`, `getPlacementExportImage`).

---

## Restore order

1. Parse bundle (L3 members / unknown keys → `bundle_member_excluded`; bindings parsed strictly)
2. Load durable receipt + image by `replayId`; both must be `applied` / present
3. Durable image hash must equal `durable.bindingsChecksum`
4. Wire receipt fields must equal durable (including `tenantId` / `mode` / `canonicalHome` / `checksum` / `bindingsChecksum`)
5. `hash(parsed.bindings) === durable.bindingsChecksum` else `bindings_integrity_mismatch` — **no Catalog write**
6. Grant + Catalog tenant + ownership (unchanged P4-c loop)
7. Policy on the **durable** image (first-wave, one writable canonical, projection cannot be canonical)
8. If Catalog already matches the durable image → replay, no CAS
9. Ordinary Catalog `compareAndPut` of durable bindings + `canonicalBindingId` only

---

## Tests and commands

`placement-export.test.ts` is now **15** tests. New negatives:

- locator / objectKey / contentVersion / state / role tampers → `bindings_integrity_mismatch`, Catalog `governanceVersion` unchanged
- receipt `tenantId` / `mode` / `canonicalHome` / `checksum` / `fromBindingId` / `projectionBindingId` / `bindingsChecksum` tampers → `identity_rewrite_rejected`
- locator-tampered bundle against an already-matching Catalog is **not** replay

Existing binding mutations (resourceId rewrite, byos, dual canonical, projection-as-canonical) now fail at the integrity gate with `bindings_integrity_mismatch` instead of later policy codes.

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4d-cr \
pnpm exec vitest run \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  6 passed (6)
# Tests  169 passed (169)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` is not claimed. Scoped `oxlint --type-aware` and `oxfmt --check` on this CR's production/test files: 0 warnings, 0 errors.

---

## Stop

P4-d binding-image integrity CR is submitted for Codex Accept.

**未宣称 P4-d Accepted / P4 first-wave Accepted / P4 Accepted。P5 coding 仍锁定。**
