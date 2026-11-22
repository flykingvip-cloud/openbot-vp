# Watchdog task-closure acceptance (PR #177 follow-up)

- Branch: `grok-sentinel-link/watchdog-task-closure`
- Worktree: `/Users/daniel/.codex/worktrees/watchdog-task-closure/openbot`
- Prior tip (card/todo visible, buttons incomplete): `b3e8ec1c8`
- Tip (button fulfillment): `194634dde2b2e4cded46f274a807068dd1e513fd`
- Tip (evidence refresh): `3f1d0b3a7bb3ccead2e8ab011321eb0a16276c5f`
- Tip (pre enterprise/lock fix evidence): `8207c98c5dca609e0968275eb7553f9ca6f3354e`
- Tip (enterprise authority + locked inbox clear): `2174fc45e71c2129513afd193225ba24eaa5e3bf`
- Tip (heartbeat stale-snapshot merge): `b612bc6b369d5c43b06b53212dc9e2dae4304221`
- Zone: Asia/Shanghai (UTC+8)
- Written: 2026-11-01 ~11:25 Asia/Shanghai

## Acceptance blockers addressed (button fulfillment)

### P1 Authority + wake-op recovery before closing todo

- RPC `collaboration.task.actHumanAttention` builds `RuntimeAuthority` via
  `buildHumanAttentionAuthority` and passes it into `actHumanAttentionCard`.
- `release_after_verify`:
  1. requires verification note
  2. `produceHumanNoneAttestation` + `releaseWakeOpForRetryAuthorized` (existing wake-op recovery contract)
  3. clears heartbeat `humanAttention` under authority (`requireHeartbeatClear`)
  4. **only then** marks inbox `recovered`
  - On any failure: todo stays `open`, returns reason (no false recovered).
- `confirm_completed` calls `confirmWakeOpCompletedAuthorized` when wake-op has prior `roundId`; otherwise refuses and keeps todo open.

### P1 Cancel / accept / return / evidence call real contracts

- `cancel_task` → `cancelBoardItem` (board status `cancelled`).
- `accept_submission` / `return_submission` → `acceptBoardItemSubmission` /
  `returnBoardItemSubmission` with live `expectedSubmissionId`.
- `view_evidence` / `view_artifact` / `view_failure_reason` return live board item
  path + wake-op status/detail/roundId (not inbox metadata alone).
- Unsupported outcomes surface as action failure reasons (todo not closed).

### P1 Stale check reads authoritative board

- Before mutating, `assertHumanAttentionNotStale` loads board via
  `loadBoardClaimItem` + `progressFingerprint` and refuses when live progress
  differs from the card fingerprint (`stale_progress`).
- **Missing board item refuses mutation** (`missing_board_item`) — never treated as
  “unchanged”. `view_*` may still return alert evidence without a board row
  (non-blocking limitation).

### P2 Transfer override + terminal status

- `transferHumanAttentionTodo`: status stays `open`, sets `ownerOverride`, bumps
  version, records `lastTransfer`, **does not** set `resolution`.
- Heartbeat `upsertHumanAttentionTodo` preserves `ownerIds` when `ownerOverride`
  and bumps version on owner change.
- Transfer also writes `task.responsibility.owner` (or `reviewer` for awaiting_review).
- Card/UI terminal state uses `status === resolved|recovered`, not mere presence
  of `resolution` — open transfers stay actionable.

## Tests (exact)

```bash
pnpm exec vitest run \
  src/gateway/collaboration-dispatch/human-attention-intake.test.ts \
  src/gateway/collaboration-dispatch/human-attention-actions.integration.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts \
  ui/src/ui/chat/human-attention-card.node.test.ts \
  src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts
```

Result:

```
 ✓ human-attention-card.node.test.ts (2)
 ✓ human-attention-intake.test.ts (9)
 ✓ human-attention-actions.integration.test.ts (11)
 ✓ watchdog-task-closure.test.ts (14)
 ✓ collab-s4-heartbeat-scheduler.test.ts (15)
 ✓ watchdog-task-closure.integration.test.ts (9)
 Test Files  6 passed (6)
      Tests  60 passed (60)
```

Integration coverage includes:

- release_after_verify → wake-op unknown→failed, gate cleared, todo recovered; subsequent consume dispatches once and leaves unknown.
- release failure keeps todo open.
- cancel_task → board `cancelled`.
- accept_submission → board `accepted`.
- return_submission → board `returned`, gate cleared, todo recovered.
- confirm_completed → wake-op `completed`, gate cleared, todo recovered.
- missing board item → mutating action `missing_board_item`, todo stays open.
- live progress change → old card `stale_progress`.
- transfer → ownerOverride preserved across upsert; responsibility.owner updated; card stays open/actionable.
- enterprise: `buildHumanAttentionAuthority` + stamped `todo.tenantId` scopes board/heartbeat under managed tenant namespace; wrong-tenant authority cannot see the row.
- inbox clearHeartbeat ↔ heartbeat write interleaving under shared `withRoundLock` + `writeJsonDurable` preserves both updates (no torn JSON).

## Format

`oxfmt --check` on touched human-attention files: All matched files use the correct format.

Touched paths introduce no new `tsgo` errors (repo still has unrelated pre-existing tsgo debt).

## Key files

