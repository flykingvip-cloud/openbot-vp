# Phase D4 — scope

**Agent:** `cursor-convergence-phase-d4`  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`  
**Kind (locked):** `localFolder` (`local_index` mode)

## RPC

| Method                                                                 | Role                                 |
| ---------------------------------------------------------------------- | ------------------------------------ |
| `knowledge.base.create` / `documents.list` / `search` / `sources.list` | existing                             |
| `knowledge.feed.list` / `runtime.context` / `workspace.search`         | existing                             |
| `knowledge.local-folder.bind`                                          | new                                  |
| `knowledge.local-folder.scan-now`                                      | new                                  |
| `knowledge.local-folder.unbind`                                        | new                                  |
| `knowledge.local-folder.status`                                        | new                                  |
| `knowledge.local-folder.sync.plan` / `.commit`                         | new (wired; matrix uses local_index) |

## Modules transplanted

`local-folder-{types,binding-store,path-policy,runtime,sync,sync-plan-store,watcher}.ts` + `source-document-link-store.ts` + golden-path matrix test.

## Deferred kinds

`file` one-shot upload, `url`/`web`, `dataset`, `gitRepo`, `cloudDrive`, `mailAttachment`, passive connector productization.
