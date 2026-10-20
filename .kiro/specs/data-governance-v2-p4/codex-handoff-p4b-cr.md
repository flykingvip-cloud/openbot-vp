# Data Governance v2 — P4-b Codex Handoff CR

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-b Changes Required on `e5388641e93f7724926e2a0b486f16b860861955` / first submit `f2b3444da7bab6e2de4c279447d3945a87965e45`  
**This document does not claim P4-b Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-c/d stay locked until P4-b Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0: `call` and `auth` could be spliced for the same tenant, different `ActorRef`. Consent used `call`; approval used `auth`.    | `prepareCognitivePromotionApply` requires `sameActorRef(auth.actor, call.actor)` over the canonical full `ActorRef`. Same-tenant different user is `actor_mismatch`; grant is not consumed.                                                                                                                                          |
| P0: receipt unique-create wrote `applies.json` then separately marked the grant file consumed. Two files, no grant re-read CAS. | Durable prepare journal is the commit point. Under promotion lock then grant lock: re-read unused, journal fsync, grant `unused → consumed` CAS, receipt unique-create, unlink journal. Crash recovery completes both. Concurrent deploy/revoke is serialized on the grant lock; consume will not overwrite a revoked/changed grant. |
| P1: `checksum` was sha256 of locator metadata, not canonical bytes.                                                             | Prepared receipts **omit** `checksum`. Parser rejects a prepared row that carries one. P4-c hashes canonical resource bytes at apply.                                                                                                                                                                                                |
| P1: cloud prepared receipts lacked required `keyRefId` (P4-a `keyRef` is null).                                                 | Cloud write (`encrypted-cloud` / managed cloud home / managed projection) without key-service `keyRef` + region is `key_ref_required`. P4-b does not mint cloud prepared receipts.                                                                                                                                                   |

Retained: `decideShadowPromotion` only, P4-a `resolvePlacement` + `reverifySubjectConsent`, replay lookup before unused, branded auth, no P4-c adapters.

---

## Implementation SHA

| Milestone                            | SHA                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Prior P4-b submit (Changes Required) | `36431d9ec5ba45a4b9061c1def40ab65b88a48c3` / tests `d427d94a2ed260645d2238cc4b9215eadebcac97` |
| Prior review tip pin                 | `e5388641e93f7724926e2a0b486f16b860861955`                                                    |
| **This CR implementation**           | `a1fe724c9615a1a9d882a2c564e7b0c63e2f18e1`                                                    |
| **This review tip**                  | `17515ef7a8fc9e90bbcba6d5d4e1f379565b57ee`                                                    |

---

## Fail-before / pass-after

**Fail-before** (`e5388641e93f7724926e2a0b486f16b860861955`):

1. Same-tenant user A `GovernanceApprovalAuth` + user B `GovernanceAuthenticatedCall` was accepted.
2. `applies.json` could be durable while the grant file stayed `unused` (or consume could overwrite a concurrently changed grant).
3. Prepared `checksum` hashed `resourceId + bindingId + contentVersion + locator`.
4. `encrypted-cloud` with a trusted region produced a prepared receipt with no `keyRefId`.

**Pass-after** (`a1fe724c9615a1a9d882a2c564e7b0c63e2f18e1`):

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4b-cr pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  4 passed (4)
# Tests  119 passed (119)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

P3 grant-writer regressions: p3e/p3f/p3g + shadow + p3b **85 passed**. `pnpm tsgo` has no errors on P4-b paths. Scoped oxlint: 0 warnings.

---

## Directed coverage added

- same-tenant different `ActorRef` → `actor_mismatch`, grant unused
- cloud placement without key-service `keyRef` → `key_ref_required`, grant unused
- prepared receipt has no `checksum`
- crash after grant consume / before receipt: journal present, raw `applies.json` has no receipt, grant `consumed`; `getCognitivePromotionReceipt` recovers the receipt and deletes the journal
- concurrent revoke before grant CAS → `grant_revoked`, no receipt, grant not consumed

---

## CAS / crash evidence

Journal path: `data-governance/cognitive-promotions/applies.json.prepare-txn`.

Lock order: promotion store → grant file. Deploy `writeGovernanceApprovalGrantAtDeployBoundary` takes the grant lock only.

`compareAndConsumeGovernanceApprovalGrantUnlocked` re-reads the grant and refuses revoked / expired / already-consumed overwrite. Not a barrel export.

---

## Stop

P4-b CR is submitted for Codex Accept. **未宣称 P4-b Accepted / P4 Accepted.**

Do **not** start P4-c until P4-b is Accepted.
