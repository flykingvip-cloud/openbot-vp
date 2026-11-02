# 切片 2 交付：执行中对话 + 停止保护

工作树：`/Users/daniel/AI VP/openbot`（`openbot-vp`）。对照树未改。  
时区：Asia/Shanghai。不含合并/生产部署。

## 0. 切片 1 核对

**交付齐**（见 `docs/slice2-chat-during-task-evidence.md` §0）：UI 净差零、`shouldApplyShoppingPauseCta` 已删、partial/block 出口测试可绿、文档两句正确。

## 1. 原阻塞点

**主阻塞在前端**：`isChatBusy = chatSending || chatRunId` 时 `handleSendChat` 只 `enqueueChatMessage`，不调 `chat.send`。  
**次阻塞在后端默认 `collect`**：即便送达，活跃 run 期间入站走 followup 串行；steer 默认不开；steer ≠ 独立回复。

详见 `docs/slice2-chat-during-task-evidence.md`。

## 2. 修改后调用链

```
composer
  → handleSendChat
       ├─ chatSending → 本地队列（防重复提交）
       └─ 否则 sendChatMessageNow(preserveActiveRunOccupancy=Boolean(chatRunId))
            → chat.send（idempotencyKey）
            → 若 preserve：不覆盖 chatRunId/stream/工具流；短回复终局不清 A
  → gateway get-reply-run → runReplyAgent
       ├─ 原 shouldSteer 路径不变
       ├─ collect/followup + streaming + turnRelation===amend
       │     → 额外 queueEmbeddedPiMessage（失败如实；不跳过 followup）
       └─ enqueue-followup（用户可见回复仍在 A 结束后的 followup）
```

暂停/取消/焦点切换：仍走原控制入口与任务板；前端不做业务分类。

## 3. 状态归属

| 状态 | 标记 | 本切片行为 |
|---|---|---|
| 本条发送 | `chatSending` | 唯一重复提交门；`isChatSendInFlight` |
| 对话流式占用 | `chatRunId` + stream | 后台 A 保留；中途 send 用 `preserveActiveRunOccupancy` |
| 后台任务 | 任务板 + embedded active run | 不与 composer 共用「全扣消息」门闩 |
| 异 run 终局 | `clearActiveChatRunState` / foreign final | 异 runId 不清 A；foreign final 只追加气泡 |

## 4. 实际并发能力与限制（诚实）

**已实现**

1. 长程 A 运行中，主人消息可及时到达服务端（不再仅因 `chatRunId` 扣在前端）。
2. 连续消息：发送中仍入本地队，RPC 结束后带 preserve 冲刷，保序送达。
3. amend 约束在 collect+streaming 下尽力 steer 注入当前 run；followup 仍排队产出可见回复。
4. 停止保护沿用 `wakeSuppress` / `focusRevision` / tombstone / `claimTaskBoardContinue`（定向测试通过）。

**未宣称 / 已知限制**

1. **独立插问 B 的「即时独立回复」**在默认 `collect` 下仍等 A 回合边界后的 followup；**入队 ≠ 即时对话**。
2. 未新开第二执行器并行改同一任务/同一工作资源；aside 进度问不走 amend-steer（避免污染 A），回复仍 followup。
3. 未改全局 `messages.queue.mode`；未重排 `attempt.ts`；无新状态枚举体系。
4. 若要 A 与 B 真正并行可见回复，需另给资源隔离与 run 身份设计（超出本切片最小改动）。

## 5. 场景对照

| 场景 | 本切片证据 |
|---|---|
| A 中查进度 | FE 测：busy 仍 `chat.send`+preserve；回复仍 followup（限制已写明） |
| A 中补约束 | amend → steer 注入测；followup 仍入队 |
| A 中插问 B | 送达 + preserve；B 独立即时回复未宣称 |
| 暂停 A 答 B | stop 仍优先；板 wakeSuppress/claim 测 |
| 插问期间 A 完成 | preserve + foreign clear 守卫；不覆盖 A 占用 |
| 修改后旧唤醒 | claim revision/tombstone 原测 |
| 多条连续 | 本地队 + flush preserve + 服务端 collect |

## 6. 定向测试

- `ui/src/ui/app-chat.node.test.ts`（含 mid-task delivery）
- `ui/src/ui/controllers/chat.test.ts` `-t preserveActiveRunOccupancy`
- `src/auto-reply/reply/queue-policy.test.ts`
- `src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts`
- `src/conversation-task/task-board-continue.test.ts`（停止保护）
- 切片1 outlet 回归抽样

## 7. 改动文件

- `ui/src/ui/app-chat.ts`, `ui/src/ui/app-chat.node.test.ts`
- `ui/src/ui/controllers/chat.ts`, `ui/src/ui/controllers/chat.test.ts`
- `src/auto-reply/reply/queue-policy.ts`, `queue-policy.test.ts`
- `src/auto-reply/reply/agent-runner.ts`, `agent-runner.collect-amend-steer.test.ts`
- `docs/slice2-chat-during-task-evidence.md`, `docs/slice2-chat-during-task-delivery.md`, `docs/slice1-decision-to-reply-path.md`


## 8. 落地

- PR: https://github.com/flykingvip-cloud/openbot-vp/pull/216
- HEAD: `ab32aa1d680f2a087bd62e8c9762b3b417bd570a`
- 定向：5 files / 159 passed（mid-task+outlet）；停止保护相关 9 files / 145 passed
- 切片 3 暂缓；不含合并/生产部署
