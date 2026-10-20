# Phase 1B 转交指令（r5）

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `2928250712`（#449 + #453 + #451 + #452 + #456 + #455 + #454 + #457 + #458 + #459 + #461 + #462 + #463）  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。本文件取代 r4。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地 | 含义                                                                              | 仍不算完成                                            |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| #449   | 准入账本                                                                          | 不是 unlock                                           |
| #453   | architecture 接受 item 2 Stage A **规则**                                         | item 2 仍 not-met                                     |
| #454   | Stage A dump 共签；Stage B classified 证据库；item 3 暗接受；item 5 helper 未接线 | item 5 / 7 仍 not-met                                 |
| #457   | item 4 规划；`item3AcceptancePresent=true`                                        | schema v2 未启用                                      |
| #452   | item 4 准备包；item 6 SRE 规格                                                    | 不启用 v2                                             |
| #456   | 离线 sqlite **fixture** copy/restore                                              | item 6 仍 not-met                                     |
| #459   | `{stateDir}/memory/resource-{id}.sqlite` 布局演练                                 | 仍是合成 header，不是授权生产库                       |
| #461   | wsc 书面复核 #459；SRE half = `authorized-layout-reviewed-item6-not-met`          | 不是绿灯回执；item 6 仍 not-met                       |
| #463   | steward persist + conflict 写阻断；权威 Catalog 四门在 fixture 上 pass            | `productionInventoryCovered=false`；item 2 仍 not-met |
| #462   | r4 转交指令                                                                       | 已被本 r5 取代                                        |
| #458   | r3 转交指令                                                                       | 已被 r4 / r5 取代                                     |
| #451   | 既有 cutover 离线 fixture                                                         | 记录快照不是 sqlite 备份                              |
| #455   | r2 转交指令                                                                       | 已被后续 r 取代                                       |
| #450   | 被 #453 包含后关闭                                                                | 不要再合                                              |

未合入：

| 打开中 | 含义                                                                                          | 注意                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #460   | 曾含 steward persist + 已撤回的生产 cwd 接线，并把 §5.4 改成要求 Phase 0 inventory 入 Catalog | steward/conflict 已被 #463 覆盖。不要合入 Phase 0→Catalog 计量，不要再接 `tenant-context` / `tool-cwd`。建议关闭或丢掉与 #463 重叠的部分。 |

当前评分：item 3 = **met**（只接受暗写开关，`enablesProduction=false`）。2 / 4 / 5 / 6 / 7 = **not-met**。

#463 之后的 item 2 事实：`authorityCatalogGatesPass=true`，`productionInventoryCovered=false`。不要把权威 fixture 四门 pass 写成 item 2 `met`。

禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451–#463 当成 unlock、让 managed cwd 停机、把 #459 receipt `green` 或 #461 书面复核写成 item 6 `met`。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责，现在就做）

你是剩余准入的主 owner。#429 不是 item 3。item 3 暗接受已在 #454，不要重签，不要打开写开关。

#463 已合入。不要重做 steward persist / conflict 写阻断。不要把 #460 的 Phase 0 inventory→Catalog 计量合进去。

### A. item 2 — 生产 inventory 覆盖，而不是再过一遍 fixture

现状：权威 Catalog 四门在 fixture 上已 pass。item 2 仍 not-met，因为 `productionInventoryCovered=false`。

1. 只用**真实权威 dump** 补生产覆盖；membership 单独不能发明 resourceId。
2. 不要用 `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json` 当 Catalog 输入。
3. conflict / unknown / pending 继续写阻断并列清单；quarantine 不准进正常 Catalog。
4. 只用既有 `catalog-store.compareAndPut` 写 classified。
5. 不要开 miss=deny。
6. `productionInventoryCovered=true` 之前，item 2 保持 **not-met**。

### B. item 5 — 接线，但不得停机，也不得再漂 Freeze 行号

现状：fail-closed helper 已在主干，**未接线**。生产 `tool-cwd` 仍空 Catalog 合成，仍 `agentAssetId: params.agentId`。主干 managed deny 仍抛 `agent tool cwd denied`。

#454 / #460 两次接线都撤回了。不要第三次重演。

接线要求同时成立：

1. 调用方传入**已有** Catalog 记录和精确 `agentAssetId`。
2. 不再空 Catalog 合成，不再用 `agentId` 冒充 `agentAssetId`。
3. 未接线路径必须仍能得到 membership 作用域路径，**禁止抛错停机**。
4. 不要只靠改 `tenant-context.ts` / `tool-cwd.ts` 行号来“接线”。
5. 现在不要接写路径 miss=deny。
6. 未同时满足 1–5 时，item 5 保持 **not-met**。

### C. item 7 — 写点归零

`productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做。不要只改 inventory JSON 或 trusted Freeze baseline 来假绿。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 2|5|7
stage: inventory-coverage | fail-closed-wired | retirement
production Catalog write: none | classified-only
enablesProduction: false
managed cwd throw: false
item2: not-met | met
item5: not-met | met
unlock: not issued
```

---

## 2. 发给 `cursor-memory-wsc`（待命，不要启用 v2）

#457 / #461 已合入。不要启用 schema v2。不要改 `src/memory/**`。不要把 item 6 打成 `met`。不要填 `receipt.sre`。不要做 item 7。

若 fable 再补授权生产 sqlite 或 fencing：只做书面复核，仍不写绿灯回执。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-memory-wsc`

```text
agent: cursor-memory-wsc
PR: #<n>
item: 4|6
schemaV2Enabled: false
sameReleaseUnit: memory-schema-v2
item3AcceptancePresent: true
item6: not-met
unlock: not issued
```

---

## 3. 发给 `cursor-fable`（待命）

#459 / #461 已合入。item 6 **仍未通过验收**。不要把 receipt `green` 或书面复核写成 item 6 `met`。不要做 item 7。不要 LIVE。不要填 `receipt.sre`。

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

#453 / #454 dump 已在主干。#463 只扩了 classified 证据 Catalog，不是 Stage A 重签。不要重签，不要写 Catalog，不要代做 inventory 覆盖。

只核对 `docs/design/evidence/memory-workspace-phase1b-authority-dump.json` 是否仍符合已接受规则。

---

## 5. 不要发给谁做什么

- 不要再转 #450 去合入。
- 不要把 #460 当 item 2 主路径去合。
- 不要请任何人批 unlock。
- 不要让 Freeze owner 做 Retirement。
- 不要重复合入会让 managed cwd 抛错或漂 Freeze 行号的接线。
- 不要为修绿 Freeze 去改 trusted baseline 或只改 inventory JSON。
