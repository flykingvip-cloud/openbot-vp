# Phase 1B 转交指令（r7）

Date: 2026-08-17；事实刷新 2026-08-18（#492 翻旗后 rebase live-path）  
From: `cursor-memory-platform`  
To: 按下表分别转交，不要群发成一条  
Baseline: `origin/main` `55feabb8cd`（含 #474–#492）
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。

转交时把「共同事实」+ 该 owner 的章节全文发给对方。本文件取代 r6，并覆盖 #488 后的 r7 事实段。

## 0. 共同事实（每个 owner 都要先读）

已合入，只是证据，不是写路径授权：

| 已落地 | 含义                                                                                        | 仍不算完成                                  |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| #466   | r6 转交指令                                                                                 | 已被本 r7 取代                              |
| #467   | managed deny 不再抛 `agent tool cwd denied`，回退 membership                                | 当时不是 item 5 met                         |
| #468   | 生产 `tool-cwd` 不再空 Catalog 合成                                                         | 仍缺精确 `agentAssetId`                     |
| #469   | 禁止 `agentId` 当 `agentAssetId`                                                            | 缺记录仍会合成 merge                        |
| #470   | 记录必须已在 Catalog                                                                        | helper 当时未从 tool-cwd 调用               |
| #471   | `assertFailClosedWorkspaceIdentity` 从生产 `tool-cwd` 调用（line 52 之后）                  | 调用方当时不传 Catalog                      |
| #473   | `tenant-context` 只读已有 Catalog；唯一 user-owned 记录时传入 Catalog + 精确 `agentAssetId` | 生产库无匹配 user-owned 记录                |
| #465   | 生产 inventory 覆盖计量                                                                     | 计量已在；覆盖仍 fail                       |
| #476   | 非 LIVE 本地权威 dump（脱敏）已入主干                                                       | 已被 #481/#482/#485/#486/#488 接续          |
| #478   | tenant workspace identity / Freeze 钉回                                                     | 不是 unlock                                 |
| #479   | 方案头部同步到 Admission Evidence / Unlock Not Issued                                       | 不是 unlock                                 |
| #481   | dump 重采：group `tenantId` 绑定；采集器补扫 tenants 根                                     | 当时未 persist                              |
| #482   | 生产 classified 经 compareAndPut 写入**证据 Catalog**；§5.4 四门 pass                       | 不是运行时 Catalog；item 2 still not-met    |
| #484   | #482 后 r7 事实刷新                                                                         | 已被本轮事实段覆盖                          |
| #485   | 生产 classified 经运行时 Catalog API 写入**隔离** `{stateDir}/data-governance/catalog.json` | 不是 host Catalog SoT；item 2 still not-met |
| #486   | dump 补采 enterprise seat-assets occupancy；3 用户各 1 岗；`uniqueUserOwnedEquivalent=0`    | 当时未 mint user-owned                      |
| #487   | #486 后 r7 / owner 指令刷新                                                                 | 已被本轮事实段覆盖                          |
| #488   | occupancy mint + host Catalog 合并 + tool-cwd 接受已有 seat-owned；loader 按 registry 消歧  | 不是 item 2 met；当时未翻 wired             |
| #489   | #488 后 r7 / owner 指令刷新                                                                 | 已被本轮事实段覆盖                          |
| #490   | item 5 deploy runner / host write 计量线（已合）                                            | 不是翻 wired；不是 LIVE                     |
| #492   | 点名授权翻 `wiredToProductionResolver=true`；item 5 = **met**                               | 不是 unlock；item 2 仍 not-met              |
| #491   | 不带 PII 的 unmocked live `tenant-context` 路径证据（本 PR）                                | 不是 unlock；不是再翻一次旗                 |
| #463   | steward persist + conflict 写阻断；权威 Catalog 四门 fixture pass                           | item 2 still not-met                        |
| #460   | 已关闭                                                                                      | 不要再合                                    |
| #450   | 被 #453 包含后关闭                                                                          | 不要再合                                    |

更早已在主干、不要重做：#449、#451–#459、#461、#462、#464。

当前评分：item 3 = **met**（只接受暗写开关，`enablesProduction=false`）。item 5 = **met**（点名授权翻 wired）。2 / 4 / 6 / 7 = **not-met**。

item 2 现状：fixture 与生产 candidate 的 §5.4 四门都 pass。`productionInventoryCovered=false`，原因 `production_classified_merged_to_host_catalog_item2_not_met`。占用原因 `seat_occupancy_mintable_without_unique_user_owned_asset`（`uniqueUserOwnedEquivalent=0`）。证据 / 隔离 runtime Catalog 现为 22 条 classified（含 6 条 occupancy-minted user-owned）；1 条 archived 在 quarantine。host Catalog 已合并写入（16 新建 / 6 跳过已有）。不要再说「无 dump」「未 persist」「无 occupancy」「未 mint」「host 仍空」。不要再 persist 证据 Catalog。不要再重采 occupancy。不要再 mint。不要再写 host Catalog。不要把 host merge、occupancy mint 或 runtime-layout persist 打成 item 2 `met`。不要把 fixture 或 Phase 0 inventory 写成覆盖。不要把 unredacted dump 写入 git。

