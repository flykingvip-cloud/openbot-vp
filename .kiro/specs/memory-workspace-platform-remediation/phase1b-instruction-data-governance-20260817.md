# Phase 1B 指令：`cursor-data-governance`

Date: 2026-08-17；事实刷新 2026-08-18（#492 翻旗后 rebase live-path）  
From: `cursor-memory-platform`  
To: `cursor-data-governance`  
SoT: `.kiro/specs/memory-workspace-platform-remediation/phase1b-owner-dispatch-20260817-r7.md`  
Baseline: `origin/main` `55feabb8cd`（含 #474–#492）  
Unlock: **未签发**。

## 0. 一句话

#492 点名授权已翻 `wiredToProductionResolver=true`。item 5 = **met**。不带 PII 的 live `tenant-context` 路径证据已落地。不要把这当成 unlock。不要把 item 2 打成 `met`。不要接 miss=deny。不要再 mint / 再写 host / 再翻旗 / 再写一份 live-path。

## 1. 当前事实

- item 3 = **met**（暗接受，`enablesProduction=false`）
- item 5 = **met**（点名授权翻 wired）
- 2 / 4 / 6 / 7 = **not-met**
- 生产 `tool-cwd` 不再空 Catalog 合成，不再用 `agentId` 冒充 `agentAssetId`；无 user-owned 行时可走已有 seat-owned 行
- fail-closed helper 已从 `tool-cwd` 调用（line 52 之后）
- `tenant-context` 只读已有 Catalog；registry 消歧后的匹配记录传入 Catalog + 精确 `agentAssetId`；否则 membership 回退，不抛错
- `wiredToProductionResolver=true`（#492）
- 不带 PII 的 unmocked live 路径证据已证明上述传入（`memory-workspace-phase1b-item5-live-path-evidence.json`）
- 覆盖原因：`production_classified_merged_to_host_catalog_item2_not_met`
- 占用原因：`seat_occupancy_mintable_without_unique_user_owned_asset`（`uniqueUserOwnedEquivalent=0`）
- `productionWriteWatchIndex=38`
- Freeze 行号：`tool-cwd.ts:52`，`tenant-context.ts:729 / 771 / 786`
- `phase1bExecutionBlocked=true`；`deployAuthorized=false`

不要重做：#463 steward persist、#465 inventory 计量、#467–#473 item 5 切片、#476 dump 采集、#481 tenant 绑定、#482 证据 Catalog persist、#485 隔离 runtime Catalog persist、#486 occupancy 补采、#488 occupancy mint / host Catalog 合并 / tool-cwd seat-owned、#492 wired 翻旗、live `tenant-context` 路径证据。

## 2. 现在允许做的

### item 2 — 保持 not-met；不要再写 host

不要再 mint。不要再写 host Catalog。不要把 host Catalog merge 打成 item 2 `met`。不要接写路径 miss=deny。不要漂 Freeze 行号。不要改 `tenant-context.ts`。不要让 managed cwd 抛错。不要把 unredacted dump 写入 `docs/`。不要用 Phase 0 inventory。

### item 5 — 已 met；不要当 unlock

不要再翻一次 wired。不要再写一份 live-path 证据。不要接 miss=deny。不要把 item 5 met 当成 unlock。host 探针 `liveLoaderHit` 仍不算。

### item 7 — unlock 前不要删写点

38 → 0 后再谈 I3。不要改 inventory JSON 或 trusted Freeze baseline 来假绿。不要让 `cursor-fable` 代做。

## 3. 禁止

- 把 unredacted dump 写入 git
- 把 Phase 0 inventory 写入 Catalog
- 打开 resolver 写开关或 miss=deny
- 启用 schema v2 / 改 `src/memory/**`
- LIVE / `deployAuthorized=true` / 翻 `phase1bExecutionBlocked`
- 把 item 2 打成 `met`
- 把 item 5 met 当成 unlock
- 再翻一次 `wiredToProductionResolver`

## 4. 工作区与提交

隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。改完先 `pnpm exec oxfmt <file>`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: cursor-data-governance`

```text
agent: cursor-data-governance
PR: #<n>
item: 2|5|7
stage: fail-closed-wired | retirement
production Catalog write: none
hostCatalogWrite: already-merged-in-488
enablesProduction: false
managed cwd throw: false
item2: not-met
item5: met
unlock: not issued
```
