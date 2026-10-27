# Collaboration P0-2 — wake → Mode B round-dispatch consumer (2026-10-19)

> Status: **gap-close** for self-run spine.  
> Flags stay **OFF** by default; hangs on existing `wakeContract` + `selfAdvance.executeGroupAllowlist`.  
> No Floor live, no second orchestrator, no LIVE gray flips in this PR.

## Field evidence

`trySelfAdvance` / heartbeat `nudge|escalate` / continue-after-round wrote wake
ledger rows with `outcome: "recorded"` but never opened an execution round.
真回合 still required a human `structured_mention`.

## Inventory-first

| Surface                                                       | Status      | Note                                            |
| ------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| Human structured `@` → decideParticipants + wake `dispatched` | EXISTS      | Unchanged                                       |
| self_advance / nudge / escalate wake writers                  | EXISTS      | Were ledger-only                                |
| Mode B `executeCollaborationRound`                            | EXISTS      | Reused by dispatcher                            |
| Wake → 真回合 consumer                                        | **THIS PR** | Opt-in via execute allowlist + bound dispatcher |

## What this PR adds

| Surface                                | Behavior                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `wake-round-dispatch.ts`               | Gate + `consumeWakeForRoundDispatch`; `dispatched` only on successful Mode B dispatch |
| `mode-b-wake-round-dispatcher.ts`      | Builds Mode B single-owner decision; calls `executeCollaborationRound`                |
| `trySelfAdvance` delivery_exec execute | Uses consumer (unbound → `recorded`)                                                  |
| Heartbeat emit nudge/escalate          | Uses consumer (selfAdvance dry_run → `recorded`)                                      |
| continue-after-round nudge             | Same consumer                                                                         |
| Tests                                  | allowlist外 recorded; execute+mock dispatched; dry_run fallback; Mode B mock runBot   |

## Gate (all required)

1. `source ∈ {self_advance, nudge, escalate}`
2. Wake Contract on for group (global or allowlist)
3. `selfAdvance.mode=execute` **and** group on `executeGroupAllowlist`
4. A `WakeRoundDispatcher` bound (process registry or per-call inject)

Otherwise wake outcome stays `recorded` (dry_run / 无消费 / flag-off).

## Explicit non-goals

- Opening Floor live / multi-beat Episode
- Flipping LIVE allowlists or DIGEST
- Auto-submit / auto-accept board items
- New global default-on flag

## Acceptance

1. Default OFF; allowlist外 only `recorded`
2. Gray execute + mock/Mode B dispatcher → wake `dispatched`; whoWokeWhom answers
3. Turn off execute / unbind dispatcher → fallback `recorded`
4. Implementer does **not** self-merge; LIVE tip+restart needs separate user auth
