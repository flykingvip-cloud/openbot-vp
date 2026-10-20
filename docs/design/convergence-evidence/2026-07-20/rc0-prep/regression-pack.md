# Regression pack (RC0-PREP rework — re-run this wave)

**Captured:** 2026-07-20T12:24Z UTC  
**Worktree HEAD when run:** `08027a7006` (branch tip; recommended deploy tip remains `9aceda7349`)  
**Note:** Results are from a **fresh** `pnpm build` + vitest this wave — not copied from Phase D4 reports.

## Commands

```bash
cd /Users/daniel/AI项目/openbot-convergence
pnpm build
pnpm exec vitest run \
  src/gateway/tenant-context.test.ts \
  src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
  src/gateway/server-methods/chat.history-d3.test.ts \
  src/gateway/server-methods/chat-checkpoints.d3.test.ts \
  --pool=forks
pnpm tsgo   # record only; ceiling historically 77 at D4 acceptance
```

## Results

| Suite                                     | Expect        | Result                                                                                                                   |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                              | exit 0        | **PASS** · exit 0 · ~39.7s wall (`71.16s` user) · Control UI `index-BrtEWITL.js`                                         |
| `tenant-context.test.ts`                  | 29+ green     | **PASS** · 29 tests                                                                                                      |
| `local-folder-import.golden-path.test.ts` | K1–K6 (6)     | **PASS** · 6 tests                                                                                                       |
| `chat.history-d3.test.ts`                 | green         | **PASS** · 2 tests                                                                                                       |
| `chat-checkpoints.d3.test.ts`             | green         | **PASS** · 3 tests                                                                                                       |
| Vitest aggregate                          | all green     | **PASS** · 4 files / **40** tests · ~12.7s                                                                               |
| `pnpm tsgo`                               | ≤77 preferred | **RECORD** · **78** `error TS*` lines on HEAD `08027a7006` (above D4 ceiling; another reason to prefer tip `9aceda7349`) |

## Mapping to phases

| Phase                 | Covered by                                |
| --------------------- | ----------------------------------------- |
| D1 auth/tenant        | `tenant-context.test.ts`                  |
| D2 session promote    | same suite (promote / store path cases)   |
| D3 history/checkpoint | `chat.history-d3` + `chat-checkpoints.d3` |
| D4 localFolder matrix | `local-folder-import.golden-path.test.ts` |

## Verdict

**Regression gate: GREEN** for the mandatory pack. Staging may proceed only with tip discipline (`RECOMMENDED_RC0_TIP=9aceda7349`) and remaining RC0 checklist items.