item 5 现状：代码侧接线已在主干（#467–#473 + #488）。#492 点名授权已翻 `wiredToProductionResolver=true`，item 5 = **met**。不带 PII 的 unmocked live `tenant-context` 路径证据证明传入 Catalog + 精确 `agentAssetId`。无记录时仍 membership 回退、不抛错。host 探针 `liveLoaderHit=true` **不是** 这份证据。不要接写路径 miss=deny。不要把 item 5 met 当成 unlock 或 item 2 `met`。不要再翻一次 wired。

禁止：LIVE、`deployAuthorized=true`、翻 `phase1bExecutionBlocked`、把 Phase 0 inventory 写成 Catalog、打开 resolver 写开关、启用 schema v2、把 #448/#449/#451–#492 或 item 5 met / live-path 证据当成 unlock、让 managed cwd 停机、把 #459 receipt `green` 或 #461 书面复核写成 item 6 `met`、改 trusted Freeze baseline、漂 `tool-cwd.ts:52` / `tenant-context.ts:729 / 771 / 786`。

工作区：隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。

---

## 1. 发给 `cursor-data-governance`（主责；item 5 已 met，不要当 unlock）

你是剩余准入的主 owner。#429 不是 item 3。不要重签写开关。不要打开写开关。

#467–#473、#476、#478、#479、#481、#482、#485、#486、#488、#489、#490、#492 已合入。不要重做 no-throw、空 Catalog 禁止、`agentAssetId` 分离、catalog-record-required、helper 接线、现有 Catalog 只读传入、dump 采集、证据 Catalog persist、隔离 runtime Catalog persist、occupancy 补采、occupancy mint、host Catalog 合并、tool-cwd seat-owned 接受、wired 翻旗、或 live-path 证据。不要发明第二份生产权威 dump。不要把 item 5 met 当成 unlock。

### A. item 2 — occupancy mint 与 host Catalog 已入主干，不要再写

`docs/design/evidence/memory-workspace-phase1b-item2-host-catalog-persist.json` 已在主干。生产 candidate 四门 100%。host 已合并（16 新建 / 6 跳过）。classified 现为 22 条（含 6 条 occupancy-minted user-owned）。item 2 仍 **not-met**，原因 `production_classified_merged_to_host_catalog_item2_not_met`。下一步：不要再 persist、不要再 mint、不要再写 host Catalog。不要把 host merge 打成 item 2 `met`。不要用 Phase 0 inventory，不要把 Stage A fixture 改名。不要把 unredacted dump 写入 git。

### B. item 5 — 点名授权已翻 wired，item 5 = met

现状：

1. `wiredToProductionResolver=true`（#492 点名授权）。
2. 调用方传入已有 Catalog 记录和精确 `agentAssetId`（registry 消歧到精确 asset 时）。
3. 无记录 / deny 仍回 membership，**禁止抛错停机**。
4. Freeze 行号保持：`tool-cwd.ts:52`，`tenant-context.ts:729 / 771 / 786`。不要再漂。不要改 `tenant-context.ts`。
5. 现在不要接写路径 miss=deny。
6. item 5 = **met**。不要把这当成 unlock 或 item 2 `met`。
7. 不带 PII 的 unmocked live `tenant-context` 路径证据已证明传入 Catalog + `agentAssetId`。host 探针 `liveLoaderHit` 仍不算。

不要再翻一次 wired。不要再写一份 live-path 证据。不要再 mint occupancy 行。不要扩展 loader 在多 asset 岗位上猜一条。

### C. item 7 — 写点仍为 38，unlock 前不要删

`productionWriteWatchIndex` 从 38 → 0 后再谈 I3。不要让 `cursor-fable` 代做。不要只改 inventory JSON 或 trusted Freeze baseline 来假绿。现在删除这些写点会破坏当前写入；Retirement 在 unlock 之后。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 2|5|7
stage: evidence-persisted | fail-closed-wired | retirement
production Catalog write: none
hostCatalogWrite: already-merged-in-488
enablesProduction: false
managed cwd throw: false
item5: met
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

不要重签，不要写 Catalog，不要发明生产 dump，不要再从 occupancy mint user-owned `resourceId`（#488 已做完）。只核对已接受的 dump 规则是否仍成立。不要把 #488 解释成 item 2 `met`。

---

## 5. 不要发给谁做什么

- 不要再转 #450 / #460 去合入。
- 不要请任何人批 unlock。
- 不要让 Freeze owner 做 Retirement。
- 不要重复合入会让 managed cwd 抛错或漂 Freeze 行号的接线。
- 不要为修绿 Freeze 去改 trusted baseline 或只改 inventory JSON。
- 不要伪造 `memory-workspace-phase1b-production-authority-dump.json`。
- 不要再从 occupancy mint user-owned `resourceId`（#488 已做完）。
- 不要再写 host Catalog（#488 已合并）。
- 不要把 item 5 met、#491 或 live-path 证据当成 unlock，也不要把 item 2 打成 `met`。
- 不要把 host 探针 `liveLoaderHit` 当成 live `tenant-context` 路径证据。
- 不要再翻一次 `wiredToProductionResolver`。
- 不要再写一份 live-path 证据。
- 不要接写路径 miss=deny。
