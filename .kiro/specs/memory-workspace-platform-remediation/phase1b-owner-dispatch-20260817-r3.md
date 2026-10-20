# Phase 1B 转交指令（r3）

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `c02c296d8c`（#449 + #453 + #451 + #452 + #456 + #455 + #454 + #457）  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地               | 含义                                                                              | 仍不算完成                |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------- |
| #449                 | 准入账本                                                                          | 不是 unlock               |
| #453                 | architecture 接受 item 2 Stage A **规则**                                         | item 2 仍 not-met         |
| #454                 | Stage A dump 共签；Stage B classified 证据库；item 3 暗接受；item 5 helper 未接线 | item 2 / 5 / 7 仍 not-met |
| #457                 | item 4 规划；`item3AcceptancePresent=true`                                        | schema v2 未启用          |
| #452                 | item 4 准备包；item 6 SRE 规格                                                    | 不启用 v2                 |
| #456 + #457 SRE 核对 | 离线 sqlite **fixture** copy/restore                                              | item 6 仍 not-met         |
| #451                 | 既有 cutover 离线 fixture                                                         | 记录快照不是 sqlite 备份  |
| #455                 | r2 转交指令                                                                       | 已被本 r3 取代            |
| #450                 | 被 #453 包含后关闭                                                                | 不要再合                  |

当前评分：item 3 = **met**（只接受暗写开关，`enablesProduction=false`）。2 / 4 / 5 / 6 / 7 = **not-met**。

禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451–#457 当成 unlock、让 managed cwd 停机。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责，现在就做）

你是剩余准入的主 owner。#429 不是 item 3。item 3 暗接受已在 #454，不要重签，不要打开写开关。

### A. item 2 — 把 §5.4 四门做到 100%

现状：Stage B 只持久化了 `agent_primary` / `group_shared`。`employee_private` 与 `conflict_or_unknown` 仍 fail。

1. 补 `employee_private` steward `resourceId` 契约；membership 单独不能发明 resourceId。
2. conflict / unknown / pending 必须 100% 写阻断并列清单；quarantine 不准进正常 Catalog。
3. 只用既有 `catalog-store.compareAndPut` 写 classified。
4. 复测四门都对**持久 Catalog** 100% 之前，item 2 保持 **not-met**。
5. 不要开 miss=deny。不要用 `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json`。

### B. item 5 — 接线，但不得停机

现状：`src/gateway/data-governance/workspace-identity-fail-closed.ts` 已在主干，**未接线**。生产 `src/gateway/workspace-resolver/tool-cwd.ts` 仍 `createEmptyWorkspaceCatalog()`，仍 `agentAssetId: params.agentId`。

#454 曾把 fail-closed 接到 `tool-cwd`，managed `resolveAgentWorkspaceDirForClient` 会抛 `agent tool cwd denied`。那次已撤回。不要重演。

接线要求同时成立：

1. 调用方传入**已有** Catalog 记录和精确 `agentAssetId`。
2. 不再空 Catalog 合成，不再用 `agentId` 冒充 `agentAssetId`。
3. 未接线的调用路径必须仍能得到 membership 作用域路径，**禁止抛错停机**。
4. 现在不要接写路径 miss=deny。
5. 未同时满足 1–4 时，item 5 保持 **not-met**。

### C. item 7 — 写点归零

`productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做 Retirement。

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

现在不要改 `src/memory/**`，不要启用 schema v2。启用仍要独立 unlock。

item 6：#456 只是 fixture。已书面核对为 `fixture-reviewed-item6-not-met`。不要自己写 `status=green` receipt，不要做 item 7。

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

#456 已合入。item 6 **未通过验收**。

不要把 receipt `green` / `sqliteFileBackup=green` 写成 item 6 `met`。那是合成 header 的临时文件，不是授权库文件级备份。不要做 item 7。不要第二套状态机，不要 LIVE。

若继续补洞：授权 `{stateDir}/memory` sqlite 的离线文件级 copy/restore，并等 wsc 书面核对后再填 `sre`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-fable`

```text
agent: cursor-fable
PR: #<n>
item: 6
authorizedSqliteFileBackup: green|fail
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
