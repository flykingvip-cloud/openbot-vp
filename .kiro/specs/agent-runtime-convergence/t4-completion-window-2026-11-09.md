# T4 completion window and T3 classification closure

- Date: 2026-11-09
- Branch: `cursor/runtime-authority-batch-b-bf87`
- Baseline before this batch: `32578f9a73693008e3717f89993f262b6c635e9f` (includes accepted Batch A `591c9475fd287fad92eb38a45d9cca75c81ec263`)
- Implementation tip: `050098bc3c318b3c76d89278d293a65d29950999` (`27e9acc6`, `ebf4f650`, `050098bc`)
- Evidence notes follow that tip. The fixed head is the branch tip after this file.
- Nature: first Batch B evidence. Independent acceptance of `4ce9c442e4e2c9fc42444e76d6a9a79b37992d88` rejected it. The correction is `batch-b-acceptance-rejection-fix-2026-11-09.md`. This file is not the fixed acceptance head.

## Close meanings

These domains stay separate. A later delivered reply may retry a rejected board write. None of them is a delivery receipt.

| Domain                      | Close means                                                                                                                                                      | Does not mean                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ConversationTask `closed`   | The CTR lifecycle left `active`. The transition is terminal.                                                                                                     | The session board is finished, the ledger is accepted, or the reply was delivered. |
| Ledger close                | Acceptance evidence was recorded for that conversation task. A ledger throw does not close the other two domains.                                                | The session board was checked, or the user received a completion notice.           |
| SessionTaskBoard completion | `recordCheckedTaskCompletion` persisted `deliverableChecked` for a live binding, or reported `alreadyChecked` for that same binding without rewriting the board. | The conversation task is closed, or delivery succeeded.                            |
| Delivery confirmation       | Only `confirmPendingTurnDelivery` after `resolveRequiredDeliveryConfirmStatus` is `delivered`.                                                                   | A non-empty assistant reply. Reply completion does not call the confirm entry.     |

The observer return string is not proof that the transcript has no completion notice. At `4ce9c442` the board writer still appended the notice before ConversationTask close. That claim is withdrawn. See the rejection fix.

## Failure injection before the fix

Command, run against production code at `32578f9a` with the new window test expecting the safe outcome:

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task/reply-completion.window.test.ts`

Result: 5 failed, 4 passed. The failures are the window. The passes are behaviors that were already safe.

| Case                                  | Result on `32578f9a`                                                                   | What it proved                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Binding mismatch                      | Notice assertion passed (`undefined`), then lifecycle was `closed` instead of `active` | ConversationTask committed closed while the board rejected the binding and no notice was returned. Retry could not see an active task. |
| Session board write throw             | Same: notice `undefined`, lifecycle `closed`                                           | `transitionTask(closed)` ran before `recordCheckedTaskCompletion` threw.                                                               |
| Stale execution attempt               | Same: notice `undefined`, lifecycle `closed`                                           | A stale attempt still closed the conversation task.                                                                                    |
| Retry after reject                    | First call already left lifecycle `closed`                                             | No retry path.                                                                                                                         |
| Silence `NO_REPLY` with tool evidence | Returned `当前任务已完成，交付已核对。`                                                | A silent reply was reported as completion.                                                                                             |
| Ledger write throw                    | Passed: both domains stayed open                                                       | Ledger failure was already fail-closed. Not a partial-success window.                                                                  |
| Duplicate close after a full success  | Passed                                                                                 | A completed close did not reopen or announce twice.                                                                                    |
| Alignment failure                     | Passed                                                                                 | Drift did not close or announce.                                                                                                       |
| Delivery unknown                      | Passed                                                                                 | The observer does not confirm delivery. Dispatch calls it only inside the `delivered` gate.                                            |

This does not claim the production flag was on. Conversation-task activation stays default OFF. The injection shows the code path can diverge when that observer runs.

## Fix

`27e9acc60c9bb534babfda1ce4c2b26d837dbc50`

Order is now: ledger evidence, then session-board settlement, then `transitionTask(closed)` only when the board is not applicable, newly accepted, or already checked for the same binding. Rejected and thrown board writes leave the conversation task active. Strict close without canonical evidence does not settle the board and does not return a notice. `NO_REPLY` and ellipsis-only placeholders are not completion evidence.

Same-SHA check after the three Batch B commits, 10 files / 96 tests passed, including the window file, reply completion, completion binding, focus policy, focus switch, turn relation, task status, catalog, heartbeat focus, and the delivery-consult source lock.

## T3

`ebf4f65070ef56d068defa30f464d5198499f7e8` and `050098bc3c318b3c76d89278d293a65d29950999`.

| Slice    | Result                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I0 stamp | Sample strings match. `focus-switch` re-exports `policy` `stripInboundStamp`. Dialogue status delegates to the same function.                                                                                                                     |
| I0 caps  | `MAX_PARKED_SLOTS` stays the execution-slot cap. `MAX_PARKED_TASKS` stays the session-board cardinality. Both remain 3 and are not aliased.                                                                                                       |
| I1       | `shouldTaskParkAbortInFlight` lives in `conversation-task/park-abort.ts`. `turn-relation` re-exports it. `classifyTurnRelation` stays the legacy classifier and is not exported from policy. Title text still comes from context `titleFromGoal`. |
| I2       | `evaluateWakeEligibility` is separate from `decideWake`. Heartbeat eligibility rejects identity creation. Heartbeat still cannot create, replan, or write completion. Claim and board writes stay in state.                                       |
| I3       | Transcript readers stay in `focus-switch`. Title copy delegates to context. Heuristics with no module-external consumer stay local and were not promoted.                                                                                         |

`shouldTaskParkAbortInFlight` was not moved into `policy/index` in this batch. That public entry is a different landing stream from the predicate's caller, and mixed landing streams are not forced. The catalog still marks the predicate `pending_migration` with target owner `policy`.

## Not in this batch

- No collaboration migration (T5–T6) and no Gateway collaboration edits.
- No merge and no production deploy.
- `classifyTurnRelation` was not restored as mainline or policy authority.
- SessionTaskBoard, ClaimContract, and ExecutorPrivateTodolist were not merged.
