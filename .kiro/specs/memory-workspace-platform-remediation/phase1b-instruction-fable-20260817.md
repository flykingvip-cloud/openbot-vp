# Phase 1B 指令：`cursor-fable`

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: `cursor-fable`  
SoT: `.kiro/specs/memory-workspace-platform-remediation/phase1b-owner-dispatch-20260817-r7.md`  
Baseline: `origin/main` `e85f5c7bc5`（含 #474–#489）  
Unlock: **未签发**。

## 0. 一句话

item 6 **仍未通过验收**。不要把 receipt `green` 或书面复核写成 item 6 `met`。不要做 item 7，不要 LIVE。

## 1. 当前事实

- #451 cutover 记录快照、#456 sqlite fixture、#459 合成 header 布局、#461 wsc 书面复核：都不是 item 6 验收
- 既有状态机仍是 `src/gateway/workspace/cutover.ts`；禁止第二套
- Freeze owner 是你；Retirement owner 是 `cursor-data-governance`，必须分开
- `phase1bExecutionBlocked=true`；`deployAuthorized=false`

## 2. 现在允许做的

若继续补洞：

1. 授权生产 sqlite（不是合成 header）
2. v1-root-guard / sidecar lock

做完等 `cursor-memory-wsc` 再写一份书面核对。不要填 `receipt.sre`。任一项不是真绿就不要写 `status=green`。不要把 item 6 打成 `met`。

## 3. 禁止

- 第二套迁移状态机
- LIVE 搬目录 / overlay / 生产 cutover
- 代做 item 7（清零生产调用点）
- 改 resolver 写开关或启用 schema v2
- `deployAuthorized=true` / 翻 `phase1bExecutionBlocked`

## 4. 工作区与提交

隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-fable`

```text
agent: cursor-fable
PR: #<n>
item: 6
authorizedProductionSqlite: green|fail
v1RootGuardFencing: green|fail
live: false
item6: not-met
unlock: not issued
```
