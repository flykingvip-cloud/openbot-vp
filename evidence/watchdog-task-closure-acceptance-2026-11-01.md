# Watchdog task-closure acceptance (PR #177 follow-up)

- Branch: `grok-sentinel-link/watchdog-task-closure`
- Worktree: `/Users/daniel/.codex/worktrees/watchdog-task-closure/openbot`
- Base tip before this fix: `6f1583c0a83a57a5398798bac954613a889dde1c`
- Pushed tip: `e1298d0e2fe3a5af15ca33f82ea239f4396d3023`
- Zone: Asia/Shanghai (UTC+8)
- Written: 2026-11-01 ~09:51 Asia/Shanghai

## Acceptance blockers addressed (vs tip 6f1583c0a)

### P1 mode-b empty/abort ≠ not_started
- `mode-b-wake-round-dispatcher.ts`: once `executeCollaborationRound` returns aborted, always `sideEffectClass: "started_or_unknown"` (empty final text is not proof of idle).
- Unit coverage: tools-executed + empty reply; empty/placeholder abort → no auto-replay.

### P1 heartbeat nudge fail counting / bounded retry / human exit
- `group-task-heartbeat.ts`:
  - `nudgeFailCount` + `lastNudgeAttemptAt` with 30s backoff (`nudge_fail_backoff`).
  - After 3 nudge dispatch failures → escalate (if coordinator) or `human_todo`.
  - Escalate fail ≥3 → durable `humanAttention` (`needs_human` + owners + reason + recoveryHint) and `${group}.human-attention.jsonl`.
  - `started_or_unknown` consume failures open `humanAttention` immediately (no blind replay).
  - Fixed bug: `...escalateCarry` previously overwrote freshly written `nudgeFailCount` with `undefined`.

### P2 safeMessage redaction
- `wake-round-dispatcher-boot.ts`: export `sanitizeWakeRunBotErrorMessage` using `redactSensitiveText(..., { mode: "all" })`.

### Heartbeat consume sideEffectClass
- `wake-round-dispatch.ts` `consumeWakeForRoundDispatch` failure branch:
  - `not_started` → `markWakeOpFailed` (retryable)
  - `started_or_unknown` → `markWakeOpUnknown` (no blind replay)
  - returns `sideEffectClass` on result for heartbeat to honor.

## Tests (exact)

Command:

```bash
pnpm exec vitest run \
  src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts \
  src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts
```

Result (exit 0):

```
 ✓ src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts (13 tests) 5ms
 ✓ src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts (15 tests) 1422ms
 ✓ src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts (7 tests) 708ms

 Test Files  3 passed (3)
      Tests  35 passed (35)
```

Integration proofs:
1. Real `createModeBWakeRoundDispatcher` + runBot stub → wake-op ledger `failed` vs `unknown` vs `completed` (does not mock whole round executor).
2. not_started retryable; started_or_unknown no re-dispatch; fail exhaust → humanAttention + jsonl.
3. Multi-scan persistence of `nudgeFailCount` / backoff / escalate / human_todo (not planner-only).
4. Review routing: after clearing submit `pendingEventRelay`, heartbeat enrichment reads `task.responsibility.reviewer` and nudges `bot:reviewer` (not executor).

## Format / types / pnpm check

- `oxfmt --check` on the 6 touched files: **All matched files use the correct format.**
- `tsgo --noEmit -p tsconfig.json`: **no errors in touched files**; full project still exits 2 on **pre-existing unrelated** errors (memory-core, bash-tools sandbox test, enterprise-data, memory-continuity HTTP tests, etc.).
- Full `pnpm check`: **fails early** on `format:check` for **pre-existing unrelated** paths already dirty on tip (e.g. `.kiro/specs/watchdog-task-closure/tasks.md`, audit docs, unrelated src). Not introduced by this change set; not mass-reformatted.

## Files changed

- `src/gateway/collaboration-dispatch/mode-b-wake-round-dispatcher.ts`
- `src/gateway/collaboration-dispatch/wake-round-dispatch.ts`
- `src/gateway/collaboration-dispatch/group-task-heartbeat.ts`
- `src/gateway/wake-round-dispatcher-boot.ts`
- `src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts`
- `src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts` (new)
- `evidence/watchdog-task-closure-acceptance-2026-11-01.md` (this file)

## Unresolved / out of scope

- Full-repo `pnpm check` green requires unrelated tip hygiene (oxfmt + tsgo debt outside this PR scope).
- No prod deploy / restart / force-push / approval skip.
