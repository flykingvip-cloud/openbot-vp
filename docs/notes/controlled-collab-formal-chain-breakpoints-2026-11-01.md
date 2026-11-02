# Controlled collab formal chain — breakpoints (2026-11-01)

Call-site map for draft PR formal-chain work. Activate success stays `dispatched: false`.

## Chain (production entries only)

| Step | Entry | Notes |
| --- | --- | --- |
| 1. discuss→task | `controlledDiscussToTask` / `activateCollaborationTask` | Oral chat alone never creates a board fact. |
| 2. board publish | inside `activateCollaborationTask` (confirmed path) | Legal publish only. |
| 3. post-publish claim | `tryClaimAfterBoardPublish` → (`recordHandoffWake` + consumable `recordNudgeWake`/`consumeWakeForRoundDispatch(source=nudge)` \| `claimCollaborationBoardItem`) | Publish ≠ claim. Ordinary board publish never implicitly claims for the publisher. `resolvePostPublishClaimTarget`: empty intended → `blocked:no_single_legal_claimant`; multiple → `blocked:ambiguous_intended_claimants` (never pick first). Single intended and present actor IS that id → real `claimCollaborationBoardItem` self-claim. Single intended ≠ actor → keep handoff **audit** via `recordHandoffWake`, then reuse the existing consumable path `recordNudgeWake` + `consumeWakeForRoundDispatch({source:"nudge"})` (already in `WAKE_ROUND_DISPATCH_SOURCES` — **do not expand** the allowlist) with stable `opKey=post_publish_intended_claim_handoff\|…` so retries/concurrent publish do not double-wake. Dispatcher prompt tells the rightful executor to claim→apply→propose **as itself** (no impersonation, no policy/confirm bypass, no new scheduler). `formalClaim.wakeRecorded` / `wakeDispatched` report ledger vs real consume; when dispatcher unbound / auth insufficient / target de-authorized → `recorded_not_dispatched` and no claim/responsibility. Activate still `dispatched:false`. |
| 4–5. apply / propose / confirm | existing claim-contract + todolist entries (often via board tools inside the woken Mode B round) | Unchanged. Confirm path may still call `ensureBoardActiveAfterConfirm` (not a parallel SM). Positive handoff proof starts at CEO `activateCollaborationTask` and lets production dispatcher/tools perform claim/propose — tests must not manually seed claim outside that path. |
| 6. wake / dispatcher | `consumeWakeForRoundDispatch` / round dispatcher | Only here may wake-level `dispatched: true` / `formalClaim.wakeDispatched:true` appear. Activate success envelope never flips `dispatched` (`ACTIVATE_SUCCESS_DISPATCHED=false`). |
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
