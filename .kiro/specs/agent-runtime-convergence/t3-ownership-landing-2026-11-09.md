# T3 ownership landing after partial Batch B

- Date: 2026-11-09
- Accepted partial head: `53200d4a42c7737f9bef91bebb7f61e438bd2d4a` (13 files / 124 tests)
- This note follows the commits that move the two remaining pure decisions into the policy public entry.
- No Batch C, no merge, no deploy, no new notice-recovery system.

## Wake selection and slot cap

`decideWake`, `MAX_FOCUS_SLOTS`, and `MAX_PARKED_SLOTS` are implemented in `src/agent-runtime/policy/explicit-task-control.ts` and exported from `policy/index`. The function only returns a park/switch/acquire/reject decision. Claim, board write, and wake stay in state and the heartbeat/cron hosts.

`MAX_PARKED_SLOTS` and `MAX_PARKED_TASKS` are still two constants. Both values are 3. They are not aliased.

Consumers that decide a wake now import `decideWake` from `policy/index`:

- `src/infra/heartbeat-focus.ts`
- `src/cron/isolated-agent/main-session-focus.ts`
- `src/conversation-task/index.ts`

`focus-policy.ts` only re-exports those symbols, plus the context sentence `formatDroppedParkedTaskSentence`.

## Owner-constraint predicates

After checking call sites, these pure predicates moved to `src/agent-runtime/policy/constraints.ts` and `policy/index`:

- `isOwnerConstraintRevision`
- `isOwnerConstraintFullReplace`
- `shouldPersistOwnerConstraint`
- `isBareContinueCue`
- `isOwnerExecutionBarrierUtterance`
- `isPriorUtteranceCorrection` (dependency of revision, and of group correction routing)

`classifyTurnRelation` stays in `turn-relation.ts` and is not exported from `policy/index`.

Consumers:

- `session-task-board.ts` imports the persist/revise/replace predicates from `policy/index` and still performs the board write.
- `directed-decision-reply.ts` imports `isPriorUtteranceCorrection` from `policy/index`.
- `turn-relation.ts` re-exports the predicates and still calls them from the legacy classifier.

## Notice crash window

A crash after `transitionTask(closed)` returns and before `appendTaskCompletionNotice` returns can leave the ConversationTask closed and the completion notice absent from the transcript. That is a supplemental reliability gap for the completion notice. It is not a statement that the business result was not delivered, and it is not a delivery receipt. This round does not add a recovery system and does not claim the notice survives that crash.

## Regressions

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task/focus-policy.test.ts src/conversation-task/turn-relation.test.ts src/conversation-task/focus-switch.test.ts src/agent-runtime/policy/catalog.test.ts src/agent-runtime/policy/explicit-task-control.test.ts src/infra/heartbeat-focus.test.ts src/cron/isolated-agent/main-session-focus.test.ts src/conversation-task/session-task-board.test.ts src/conversation-task/session-task-board.slice3-context.test.ts src/gateway/collaboration-dispatch/directed-decision-reply.test.ts src/conversation-task/reply-completion.window.test.ts`

Result: 11 files, 126 tests passed.

## Remaining

The two T3 ownership items in this request are landed. The notice crash window above stays an accepted bound. Batch C is not started.
