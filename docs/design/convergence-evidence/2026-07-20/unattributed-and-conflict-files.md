# Unattributed and conflict files

Captured: 2026-07-20T09:44:55Z  
Tool: `bun scripts/agent-attribution.ts` + dirty-file-claim.tsv

## Summary (attribution script)

```
Agent Attribution — dirty working tree
- dirty files: 50
- attributed: 22
- conflict (>1 owner): 2
- unattributed: 26

## codex-runtime-safety (production-agent-runtime-safety:codex-runtime-safety) — 4
   modified  deploy/production/proxy/nginx/admin.openbot.love.conf
   modified  deploy/production/proxy/nginx/apex.openbot.love.conf
   modified  deploy/production/proxy/nginx/biz.openbot.love.conf
   modified  deploy/production/proxy/nginx/gw.openbot.love.conf

## cursor-convergence-day0 (repository-wide-branch-convergence) — 2
   untracked docs/design/convergence-evidence/
   untracked docs/design/repository-wide-branch-convergence-plan-2026-07-20.md

## cursor-daniel (ops-decommission) — 3
   modified  ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts
   modified  ui/src/ui/ports/employee/employee-workbench-agent-scope.ts
   modified  ui/src/ui/ports/employee/views/workbench-home-model.ts
```

## Hot / CONFLICT candidates

| Path                                                  | Why hot / conflict          | Day0 disposition                                          |
| ----------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| `package.json`                                        | hotfile                     | freeze / integration-hotfile only in convergence worktree |
| `ui/src/i18n/locales/en.ts`, `zh-CN.ts`               | hotfile + multi-agent churn | freeze-evidence                                           |
| `src/gateway/method-scopes.ts` / `server-methods*.ts` | hotfile                     | **not touched** by Day0                                   |
| `ui/src/ui/ports/employee/*`                          | roster + workbench overlap  | freeze until roster owner                                 |
| `src/gateway/control-plane/*`                         | roster control-plane        | freeze                                                    |

## Policy reminder

- Empty owner → deadline disposition **`freeze-evidence`** only (48h).
- **No** automatic `park-branch` from mixed dirty tree.
- Full per-file table: `dirty-file-claim.tsv`.
