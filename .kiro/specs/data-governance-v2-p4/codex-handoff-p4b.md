# Data Governance v2 — P4-b Codex Handoff

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Required baseline tip:** `296b14b8ac2c5b4004e9ff6beae588ed35c952dc` (P4-a CR6 Accepted)  
**This document does not claim P4-b Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-c/d stay locked until P4-b Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Scope

P4-b only: signed tenant-bound promotion **protocol** + durable `prepared` receipt + grant consume.

| In                                                 | Out                                              |
| -------------------------------------------------- | ------------------------------------------------ |
| `prepareCognitivePromotionApply`                   | local/cloud byte writers                         |
| `decideShadowPromotion` (call, not fork)           | encryption / key-service adapter                 |
| P4-a `resolvePlacement` + `reverifySubjectConsent` | projection upload                                |
| branded `GovernanceApprovalAuth`                   | Catalog binding cutover                          |
| `replayId` + unique-create `prepared` receipt      | tombstone propagation                            |
| grant `unused → consumed` in the same CAS          | export / restore                                 |
| durable `cognitive_promotion_receipt`              | BYOS / tenant-cloud / archive / dedicated region |
|                                                    | P2 purge/forget                                  |
|                                                    | P5 longevity                                     |
|                                                    | a second promotion judge                         |

P4-b creates `state: "prepared"` only. `applied | conflicted | failed | aborted` are reserved for P4-c.

---

## Implementation SHA

| Milestone                             | SHA                                        |
| ------------------------------------- | ------------------------------------------ |
| P4-a CR6 Accepted / required baseline | `296b14b8ac2c5b4004e9ff6beae588ed35c952dc` |
| **P4-b protocol + store**             | `36431d9ec5ba45a4b9061c1def40ab65b88a48c3` |
| **P4-b directed-test coverage**       | `d427d94a2ed260645d2238cc4b9215eadebcac97` |
| **This review tip**                   | `f2b3444da7bab6e2de4c279447d3945a87965e45` |

---

## Changed files

Protocol / store (`36431d9ec5`):

- `src/gateway/data-governance/cognitive-promotion.ts`
- `src/gateway/data-governance/cognitive-promotion-store.ts`
- `src/gateway/data-governance/cognitive-promotion.test.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/cognitive-cas-boundary.test.ts`
- `src/gateway/data-governance/index.ts`
- `src/gateway/data-governance/paths.ts`
- `src/gateway/data-governance/types.ts`

Coverage follow-up (`d427d94a2e`):

- `src/gateway/data-governance/cognitive-promotion.test.ts`

Docs / this handoff (this review tip):

- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4b.md`
- `.kiro/specs/data-governance-v2-p4/design-p4.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`
- `.kiro/specs/data-governance-v2/closeout.md`

---

## Contract implemented

1. Branded `GovernanceAuthenticatedCall` + `GovernanceApprovalAuth` required. Forged/unbranded auth is `governance_approval_auth_required`.
2. Wire keys `tenantId` / `tenant` / `executedBy` / `requestedBy` / `auth` / `stateDir` / `grant` / `candidate` are rejected (`wire_authority_rejected`). Tenant comes from auth only.
3. Candidate scores come from the stored recommendation IEEE754 hex, not the wire. Classification/lifecycle come from Catalog via `loadValidatedCatalogRecordSync`.
4. `decideShadowPromotion()` is the only admit/deny source. Non-`recommend_admit` (`recommend_deny`, `invalid_score`) returns before receipt create and before grant consume.
5. P4-a `resolvePlacement` runs next. Placement deny does not consume the grant and is not rewritten to allow.
6. `eligible-with-consent` that would write a managed projection calls `reverifySubjectConsent` after resolve and before prepare.
7. `decisionFingerprint = sha256(canonical JSON of decideShadowPromotion input + output)`.
8. `replayId = sha256(grantId + "\0" + recommendationId + "\0" + resourceId + "\0" + decisionFingerprint)`. No timestamp, nonce, or node id.
9. Receipt is loaded by `replayId` **before** unused-grant checks. Existing receipt is returned as-is (`replay: true`). Grant is not re-consumed.
10. Else grant must be `cognitive_promotion_apply`, resource-scoped to `resourceId`, tenant = auth tenant, issuer `enterprise_ops | tenant_admin`, unexpired, unrevoked, `state: "unused"`.
11. One durable revision: unique-create `prepared` receipt keyed by `replayId` **and** record grant consume. Then the grant file is marked `consumed`.
12. CAS loser with an existing receipt returns that receipt. Grant consumed and this replay missing → `grant_consumed_without_receipt`. Same grant, different replay → `grant_consumed`.
13. Production protocol uses `resolveStateDir()`. It does not import test rebind APIs.

Grant kind `cognitive_promotion_apply` with non-resource scope cannot be persisted (`invalid_approval_grant_record`). Engine `issuedBy` cannot be persisted.

---

## Fail-before / pass-after

**Fail-before** (baseline `296b14b8ac2c5b4004e9ff6beae588ed35c952dc`):

- `prepareCognitivePromotionApply` / `cognitive-promotion.ts` / `cognitive-promotions/applies.json` did not exist.
- `cognitive_promotion_apply` was not a grant kind.
- No durable promotion receipt and no grant-consume CAS for shadow admit.

**Pass-after** (impl `d427d94a2ed260645d2238cc4b9215eadebcac97` on protocol `36431d9ec5ba45a4b9061c1def40ab65b88a48c3`):

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4b pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  4 passed (4)
# Tests  115 passed (115)

OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4b pnpm exec vitest run \
  src/gateway/data-governance/cognitive-shadow-promotion.test.ts \
  src/gateway/data-governance/cognitive-p3b.test.ts \
  src/gateway/data-governance/cognitive-p3f.test.ts \
  src/gateway/data-governance/cognitive-p3g.test.ts
# Test Files  4 passed (4)
# Tests  60 passed (60)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2

pnpm tsgo
# no errors on P4-b paths
```

