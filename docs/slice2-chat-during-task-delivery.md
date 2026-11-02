# 切片 2 交付：执行中对话 + 停止保护（P0–P3 回炉）

工作树：实施于 `/Users/daniel/AI VP/openbot-pr216-slice2`（同分支 worktree；主路径曾被 android 分支占用）。对照树未改。  
时区：Asia/Shanghai。不含合并/生产部署。切片 3 暂缓。

## 0. 切片 1

交付齐（见 evidence §0）。历史 UI+revert 提交不重写；净差清晰。

## 1. 行为分录（强制分开记录）

| 维度 | 含义 | 本轮证据 |
|---|---|---|
| **消息已送达** | 前端不再因 `chatRunId` 扣住；`chat.send` 发出 | `app-chat` mid-task + preserve 测 |
| **约束已应用** | amend steer 成功且**仅一次**；板 `stop.summary` 含约束；**无** followup 再执行 | `agent-runner.collect-amend-steer` P1；事件序列 `amend_applied_once` |
| **回答已产生** | 进度查询**立即**返回板投影文本，不等 A followup | `进度如何` → `[{ text }]`；事件序列 `B_progress_answered` |

入队 ≠ 即时对话。普通插问（非进度、非 amend）在默认 collect 下仍可能 followup 串行——见 §4。

## 2. P0–P3 修改摘要

### P0 发送失败不得复活占用
`sendChatMessage` 在 `preserveActiveRunOccupancy` 下**不再**于 RPC 失败时恢复占用快照。发送本未改 A，失败只记 `lastError`、撤乐观气泡。  
补测：A 完成／取消／新 delta 后 B RPC 失败。

### P1 steering 与 followup 一次消费
collect+streaming+amend：steer **成功** → 即时 ack + 写板约束 + **不** `enqueueFollowupRun`；steer **失败** → 仍 followup（不丢）。可计数 `steerCount===1`。

### P2 停止保护贯通入站
真实 `applyIncomingUserMessage`：
- `暂停` → `suppressCurrentTaskWake` → claim `wake_suppress`
- `取消当前` → tombstone + 清 current → claim 拒绝
- 同任务 amend → `stop.summary` 含约束（**不** bump `focusRevision`）→ claim 提示含新约束

### P3 执行中可对话（进度）
`isProgressStatusQuery` 命中且板有 current → `formatTaskBoardProgressReply` 立即返回。不走 steer/followup。

## 3. 完整事件序列（测试）

`src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`：

`A_active → B_progress_answered → amend_applied_once → owner_pause → stale_wake_rejected`

另：`chat.test.ts` P0 三条交错回归。

## 4. 普通插问：实际能力与限制（诚实）

| 能力 | 状态 |
|---|---|
| 进度查询即时答 | **已实现**（板投影） |
| amend 约束一次注入 + ack | **已实现** |
| 普通 aside 插问即时独立回复 | **未实现**：默认 collect 仍 `enqueue-followup`，可见答在 A 回合后 |
| 第二执行器并行改同一任务 | **不做**（指令禁止） |

若要普通插问也即时答，最小下一刀应在 `runReplyAgent` 对 `turnRelation===aside` 增加只读答或短路径，且不得改板/不得并发写同一资源——**本轮未做**，避免扩成第二控制者。

## 5. 调用链（修改后）

```
composer → handleSendChat
  → sendChatMessage(preserve?) → chat.send
  → runReplyAgent
       ├─ progress query → board reply（立即，无 followup）
       ├─ collect amend + streaming → steer
       │     ├─ success → ack + board note（无 followup）
       │     └─ fail → enqueue-followup（不丢）
       └─ 其它 active → resolveActiveRunQueueAction（多为 followup）
applyIncomingUserMessage("暂停"|"取消当前"|amend) → 板状态
claimTaskBoardContinue → wake_suppress / tombstone / 新 stop 提示
```

## 6. 定向测试

- `ui/.../chat.test.ts` `-t preserveActiveRunOccupancy`（含 P0 竞态）
- `src/auto-reply/reply/mid-task-dialogue.test.ts`
- `src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts`
- `src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`
- `src/conversation-task/session-task-board.inbound-stop.test.ts`

## 7. 落地

- PR: https://github.com/flykingvip-cloud/openbot-vp/pull/216
- HEAD: 
- 切片 3 暂缓；不含合并/生产部署
