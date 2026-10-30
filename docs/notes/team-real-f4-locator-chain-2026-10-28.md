# TEAM-REAL F4：可信 locator 接到真实会话工具

- 日期：2026-10-28（Asia/Shanghai）
- 基线：`d04fd5ea`（#129 + #130）
- 现象：真实 managed_enterprise 群 `grp-daniel-hhd-gmail-com-upbeyond` 小闭环 FAIL
- 阻塞码：`trusted_group_locator_required`、`list_todolists_failed`、`execution_binding_required`
- 本注不宣称 F4 PASS。切 18789 与重跑 S1–S6 在本变更之外。

## 根因

双根清理之后，managed 的 claim/board/plan 在没有 `auth` / `trusted` / `stores` 时硬拒绝 `createWorkspaceCollaborationStores`。网关 RPC（`collaboration.task.activate` / `proposeTodolist`）已经从 handler 注入 locator。真实协调者走的是进程内 `collaboration_board` 工具，调用 `proposeCollaborationTodolist` 时不带 locator，于是得到：

`managed_enterprise claim/board/plan requires trusted group locator from handler auth; compat createWorkspaceCollaborationStores is refused`

裸「确认计划」走 `chat.send` → `maybeConfirmPlanFromChatSend`。授权失败时先前丢掉 locator 仍去 `listCollaborationTodolists`，用户可见错误被写成 `list_todolists_failed（trusted_group_locator_required）`，盖住真正的 ACL 原因。人闸卡没建出来，所以没有 `recordNudgeWake` / `consumeWakeForRoundDispatch`。`execution_binding_required` 是这条链没走到 wake 绑定的下游，不是 submit 表面本身缺一个新开关。

## 本变更接上的链

1. `collaboration_board` 用会话上冻结的 enterprise id（execution identity，不是工具参数）调用 `resolveCompositionTrustedTeamContext` → `authorizeTeamGroupResourceAccess` + trusted stores，再传给 `activateCollaborationTask` / `claim` / `apply` / `proposeTodolist` / `listCollaborationTodolists`。managed 没有 locator 仍硬拒绝，不回退 host `~/.openbot/collaboration`。
2. 工具增加 `activate_task`、`claim_item`、`apply_claim`、`list_todolists`。人闸卡仍是既有 `propose_todolist` → owner-decision card。`claim_item` 的 claimant 用 gateway agent id（`bot` 与 `bot:bot` 在认领侧按同一人处理）。
3. `chat.send` 确认计划在写授权失败时直接回「尚未确认：」加上授权原因，不再无 locator 去 list。授权成功时把同一 trusted stores 交给确认和 `triggerPostPlanConfirmAdvance`（既有 `recordNudgeWake` → `consumeWakeForRoundDispatch`）。
4. wake 派工前的 `checkMemberDispatchReadiness` 仍在。OS 活跃 bot 与 gateway `agents.list` 的交集现在把 `bot:` / `agent:` 前缀和裸 id 视为同一个 bot，避免前缀把交集拆空。`autoEnsureSession` 仍只在这条 wake 写路径上。
5. 授权读成员时，若 actor 就是该员工，走与 chat.send 相同的 C5 members 修复，避免 email-only `members.json` 把 UUID 会话挡在 locator 之外。

## 明确没做

- 不恢复 `createWorkspaceCollaborationStores` 作为 managed 团队回退，不双写，不新建平行成果库。
- 不放宽 `submitTeamDeliverable` / self_advance / accept / finalize。正式成果仍要 wake 上的 `executionDeliverableBinding`。仅有 OS `currentTaskId` 的规划回合 DELIVERABLE 仍会 `execution_binding_required`。
- 不改 claim/formal-root 热实现，只把已有 trusted 参数从会话组合根传进去。
- 无 PROMOTE，不默认打开生产开关。

## 留给现场 F4

切到本 PR 的构建并重跑 S1–S6（18789，NO_PROMOTE）之后才可能记 PASS。协调者需要 `activate_task(humanConfirmed=true)` → `claim_item` → `apply_claim` → `propose_todolist`，人闸确认后再由 wake 派工提交。claimant 必须同时是 OS 活跃 bot 和 `agents.list` 里的 runtime id。本组 selfAdvance 已是 execute+allowlist；若 readiness 仍返回 `dispatch_readiness_not_ready`，那是交集未命中，不是 dry_run 门控。

## 2026-10-30 follow-up — multi-milestone auto-continue after M1 DELIVERABLE

Incident (HK LIVE UTC 2026-10-29 16:32): discussion-path `execution_binding_required` + same-second `task_board_continue skip` → no further wake; session idle hours. Also ENAMETOOLONG on task-outcomes paths with URL-encoded CJK space ids; `collaboration.directory.bots.list` TENANT_CONTEXT_REQUIRED reconnect UI.

Code fixes (same PR family):

1. Prefer attaching complete `executionDeliverableBinding` on wake consume (`attachWakeExecutionDeliverableBinding`) and on chat discussion when the actor has exactly one active board claim (`tryBuildChatActorExecutionDeliverableBinding`, source=`explicit_run`).
2. After formal DELIVERABLE settle (ok or reject), `scheduleContinueAfterDeliverableSettlement` forces inventory-first collaboration continue (bypasses default-OFF `continueAfterRoundComplete`; cooldown still applies). Private `task_board_continue` skip alone must not kill the chain.
3. `boundedOutcomePathSegment` hashes long tip/version/lock/contribution/consumer/projection/command-log segments (CJK space ids).
4. `collaboration.directory.bots.list` soft-degrades to `{ bots: [], degraded: true }` when enterprise tenant context is missing (no hard TENANT_CONTEXT_REQUIRED error that drives reconnect/offline UI).

5. After gateway restart, `scheduleResumeIncompleteBoardsAfterGatewayRestart` (wired in group-task-heartbeat boot) scans durable board inventory and force-schedules the next incomplete milestone via the same continue-after-round path — no blind mid-LLM wake-op redo.
6. L2 MVP UI helpers: `ui/src/ui/long-task-incident-state.ts` (binding fail / gateway reconnect|offline / computer occupied / sandbox stuck) and `long-task-board-progress.ts` (done / blocker / last persist from SessionTaskBoard or group board claims); chat optional strip props `longTaskIncidentLabel` / `longTaskBoardProgressLine`.

Future NIGHT-style multi-milestone tasks: after M1 DELIVERABLE the group should auto-wake/self-advance the next active board inventory without a human CEO nudge, as long as board inventory remains and continue cooldown has elapsed.
