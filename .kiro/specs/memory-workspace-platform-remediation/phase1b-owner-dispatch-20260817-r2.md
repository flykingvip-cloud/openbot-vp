# Phase 1B 转交指令（r2）

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `514c9d810c`（#449 + #453 + #451 + #452）  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地 | 含义                                      | 仍不算完成                                         |
| ------ | ----------------------------------------- | -------------------------------------------------- |
| #449   | 准入账本                                  | 不是 unlock                                        |
| #453   | architecture 接受 item 2 Stage A **规则** | item 2 仍 not-met                                  |
| #452   | item 4 准备包；item 6 SRE 规格            | schema v2 未启用；drill 未按 sqlite 备份验收       |
| #451   | 既有 cutover 的离线 fixture               | `backup=green` 只是内存记录快照，item 6 仍 not-met |
| #450   | 被 #453 包含后关闭                        | 不要再合                                           |

2–7 仍全部 **not-met**。禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451/#452/#453 当成 unlock。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责，现在就做）

你是剩余准入的主 owner。#429 只是设计接受，不是 item 3。

### 现在做（可并行）

**A. item 2 Stage A dump + 共签**

1. 准备非 LIVE 本地 dump：`memberships[]` / `agentAssets[]` / `groups[]`。
2. 禁止用 `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json` 当输入。
3. 跑 `docs/design/evidence/memory-workspace-phase1b-authority-extract.mjs --dump <dump> --out docs/design/evidence/memory-workspace-phase1b-authority-candidate.json`
4. 写共签：`docs/design/evidence/memory-workspace-phase1b-item2-stage-a-governance-accept.json`

```json
{
  "decision": "accepted",
  "stage": "A",
  "acceptedBy": "cursor-data-governance",
  "item2": "not-met",
  "catalogWrite": false,
  "phase1bExecutionBlocked": true
}
```

architecture 规则接受已在 #453。你签 dump，不要代签 architecture。

**B. item 3 写开关接受包（现在不要改 resolver）**

写 `docs/design/evidence/memory-workspace-phase1b-item3-write-switch-acceptance.json`：

```json
{
  "decision": "accepted",
  "scope": "write-switch",
  "acceptedBy": "cursor-data-governance",
  "enablesProduction": false,
  "sameReleaseUnit": "memory-schema-v2",
  "phase1bExecutionBlocked": true
}
```

`enablesProduction` 必须是 `false`。不要改 `src/gateway/workspace-resolver/**`。

### 之后做（有前置）

**C. item 2 Stage B** — 仅当 A 的 dump 与共签都在：用既有 `catalog-store.compareAndPut` 只写 classified；quarantine 不准进正常 Catalog；复测 §5.4 四门 100%。未达标不得把 item 2 打成 `met`。不要开 miss=deny。

**D. item 5** — 证据必须证明生产不再空 Catalog 合成、不再用 `agentId` 当 `agentAssetId`。现在不要把 miss=deny 接到生产。

**E. item 7** — `productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做 Retirement。

必读：`.kiro/specs/memory-workspace-platform-remediation/phase1b-item3-write-switch-change-request.md`；`docs/design/evidence/memory-workspace-phase1b-item2-stage-a-architecture-accept.json`；`src/gateway/workspace-resolver/tool-cwd.ts`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 2|3|5|7
stage: A-dump | A-accept | B | write-switch-accept | fail-closed-evidence | retirement
production Catalog write: none | classified-only
enablesProduction: false
item2: not-met | met
unlock: not issued
```

---

## 2. 发给 `cursor-fable`（item 6 补洞）

#451 已合入，但 item 6 **未通过验收**。

要补：离线 fixture 的 **sqlite 文件级** backup/restore，并与 #452 SRE 半边对齐。继续只用 `src/gateway/workspace/cutover.ts`。不要第二套状态机，不要 LIVE，不要做 item 7。

新 receipt 必须同时为 true：`extendsExistingRecord`、`secondStateMachine=false`、`live=false`、sqlite backup/restore 实际跑过。不要再把「cutover 记录快照」写成 `backup=green`。`sre` 字段只有在 `cursor-memory-wsc` 书面对齐后才能填。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-fable`

```text
agent: cursor-fable
PR: #<n>
item: 6
sqliteFileBackup: green|fail
live: false
unlock: not issued
```

---

## 3. 发给 `cursor-memory-wsc`（等待 item 3，不要启用 v2）

#452 已合入。现在不要改 `src/memory/**`，不要启用 schema v2。

等 DG 的 item 3 接受包存在且 `enablesProduction=false` 后，再按同一发布单元 `memory-schema-v2` 做规划。启用仍要独立 unlock。

item 6：配合 fable 补 sqlite 文件级 backup 的记忆侧核对。不要自己写 `status=green` 的 drill receipt，不要做 item 7。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-memory-wsc`

```text
agent: cursor-memory-wsc
PR: #<n>
item: 4|6
schemaV2Enabled: false
sameReleaseUnit: memory-schema-v2
unlock: not issued
```

---

## 4. 发给 `codex-workspace-architecture`（待命）

#453 已合入，Stage A 规则接受完成。现在不要重签，不要写 Catalog。

等 DG 交出非 LIVE dump 后，只核对 dump 是否符合你已接受的规则。不要代做 Stage B。

---

## 5. 不要发给谁做什么

- 不要再转 #450 去合入。
- 不要请任何人批 unlock。
- 不要让 Freeze owner 做 Retirement。
