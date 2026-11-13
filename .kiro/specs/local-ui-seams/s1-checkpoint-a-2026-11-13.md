# 检查点 A 实现记录（2026-11-13）

- Task: runtime-three-role-convergence-plan-20261113
- Agent: codex-runtime-manager
- 工作树：`/workspace/openbot-vp-three-role-s0`，分支 `runtime/three-role-s1`
- 父提交：`616697b9fb5e494f1c55694dbb7673ab48c23408`（不重写 S1）
- 开工基线祖先：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`
- 范围：仅检查点 A。未开始检查点 B / S2–S6。未推送、未开 PR、未合并、未部署。

## 实际改动

- 交互默认总 deadline 改为 15 秒（`DEFAULT_INTERACTION_RESOURCE_WAIT_MS`），不再回落商业排队 120 秒。仍可用 `OPENBOT_INTERACTION_RESOURCE_WAIT_MS` 配置，并被宿主 agent timeout 封顶。不修改执行 A 的业务期限。
- 同一 `resourceBudget` 贯穿队列等待、候选 fallback、推理；`remainingMs` 耗尽时返回 0，不再下限为 1；接近耗尽时不再发下一模型/排队请求。槽位等待另受 2 秒阻塞回执窗（`INTERACTION_BLOCKED_RECEIPT_MS`）限制，不重置总预算。
- 取消中晚到的 `acquire` 释放一次租约，不启动业务。超时后迟到提案不进入 admission。同 request 终局先写入者生效，冲突结果不能覆盖已封印事实。
- 修复 S1 将 `CHAT_TURN_ERROR_UNCONFIRMED_TEXT` 从 `chat.ts` 错误相对路径导入的问题，使 Gateway 进程级入口可以加载。
- 工作台后台占用：B 的终局不清 A；已结束的 A 迟到事件不再恢复占用。

## 计时方式与等价性

- 默认 15 秒是常量与 `resolveInteractionResourceWaitMs()` 的实测值，不是跑满 15 秒的睡眠。
- A 挂起 60 秒 / B 2 秒回执：真实墙钟 + 可控未释放的商业槽位（A 在整个 B 窗口内保持占用且未结束，等价于 60 秒工具挂起；60 秒截止点已标记但不等待满）。B 在 2 秒阻塞窗 + 轮询余量（测试断言 `< 2000 + 500`，实测约 2053ms）内降级。
- 模型完整交互 / 多 fallback：同一 remaining-budget 路径上用短真实超时（150ms）验证不重置、耗尽后不再发下一请求；快路径普通回复在 2 秒内返回。不使用会让排队 I/O 死锁的全队列 fake clock。
- 进程级：隔离 Gateway `chat.send` → 实际 `runGovernedInteraction` 宿主（模型 `complete` 替身已标明）→ 终局落盘 → `chat.history`。持久化失败用真实临时转写只读化，而不是写一条假 final。

## 未跑 / 接口缺口

- 管理方原「后端 6 文件/82 项、前端 2 文件/7 项」无法从本候选恢复文件清单，标 GAP，未编造清单。
- 本环境无已授权的本地真实模型跑次；模型结果为受控替身 / 受控挂起，不是真实模型。
- F1/F3 保真分支未合入，未在本候选真实链路出现回归，标接口依赖。F2 归检查点 B，F4 归 S5。
- `groupDiscussionQueue` / `deliverChatSendMentions` 本步未改。
