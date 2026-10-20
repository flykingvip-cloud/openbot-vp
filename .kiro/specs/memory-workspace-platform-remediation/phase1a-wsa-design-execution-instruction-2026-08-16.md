# Phase 1A WS-A 设计执行指令

Date: 2026-08-16  
From: `cursor-memory-platform`  
To: `codex-workspace-architecture`  
Prerequisite: §14.1 closed on `origin/main` `df10c7e60f` (#442). `section141Signed=true`.

## 0. 一句话

Phase 1A 设计门已关。现在只做 **WS-A 设计执行**：Catalog / StorageBinding store、Workspace 只读 adapter、Envelope typed view、platform-auth membership adapter。**禁止切写、禁止 Phase 1B、禁止 LIVE。**

## 1. 当前事实

| 项                        | 值                                            |
| ------------------------- | --------------------------------------------- |
| `origin/main`             | `df10c7e60f7f1bedcffd0fb36a19ddcf27bef483`    |
| `section141Signed`        | `true`                                        |
| `signedCount`             | `7`                                           |
| `phase1bExecutionBlocked` | `true`                                        |
| `deployAuthorized`        | `false`                                       |
| 设计门 PR                 | https://github.com/gmood2008/openbot/pull/442 |

已独立 accepted：architecture / data-governance / resolver / security / memory / sre / storage-cutover。

## 2. 你要交付的三件事（仍是设计/契约落地，不是写路径切换）

1. **Catalog / StorageBinding store + Workspace 只读 adapter**  
   DG Catalog 是唯一 SoT。现有 Workspace Catalog 不得独立写 SoT。adapter 只读。coverage=0% 必须如实保留，直到 store 真的有持久对象。
2. **Workspace Envelope typed view**  
   磁盘 / Catalog / RPC / receipt 只持久 `resourceId`。不新建 WorkspaceIdentity SoT。
3. **Employee authority adapter**  
   复用 platform-auth membership store，对接权威 group Registry/membership。不新建第二套 membership SoT。department 不是物理父目录。

离线 bootstrap 只能从 Phase 0 catalog candidate 进入 **store 设计**，不能把 inventory 写成生产 Catalog。

## 3. 必读

- `docs/design/memory-workspace-identity-remediation-2026-08-14.md`
- `docs/design/evidence/memory-workspace-phase1a-catalog-contract.json`
- `docs/design/evidence/memory-workspace-phase1a-membership-contract.json`
- `docs/design/evidence/memory-workspace-phase0-section141-signoff-matrix.json`
- `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json`

## 4. 禁止

- Phase 1B / 写路径收敛
- LIVE / `deployAuthorized=true`
- resolver write switch / 改 `src/gateway/workspace-resolver/**`
- memory schema v2 / 改 `src/memory/**` 生产实现
- 把 Phase 0 inventory 写成 Catalog SoT
- Catalog miss=deny 在 Phase 1B unlock 之前
- 另造 WorkspaceIdentity 或 membership SoT

## 5. 工作区与提交

- 隔离 worktree，从当时的 `origin/main` 建分支。
- `git merge-base --is-ancestor origin/main HEAD` 必须成功。
- 不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。
- trailer：`Task: memory-workspace-platform-remediation` / `Agent: codex-workspace-architecture`

## 6. 回报

```text
agent: codex-workspace-architecture
PR: #<n>
WS-A: catalog-store | envelope-view | membership-adapter
production write: none
section141Signed: true
Phase 1B: blocked
LIVE: forbidden
```

## 7. 不是你的任务

- 不要翻 `phase1bExecutionBlocked`
- 不要给 LIVE / resolver write switch / schema v2 开绿灯
- Retirement 仍是 `cursor-data-governance`，与 Freeze（`cursor-fable`）分离
