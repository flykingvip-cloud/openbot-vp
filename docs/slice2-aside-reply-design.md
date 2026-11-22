# 切片 2：普通插问（aside）及时回复 — 最小方案设计

时区：Asia/Shanghai。不合并、不部署。切片 3 暂缓。  
本设计不新增总控 agent / 任务引擎 / 第二套续跑循环。

## 1. 目标与诚实边界

| 能力                            | 状态                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| 进度查询（板投影）              | 已实现                                                                           |
| amend 约束一次注入              | 已实现                                                                           |
| 主人暂停/取消打断活动执行       | 已实现（gateway + agent-runner）                                                 |
| **普通 aside 插问及时独立回复** | **本轮已落地**（`mid-task-aside-reply-lane`：ephemeral `disableTools` embedded） |
| 第二执行器并行改同一任务资源    | **不做**                                                                         |

“消息已入队 / 已收到”≠完成。必须有实际处理与可见回复，且消息归属不与 A 的流串线。

## 2. 原路径阻塞点（已取证）

```
composer → chat.send（前端不再因 isChatBusy 扣队）
  → applyFocusSwitchGate / applyIncomingUserMessage
  → dispatchInboundMessage → runReplyAgent
       ├─ 控制语 / 进度 / collect-amend-steer → 短路
       └─ 其它 active（含 aside）→ resolveActiveRunQueueAction
            → 默认 collect：enqueue-followup（串在 A 之后）
```

阻塞在**执行调度串行**：aside 与 A 共用同一 active run / followup 队列。  
steering 把插问注入 A 会混流、并可能驱动 A 的工具动作 — 不采用。

## 3. 最小方案（原调度内）

### 3.1 分类（复用 `classifyTurnRelation`，不新造裁决层；**不全进 reply_lane**）

插话分流（看板跟任务变化，不跟每条聊天堆待办）：

| 插话类型                      | 立即回应                | 后续处理                                    |
| ----------------------------- | ----------------------- | ------------------------------------------- |
| 普通插问（aside）             | **reply_lane** 及时答   | 通常不改看板                                |
| 查询进度                      | progress 投影           | 不新增待办                                  |
| 目标/约束只读问               | **board_readonly**      | 不写板                                      |
| 补充/纠正（amend）            | 简述理解（收到/已注入） | **原任务板入口** `commitSameTaskConstraint` |
| 安全限制（先别发布/不要付款） | **先写板屏障** 再 ack   | 原 amend 路径；不得只走 reply_lane          |
| 切换优先级（new_work）        | 确认焦点/停点           | 原 focus 路径                               |
| 暂停/取消                     | **立即确认**            | **立即** abort A + aside lanes              |

对 `isActive`：`resolveMidTaskAsideDisposition` 仅在 turn-relation 为 **aside** 时进入 reply_lane；amend/new_work → `not_aside`。

### 3.1.1 读问句与 turn-relation

`classifyTurnRelation` 可能把「有效约束有哪些」「进度如何」标成 `amend`。  
因此 **progress / goal / constraint 读问句必须在 turn-relation 之前识别**，避免误走 steer。  
`resolveMidTaskAsideDisposition` 已按此顺序；amend 写路径仍只接受真正补充约束语。

### 3.2 reply_lane：及时回复且不抢 A 的任务资源

**调度**：在原 gateway/`runReplyAgent` 入口增加 **reply-only 旁路**（不是第二任务控制者）：

1. 为插问 B 分配独立 `runId` / 用户消息身份（已有 `idempotencyKey` / `MessageSid`）。
2. 启动 **禁止写任务板、禁止工作区写工具** 的短回合（只读上下文：最近转录 + 板投影）。
3. 流式/终局事件挂在 **B 的 runId**，不得写入 A 的 `chatRunId` 缓冲。
4. A 的 AbortController / 任务板 / 工作区写锁 **不被 B 持有或释放**。
5. 若运行时无法在工具沙箱层关掉写工具：则 **降级为 followup 串行**，并在回复中诚实标明“后台任务结束后作答”——**不得**伪装成已即时答完。

