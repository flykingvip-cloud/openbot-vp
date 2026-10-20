# Data Governance v2 — P4-b Codex Handoff CR3 (unused-journal recovery)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `e3861e93a45a46748efe18e80c4b31e63bad2cda` (CR2 pin) / CR2 impl `868ef25457d1744564914d8e00754e40c0b644e5`  
**This document does not claim P4-b Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-c was not started. P4-c/d stay locked until P4-b Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0: crash after journal fsync and before grant CAS left an unused grant. Recovery treated the speculative journal as enough to start a new unused→consumed CAS and mint a prepared receipt. That skipped recommendation-open, `decideShadowPromotion`, Catalog lifecycle/classification/legal hold, placement policy, subject consent, and region/key/tenant checks. | Recovery no longer calls consume CAS. Grant consume CAS remains the only commit point. A leftover journal is speculative.                                                                                                                                                            |
| Recovery only re-checked grant revoked/expired/state. Consent revoke or governance change between crash and recovery could still consume the grant.                                                                                                                                                                                                                  | Unused grant, or revoked/expired/missing/identity mismatch, writes `aborted` / `conflicted` + recovery marker, keeps the journal, does not consume, and does not mint a successful prepared receipt. Retry must go through `prepareCognitivePromotionApply()`, not journal recovery. |
| Parser required checksum on `aborted`, so an unused-abort receipt would not parse and lookup looked like “never prepared”.                                                                                                                                                                                                                                           | `aborted` omits checksum, same as `prepared` / `conflicted`.                                                                                                                                                                                                                         |

Retained from CR2: consume identity (`consumedByReplayId === journal.replayId`); conflicted receipts + recovery marker; leftover foreign journal is `recovery_required`; full `ActorRef` match; prepared receipts omit checksum; cloud without keyRef/region is `key_ref_required`; receipt lookup before unused-grant check; `decideShadowPromotion` only; P4-a resolver + consent reverify reused; no P4-c adapter; no Catalog binding cutover.

---

## Implementation SHA

| Milestone                   | SHA                                        |
| --------------------------- | ------------------------------------------ |
| Prior review tip (CR2 pin)  | `e3861e93a45a46748efe18e80c4b31e63bad2cda` |
| Prior CR2 implementation    | `868ef25457d1744564914d8e00754e40c0b644e5` |
| **This CR3 implementation** | `868de8c348e3b8538d0c960df43acdbef05405af` |
| **This review tip**         | `c5edac6e17c714439869cedbacd8868382d5b82a` |

---

## Files changed

