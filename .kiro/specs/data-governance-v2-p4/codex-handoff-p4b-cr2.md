# Data Governance v2 — P4-b Codex Handoff CR2 (recovery identity)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `c41497d3c78130a1a2c1e988e5964f872709cfbc` (CR1 pin) / CR1 impl `a1fe724c9615a1a9d882a2c564e7b0c63e2f18e1`  
**This document does not claim P4-b Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-c was not started. P4-c/d stay locked until P4-b Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0: `recoverPrepareTxnUnlocked` could treat `{ ok: true, alreadyConsumed: true }` as success without proving the consumed replay identity. Missing `consumedGrants` still minted a prepared receipt. | Grant records persist `consumedByReplayId`. Recovery completes a prepared receipt only for `{ ok: true, alreadyConsumed: false }` or `{ ok: true, alreadyConsumed: true }` with `consumedByReplayId === journal.receipt.replayId`. Unproven or other-replay consume is fail-closed. |
| P0: failed consume unlinked the journal with no durable recovery marker. Later lookup returned `null` and looked like “never prepared”.                                                              | Failed CAS (`grant_revoked` / `grant_expired` / `grant_not_found` / `grant_not_unused`) and unproven/other-replay consume write a `conflicted` receipt (no checksum, no `consumedGrants` write) plus `applies.json.prepare-txn.recovery`, and **keep** the journal.                 |
| P0: `prepareCognitivePromotionApply` replayed any existing receipt, including `conflicted`.                                                                                                          | Lookup / unique-create replay only `prepared` and `applied`. `conflicted` / leftover foreign journal is `recovery_required`.                                                                                                                                                        |
| Comments claimed both journal fsync and grant CAS as commit points.                                                                                                                                  | **Scheme A only:** grant consume CAS is the commit point. The journal is speculative until CAS succeeds for this replay.                                                                                                                                                            |

Retained: full `ActorRef` match; actor mismatch does not consume grant; prepared receipts omit checksum; cloud without keyRef/region is `key_ref_required`; receipt lookup before unused-grant check; `decideShadowPromotion` only; P4-a resolver + consent reverify reused; no P4-c adapter; no Catalog binding cutover.

---

## Implementation SHA

| Milestone                           | SHA                                        |
| ----------------------------------- | ------------------------------------------ |
| Prior review tip (this round’s pin) | `c41497d3c78130a1a2c1e988e5964f872709cfbc` |
| Prior CR2 consume-CAS attempt       | `63dea038c6c00b2db99a2c93e81c6f74d212cfb8` |
| **This CR2 implementation**         | `868ef25457d1744564914d8e00754e40c0b644e5` |
| **This review tip**                 | `a09fcef8b054d2a8830d9d6d4fc8fac19c97c3b8` |

---

## Files changed

