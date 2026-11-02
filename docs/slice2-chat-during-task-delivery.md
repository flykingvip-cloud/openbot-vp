# 切片 2 交付：四项阻塞回炉（暂停真打断 / 完整约束 / 唯一板入口 / 进度表述）

工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`（`feat/ft-plan-speak-shopping-positive-admission-20261102`）。对照树未改。  
时区：Asia/Shanghai。不含合并/生产部署。切片 3 暂缓。

## 0. 绑定 SHA

- **行为完整 SHA**：`6c4081a3c6c81bd63bbb317916f1d500c2466843`（行为 tip；本 docs 提交仅绑定该 SHA）
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/216
- 不得再引用旧 HEAD `ab32aa1…` / 仅 docs 的 `b3a3946ac…` 当作行为 tip。

## 1. 行为分录（强制分开）

| 维度 | 含义 | 本轮证据 |
|---|---|---|
| **消息已送达** | 前端 busy 不扣队；控制/进度/amend 经 `runReplyAgent` / `chat.send` | 既有 mid-task + 本轮事件序列 |
| **约束已应用** | 长约束全文进 `effectiveConstraints`；steer **一次**；**无** followup 再执行 | `collect-amend-steer`；事件序列 `amend_applied_once`；inbound-stop 第 48 字之后仍在 claim.prompt |
| **回答已产生** | 进度查询立即返回「任务板最近记录…」；**不**输出 `wakeSuppress` 字段名 | 事件序列 `B_progress_answered`；mid-task-dialogue 测 |
| **活动已停** | 暂停/取消 → `abortInFlight` → gateway `abortChatRuns…(task-park)` **且** agent-runner `abortEmbeddedPiRun` + `clearSessionQueues`；旧 claim 拒绝 | 事件序列 `owner_pause_aborts_activity` + `stale_wake_rejected`；inbound-stop |

入队 ≠ 即时对话。普通插问（非进度、非 amend、非暂停/取消）在默认 collect 下仍可能 followup 串行——**未完成**，见 §4。

## 2. 四项阻塞各改了什么

### 阻塞 1：暂停／取消须停止正在运行的任务
- `suppressCurrentTaskWake` / `cancelCurrentTask` 增加 `abortInFlight: true`（不仅 `wakeSuppress` / tombstone）。
- `shouldTaskParkAbortInFlight(cutContext, abortInFlight?)`：pause/cancel 也会 abort。
- **真实入口**：
  - `src/gateway/server-methods/chat.ts`：读 `taskTracking.abortInFlight` → `abortChatRunsForSessionKeyWithPartials(..., stopReason: "task-park")`；随后 **不再**为该控制语开启新业务回合。
  - `src/auto-reply/reply/agent-runner.ts`：主人控制语 → `applyIncomingUserMessage` 写板 → `abortEmbeddedPiRun` + `clearSessionQueues` → 返回 statusLine。
- 测试：`slice2-mid-task-event-sequence` 断言 `abortEmbeddedPiRun("session-a")`；`inbound-stop` 断言 `abortInFlight` + claim 拒绝。

### 阻塞 2：约束不得截断持久化
- 新增 `TrackedTask.effectiveConstraints?: string[]` 存**完整**主人原文。
- `appendSameTaskConstraint` / `commitSameTaskConstraint`：全文入列表；`stop.summary` 仅短展示标记 `约束：…`（≤48 字 + …）。
- `buildResumePrompt` / claim 提示读 `effectiveConstraints`，不靠截断 summary 恢复。
- 补测：关键句在第 48 字之后仍出现在 board 与 claim.prompt。

### 阻塞 3：唯一更新入口
- 删除回复层重复写板规则；`mid-task-dialogue.ts` **只做展示**（进度/ack 文案）。
- 任务变更只走板 API：`applyIncomingUserMessage` → `appendSameTaskConstraint`；reply 路径用 `commitSameTaskConstraint`（内部仍调同一 append）。
- `agent-runner` 不再手写截断/拼接停点。

### 阻塞 4：进度表述；普通插问未完成
- `formatTaskBoardProgressReply`：固定「任务板最近记录：未完成|已结束待核对」；**不**把 `unfinished` 说成「正在推进」；**不**吐 `wakeSuppress` 字段名。
- 普通 aside 即时独立回复：**仍未完成**（见 §4）。

## 3. 必测事件序列（绿）

`src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`：

`A_active → amend_applied_once → B_progress_answered → owner_pause_aborts_activity → stale_wake_rejected`

即：A 执行中长约束 → 完整生效一次 → 查询及时答 → 主人暂停 → abort 活动 → 旧唤醒不复活。

## 4. 普通插问：诚实边界

| 能力 | 状态 |
|---|---|
| 进度查询即时答 | **已实现**（板投影） |
| amend 约束一次注入 + ack | **已实现**（全文持久化） |
| 暂停/取消打断活动执行 | **已实现**（abortInFlight + 原 abort 路径） |
| 普通 aside 插问即时独立回复 | **未实现**：默认 collect 仍可能 `enqueue-followup` |
| 第二执行器并行改同一任务 | **不做** |

最小下一刀（未做）：对 `turnRelation===aside` 的只读短路径，且不得改板/不得并发写同一资源。

## 5. 调用链（修改后）

```
composer → handleSendChat → chat.send
  → applyFocusSwitchGate / applyIncomingUserMessage
       ├─ 暂停/取消 → abortInFlight
       │     → gateway abortChatRuns…(task-park) 且不新开业务回合
       └─ amend → appendSameTaskConstraint（全文）
  → runReplyAgent
       ├─ 控制语 → 写板 + abortEmbeddedPiRun + clearQueues
       ├─ progress → formatTaskBoardProgressReply（立即）
       ├─ collect amend + streaming → steer 一次 + commitSameTaskConstraint（无 followup）
       └─ 其它 active → resolveActiveRunQueueAction（多为 followup）
claimTaskBoardContinue → wake_suppress / tombstone / 含有效约束的 resume prompt
```

## 6. 定向测试（本机 WT）

- `src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`
- `src/conversation-task/session-task-board.inbound-stop.test.ts`
- `src/auto-reply/reply/mid-task-dialogue.test.ts`
- `src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts`
- `src/conversation-task/turn-relation.test.ts`
- `src/conversation-task/session-task-board.test.ts`

本轮上述合计 **41 passed**（未宣称线上闪现已验收；未独立当作用户重跑以外的全集）。

## 7. 落地

- 分支：`feat/ft-plan-speak-shopping-positive-admission-20261102`
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/216
- 工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`
