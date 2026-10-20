# Phase 1B 指令：`cursor-memory-wsc`

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: `cursor-memory-wsc`  
SoT: `.kiro/specs/memory-workspace-platform-remediation/phase1b-owner-dispatch-20260817-r7.md`  
Baseline: `origin/main` `e85f5c7bc5`（含 #474–#489）  
Unlock: **未签发**。

## 0. 一句话

待命。不要启用 schema v2，不要改生产 `src/memory/**`，不要把 item 6 打成 `met`。

## 1. 当前事实

- item 4 准备包已在主干；`schemaV2Enabled=false`；`item3AcceptancePresent=true`；同一发布单元 `memory-schema-v2`
- 未改 `src/memory/**`，未启用 v2
- item 6 仍 **not-met**。#456 fixture、#459 合成 header、#461 书面复核都不是绿灯验收
- 不要填 `receipt.sre`，不要做 item 7
- `phase1bExecutionBlocked=true`；`deployAuthorized=false`

## 2. 现在允许做的

若 `cursor-fable` 再补授权生产 sqlite 或 v1-root-guard / sidecar fencing：只做书面复核，仍不写绿灯回执，仍不把 item 6 打成 `met`。

启用 schema v2 要独立 unlock，且与已接受的写开关同一发布单元。现在不要做。

## 3. 禁止

- 改 `src/memory/**` 生产实现或启用 schema v2
- 打开 resolver 写开关
- LIVE / 重索引 / 搬目录
- 代做 item 7
- `deployAuthorized=true` / 翻 `phase1bExecutionBlocked`

## 4. 工作区与提交

隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-memory-wsc`

```text
agent: cursor-memory-wsc
PR: #<n>
item: 4|6
schemaV2Enabled: false
sameReleaseUnit: memory-schema-v2
item6: not-met
unlock: not issued
```
