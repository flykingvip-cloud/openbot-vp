# Collaboration C3 — Peer review gate before accept (2026-10-13)

> Status: **gap-only** peer-review hard gate. Flag
> `collaboration.task.requirePeerReview` remains **OFF** by default.
> No Floor live, no `ui.*` RPC, no second orchestrator.

Depends on **C2** (merged via #668 @ `83f240b7f56`).

## Field evidence addressed

1. Tip 数字人战队: framework + chapter drafts often stitch without structured
   cross-review before「汇总」→ accept had no peer-review precondition.
2. OGUI-inspired three-data split: draft ≠ submitted; accept is the final
   boundary and must optionally require a non-author review.
3. RCIS 责任·贡献·创新·共享 may **observe** review/accept events;
   `drivesAdmission` stays **false**.

## Inventory-first (AS-IS)

| Surface                                      | Status          | Note                            |
| -------------------------------------------- | --------------- | ------------------------------- | -------- |
| Claim progress C1                            | EXISTS          | submitted_for_review → accepted | returned |
| `acceptBoardItemSubmission`                  | EXISTS          | No peer-review check before C3  |
| Collaboration quality ledger `event: review` | EXISTS          | Used by RCIS aggregate          |
| Named peer-review ledger + accept gate       | **was MISSING** | This PR                         |

## What this PR adds

| Surface                                     | Behavior                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Flag `collaboration.task.requirePeerReview` | Default OFF; accept gate only when ON                                   |
| `peer-review-gate.ts`                       | record / list / count / assert gate                                     |
| Hook                                        | `acceptBoardItemSubmission` calls gate when flag ON                     |
| RPC                                         | `collaboration.task.recordPeerReview` (not `ui.*`)                      |
| RCIS observe                                | best-effort quality ledger `review` on record; `drivesAdmission: false` |
| Design doc                                  | This file                                                               |

## Explicit non-goals

- Floor live / default-on flags / LIVE cutover
- `ui.*` RPC / second orchestrator / multi-beat controller
- Feeding peer-review scores into Admission
- Merging with Wizard / OGUI (C4)

## Acceptance checklist (执行效率合入验收)

1. inventory-first / gap-only；无 Floor live / 无第二编排器 / 无 `ui.*`
2. 默认 `requirePeerReview` OFF；flag-off accept 行为与今一致
3. flag-on：无非作者 peer review 时 accept 拒绝（`peer_review_required`）
4. flag-on：≥1 非作者 peer review 后可 accept；自审不计
5. review 事件落账；RCIS 可观察且 `drivesAdmission===false`
6. 测在 diff 中；CI unstable 不阻塞；**实现方不自 merge**
