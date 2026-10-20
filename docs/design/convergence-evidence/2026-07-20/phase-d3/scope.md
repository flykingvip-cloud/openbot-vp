# Phase D3 — scope

**Agent:** `cursor-convergence-phase-d3`  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`  
**Start HEAD:** `5b924350bc` (D2 tip)

## Inventory finding

Checkpoint LIST pack, `chat.history` → `loadSessionEntryForClient`, and most path-safety tests were **already on branch**. D3 focused on **locking tests + negatives**, not a greenfield transplant.

## Included

| ID  | Work                                                                                         |
| --- | -------------------------------------------------------------------------------------------- |
| T1  | `chat.history-d3.test.ts` — spies `loadSessionEntryForClient`; invalid archiveId negative    |
| T2  | `session-utils.fs.test.ts` — unsafe `sessionFile` still reads store-local transcript         |
| T3  | `chat-checkpoints.d3.test.ts` — client/sessionKey wiring + empty key + UNAVAILABLE negatives |
| T4  | `tenant-context.test.ts` still **29** green                                                  |
| T6  | `employee-steward-session.d3.test.ts` — preserves `agent:bot-2:main`                         |

## Deferred

| ID         | Reason                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| T5 restore | Already present (`chat.restore` + tests); no new restore work in thin pack |

## Not touched

- monthly-usage / organization UI
- method-scopes BASE (checkpoints stay pack-registered)
- D2 promote/heal implementation (regression only)
