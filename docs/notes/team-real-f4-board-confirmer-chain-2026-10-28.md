# TEAM-REAL F4：board publish + active confirmer 人闸链

- 日期：2026-10-28（Asia/Shanghai）
- 基线：`c818341c`（#132 locator 已合 main）
- 分支：`fix/f4-board-confirmer-chain-20261028`
- 现象：R2 小闭环 S2 FAIL — `activate_task(humanConfirmed=true)` → `not_a_board_candidate`（boardPublished=false）；`propose_todolist` → `cardDelivery=no_active_confirmer`（clientPresented=false）
- **不宣称 F4 PASS**。本变更不切 18789、不跑 S1–S6。NO_PROMOTE。

## 根因（1–3 句）

1. F4 短题（`deliverables/…/charter.md`、连通性说明）未命中旧 `detectBoardMaterializeCandidate` 启发式；activate 也未转发 `goal` / `skipChallengeWindow`，灰名单上 challenge 还会在候选通过后继续挡发布。
2. managed 租户组目录常无 `operating-state.json`，emit 只认 OS `memberRoleMap` + `publishedBy`/`coordinatorBotId`，于是 `no_active_confirmer`；bot 发布时人闸卡也缺少 human owner 提及。
3. 未放宽 submit / self_advance / accept / finalize；不恢复 managed `createWorkspaceCollaborationStores` 回退；locator（#132）不回退。

## 改动

- `intent-board-materialize.ts`：扩展候选启发式；从正文抽取显式 Acceptance/Constraints；`humanConfirmed` 时提升 fuzzy Due；显式 goal+acceptance 可过候选。
- `activate-collaboration-task.ts`：转发 goal；title 并入 intent；`humanConfirmed` 默认 `skipChallengeWindow`（可显式 false）。
- `owner-decision-emit.ts`：members.json 投影 OS；id 归一（`bot`/`bot:bot`、`human:`）；提及 human owner/admin。
- `claim-contract-entry.ts`：确认 ACL 纳入活跃 human owner/admin（仍须确认，不自动过闸）。

## 明确没做

- 未改 WIP `/Users/daniel/AI VP/openbot` tracked 文件。
- 未重启/切换 `openbot-gateway-rebuild-24db4a357d`。
- 未跑现场 F4；未宣称 PASS。
