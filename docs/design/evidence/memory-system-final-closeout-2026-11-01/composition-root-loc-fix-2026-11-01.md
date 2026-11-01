# composition-root-loc fix (2026-11-01 Asia/Shanghai)

Tip before: `cd031bc90c1314e8cf4313ee8ca31185b2dac48a` (branch `cursor/memory-final-closeout-afe1`).

## Offenders (trunk-identical; not introduced by closeout)

| Path | Before (`split("\n").length`) | Budget | After |
| --- | ---: | ---: | ---: |
| `src/gateway/collaboration-learning.ts` | 166 | 150 | 150 |
| `ui/src/ui/app.ts` | 4890 | 4845 | 4844 |

Budgets unchanged (no raise). No `.loom/registry.yaml` in this fix.

## Edits

1. **collaboration-learning facade** (`controlled-discuss-to-task-p1` stream): removed unused #164 discuss-to-task re-exports. Live callers already import submodule paths.
2. **app.ts + checkpoint-session-isolation.ts** (`collab-restore-line-phase-a` stream): moved `loadChatCheckpoints` body into owned `loadChatCheckpointsForHost` helper; shell method delegates. Behavior preserved.

## Gates

- `pnpm lint:core:composition-root-loc` → exit 0
- `pnpm tsgo` → exit 0
- vitest checkpoint suites → exit 0
- `oxfmt --check` on touched files → exit 0

No gateway restart / deploy / merge. Local gateway evidence JSON left untracked for a later closeout commit.
