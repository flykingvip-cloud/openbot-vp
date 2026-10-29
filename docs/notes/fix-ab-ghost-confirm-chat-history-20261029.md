# fix/ab · ghost confirm + missing own bubbles (2026-10-29 Asia/Shanghai)

## A · 幽灵确认卡
1. `collaboration.task.getTodolist`（及 `listTodolists`）在 managed_enterprise 下**未**走 `resolveTrustedWriteContext`，缺 auth/stores → 抛 `trusted group locator… compat createWorkspaceCollaborationStores is refused`。
2. UI hydration 学不到 todolist status → `isOwnerDecisionTodolistActionable(null)===true` → 历史卡仍显示「确认计划」。
3. Owner 点击 → `confirmation_consumed`（SoT 早已 confirmed）；PR#136 互认未清真人侧历史卡。
4. Sticky 区渲染**全部**历史 ownerDecision（本群 transcript 约 33 张），形成卡墙。

## B · 自己气泡不见
1. 服务端 transcript / chat.history 正常（role=user, senderLabel=CEO, id=local-*）。
2. Sticky 确认卡墙堆在 thread 底部，滚到底只见卡、对话被挤出视野；助理流式回复仍可见。
3. 次因：`mergeIncomingHistoryWithLocalUserTurn` 仅按文案匹配，历史里较早的「你好」会让新的 in-flight local 气泡在 history reload 时被丢掉（大群重复短句场景）。

## Fix（最小）
- Handler：getTodolist / listTodolists 对齐 confirm 的 trusted locator 链。
- UI：`selectStickyOwnerDecisionCards`（每 board 最新 + 最多 1 张 terminal 回顾；consumed 丢弃）。
- confirmation_consumed → status confirmed + delivery consumed。
- merge：优先 local-* id 匹配；乐观气泡在 space 会话打上 senderLabel。
