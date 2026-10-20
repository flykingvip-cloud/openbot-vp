# Phase 1B 转交指令（r6）

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `7f9a6e0b87`（#449 + #453 + #451 + #452 + #456 + #455 + #454 + #457 + #458 + #459 + #461 + #462 + #463 + #464 + #465）  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。本文件取代 r5。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地 | 含义                                                                              | 仍不算完成                                                |
| ------ | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| #449   | 准入账本                                                                          | 不是 unlock                                               |
| #453   | architecture 接受 item 2 Stage A **规则**                                         | item 2 仍 not-met                                         |
| #454   | Stage A dump 共签；Stage B classified 证据库；item 3 暗接受；item 5 helper 未接线 | item 5 / 7 仍 not-met                                     |
| #457   | item 4 规划；`item3AcceptancePresent=true`                                        | schema v2 未启用                                          |
| #452   | item 4 准备包；item 6 SRE 规格                                                    | 不启用 v2                                                 |
| #456   | 离线 sqlite **fixture** copy/restore                                              | item 6 仍 not-met                                         |
| #459   | `{stateDir}/memory/resource-{id}.sqlite` 布局演练                                 | 仍是合成 header，不是授权生产库                           |
| #461   | wsc 书面复核 #459                                                                 | 不是绿灯回执；item 6 仍 not-met                           |
| #463   | steward persist + conflict 写阻断；权威 Catalog 四门 fixture pass                 | item 2 仍 not-met                                         |
| #465   | 生产 inventory 覆盖计量；无生产权威 dump                                          | `covered=false`；fixture dump 不算生产；item 2 仍 not-met |
| #464   | r5 转交指令                                                                       | 已被本 r6 取代                                            |
| #462   | r4 转交指令                                                                       | 已被后续 r 取代                                           |
| #458   | r3 转交指令                                                                       | 已被后续 r 取代                                           |
| #451   | 既有 cutover 离线 fixture                                                         | 记录快照不是 sqlite 备份                                  |
| #450   | 被 #453 包含后关闭                                                                | 不要再合                                                  |
| #460   | 已关闭                                                                            | 不要再合；不要恢复 Phase 0→Catalog 计量                   |

当前评分：item 3 = **met**（只接受暗写开关，`enablesProduction=false`）。2 / 4 / 5 / 6 / 7 = **not-met**。

item 2 现状：`authorityCatalogGatesPass=true`，`productionInventoryCovered=false`，原因 `missing_production_authority_dump`。没有真实生产权威 dump 之前，不要发明 dump，不要把 fixture 或 Phase 0 inventory 写成覆盖。

禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451–#465 当成 unlock、让 managed cwd 停机、把 #459 receipt `green` 或 #461 书面复核写成 item 6 `met`。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责，现在就做 item 5）

你是剩余准入的主 owner。#429 不是 item 3。不要重签写开关。不要打开写开关。

#463 / #465 已合入。不要重做 steward persist、conflict 写阻断、或再生产一遍 inventory 计量。不要发明生产权威 dump。

### A. item 2 — 阻塞在真实 dump，不要硬做

没有 `docs/design/evidence/memory-workspace-phase1b-production-authority-dump.json` 之前，item 2 保持 **not-met**。不要用 Phase 0 inventory，不要把 Stage A fixture dump 改名为生产 dump。

### B. item 5 — 现在的主任务：接线，但不得停机，也不得再漂 Freeze 行号

现状：fail-closed helper 已在主干，**未接线**。生产 `tool-cwd` 仍空 Catalog 合成，仍 `agentAssetId: params.agentId`。主干 managed deny 仍抛 `agent tool cwd denied`。

#454 / #460 两次接线都撤回了。不要第三次重演。

接线要求同时成立：

1. 调用方传入**已有** Catalog 记录和精确 `agentAssetId`。
2. 不再空 Catalog 合成，不再用 `agentId` 冒充 `agentAssetId`。
3. 未接线路径必须仍能得到 membership 作用域路径，**禁止抛错停机**。
4. 不要只靠改 `tenant-context.ts` / `tool-cwd.ts` 行号来“接线”；Freeze 会把行漂移当成新生产写点。
5. 现在不要接写路径 miss=deny。
6. 未同时满足 1–5 时，item 5 保持 **not-met**。

### C. item 7 — 写点归零

`productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做。不要只改 inventory JSON 或 trusted Freeze baseline 来假绿。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 5|7
stage: fail-closed-wired | retirement
production Catalog write: none
enablesProduction: false
managed cwd throw: false
item5: not-met | met
unlock: not issued
```

---

## 2. 发给 `cursor-memory-wsc`（待命，不要启用 v2）

不要启用 schema v2。不要改 `src/memory/**`。不要把 item 6 打成 `met`。不要填 `receipt.sre`。不要做 item 7。

若 fable 再补授权生产 sqlite 或 fencing：只做书面复核，仍不写绿灯回执。

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

---

## 3. 发给 `cursor-fable`（待命）

item 6 **仍未通过验收**。不要把 receipt `green` 或书面复核写成 item 6 `met`。不要做 item 7。不要 LIVE。不要填 `receipt.sre`。

若继续补洞：授权生产 sqlite（不是合成 header）以及 v1-root-guard / sidecar lock，做完等 wsc 再写一份书面核对。

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

---

## 4. 发给 `codex-workspace-architecture`（待命）

不要重签，不要写 Catalog，不要发明生产 dump。只核对已接受的 dump 规则是否仍成立。

---

## 5. 不要发给谁做什么

- 不要再转 #450 / #460 去合入。
- 不要请任何人批 unlock。
- 不要让 Freeze owner 做 Retirement。
- 不要重复合入会让 managed cwd 抛错或漂 Freeze 行号的接线。
- 不要为修绿 Freeze 去改 trusted baseline 或只改 inventory JSON。
- 不要伪造 `memory-workspace-phase1b-production-authority-dump.json`。