- `src/gateway/data-governance/types.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/cognitive-promotion-store.ts`
- `src/gateway/data-governance/cognitive-promotion.test.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `src/gateway/data-governance/placement-resolve.test-harness.ts`
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4b-cr3.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

---

## Journal / commit-point semantics (scheme A)

**Grant consume CAS is the single commit point.**

- Live prepare writes a speculative journal, then CAS unused → consumed with `consumedByReplayId = replayId`. CAS success then writes the prepared receipt + `consumedGrants` and unlinks the journal. Live CAS failure unlinks the speculative journal and does not mint a receipt.
- A leftover journal is **not** itself a commit. Recovery **must not** perform a fresh unused→consumed CAS.
- After CAS success, a crash before receipt is recoverable: grant already consumed and `consumedByReplayId === journal.replayId` completes the prepared receipt, writes `consumedGrants`, and unlinks the journal/marker.
- Unused grant, revoked/expired/missing grant, other-replay consume, or missing consume identity cannot create a successful prepared receipt. Recovery writes `aborted` / `conflicted` + recovery marker, keeps the journal, and does not write `consumedGrants`.

Priority: grant CAS > journal. The journal may drive receipt recovery **only after** CAS already succeeded for this replay.

---

## Recovery state machine

`recoverPrepareTxnUnlocked` (promotion lock → journal grant lock). It **reads** the grant; it does not call `compareAndConsumeGovernanceApprovalGrantUnlocked`.

| Grant inspection                                       | Durable outcome                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| existing prepared/applied for this replay              | unlink journal + marker                                                                                                  |
| existing conflicted/aborted for this replay            | refresh marker; keep journal; do not promote to prepared                                                                 |
| consumed and `consumedByReplayId === journal.replayId` | prepared receipt; `consumedGrants[grantId]=replayId`; unlink journal + marker                                            |
| unused (including omitted `state`)                     | `aborted` + marker reason `grant_unused`; keep journal; grant stays unused; no `consumedGrants`                          |
| `grant_revoked` / `grant_expired` / `grant_not_found`  | `conflicted` + marker with that reason; keep journal; grant file unchanged                                               |
| consumed by another replay                             | `conflicted` + marker reason `grant_consumed_by_other_replay`; keep journal; leave existing `consumedGrants`             |
| consumed with missing identity                         | `conflicted` + marker reason `grant_consumed_identity_unproven`; keep journal; no `consumedGrants` write for this replay |

Subsequent `prepareCognitivePromotionApply` / unique-create:

- `prepared` / `applied` → successful replay
- `conflicted` / `aborted` or leftover journal for a different replay → `recovery_required` (not a successful replay)
- Retry after unused abort must re-run the full prepare authorization chain. Journal recovery must not submit.

---

## Crash matrix (durable files)

Journal: `data-governance/cognitive-promotions/applies.json.prepare-txn`  
Marker: `data-governance/cognitive-promotions/applies.json.prepare-txn.recovery`  
Store: `data-governance/cognitive-promotions/applies.json`  
Grant: `data-governance/approval-grants/<tenant>/<grantId>.json`

| Fault                                                             | After crash                                                           | After recovery                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| journal durable, crash before consume                             | journal present; grant unused; no receipt; no `consumedGrants`        | `aborted` (`grant_unused`); marker; journal kept; grant unused; no prepared; no `consumedGrants`                                         |
| same, then subject consent revoked                                | journal present; grant unused; consent revoked                        | same unused abort; grant unused; no prepared                                                                                             |
| same, then recommendation closed                                  | journal present; grant unused; recommendation superseded              | same unused abort; grant unused; no prepared                                                                                             |
| same, then Catalog lifecycle / legal hold / classification change | journal present; grant unused; Catalog mutated                        | same unused abort; grant unused; no prepared                                                                                             |
| same, then placement-relevant Catalog policy change               | journal present; grant unused; classification changed                 | same unused abort; grant unused; no prepared                                                                                             |
| same, then grant revoked                                          | journal present; grant revoked unused                                 | conflicted (`grant_revoked`); marker; journal kept; no `consumedGrants`; grant not consumed                                              |
| same, then grant expired                                          | journal present; grant unused expired                                 | conflicted (`grant_expired`); marker; journal kept; no `consumedGrants`                                                                  |
| same, then grant file missing                                     | journal present; grant missing                                        | conflicted (`grant_not_found`); marker; journal kept; no `consumedGrants`                                                                |
| same, then other replay consumed                                  | journal present; grant consumed by other; `consumedGrants` other      | conflicted (`grant_consumed_by_other_replay`); marker; journal kept; `consumedGrants` stays on other replay; no prepared for this replay |
| grant consume success, crash before receipt                       | journal present; grant consumed with `consumedByReplayId`; no receipt | prepared receipt; `consumedGrants` bound; journal/marker gone                                                                            |
| consumed grant without `consumedByReplayId`                       | journal present; grant consumed, identity missing                     | conflicted (`grant_consumed_identity_unproven`); marker; journal kept                                                                    |
| legal same-replay recovery                                        | as consume-before-receipt                                             | second lookup returns the same prepared receipt (idempotent)                                                                             |
| unique-create vs leftover unused journal                          | journal for replay A; grant unused                                    | A is `aborted` / `grant_unused`; unique-create is `recovery_required`; grant unused                                                      |
| different replay vs leftover unused journal                       | journal for replay A; grant unused                                    | A is `aborted`; B is `recovery_required`; B has no receipt; grant unused                                                                 |
| different replay vs leftover conflicted journal                   | conflicted A + journal A                                              | B is `recovery_required`; journal A bytes unchanged                                                                                      |

`conflicted` / `aborted` receipts omit `checksum`. Queries that see them return fail-closed `recovery_required`, not `{ ok: true, replay: true }`.

---

## Concurrency / lock order

Lock order remains **promotion store lock → grant lock**. Never reverse. Grant lock is not reentrant: leftover-journal recovery uses the **journal** grant lock first, then the prepare grant lock.

Covered:

- two identical replays concurrent (one created, one replay)
- same grant, different replay (second is `grant_consumed` / `recovery_required`)
- deploy/revoke writer vs prepare (`onBeforeGrantLock` revoke → `grant_revoked`, grant not consumed)
- crash recovery vs new prepare (leftover unused journal aborts; does not consume)
- recovery journal vs grant already consumed by another replay
- stale promotion lock still unlinked after `LOCK_STALE_MS`

Invariants:

- one grant maps to at most one replay (`consumedByReplayId` + `consumedGrants`)
- one replay maps to at most one receipt
- no prepared receipt without a matching consumed grant
- no consumed grant without a prepared receipt **or** a `conflicted` / `aborted` / recovery marker path when this journal must not commit
- recovery never starts a fresh unused→consumed CAS

---

## Tests and commands

Scoped vitest: **134 passed / 4 files** (`cognitive-promotion.test.ts` 42, `placement-resolve.test.ts` 81, `placement-platform-root.test.ts` 4, `cognitive-cas-boundary.test.ts` 7).

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4b \
pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  4 passed (4)
# Tests  134 passed (134)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

Fault-injection tests read durable files (receipt, grant record including `consumedByReplayId`, `consumedGrants`, journal, recovery marker), not only function return values.

New unused-journal cases:

- journal after, grant CAS before crash
- recovery before revoke subject consent
- recovery before close recommendation
- recovery before Catalog lifecycle / legal hold / classification change
- recovery before placement-relevant Catalog change
- unique-create / foreign replay vs leftover unused journal

All assert grant stays unused and there is no successful prepared receipt.

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` is not claimed. Scoped checks on this CR’s files:

**P4-b scoped lint:** `oxlint --type-aware` on the implementation/test files → 0 warnings, 0 errors.

**P4-b scoped format:** `oxfmt --check` on those files → pass.

`git diff --check` on the P4-b paths is clean.

---

## Stop

P4-b CR3 unused-journal recovery is submitted for Codex Accept.

**未启动 P4-c。未宣称 P4-b Accepted / P4 Accepted。**

Do **not** start P4-c until Codex explicitly writes **P4-b Accept**.