- `src/gateway/data-governance/types.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/cognitive-promotion-store.ts`
- `src/gateway/data-governance/cognitive-promotion.ts`
- `src/gateway/data-governance/cognitive-promotion.test.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4b-cr2.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

---

## Journal / commit-point semantics (scheme A)

**Grant consume CAS is the single commit point.**

- Live prepare writes a speculative journal, then CAS unused → consumed with `consumedByReplayId = replayId`. CAS success then writes the prepared receipt + `consumedGrants` and unlinks the journal. Live CAS failure unlinks the speculative journal and does not mint a receipt.
- A leftover journal is **not** itself a commit. Recovery may retry CAS.
- After CAS success, a crash before receipt is recoverable: `alreadyConsumed` + matching `consumedByReplayId` completes the prepared receipt, writes `consumedGrants`, and unlinks the journal.
- CAS failure, other-replay consume, or missing consume identity cannot create a successful prepared receipt. Recovery writes `conflicted` + recovery marker, keeps the journal, and does not write `consumedGrants`.

Priority: grant CAS > journal. The journal may drive receipt recovery **only after** CAS success for this replay (fresh unused→consumed, or proven same-replay `alreadyConsumed`).

---

## Recovery state machine

`recoverPrepareTxnUnlocked` (promotion lock → journal grant lock):

| ConsumePromotionGrantResult                                                                 | Durable outcome                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `{ ok: true, alreadyConsumed: false }`                                                      | grant consumed for this replay; prepared receipt; `consumedGrants[grantId]=replayId`; unlink journal + marker; return prepared |
| `{ ok: true, alreadyConsumed: true }` and `consumedByReplayId === journal.receipt.replayId` | same as success (idempotent crash after CAS)                                                                                   |
| `{ ok: true, alreadyConsumed: true }` and identity missing                                  | `conflicted` + marker reason `grant_consumed_identity_unproven`; keep journal; no `consumedGrants` write for this replay       |
| `{ ok: true, alreadyConsumed: true }` and other `consumedByReplayId`                        | `conflicted` + marker reason `grant_consumed_by_other_replay`; keep journal; leave existing `consumedGrants` mapping           |
| `grant_revoked` / `grant_expired` / `grant_not_found` / `grant_not_unused`                  | `conflicted` + marker with that reason; keep journal; grant file unchanged (not consumed)                                      |
| existing prepared/applied for this replay                                                   | unlink journal + marker (already committed)                                                                                    |
| existing conflicted for this replay                                                         | keep journal; refresh marker; do not promote to prepared                                                                       |

Subsequent `prepareCognitivePromotionApply` / unique-create:

- `prepared` / `applied` → successful replay
- `conflicted` or leftover journal for a different replay → `recovery_required` (not a successful replay)

---

## Crash matrix (durable files)

Journal: `data-governance/cognitive-promotions/applies.json.prepare-txn`  
Marker: `data-governance/cognitive-promotions/applies.json.prepare-txn.recovery`  
Store: `data-governance/cognitive-promotions/applies.json`  
Grant: `data-governance/approval-grants/<tenant>/<grantId>.json`

| Fault                                           | After crash                                                           | After recovery                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| journal durable, crash before consume           | journal present; grant unused; no receipt; no `consumedGrants`        | prepared receipt; grant consumed + `consumedByReplayId`; `consumedGrants` bound; journal/marker gone                                     |
| same, then grant revoked                        | journal present; grant revoked unused                                 | conflicted receipt (`grant_revoked`); marker; journal kept; no `consumedGrants`; grant not consumed                                      |
| same, then grant expired                        | journal present; grant unused expired                                 | conflicted (`grant_expired`); marker; journal kept; no `consumedGrants`                                                                  |
| same, then grant file missing                   | journal present; grant missing                                        | conflicted (`grant_not_found`); marker; journal kept; no `consumedGrants`                                                                |
| same, then other replay consumed                | journal present; grant consumed by other; `consumedGrants` other      | conflicted (`grant_consumed_by_other_replay`); marker; journal kept; `consumedGrants` stays on other replay; no prepared for this replay |
| grant consume success, crash before receipt     | journal present; grant consumed with `consumedByReplayId`; no receipt | prepared receipt; `consumedGrants` bound; journal/marker gone                                                                            |
| consumed grant without `consumedByReplayId`     | journal present; grant consumed, identity missing                     | conflicted (`grant_consumed_identity_unproven`); marker; journal kept                                                                    |
| legal same-replay recovery                      | as consume-before-receipt                                             | second lookup returns the same prepared receipt (idempotent)                                                                             |
| different replay vs leftover unused journal     | journal for replay A                                                  | recovery commits A; B cannot steal (grant_consumed / without receipt)                                                                    |
| different replay vs leftover conflicted journal | conflicted A + journal A                                              | B is `recovery_required`; journal A bytes unchanged                                                                                      |

`conflicted` receipts omit `checksum`. Queries that see them return fail-closed `recovery_required`, not `{ ok: true, replay: true }`.

---

## Concurrency / lock order

Lock order remains **promotion store lock → grant lock**. Never reverse. Grant lock is not reentrant: leftover-journal recovery uses the **journal** grant lock first, then the prepare grant lock.

Covered:

- two identical replays concurrent (one created, one replay)
- same grant, different replay (second is `grant_consumed` / `recovery_required`)
- deploy/revoke writer vs prepare (`onBeforeGrantLock` revoke → `grant_revoked`, grant not consumed)
- crash recovery vs new prepare (leftover journal recovered under its grant lock first)
- recovery journal vs grant already consumed by another replay
- stale promotion lock still unlinked after `LOCK_STALE_MS`

Invariants:

- one grant maps to at most one replay (`consumedByReplayId` + `consumedGrants`)
- one replay maps to at most one receipt
- no prepared receipt without a matching consumed grant
- no consumed grant without a prepared receipt **or** a `conflicted` / recovery marker path when identity cannot be proven for this journal

---

## Tests and commands

Scoped vitest: **129 passed / 4 files** (`cognitive-promotion.test.ts` 37, `placement-resolve.test.ts` 81, `placement-platform-root.test.ts` 4, `cognitive-cas-boundary.test.ts` 7).

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4b \
pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  4 passed (4)
# Tests  129 passed (129)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

Fault-injection tests read durable files (receipt, grant record including `consumedByReplayId`, `consumedGrants`, journal, recovery marker), not only function return values.

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` stopped at `oxfmt --check` on 132 files. None of the P4-b implementation files remain unformatted.

**P4-b scoped lint:** `oxlint --type-aware` on the six implementation/test files → 0 warnings, 0 errors.

**P4-b scoped format:** `oxfmt --check` on those six files → pass.

**P4-b scoped typecheck:** full `pnpm tsgo` after the checksum-typing fix reports **no errors** in:

- `src/gateway/data-governance/cognitive-promotion.ts`
- `src/gateway/data-governance/cognitive-promotion-store.ts`
- `src/gateway/data-governance/cognitive-promotion.test.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/types.ts`

**Unrelated `pnpm tsgo` failures (pre-existing; not this task):** wecom channel/webhook, agents image/pdf/stepfun tools, conversations purge/source-identity, collaboration-learning capsules, P3 cognitive evaluator/merge/update/p3a–p3g tests, knowledge ingest/preview, platform-auth tests, workspace-resolver, employee/enterprise UI, and others listed by `pnpm tsgo`. Evidence: those paths were not in this CR’s commit; the only P4-b diagnostic in an earlier `pnpm tsgo` run (`cognitive-promotion.test.ts` checksum delete typing) is fixed in `868ef25457d1`.

`git diff --check` on the P4-b paths is clean.

---

## Stop

P4-b CR2 recovery-identity is submitted for Codex Accept.

**未启动 P4-c。未宣称 P4-b Accepted / P4 Accepted。**

Do **not** start P4-c until Codex explicitly writes **P4-b Accept**.