- `src/gateway/collaboration-dispatch/human-attention-business.ts` (new)
- `src/gateway/collaboration-dispatch/human-attention-actions.ts`
- `src/gateway/collaboration-dispatch/human-attention-inbox.ts`
- `src/gateway/collaboration-dispatch/human-attention-card.ts`
- `src/gateway/collaboration-dispatch/human-attention-emit.ts`
- `src/gateway/collaboration-dispatch/human-attention-actions.integration.test.ts` (new)
- `src/gateway/server-methods/human-attention.ts`
- `ui/src/ui/chat/human-attention-card.ts`
- `evidence/watchdog-task-closure-acceptance-2026-11-01.md` (this file)

## Round: enterprise authority + locked inbox clear (2026-11-01 ~11:15 Asia/Shanghai)

Review blockers addressed:

### P1-A Authority no longer hard-codes empty tenant / `personal_local`

- `buildHumanAttentionAuthority` resolves tenant via preferred RPC identity
  (`resolveCollaborationTenantResolution` / `todo.tenantId`) +
  `resolveCollaborationGroupTenantId` + `resolveAuthorityTenantForEntry`, and
  profile via `resolveSecurityProfile(cfg)`.
- RPC `collaboration.task.actHumanAttention` passes `tenant` + `todoTenantId`.
- Inbox todos may stamp `tenantId`; emit path stamps from authority when present.
- Integration: enterprise `managed_enterprise` fixture builds authority through the
  real helper (not personal_local inject) and asserts namespace under
  `OPENBOT_TENANTS_ROOT/<tenantId>/…`.

### P1-B Inbox clearHeartbeat uses heartbeat lock + durable write

- `clearHeartbeatHumanAttention` uses the same `withRoundLock` stem as heartbeat
  `writeState`, re-reads + re-checks fingerprint inside the lock, then
  `writeJsonDurable`.
- Heartbeat `writeState` also switched to `writeJsonDurable` for atomic writes.
- Interleaving test proves clear + concurrent item update both survive.

### Stale gap

- `assertHumanAttentionNotStale` returns `missing_board_item` when the board row
  is absent (mutations refused).

## Unresolved / out of scope

- No prod deploy / restart / force-push / approval skip.
- `view_*` still uses alert UX (non-blocking limitation retained).
- Full-repo `pnpm check` may still fail on pre-existing unrelated tip hygiene.
- `confirm_completed` without prior wake-op `roundId` honestly refuses (no forged receipt).
- Second consecutive consume after a successful post-release dispatch can still
  re-enter depending on wake-op completion marking in the consumer; the acceptance
  proof for this round is: release unlocks exactly one following dispatch that
  leaves `unknown`.

## Round: heartbeat stale-snapshot merge (P1) — 2026-11-01 ~11:25 Asia/Shanghai

- Tip: `b612bc6b369d5c43b06b53212dc9e2dae4304221`

Review blocker: heartbeat could overwrite human recovery with a lock-free prior snapshot.

### Root cause

1. `runGroupTaskHeartbeat` reads `priorState` **outside** the lock.
2. Async scan / dispatch proceeds.
3. Human `clearHeartbeatHumanAttention` takes the lock, clears `humanAttention` + fail counts, durable-writes.
4. Heartbeat `writeState` took the lock but wrote the **entire scanned snapshot** without re-read / version check → old `humanAttention` / fail counts resurrected.

Atomic `writeJsonDurable` prevents torn JSON; it does **not** prevent stale whole-state overwrite. The prior lock interleave test re-read **inside** the lock and therefore did not prove the production path.

### Fix

- `writeState` now re-reads under `withRoundLock`, runs `mergeHeartbeatStatePreservingHumanRecovery` against `prior` + `live`, bumps `revision`, then durable-writes.
- Merge rule: if live cleared the same-fingerprint `humanAttention` that `prior` had, strip that attention from the scanned item and keep live fail counters — other scanned item updates still apply.
- Scan / model / external dispatch stay **outside** the lock; only merge+write holds it.
- `clearHeartbeatHumanAttention` bumps `revision` on clear.
- Test-only `_testAfterPriorReadBeforeWriteBarrier` pauses after scan, before save (does not hold the state lock across external work).

### New tests (real `runGroupTaskHeartbeat`)

- `pauses after old read before save: human clear wins; other item heartbeat updates kept`
  - Barrier after old read / before save → clear → resume → protected item stays cleared; other item keep observe nudge updates.
- `reverse interleave: heartbeat save then clear clears; clear then heartbeat keeps clear`
  - HB then clear → cleared; clear then HB → stays cleared (other updates retained).

### Vitest (six-file acceptance set)

```bash
pnpm exec vitest run \
  src/gateway/collaboration-dispatch/human-attention-intake.test.ts \
  src/gateway/collaboration-dispatch/human-attention-actions.integration.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts \
  ui/src/ui/chat/human-attention-card.node.test.ts \
  src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts
```

Result: **6 files, 62 passed** (was 60; +2 stale-snapshot race tests).

`oxfmt` on touched heartbeat / inbox / integration files: clean.

### Unresolved / out of scope (unchanged)

- No merge / prod deploy / force-push / cloud agent / approval skip.
- GitHub API may be unreachable here; `/landpr` missing — local green ≠ landed.
- Pre-existing `group-task-heartbeat.test.ts` “allowlist on: nudge → escalate” failure (nudgeFailCount path) is unrelated and fails on clean tip too.
