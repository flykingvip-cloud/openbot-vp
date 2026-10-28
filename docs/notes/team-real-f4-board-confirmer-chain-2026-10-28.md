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

## F4 R5 follow-up（UI confirm → wake silent）

- 现象：tip `a1c1bcc` 已在 `collaboration.task.confirmTodolist` 接线 `triggerPostPlanConfirmAdvance`，UI 确认成功（SoT confirmedBy / confirmation_consumed），但 wake-events 无 `plan_confirmed_auto_advance`，日志无 advance 痕迹。
- 根因：`triggerPostPlanConfirmAdvance` 经 `buildCollaborationExecutionTaskBag` 用 **board claimantId**（实网 `bot`）做 owner 过滤加载 todolist，而 propose 写入的 ownerMemberId 为 `bot:bot`；严格相等失败 → `execution_bag_plan_not_confirmed`。即使修复 owner 别名，confirmer email 对 bag ACL 的 `human:<uuid>` 仍可能 `forbidden`。空 catch + RPC 只回 `autoAdvanceWired` 把 early-return 藏成「确认 OK」。
- 修复：按 **todolistId** `loadExecutorTodolist` + `buildExecutionTaskBag`（确认后路径，不走 owner 过滤/bag viewer ACL）；`finishAdvance` 打日志；RPC 回传 `autoAdvance.{wakeRecorded,reason,...}`。
- 不放宽 submit/self_advance/accept/finalize；NO_PROMOTE；不宣称 F4 PASS。


## F4 R7 follow-up（wake consumed 但 dispatch_readiness_not_ready）

- 现象：tip `ead9aa6` S2 PASS（UI confirm → `plan_confirmed_auto_advance`，wakeRecorded/Consumed=true），S3 FAIL：`dispatched:false reason=dispatch_readiness_not_ready`，`targetAgentIds=["bot"]`；group 已在 selfAdvance execute allowlist。
- 根因：`consumeWakeForRoundDispatch` 把「注册表」当成 `agent-runtime-store.listAgents({tenantId})`（只有企业 `rt-001` 等），**不是**文档/注释所说的 gateway `agents.list`。实网 claimant `bot` 在 OS（`bot:bot` active）与 `openbot.json` agents.list 均存在，却因 runtime-store 无 `bot` 被标 `not_registered`。
- 修复：wake 写路径 readiness 改为 `listAgentsForGateway(cfg).agents` ∩ OS active bot（保留 `bot:`/`agent:` 针归一）；gap detail 区分 `os_bot_inactive_or_missing` / `not_in_gateway_agents_list`；consume reason/wake-op detail 带上 gap。不放宽 submit/self_advance/accept/finalize；不引入平行派工机制；NO_PROMOTE；不宣称 F4 PASS 直至现场重跑。
