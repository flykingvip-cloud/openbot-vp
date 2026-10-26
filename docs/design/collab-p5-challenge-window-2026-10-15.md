# Collaboration P5 — Deploy quality gate: single-challenger challenge window (2026-10-15)

> Status: **code + docs PR**. Platform `collaboration.task.challengeWindow` remains **OFF** by default (可关).  
> No LIVE flag flips / claim or wake allowlist gray-enable / Floor live / second orchestrator / P6.

## What this ships (FINAL §1.3 动作1 + §1.4 L-Deploy + §3.6)

| Item                                 | Behavior                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `collaboration.task.challengeWindow` | Feature flag (default **false**). When true, `publishBoardItem` requires a resolved\|skipped window **or** `skipChallengeWindow: true` |
| Exactly 1 challenger (蓝)            | `openChallengeWindow({ challengerId })` — refuses challenger === lead                                                                  |
| Critique                             | `recordChallengeCritique` issues: `acceptance_gap` \| `scope_drift` \| `role_mismatch` + comment; only designated 蓝                   |
| 主答决议                             | `resolveChallengeWindow` → `absorb` \| `reject` with reason (optional revised draft on absorb)                                         |
| Ledger                               | Append-only `<ns>/challenge-windows/<taskId>.jsonl`; quality best-effort on resolve; `drivesAdmission: false`                          |
| Intent path                          | `materializeIntentToBoardItem` → `needs_challenge` when flag ON and no window/skip                                                     |
| Per-item 可关                        | `skipChallengeWindow` on publish, or `skipChallengeWindow` ledger record                                                               |
| RPC                                  | `openChallengeWindow` / `recordChallengeCritique` / `resolveChallengeWindow` / `skipChallengeWindow` / `listChallengeWindows`          |

Not full-group debate. Does not invent a second orchestrator — wires into existing `publishBoardItem` / intent-materialize.

## How to disable (rollback)

1. Keep or set `collaboration.task.challengeWindow: false` (default).
2. Reload/restart gateway.
3. Verify: `openChallengeWindow` returns `flag_off`; `publishBoardItem` works without `challengeWindowId`.

Optional per-item close while flag is ON: pass `skipChallengeWindow: true` on publish (or call `skipChallengeWindow` RPC first).

## Gray-enable / LIVE

- **N/A for allowlist** — this slice uses a single boolean flag (default OFF), not a group allowlist.
- **Do not** flip LIVE production config without separate user auth.
- Claim / wake allowlists unchanged.

## Tests

```bash
./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/challenge-window.test.ts \
  src/gateway/collaboration-dispatch/intent-board-materialize.test.ts \
  src/gateway/collaboration-dispatch/claim-contract.test.ts
```

## Non-goals (P6 / deferred)

- Handoff gray-open, Episode multi-beat, Floor live, RCIS admission
- Global flags ON, LIVE writes
- Full-group 红蓝 / second orchestrator
