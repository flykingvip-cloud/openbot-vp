# Phase 1B Item 7 Call-site Ledger

**operationId:** `phase1b-item7-callsite-ledger-104c3d5636-20260820T044500Z`  
**baselineSha / origin/main:** `104c3d5636bfc941998efbc47e641a8045895468`  
**citedUserBaseline:** `f495f7a6a17ea5a1b4bdbfbec83842501b3ef38f` (rebase after #552)  
**status:** evidence-preparation  
**Item 7:** not-met / locked  
**productionWriteWatchIndex=37** (freeze 38, retiredThisChange 0)

This packet is a **per-call-site ledger** for the remaining 37 production old-write/index sites. It is static scan + read-only verification + shadow/dry-run + replacement-path design + independent review evidence.

It is **not** Item 7 met, **not** Retirement, and **not** a production write authorization.

## Baseline recorded at start

| Field                     | Value                                      |
| ------------------------- | ------------------------------------------ |
| originMainSha             | `104c3d5636bfc941998efbc47e641a8045895468` |
| branchShaAtStart          | `104c3d5636bfc941998efbc47e641a8045895468` |
| citedUserBaseline         | `f495f7a6a17ea5a1b4bdbfbec83842501b3ef38f` |
| minima receipt tip        | `ce6cf5e1702c7f2de20b58f062fd100562b6ee01` |
| Item 5 final closeout tip | `85f55ee2fa76f88dc538180b481a5823631af649` |

## Inventory (unchanged)

| Index                              | Value  | Source                            |
| ---------------------------------- | ------ | --------------------------------- |
| Freeze `productionWriteWatchIndex` | 38     | Phase 0 freeze                    |
| Live write/index sites             | **37** | existing retirement scan snapshot |
| `retiredThisChange`                | 0      | this packet                       |

Do **not** rewrite 37 to 0 in this packet. Item 7 met may be requested only after the live count is actually 0 **and** independent retirement review, rollback, and quarantine proofs land.

## Per-site ledger fields

Each of the 37 rows records:

- file and symbol (scan coordinates kept)
- current write behavior (static read of the cited line)
- replacement path (design only, `replacementImplemented=false`)
- unique owner
- rollback (`restoreFromGit`, never rewrite Freeze to 0)
- quarantine (design only, `enabled=false`, `quarantineNormalWrites=0`)
- retirement prerequisite (wave W0–W5; `deleteNow=false`)

Replacement families:

- P1/P3 write: Catalog-backed workspace identity; fail-closed on miss
- P4 empty Catalog: read existing Catalog SoT; no empty synthesis; miss=deny stays off
- P4 builders: wrap existing Catalog rows only
- P5 steward dirs: steward Catalog bindings; no implicit dir create
- P1 index / P8 sync: Catalog-keyed memory index last; old engine not retired here

## 37 live sites (scan coordinates kept)

| ID  | File:line                                                                       | Symbol                                      | Op    | Owner                  | Wave |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------- | ----- | ---------------------- | ---- |
| S01 | `src/auto-reply/reply/get-reply.ts:164`                                         | `resolveEmployeeBuiltinStewardWorkspaceDir` | write | auto-reply-runtime     | W4   |
| S02 | `src/auto-reply/reply/get-reply.ts:165`                                         | `resolveAgentWorkspaceDir`                  | write | auto-reply-runtime     | W2   |
| S03 | `src/commands/agent.ts:776`                                                     | `resolveAgentWorkspaceDirForClient`         | write | cli-commands           | W2   |
| S04 | `src/commands/status-all/agents.ts:25`                                          | `resolveAgentWorkspaceDir`                  | write | cli-commands           | W2   |
| S05 | `src/gateway/checkpoint-store.ts:119`                                           | `resolveAgentWorkspaceDir`                  | write | gateway-checkpoint     | W2   |
| S06 | `src/gateway/checkpoint-store.ts:127`                                           | `resolveEmployeeBuiltinStewardWorkspaceDir` | write | gateway-checkpoint     | W4   |
| S07 | `src/gateway/checkpoint-store.ts:158`                                           | `resolveAgentWorkspaceDirForClient`         | write | gateway-checkpoint     | W2   |
| S08 | `src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts:86` | `createEmptyWorkspaceCatalog`               | write | gateway-knowledge      | W3   |
| S09 | `src/gateway/knowledge/knowledge-document-preview.ts:178`                       | `createEmptyWorkspaceCatalog`               | write | gateway-knowledge      | W3   |
| S10 | `src/gateway/server-methods/agents.ts:142`                                      | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S11 | `src/gateway/server-methods/agents.ts:146`                                      | `resolveAgentWorkspaceDir`                  | write | gateway-server-methods | W2   |
| S12 | `src/gateway/server-methods/agents.ts:1001`                                     | `resolveAgentWorkspaceDir`                  | write | gateway-server-methods | W2   |
| S13 | `src/gateway/server-methods/agents.ts:1075`                                     | `resolveAgentWorkspaceDir`                  | write | gateway-server-methods | W2   |
| S14 | `src/gateway/server-methods/agents.ts:1159`                                     | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S15 | `src/gateway/server-methods/agents.ts:1160`                                     | `resolveAgentWorkspaceDir`                  | write | gateway-server-methods | W2   |
| S16 | `src/gateway/server-methods/chat.ts:1818`                                       | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S17 | `src/gateway/server-methods/group-workspace-file.ts:460`                        | `createEmptyWorkspaceCatalog`               | write | gateway-server-methods | W3   |
| S18 | `src/gateway/server-methods/skills.ts:86`                                       | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S19 | `src/gateway/server-methods/skills.ts:137`                                      | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S20 | `src/gateway/server-methods/tools-catalog.ts:152`                               | `resolveAgentWorkspaceDirForClient`         | write | gateway-server-methods | W2   |
| S21 | `src/gateway/workspace-resolver/builders.ts:105`                                | `buildUserOwnedWorkspaceCatalogEntry`       | write | cursor-data-governance | W3   |
| S22 | `src/gateway/workspace-resolver/steward-read.ts:104`                            | `buildUserOwnedWorkspaceCatalogEntry`       | write | cursor-data-governance | W3   |
| S23 | `src/gateway/workspace-resolver/steward-write.ts:99`                            | `createEmptyWorkspaceCatalog`               | write | cursor-data-governance | W3   |
| S24 | `src/gateway/workspace-resolver/steward-write.ts:152`                           | `resolveEmployeeStewardSourceWorkspaceDir`  | write | cursor-data-governance | W4   |
| S25 | `src/gateway/workspace-resolver/steward-write.ts:153`                           | `resolveEmployeeStewardTargetWorkspaceDir`  | write | cursor-data-governance | W4   |
| S26 | `src/gateway/workspace-resolver/steward-write.ts:279`                           | `resolveEmployeeStewardSourceWorkspaceDir`  | write | cursor-data-governance | W4   |
| S27 | `src/gateway/workspace-resolver/steward-write.ts:280`                           | `resolveEmployeeStewardTargetWorkspaceDir`  | write | cursor-data-governance | W4   |
| S28 | `src/gateway/workspace-resolver/tool-cwd.ts:52`                                 | `buildUserOwnedWorkspaceCatalogEntry`       | write | cursor-data-governance | W3   |
| S29 | `src/gateway/workspace/handler-bridge.ts:592`                                   | `resolveAgentWorkspaceDirForClient`         | write | gateway-workspace      | W2   |
| S30 | `src/memory/backend-config.ts:417`                                              | `resolveAgentWorkspaceDir`                  | index | cursor-memory-wsc      | W5   |
| S31 | `src/memory/backend-config.ts:444`                                              | `resolveAgentWorkspaceDir`                  | index | cursor-memory-wsc      | W5   |
| S32 | `src/memory/cogniweave-manager.ts:554`                                          | `resolveAgentWorkspaceDir`                  | index | cursor-memory-wsc      | W5   |
| S33 | `src/memory/manager-sync-ops.ts:1062`                                           | `syncMemoryFiles`                           | index | cursor-memory-wsc      | W5   |
| S34 | `src/memory/manager-sync-ops.ts:1252`                                           | `syncMemoryFiles`                           | index | cursor-memory-wsc      | W5   |
| S35 | `src/memory/manager-sync-ops.ts:1343`                                           | `syncMemoryFiles`                           | index | cursor-memory-wsc      | W5   |
| S36 | `src/memory/manager.ts:152`                                                     | `resolveAgentWorkspaceDir`                  | index | cursor-memory-wsc      | W5   |
| S37 | `src/memory/qmd-manager.ts:196`                                                 | `resolveAgentWorkspaceDir`                  | index | cursor-memory-wsc      | W5   |

Each row's current write behavior, replacement path, rollback, quarantine, and retirement prerequisite live in `docs/design/evidence/memory-workspace-phase1b-item7-callsite-ledger.json`. All 37 rows keep `deleteNow=false` and `replacementImplemented=false`.

## Allowed / forbidden

Allowed: static scan, read-only verification, shadow/dry-run, replacement-path design, independent review evidence.

Forbidden: deleting old-write call-sites, rewriting the count to 0, retiring old memory engines, enabling schema v2, switching Resolver production write, writing production Catalog, migration/reindex, LIVE deploy.

Status stays `phase1bExecutionBlocked=true`, `deployAuthorized=false`, `live=forbidden`.
