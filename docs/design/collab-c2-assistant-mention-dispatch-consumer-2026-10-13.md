# Collaboration C2 follow-up — assistantMentionDispatch consumer (2026-10-13)

> Status: **gap-close** for tip audit C3 (writer-without-consumer).
> Flag `collaboration.task.assistantMentionDispatch` remains **OFF** by default.
> No Floor live, no new round from assistant text, no second orchestrator.
>
> Naming note: plan-letter **C3** in the collab upgrade stack is peer-review
> (`requirePeerReview` / `collab-c3-peer-review-gate-2026-10-13.md`). This doc
> closes the tip audit gap labeled **C3 assistantMentionDispatch consumer**.

Depends on **C2 Wake Contract** (#668 / #671).

## Field evidence

Tip audit `audits/real-test-ogui-collab-2026-10-13.md`: with
`assistantMentionDispatch=true`, writers mark `assistant_inline_at` /
`dispatch_eligible`, but **no consumer** turned eligible into live dispatch.
`planAssistantMentionTargets` existed; nothing attached edges or upgraded
outcome to `dispatched`.

## Inventory-first

| Surface                                                       | Status                       | Note                      |
| ------------------------------------------------------------- | ---------------------------- | ------------------------- | --------- |
| Human structured `@` → decideParticipants + wake `dispatched` | EXISTS                       | Unchanged                 |
| Assistant `[[collab_edge:peer_ask                             | …]]` → same-round supplement | EXISTS                    | Unchanged |
| Assistant plain `@Name` in reply text                         | WAS observe-only             | This PR consumes          |
| `assistantInlineAtCreatesRound()`                             | FROZEN `false`               | Still true — no new round |

## What this PR adds

| Surface                               | Behavior                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `assistant-mention-dispatch.ts`       | Resolve `@` → bots; build `peer_ask` edges; merge with directives under budget ≤2 |
| `attachEdgesAfterPrimary`             | Flag ON → attach consumer edges so existing invited-supplement path runs          |
| `observeAssistantReplyWakeBestEffort` | Pass bots; resolved → wake outcome `dispatched`                                   |
| Tests                                 | Flag off / unmatched eligible / resolved dispatched / edge budget                 |

## Explicit non-goals

- Floor live / LIVE defaults / `ui.*` RPC
- Opening a **new** collaboration round from assistant text
- Broadcast `@所有人` fan-out via this consumer
- Changing peer-review C3 (`requirePeerReview`)

## Acceptance

1. Flag default OFF; LIVE untouched
2. Flag ON + `@Beta` in assistant reply with Beta in roster → wake `dispatched` + `peer_ask` edge → supplement can run
3. Flag OFF → no consumer edges; observe `not_dispatched`
4. `assistantInlineAtCreatesRound()===false`
5. Implementer does **not** self-merge
