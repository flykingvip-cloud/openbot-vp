# Collaboration C1 — Claim progress states + submission_id (2026-10-13)

> Status: **gap-only** extension of P4b ClaimContract. Flag `collaboration.task.claimContract`
> remains **OFF** by default. No Floor live, no `ui.*` RPC, no second orchestrator.

## Field evidence addressed

1. `@` in assistant text does not wake peers → **C2**; C1 still makes **member态可见**.
2. No「我完成了」/ no four-tier progress posted → add `in_progress` / `submitted_for_review` / `accepted` / `returned` (+ `blocked`).
3. No `listBoard` / `getProgress` → add **read-only** RPCs `listBoardItems` + `getMemberProgress` (no flag required for reads).
4. Stitch risk → `draft chat ≠ submitted`; only `submitForReview` with UUID `submission_id` is交卷.

## State machine

```
published → claimed → applied → in_progress → submitted_for_review → accepted
                ↘ cancelled              ↘ returned → in_progress
                                         ↘ blocked ↔ in_progress
```

- `applyClaim` still seeds responsibility (unchanged).
- `submission_id` idempotent on `submitted_for_review`.
- Illegal jumps refused (`invalid_status`).

## RPCs

| Method | Flag | Behavior |
| --- | --- | --- |
| `collaboration.task.listBoardItems` | read always | `{ items }` |
| `collaboration.task.getMemberProgress` | read always | `{ progress }` member table |
| `collaboration.task.markInProgress` | write needs flag | claimant only |
| `collaboration.task.submitForReview` | write needs flag | requires UUID submissionId |
| `collaboration.task.acceptSubmission` | write needs flag | coordinator/owner actor |
| `collaboration.task.returnSubmission` | write needs flag | reason required |
| `collaboration.task.blockBoardItem` | write needs flag | optional reason |

## Non-goals

- Wake ledger / `@` → new round (C2)
- Peer-review hard gate (C3)
- OGUI form wire (C4)
- Floor live / default-on flags / LIVE cutover

## Acceptance checklist (执行效率合入验收)

1. Inventory-first / gap-only; no Floor live / no second orchestrator / no `ui.*`.
2. Default `claimContract` OFF; write path fail-closed; reads observe AS-IS.
3. Tip group can see member states via `getMemberProgress` / C0 export.
4. `submission_id` required + idempotent; draft≠submitted; illegal jumps refused.
5. Tests in diff; CI unstable does not block.
