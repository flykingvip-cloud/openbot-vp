# Controlled collab formal chain — breakpoints (2026-11-01)

Call-site map for draft PR formal-chain work. Activate success stays `dispatched: false`.

## Chain (production entries only)

| Step | Entry | Notes |
| --- | --- | --- |
| 1. discuss→task | `controlledDiscussToTask` / `activateCollaborationTask` | Oral chat alone never creates a board fact. |
| 2. board publish | inside `activateCollaborationTask` (confirmed path) | Legal publish only. |
| 3. post-publish claim | `tryClaimAfterBoardPublish` → (`recordHandoffWake` \| `claimCollaborationBoardItem`) | Publish ≠ claim. Ordinary board publish never implicitly claims for the publisher. `resolvePostPublishClaimTarget`: empty intended → `blocked:no_single_legal_claimant`; multiple → `blocked:ambiguous_intended_claimants` (never pick first). Single intended and present actor IS that id → real `claimCollaborationBoardItem` self-claim. Single intended ≠ actor → `formalClaim.outcome=scheduled` + Wake Contract `recordHandoffWake` so the intended bot can enter claim→apply→propose as itself (no impersonation, no policy/confirm bypass). Activate still `dispatched:false`. |
| 4–5. apply / propose / confirm | existing claim-contract + todolist entries | Unchanged. Confirm path may still call `ensureBoardActiveAfterConfirm` (not a parallel SM). |
| 6. wake / dispatcher | `consumeWake` / round dispatcher | Only here may `dispatched: true` appear. Activate never flips it. |
| 7. OS deliverable bind | `syncGroupOperatingState` → `projectOperatingDeliverableBinding` | Ordinary/background sync prefers existing OS `currentTaskId` when that task is still active (old-task update cannot steal focus). Explicit activate/switch passes `preferredTaskId` so new task B beats a stale OS A. No active task → `currentDeliverableId=null` (historical rows stay historical). |
| 8. submission | `submitBoardItemForReview` | Permissions, linked deliverable, version, summary. |
| 9. return / revise | `returnBoardItemSubmission` then `markBoardItemInProgress` + new submit | Old submission cannot be accepted. |
| 10. accepted | `acceptBoardItemSubmission` | Version + criteria + linked deliverable. Bare chat「完成 / 闭环完成」→ `chat_completion_is_not_acceptance` before any write. Authorized accept with a real rationale still succeeds. Chat must not change `accepted` via entries/facts (not keyword blacklist alone). |

## Explicit non-flips

- `syncActivated` success and OS-sync failure both report `dispatched: ACTIVATE_SUCCESS_DISPATCHED` (`false`).
- No `projectFormalResponsibilityChain` / placeholder receipt refs / prompt-only next-entry names. Receipt text reports real `formalClaim` from activate.
- No `applyFormalAcceptanceForm` parallel acceptance state machine — withdrawn; tests hit production submit/return/accept.
- `@mention` / oral mention does not advance the formal chain.

## Synthetic retest

```bash
pnpm exec vitest run \
  src/gateway/collaboration-learning/operating-deliverable-binding.test.ts \
  src/gateway/collaboration-learning/formal-delivery-acceptance.test.ts \
  src/gateway/collaboration-learning/activate-collaboration-task.test.ts \
  src/gateway/collaboration-learning/discuss-to-task-chat-receipt.test.ts \
  src/gateway/collaboration-learning/try-claim-after-board-publish.test.ts \
  src/gateway/collaboration-learning/post-publish-claim-handoff.test.ts
```

Do not connect `:18789`; do not change production flags / group灰度.