**并发边界**：允许与 A **并行的仅限只读文本生成**；任何可能 `write`/`bash`/`browser` 改同一 workspace 的路径必须串行或拒绝。

**停止保护优先**：主人暂停/取消到达时，reply_lane 与 A 一样尊重 abort；旧唤醒仍走 claim 拒绝。

### 3.3 消息与状态归属

| 状态       | 归属键                    | 清理规则                           |
| ---------- | ------------------------- | ---------------------------------- |
| B 发送中   | B 的 idempotencyKey       | 失败不恢复 A 的占用快照（已修）    |
| B 回复流   | B 的 runId                | A final 不得 `removeChatRun(B)`    |
| A 后台任务 | A 的 session run / taskId | B 结束不得清 A 的 abort controller |

## 4. 本回合检查点（可绿）

- 落地 `resolveMidTaskAsideDisposition` + board_readonly 问句即时答（目标/约束），证明 aside 分类不写板。
- **一般 reply_lane**：`runMidTaskAsideReplyLane` — 独立 sessionId/sessionFile + `disableTools:true`；不写板；主人暂停/取消同时 abort 已登记 aside；`runReplyAgent` 直接返回 lane 文本、不 enqueue followup。

## 5. 验收场景映射

| 场景            | 本设计对应                                                           |
| --------------- | -------------------------------------------------------------------- |
| A 中查询进度    | 已有 progress 短路                                                   |
| A 中补充约束    | 已有 amend 一次                                                      |
| A 中临时插问 B  | board_readonly 可即时；一般 B → reply_lane（ephemeral disableTools） |
| 暂停 A 后答 B   | 暂停 abort 已贯通；B 再走正常入口                                    |
| 插问期间 A 完成 | 归属键分离（aside 用独立 session/runId；A 板不动）                   |

## 6. 本轮落地与诚实缺口（Asia/Shanghai）

**已落地**

- `src/auto-reply/reply/mid-task-aside-reply-lane.ts`：ephemeral 会话 + `runEmbeddedPiAgent({ disableTools: true })`；登记/abort 旁路；隔离断言。
- `agent-runner`：`reply_lane_pending` → `await runMidTaskAsideReplyLane` → 立即返回文本；`abortInFlight` 时 `abortMidTaskAsideLanes`。
- 单测：隔离（session/file/tools）、板 epoch/约束不变、暂停取消 aside、agent-runner 接线。

**仍缺口 / 刻意不做**

- B 的 user/assistant **不**写入 A 的 jsonl（落在临时 aside sessionFile；对用户可见靠返回 payloads）。日后若需共址转录，须另开设计，避免抢 A 的会话写锁。
- Gateway/UI `chatRunId` 分桶：本轮复用 `opts.runId` 作为 aside `runId`，未改 broadcast 清桶逻辑；终局误清风险依赖既有 run 身份，未新增第二控制器。
- 不并发修改同一任务资源；不加第二任务控制者；不堆关键词特例。
- 切片 3 停止功能扩展；不合并、不部署。

## 历史链路（展示与执行）

- `chat.history`：sidecar 与主转录 **先合并、再**走原 `boundChatHistoryMessages` 条数/体积裁剪。
- 跨来源去重：`stableDialogueMessageIdentity`（优先 inbound `messageId`，否则 `role+归一化正文`）；来源前缀只作展示，不作去重键。
- A 结束后的**正常回复入口**（`get-reply-run` / `runPreparedReply`）经 `appendUntrustedContext` 把旁路问答作为**不可信 user-body 数据**注入（非 `extraSystemPrompt`）；刷新气泡靠 chat.history 原角色合并；历史正文预算（`ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS=4000`）限制旁路 `role: text` 累计长度；包装说明另有固定开销，不是整个提示块硬上限。
