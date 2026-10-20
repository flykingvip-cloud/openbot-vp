# Phase 1B 指令：`codex-workspace-architecture`

Date: 2026-08-17；事实刷新 2026-08-18（#492 翻旗后 rebase live-path）  
From: `cursor-memory-platform`  
To: `codex-workspace-architecture`  
SoT: `.kiro/specs/memory-workspace-platform-remediation/phase1b-owner-dispatch-20260817-r7.md`  
Baseline: `origin/main` `55feabb8cd`（含 #474–#492）  
Unlock: **未签发**。

## 0. 一句话

Stage A 规则已接受（#453）。DG 已把 occupancy mint、host Catalog 合并、tool-cwd seat-owned 接受写入主干（#488）。不要重签，不要再写 Catalog，不要发明第二份生产 dump，不要再 mint。只核对已接受的 dump 规则是否仍成立。不要把 #488 解释成 item 2 `met`。

## 1. 当前事实

- architecture 已签 Stage A **规则**；DG 已签 fixture dump、生产证据 persist、隔离 runtime persist、occupancy、occupancy mint + host merge
- item 2 仍 **not-met**
- fixture 与生产 candidate 的权威 Catalog 四门都 pass
- 覆盖仍 fail，原因 `production_classified_merged_to_host_catalog_item2_not_met`
- 占用原因 `seat_occupancy_mintable_without_unique_user_owned_asset`（`uniqueUserOwnedEquivalent=0`）
- classified 现为 22 条（含 6 条 occupancy-minted user-owned）；host 已合并（16 新建 / 6 跳过）
- `phase1bExecutionBlocked=true`；`deployAuthorized=false`

## 2. 现在允许做的

只核对：权威源只能是 Registry / seat / user / group / AgentAsset；主键是 `resourceId`；提取器拒绝 Phase 0 inventory；`agentId` 不得冒充 `agentAssetId`；`employee_private` 在 steward `resourceId` 未定义前不得发明 classified 身份。occupancy mint 已由 DG 在 #488 授权并完成；architecture 不要再 mint、不要写 Catalog。

不要再出一份 Stage A accept JSON，除非规则本身变了。不要把 #482 / #485 / #486 / #488 / #492 / item 5 met / live-path 证据解释成 item 2 `met` 或 unlock。

## 3. 禁止

- 再写 Stage B / 生产证据 Catalog / 运行时 Catalog / host Catalog
- 把 Phase 0 inventory 当 SoT
- 发明或改名生产权威 dump
- 再从 occupancy mint user-owned `resourceId`（#488 已做完）
- 改 `src/gateway/workspace-resolver/**` 或 `src/memory/**`
- miss=deny、LIVE、`deployAuthorized=true`
- 翻 `phase1bExecutionBlocked`
- 代签 data-governance 的 dump / persist / item 2 `met`

## 4. 工作区与提交

隔离 worktree，从最新 `origin/main` 建分支。`git merge-base --is-ancestor origin/main HEAD` 必须成功。不要 `git add .`，不要 stash，不要改 `.loom/registry.yaml`。改完先 `pnpm exec oxfmt <file>`。

trailer：`Task: memory-workspace-platform-remediation` / `Agent: codex-workspace-architecture`

```text
agent: codex-workspace-architecture
PR: #<n>
item: 2
stage: A-rules-hold
production Catalog write: none
item2: not-met
unlock: not issued
```