`pnpm check` fails on pre-existing `oxfmt --check` hits in unrelated files (docs/skills/ui CSS). Scoped oxlint on the P4-b TypeScript files: 0 warnings. `git diff --check` is clean on the P4-b files in this handoff.

Vitest workers were not raised above 16. Cache dir is explicit so this worktree does not depend on `.vite-temp` write permission.

---

## Directed tests (23 in `cognitive-promotion.test.ts`)

- `recommend_admit` creates `prepared` and consumes the grant
- `recommend_deny` / `invalid_score` create no receipt and do not consume
- forged/unbranded auth rejected
- wire `tenantId` / `executedBy` / `requestedBy` rejected
- wrong grant kind / resource scope / stored tenant rejected
- agent-asset-wide and engine-issued promotion grants cannot be persisted
- expired / revoked grant cannot start a new apply
- consumed grant with no receipt cannot start a new apply
- Envelope tenant cannot override auth tenant
- placement deny does not consume
- consent revoked after resolve and before prepare → `consent_required`, no consume
- same replay returns the existing receipt without consuming again
- consumed grant + same replay returns the existing receipt
- consumed grant + different replay → `grant_consumed` (does not return the first receipt)
- two concurrent identical replays: one `replay: false`, one `replay: true`, same `receiptId`
- CAS loser re-reads the durable receipt (forged `receiptId` is ignored)
- grant consumed and receipt missing → `grant_consumed_without_receipt`
- `getCognitivePromotionReceipt` re-reads disk after prepare (restart durability)
- decision fingerprint is stable; changing retrieval score changes `replayId`
- position/group owners needing consent fail closed
- source guards: no P4-c/d adapters in `cognitive-promotion.ts`; test harness not imported by production modules

---

## Replay / CAS concurrency evidence

```text
it("lets only one of two concurrent identical replays create the receipt")
  Promise.all([prepareCognitivePromotionApply(input), prepareCognitivePromotionApply(input)])
  expect(a.receipt.receiptId).toBe(b.receipt.receiptId)
  expect([a.replay, b.replay].filter((replay) => !replay)).toHaveLength(1)

it("re-reads the existing receipt when unique-create loses the CAS")
  uniqueCreatePreparedPromotionReceipt({ receipt: { ...first.receipt, receiptId: "cpr_forged" } })
  → { ok: true, receipt: first.receipt, created: false }
```

Store lock is exclusive (`wx` on `applies.json.lock`). Same `replayId` returns the stored row. Same grant, different `replayId` is `grant_consumed`.

---

## Restart durability evidence

Receipts live at `data-governance/cognitive-promotions/applies.json` (temp + fsync + rename). `getCognitivePromotionReceipt({ replayId })` reads that file through `resolveStateDir()` with no in-memory cache.

```text
it("re-reads the durable receipt after a simulated restart")
  first = prepareCognitivePromotionApply(...)
  reloaded = getCognitivePromotionReceipt({ replayId: first.receipt.replayId })
  expect(reloaded).toEqual(first.receipt)
```

Crash window `grant consumed, receipt missing` is not repaired as success: `grant_consumed_without_receipt`.

---

## P4-c / P4-d not implemented (static evidence)

```text
rg encryptBytes|uploadProjection|object-store|cold-archive|tenant-cloud|byos-only|"dedicated region" \
  src/gateway/data-governance/cognitive-promotion.ts \
  src/gateway/data-governance/cognitive-promotion-store.ts
# no matches

barrel: prepareCognitivePromotionApply / getCognitivePromotionReceipt exported
barrel: uniqueCreatePreparedPromotionReceipt / markGovernanceApprovalGrantConsumed / decideShadowPromotion NOT exported
```

`cognitive-promotion.ts` contains the comment `Does not write storage adapters or Catalog bindings.` Source-guard tests assert the production module does not import `replacePlacementAuthorityBindingsForTests` or the P4-b test harness.

`design-p4.md` keeps `trustedRegionDefault: string | null;` (Gate CR3). Receipt lookup still appears before the unused-grant check.

---

## Stop

P4-b is submitted for Codex Accept.

**未宣称 P4-b Accepted / P4 Accepted.**

Do **not** start P4-c until P4-b is Accepted.
