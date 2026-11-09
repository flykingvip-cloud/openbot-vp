# Batch B acceptance rejection fix

- Date: 2026-11-09
- Rejected head: `4ce9c442e4e2c9fc42444e76d6a9a79b37992d88`
- Implementation commits after that head:
  - `54d8394bc9ea40a8c2421a843163a6a88bcc6798` notice write after ConversationTask close; association criteria
  - `253f994c74f5f4f1b4b24353e2de8617f2e40471` policy implementations of abort and wake eligibility
  - `997fc3214dfa929b947bdb0debff1360200da6ca` policy public entry plus Gateway consumer
  - `aa0f9b9b8f0a52dbde9a159cad686791486de761` focus-policy and turn-relation re-export that entry
- This note is the acceptance-candidate commit that follows those four implementation commits.
- Not a merge, deploy, or Batch C start.

## Rejection 1 — notice before ConversationTask close

`recordCheckedTaskCompletion` appends the transcript notice by default. At `4ce9c442` reply completion called it before `transitionTask`, so a thrown close could leave the bubble on disk while the function returned undefined.

Failure injection before the fix, same command as the new test, against `4ce9c442` behavior:

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task/reply-completion.window.test.ts -t "close throws|session file is missing|binding is missing|incomplete|independent conversation"`

| Case | Before | After `54d8394b` |
| --- | --- | --- |
| Close throws after the board is checked | Return `undefined`, lifecycle `active`, board `deliverableChecked`, transcript notice count **1** | Same state except transcript notice count **0** |
| Retry, then a third call | Not reached | Retry returns the notice, lifecycle `closed`, notice count **1**, idempotency key `task-completion:live:run-1:draft-1` once. Third call returns undefined and the count stays 1 |

The three results are separate calls, not a new coordinator:

1. Board state: `recordCheckedTaskCompletion({ appendNotice: false })`.
2. ConversationTask close: `transitionTask(closed)` only after the board accepts, is already checked, or the task is independent.
3. Notice write: `appendTaskCompletionNotice` only after that transition returns. Its existing idempotency key suppresses a second bubble.

Returning undefined is not treated as proof the transcript is clean. The test reads the transcript.

## Rejection 2 — missing association is not "not applicable"

`not_applicable` is only both sides absent: no session file and no binding. That keeps the previous independent ConversationTask close.

| Input | Classification | ConversationTask |
| --- | --- | --- |
| Neither session file nor binding | `independent` | Closes. No board write. |
| Binding present, session file missing | `incomplete` / `session_file_missing` | Stays active |
| Session file present, binding missing | `incomplete` / `binding_missing` | Stays active. Board unfinished. Notice count 0 |
| Binding `taskId` blank | `incomplete` / `binding_task_id_missing` | Stays active. Board not checked |
| Binding has `taskId` but omits `executionAttempt` while the board has `run-1` | `ready`, then the board binding check rejects | Stays active. Attempt stays `run-1`. Notice count 0 |

Before the fix, the three incomplete cases closed the conversation task. The independent case already stayed on the old close path and passed.

## Rejection 3 — policy ownership

| Rule | Owner now | Consumer |
| --- | --- | --- |
| `shouldTaskParkAbortInFlight` | `policy/explicit-task-control.ts`, exported from `policy/index.ts` | Gateway `chat.ts` imports the public entry. `turn-relation` and `park-abort.ts` re-export that same function. |
| `evaluateWakeEligibility` plus heartbeat forbidden actions | Same policy module and public entry | `focus-policy.decideWake` calls that function. Heartbeat and cron still call `decideWake`. |

`classifyTurnRelation` is not a policy export.

## Remaining, not claimed done

- `decideWake` park/switch and `MAX_PARKED_SLOTS` stay in `focus-policy.ts`. That is the wake action, separate from eligibility. The slot cap is still not `MAX_PARKED_TASKS`.
- Owner-constraint predicates stay in `turn-relation.ts`.
- A crash after `transitionTask` returns and before `appendTaskCompletionNotice` returns can leave the conversation task closed without a transcript notice. The injected case was the close throw, which no longer writes the notice first.

## Regressions after the four implementation commits

Command:

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task/reply-completion.window.test.ts src/conversation-task/reply-completion.test.ts src/conversation-task/completion-binding.test.ts src/agents/execution-preflight/ctr-close-consult-lock.test.ts src/conversation-task/focus-policy.test.ts src/conversation-task/turn-relation.test.ts src/conversation-task/focus-switch.test.ts src/agent-runtime/policy/catalog.test.ts src/agent-runtime/policy/explicit-task-control.test.ts src/infra/heartbeat-focus.test.ts src/conversation-task/session-task-board.inbound-stop.test.ts src/cron/isolated-agent/main-session-focus.test.ts src/agent-runtime/command/task-status.test.ts`

Result: 13 files, 124 tests passed.

No collaboration migration. No merge. No deploy. Batch C was not started.
