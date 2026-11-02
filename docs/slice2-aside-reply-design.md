# 切片 2：普通插问（aside）及时回复 — 最小方案设计

时区：Asia/Shanghai。不合并、不部署。切片 3 暂缓。  
本设计不新增总控 agent / 任务引擎 / 第二套续跑循环。

## 1. 目标与诚实边界

| 能力 | 状态 |
|---|---|
| 进度查询（板投影） | 已实现 |
| amend 约束一次注入 | 已实现 |
| 主人暂停/取消打断活动执行 | 已实现（gateway + agent-runner） |
| **普通 aside 插问及时独立回复** | **未完成**（本设计的实施对象） |
| 第二执行器并行改同一任务资源 | **不做** |

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

### 3.1 分类（复用 `classifyTurnRelation`，不新造裁决层）

对 `isActive && turnRelation === "aside"`：

| 子类 | 处理 | 资源 |
|---|---|---|
| **board_readonly** | 立即从任务板投影回答（目标/有效约束/停点摘要等只读问句） | 只读板；不写板、不 steer、不 followup |
| **reply_lane**（一般插问） | 见 3.2 | 见下 |
| 控制 / amend / progress | 既有短路 | 既有 |


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

| 状态 | 归属键 | 清理规则 |
|---|---|---|
| B 发送中 | B 的 idempotencyKey | 失败不恢复 A 的占用快照（已修） |
| B 回复流 | B 的 runId | A final 不得 `removeChatRun(B)` |
| A 后台任务 | A 的 session run / taskId | B 结束不得清 A 的 abort controller |

## 4. 本回合局部检查点（可绿）

- 落地 `resolveMidTaskAsideDisposition` + board_readonly 问句即时答（目标/约束），证明 aside 分类不写板。
- **一般 reply_lane 并行短回合：未实施**，仍可能 followup 串行。

## 5. 验收场景映射

| 场景 | 本设计对应 |
|---|---|
| A 中查询进度 | 已有 progress 短路 |
| A 中补充约束 | 已有 amend 一次 |
| A 中临时插问 B | board_readonly 可即时；一般 B → reply_lane（待做）或串行降级 |
| 暂停 A 后答 B | 暂停 abort 已贯通；B 再走正常入口 |
| 插问期间 A 完成 | 归属键分离（reply_lane 实施时强制） |
