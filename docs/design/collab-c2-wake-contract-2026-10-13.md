# Collaboration C2 — Wake Contract ledger (2026-10-13)

> Status: **gap-only** wake event ledger. Flags
> `collaboration.task.wakeContract` and
> `collaboration.task.assistantMentionDispatch` remain **OFF** by default.
> No Floor live, no `ui.*` RPC, no second orchestrator.

Depends on **C0/C1** (merged via #667 @ `88e35ea0a08`).

## Field evidence addressed

1. Assistant replies that `@` peers do **not** open a new round / wake peers
   (tip 数字人战队) → freeze `assistantInlineAtCreatesRound()===false`;
   optional flag `assistantMentionDispatch` (default OFF) marks
   `dispatch_eligible` when ON without inventing a second orchestrator.
2. After assignment: hard to answer「谁唤醒了谁」→ wake-events jsonl +
   `whoWokeWhom`.
3. Return / handoff / claim / nudge / stitch_only → structured wake sources
   (plan §3).
4. Stitch risk → `stitch_only` observe marker when assign→submit has no peer wake
   (does **not** drive Admission).

## Inventory-first (AS-IS)

| Surface | Status | Note |
| --- | --- | --- |
| Human `chat.send` + structured `mentions` | EXISTS | Opens decideParticipants rounds |
| Assistant inline `@` in reply text | EXISTS | Does **not** create rounds |
| HandoffContract / ClaimContract | EXISTS (flag-off) | C2 best-effort wake hooks on propose / claim / return |
| Episode event types | EXISTS | Fixed orchestration union — not extended |
| Named wake ledger | **was MISSING** | This PR adds `<ns>/wake-events/` |

## What this PR adds

| Surface | Behavior |
| --- | --- |
| Flag `collaboration.task.wakeContract` | Default OFF; writes fail-closed |
| Flag `collaboration.task.assistantMentionDispatch` | Default OFF; gate only |
| `wake-contract.ts` | record / list / whoWokeWhom / stitch_only / observe assistant `@` |
| Hooks | claimBoardItem / returnBoardItemSubmission / proposeHandoff best-effort |
| Freeze | `assistantInlineAtCreatesRound()===false` |
| Design doc | This file |

## Explicit non-goals

- Floor live / default-on flags / LIVE cutover
- `ui.*` RPC / second orchestrator / multi-beat controller
- Feeding wake / stitch_only into Admission (`drivesAdmission` stays false)
- Rewriting chat.ts to auto-open rounds from assistant text (flag only opens
  eligibility; consumers opt in via `planAssistantMentionTargets`)

## Acceptance checklist (执行效率合入验收)

1. inventory-first / gap-only；无 Floor live / 无第二编排器 / 无 `ui.*`
2. 默认 `wakeContract` / `assistantMentionDispatch` OFF；写路径 fail-closed
3. 时间线 `whoWokeWhom` 可回答「谁唤醒了谁」（structured_mention / handoff / claim / return / nudge）
4. AS-IS：`assistantInlineAtCreatesRound()===false`；flag-off 观察为 `not_dispatched`；flag-on 为 `dispatch_eligible`
5. 无 peer wake 的 assign→submit 可记 `stitch_only`（observe_only，不进 Admission）
6. 测在 diff 中；CI unstable 不阻塞；**实现方不自 merge**
