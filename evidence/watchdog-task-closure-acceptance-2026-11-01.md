# Watchdog task-closure acceptance (PR #177 follow-up)

- Branch: `grok-sentinel-link/watchdog-task-closure`
- Worktree: `/Users/daniel/.codex/worktrees/watchdog-task-closure/openbot`
- Prior tip (card/todo visible, buttons incomplete): `b3e8ec1c8`
- Tip (button fulfillment): `194634dde2b2e4cded46f274a807068dd1e513fd`
- Tip (evidence refresh): `3f1d0b3a7bb3ccead2e8ab011321eb0a16276c5f`
- Zone: Asia/Shanghai (UTC+8)
- Written: 2026-11-01 ~10:35 Asia/Shanghai

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
 ✓ human-attention-actions.integration.test.ts (6)
 ✓ watchdog-task-closure.test.ts (14)
 ✓ collab-s4-heartbeat-scheduler.test.ts (15)
 ✓ watchdog-task-closure.integration.test.ts (9)
 Test Files  6 passed (6)
      Tests  55 passed (55)
```

Integration coverage includes:

- release_after_verify → wake-op unknown→failed, gate cleared, todo recovered; subsequent consume dispatches once and leaves unknown.
- release failure keeps todo open.
- cancel_task → board `cancelled`.
- accept_submission → board `accepted`.
- live progress change → old card `stale_progress`.
- transfer → ownerOverride preserved across upsert; responsibility.owner updated; card stays open/actionable.

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

## Unresolved / out of scope

- No prod deploy / restart / force-push / approval skip.
- Full-repo `pnpm check` may still fail on pre-existing unrelated tip hygiene.
- `confirm_completed` without prior wake-op `roundId` honestly refuses (no forged receipt).
- Second consecutive consume after a successful post-release dispatch can still
  re-enter depending on wake-op completion marking in the consumer; the acceptance
  proof for this round is: release unlocks exactly one following dispatch that
  leaves `unknown`.
