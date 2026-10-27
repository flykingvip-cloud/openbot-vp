# TEAM-REAL F1–F3：任务激活 / 计划确认 / 团队成果提交

- 日期：2026-10-27（Asia/Shanghai）
- 分支：`fix/team-real-collab-activation-confirm-deliverable`
- 规避：不改 #34/#67/#68 formal-root twin remount；不改 claim-contract-entry / intent-board-materialize / conversation-send / formal-root settle|publish 热文件。

## 根因（F0）
- 新请求未物化为独立 Task + 共享看板；口头派工≠ board 事实。
- 聊天“确认”未绑定 taskId/boardItemId/todolistId/version 走同一 confirm 入口。
- 成果散落个人 workspace；沙箱写文件≠团队交付成功。
- `registered_no_session` / `not_registered` 未在派工前结构化检查；ENAMETOOLONG 仅 accept worktree 脏补丁。

## 修复
- F1.1 `activateCollaborationTask`：合同不全 → needs_confirm/blocked；确认后 ensure Task + materialize board；幂等 activationKey。
- F1.2 `tryConfirmPlanFromChat`：无歧义 NL → `confirmCollaborationTodolist`（含 actor）；UI/聊天同一状态。
- F2 `submitTeamDeliverable`：宿主受权提交到小组 `deliverables/` locator；回执含任务关联/ID/版本/locator/大小/摘要；失败 `writtenToGroupDir:false`。
- F3 `checkMemberDispatchReadiness` + `commandLogPath` 有界哈希。
- Pack：`collaboration-task-activation` → packs registry/manifest。

## 退役
- 不把 personal_local 根当作 managed SoT；不做 A/B 双向同步；不扩大沙箱挂载。
- 口头“已派工/已确认/已落盘小组目录”不得替代本 pack 回执。

## 分栏结论
| 栏 | 判定 |
| --- | --- |
| 代码修复 | 本 PR |
| 隔离验证 | 本 PR vitest |
| 真实小闭环 F4 | 未执行（待授权） |
| 复杂任务 F5 | 未执行（待授权） |
| 生产启用 | 未执行（待授权合入与 18789 切换） |
