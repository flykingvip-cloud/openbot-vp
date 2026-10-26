# Collaboration P1 — 产物绑定 / 验收回路 (2026-10-19)

> Status: **gap-close** for Mode B overnight self-run spine.  
> Flags stay **OFF** by default; hangs on existing `claimContract` + `wakeContract` allowlists.  
> No Floor live, no second orchestrator, no LIVE / DIGEST / production config flips in this PR.

## Field evidence

P0 board tool exposed `propose_todolist` / `mark_in_progress` / `submit_for_review` but
explicitly refused `accept` / `return`. Claim-contract already had
`acceptBoardItemSubmission` / `returnBoardItemSubmission` (S3 versioning + criteria)
and return already woke the claimant; **submit did not wake 主答/coordinator**, so
交卷后验收人无结构化唤醒。

## Inventory-first

| Surface                                                   | Status      | Note                                                      |
| --------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `submitBoardItemForReview` + required `artifactVersion`   | EXISTS      | Unchanged; still refuses empty / unbound version          |
| `acceptBoardItemSubmission` / `returnBoardItemSubmission` | EXISTS      | Contract layer; tool surface was missing                  |
| Return → wake claimant (`source: return`)                 | EXISTS      | Unchanged                                                 |
| Submit → wake reviewer/coordinator                        | **THIS PR** | Best-effort; `source: insight` (no WAKE_SOURCES `submit`) |
| `collaboration_board` accept/return actions               | **THIS PR** | Wire entry; no claimant check in tool                     |
| Second orchestrator / ui.\* RPC / LIVE flips              | NON-GOAL    |                                                           |

## What this PR adds

| Surface                                       | Behavior                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `collaboration_board` WRITE_ACTIONS           | `accept_submission`, `return_submission`                                                                                                |
| Tool params                                   | `expectedSubmissionId`, `reason`, `checkedAcceptanceCriteria`, optional `proxyForActorId` / `proxyBasis`                                |
| Entry `submitCollaborationBoardItemForReview` | Loads operating-state `coordinatorBotId` into claim options                                                                             |
| `submitBoardItemForReview`                    | After real submit transition, best-effort wake reviewer: prefer `options.coordinatorBotId`, else `publishedBy` (never intendedClaimant) |
| Tests                                         | Tool accept/return happy + missing reason/expectedSubmissionId; claim-contract wake-on-submit on/off                                    |

## Explicit non-goals

- Opening Floor live / multi-beat Episode / second orchestrator
- Flipping LIVE allowlists, DIGEST, or constitutional freeze paths
- Auto-accept / auto-return without 主答 tool call
- Adding a new WAKE_SOURCES enum value (`submit`)
- Merging this PR from the implementer agent

## Vitest (no LIVE auth)

```bash
# board tool lives under src/agents (excluded by vitest.unit / gateway scopes)
./node_modules/.bin/vitest run --config vitest.config.ts \
  src/agents/tools/collaboration-board-tool.test.ts

./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/claim-contract.test.ts
```

## Acceptance

1. Tool exposes accept/return; missing `reason` or `expectedSubmissionId` fails before entry
2. Submit still requires non-empty `artifactVersion` + UUID `submissionId`
3. With `wakeContract` on, successful submit records `insight` wake to coordinator (or publishedBy)
4. With `wakeContract` off, submit Result still `ok: true` (fail-open)
5. LIVE tip+restart / gray flips need separate user auth — **not** this PR

## LIVE auth

**No.** Unit/gateway vitest only.
