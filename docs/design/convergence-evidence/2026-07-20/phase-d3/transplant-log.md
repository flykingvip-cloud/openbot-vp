# Phase D3 — transplant log

## Finding

No greenfield transplant required. Convergence HEAD already contained:

- `src/gateway/checkpoint-store.ts` (`listChatCheckpoints` → `loadSessionEntryForClient`)
- `src/gateway/server-methods/chat-checkpoints.ts` + `.pack.ts`
- Pack manifest/registry scopes for `chat.checkpoints.list`
- `chat.history` wired to `loadSessionEntryForClient` (D2 heal path)

## Historical sources (reference only)

| SHA                  | Note                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `fa0ea3218e`         | checkpoint method pack migration                                               |
| `1abea4117d`         | tenant workspaceDir for checkpoints                                            |
| `fef66191b4` lineage | `kiro-daibai/chat-checkpoint-rollback` (behind convergence; not cherry-picked) |

## D3 delta

Test-only hardening + evidence docs. No production RPC/store rewrite.
