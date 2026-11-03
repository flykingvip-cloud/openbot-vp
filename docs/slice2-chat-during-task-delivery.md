# 切片 2 交付：Gateway 停止交叉验证 / 约束任务身份 / 普通插问设计与局部检查点

工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`（`feat/ft-plan-speak-shopping-positive-admission-20261102`）。对照树未改。  
时区：Asia/Shanghai。不含合并/生产部署。切片 3 暂缓。

## 0. 绑定 SHA

- **行为完整 SHA（本轮 tip）**：`b1f6481da42a8cf2299f3b084c8fa3e5c0b51ab1`
- **上一轮 tip**：`bb949e8e508e18b32a59749b63b234e963749bd3`
- **四项阻塞行为基线**：`6c4081a3c6c81bd63bbb317916f1d500c2466843`
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/216
- **禁止**再引用旧 HEAD `ab32aa1…`、或「steer 成功后仍保留 followup」等过时表述（P1 已改为：steer 成功即返回，不再 followup）。

## 1. 行为分录（强制分开）

| 维度 | 含义 | 本轮证据 |
|---|---|---|
| **消息已送达** | 前端 busy 不扣队；控制/进度/amend/board_readonly 经 `chat.send` / `runReplyAgent` | mid-task + Gateway 停止测 |
| **约束已应用** | 长约束全文进 `effectiveConstraints`；steer **一次**；**无** followup 再执行；绑定 `expectedTaskId` | `collect-amend-steer`；`session-task-board.constraint-identity`；身份切换失败不报完整成功 |
| **回答已产生** | 进度查询立即「任务板最近记录…」；目标/约束只读问句 `board_readonly` 即时答；**不**输出 `wakeSuppress` | mid-task-dialogue / mid-task-aside；事件序列 |
| **活动已停** | 真实 `chat.send`「暂停/取消」→ abort 活动 run + `abortEmbeddedPiRun` + `clearSessionQueues` → **不** `dispatchInboundMessage` → 板 `wakeSuppress`/tombstone → 旧 claim 拒绝 | `chat.owner-pause-abort.test.ts` |

入队 ≠ 即时对话。**一般普通插问（reply_lane）本轮已落地**：ephemeral `disableTools` embedded，不以进度/board_readonly 特例替代；见 §4 与 `docs/slice2-aside-reply-design.md`。诚实缺口见该文 §6。

## 2. 本轮交叉验证（相对四项基线）

### A. Gateway 实际入口停止
- 测试：`src/gateway/server-methods/chat.owner-pause-abort.test.ts`
- 路径：`chatHandlers["chat.send"]`（真实 handler）+ 活动 `chatAbortControllers` + mock `dispatchInboundMessage` / `abortEmbeddedPiRun` / `clearSessionQueues`
- 断言序列：`controller.aborted` → 无 dispatch → queue 已清 → respond/`broadcastChat` final 含暂停文案 → `wakeSuppress` + `claimTaskBoardContinue` 拒绝
- 取消：abort + 无 dispatch + current 清空 + tombstone

代码：`chat.ts` 在 `ownerAbortInFlight` 时除 `abortChatRuns…(task-park)` 外，再 `abortEmbeddedPiRun` + `clearSessionQueues`（与 agent-runner 控制语路径对齐）。

### B. 约束绑定原任务身份
- 板 API：`commitSameTaskConstraint({ sessionFile, constraintText, expectedTaskId })` — 当前 unfinished `taskId` 必须仍等于接收约束的 id；写失败/切换返回 `false`
- `agent-runner`：steer **前**捕获 `expectedTaskId`；`!persisted` 时回复「未能写入原任务板…不视为完整成功」，**不**用完整 ack
- 测试：`session-task-board.constraint-identity.test.ts`；`agent-runner.collect-amend-steer.test.ts`「mid-steer switch to B」

### C. 交付文档
- 本文件 + `docs/slice2-chat-during-task-evidence.md` + `docs/slice2-aside-reply-design.md` 与 PR 同步；附件以 PR 内最新版为准。

## 3. 四项阻塞（基线 `6c4081a3c`）保留摘要

1. 暂停/取消 `abortInFlight` → gateway + agent-runner abort  
2. `effectiveConstraints` 全文；summary 仅展示截断  
3. 约束更新唯一入口 = 任务板；回复层只展示  
4. 进度「任务板最近记录」；不把 unfinished 说成正在推进  

## 4. 普通插问能力边界

| 能力 | 状态 |
|---|---|
| 进度查询即时答 | **已实现**（板投影） |
| 目标/有效约束只读问句即时答 | **本轮局部检查点已实现**（`board_readonly`，不写板） |
| 一般 aside 及时独立 LLM 回复（reply_lane） | **本轮已落地**（`mid-task-aside-reply-lane`；隔离测绿；缺口：共址转录 / 清桶 hardening） |
| 第二任务控制者 / 并发改同一任务资源 | **不做** |

最小方案要点：reply_lane = 原入口旁路短回合，独立 ephemeral session + `disableTools`，禁止写板/写工作区工具。本回合已接线 disposition → board_readonly **与** reply_lane。

## 5. 定向测试（本机）

Asia/Shanghai 本机 vitest（7 files / **23 passed**）：

- `src/gateway/server-methods/chat.owner-pause-abort.test.ts`（2）
- `src/conversation-task/session-task-board.constraint-identity.test.ts`（5）
- `src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts`（5）
- `src/auto-reply/reply/mid-task-aside.test.ts`（4）
- `src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`（1）
- `src/conversation-task/session-task-board.inbound-stop.test.ts`（3）
- `src/auto-reply/reply/mid-task-dialogue.test.ts`（3）

未独立宣称线上闪现已修复。行为 tip = `b1f6481da42a8cf2299f3b084c8fa3e5c0b51ab1`（取消生命周期 + chat.history 衔接）。

## 6. 不做

切片 3；合并；生产部署；第二套状态枚举；重排 attempt.ts；美化切片 1 历史 UI/revert 提交。
