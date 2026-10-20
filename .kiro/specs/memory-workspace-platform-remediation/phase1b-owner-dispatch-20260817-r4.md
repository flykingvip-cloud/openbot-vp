# Phase 1B 转交指令（r4）

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `bcdff62f78`（#449 + #453 + #451 + #452 + #456 + #455 + #454 + #457 + #458 + #459 + #461）  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。本文件取代 r3。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地 | 含义                                                                              | 仍不算完成                      |
| ------ | --------------------------------------------------------------------------------- | ------------------------------- |
| #449   | 准入账本                                                                          | 不是 unlock                     |
| #453   | architecture 接受 item 2 Stage A **规则**                                         | item 2 仍 not-met               |
| #454   | Stage A dump 共签；Stage B classified 证据库；item 3 暗接受；item 5 helper 未接线 | item 2 / 5 / 7 仍 not-met       |
| #457   | item 4 规划；`item3AcceptancePresent=true`                                        | schema v2 未启用                |
| #452   | item 4 准备包；item 6 SRE 规格                                                    | 不启用 v2                       |
| #456   | 离线 sqlite **fixture** copy/restore                                              | item 6 仍 not-met               |
| #459   | `{stateDir}/memory/resource-{id}.sqlite` 布局演练                                 | 仍是合成 header，不是授权生产库 |
| #461   | wsc 书面复核 #459；SRE half = `authorized-layout-reviewed-item6-not-met`          | 不是绿灯回执；item 6 仍 not-met |
| #458   | r3 转交指令                                                                       | 已被本 r4 取代                  |
| #451   | 既有 cutover 离线 fixture                                                         | 记录快照不是 sqlite 备份        |
| #455   | r2 转交指令                                                                       | 已被 r3 / r4 取代               |
| #450   | 被 #453 包含后关闭                                                                | 不要再合                        |

未合入：

| 打开中 | 含义                                                                                 | 注意                                                |
| ------ | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| #460   | steward persist + conflict 写阻断证据；已撤回生产 `tenant-context` / `tool-cwd` 接线 | Freeze 已绿；等 `flykingvip-cloud` 二审。不要自批。 |

当前评分：item 3 = **met**（只接受暗写开关，`enablesProduction=false`）。2 / 4 / 5 / 6 / 7 = **not-met**。

禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451–#461 当成 unlock、让 managed cwd 停机、把 #459 receipt `green` 或 #461 书面复核写成 item 6 `met`。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责，现在就做）

你是剩余准入的主 owner。#429 不是 item 3。item 3 暗接受已在 #454，不要重签，不要打开写开关。

#460 还在等二审。不要往 #460 再堆生产接线。#460 合入前，新的 item 2 / 5 / 7 工作从最新 `origin/main` 另开分支。

### A. item 2 — 把 §5.4 四门做到 100%

现状：Stage B 只把 classified 权威行写入证据 Catalog。§5.4 按 Phase 0 inventory 对持久 Catalog 计量，四门都是 fail。不要为了过门把 Phase 0 inventory 写成 Catalog SoT。

1. 补 `employee_private` steward `resourceId` 契约；membership 单独不能发明 resourceId。
2. conflict / unknown / pending 必须 100% 写阻断并列清单；quarantine 不准进正常 Catalog。
3. 只用既有 `catalog-store.compareAndPut` 写 classified。
4. 复测四门都对**持久 Catalog** 100% 之前，item 2 保持 **not-met**。
5. 不要开 miss=deny。不要用 `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json` 当 Catalog 输入。

### B. item 5 — 接线，但不得停机，也不得再漂 Freeze 行号

现状：`src/gateway/data-governance/workspace-identity-fail-closed.ts` 已在主干，**未接线**。生产 `tool-cwd` 仍 `createEmptyWorkspaceCatalog()`，仍 `agentAssetId: params.agentId`。主干 `tenant-context` 在 managed deny 时仍抛 `agent tool cwd denied`。

#454 曾接到 `tool-cwd` 并让 managed cwd 抛错，已撤回。#460 曾再接一次，Freeze 把既有站点报成 `addedProductionCallSites`，已撤回。不要第三次重演。

接线要求同时成立：

1. 调用方传入**已有** Catalog 记录和精确 `agentAssetId`。
2. 不再空 Catalog 合成，不再用 `agentId` 冒充 `agentAssetId`。
3. 未接线的调用路径必须仍能得到 membership 作用域路径，**禁止抛错停机**。
4. 不要只靠改 `tenant-context.ts` / `tool-cwd.ts` 行号来“接线”；Freeze 会把行漂移当成新生产写点。
5. 现在不要接写路径 miss=deny。
6. 未同时满足 1–5 时，item 5 保持 **not-met**。

### C. item 7 — 写点归零

`productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做 Retirement。不要只改 inventory JSON 或 trusted Freeze baseline 来假绿。

必读：`docs/design/evidence/memory-workspace-phase1b-item2-stage-b.json`；`docs/design/evidence/memory-workspace-phase1b-item3-write-switch-acceptance.json`；`docs/design/evidence/memory-workspace-phase1b-item5-fail-closed-evidence.json`；`src/gateway/workspace-resolver/tool-cwd.ts`；`src/gateway/tenant-context.ts`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 2|5|7
stage: B-gates | fail-closed-wired | retirement
production Catalog write: none | classified-only
enablesProduction: false
managed cwd throw: false
item2: not-met | met
item5: not-met | met
unlock: not issued
```

---

## 2. 发给 `cursor-memory-wsc`（待命，不要启用 v2）

#457 已合入。`item3AcceptancePresent=true`。`schemaV2Enabled=false`。`sameReleaseUnit=memory-schema-v2`。

#461 已合入。#459 的书面复核已完成：`authorized-layout-reviewed-item6-not-met`。不要再写一份把 item 6 打成 `met` 的复核。不要改 fable receipt，不要填 `receipt.sre`。

现在不要改 `src/memory/**`，不要启用 schema v2。启用仍要独立 unlock。不要做 item 7。

若 fable 再补授权生产 sqlite 或 fencing 演练：只做书面复核，仍不写绿灯回执。

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

#459 已合入。#461 已书面复核。item 6 **仍未通过验收**。

不要把 receipt `green` / `authorizedSqliteFileBackup=green` / #461 书面复核写成 item 6 `met`。#459 仍是 `mkdtemp` + 合成 SQLite header，不是授权生产库文件级备份。不要做 item 7。不要第二套状态机，不要 LIVE。不要填 `receipt.sre`。

若继续补洞，只做下面缺口，做完等 wsc **再写一份**书面核对：

1. 授权生产 sqlite（不是合成 header）的离线文件级 copy/restore。
2. v1-root-guard 与 sidecar lock fencing 演练。

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

#453 规则接受已在主干。#454 dump 已在主干。现在不要重签，不要写 Catalog，不要代做 Stage B。

只核对 `docs/design/evidence/memory-workspace-phase1b-authority-dump.json` 是否仍符合你已接受的规则。

---

## 5. 不要发给谁做什么

- 不要再转 #450 去合入。
- 不要请任何人批 unlock。
- 不要让 Freeze owner 做 Retirement。
- 不要重复合入会让 managed cwd 抛错的 `tool-cwd` 接线。
- 不要为修绿 Freeze 去改 trusted baseline 或只改 inventory JSON。
- 不要把 #460 在二审前当主干。
