# Phase D4 — transplant log

## Source

Shared tree `/Users/daniel/AI项目/openbot` (localFolder stack already present on dirty tip / prior knowledge-import work).

## Copied files

- `src/gateway/knowledge/sources/local-folder-*.ts` (+ path-policy/runtime/types tests)
- `src/gateway/knowledge/sources/source-document-link-store.ts`
- `src/gateway/knowledge/explicit-metadata-store.ts` (minimal stub: `deleteExplicitDocumentMetadata` only)

## Patched in worktree

| File                             | Change                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `source-descriptor.ts`           | +`localFolder` kind                                          |
| `knowledge-base-sources-list.ts` | +`localFolder` list kind + switch case                       |
| `server-methods/knowledge.ts`    | imports + 6 `knowledge.local-folder.*` handlers (~490 lines) |
| `method-scopes.ts`               | +6 RPC scopes                                                |
| `server-methods-list.ts`         | +6 method names                                              |

## Explicitly not transplanted

- Passive connector stack / `knowledge.connector.*`
- `gitRepo` / `cloudDrive` / `mailAttachment` kinds
- `server-startup` watcher resume
- Whole-branch cherry-pick
