# 切片 2 证据补充（Gateway 停止 / 约束身份 / board_readonly）

时区：Asia/Shanghai。PR #216。

## 绑定

- 四项阻塞行为基线：`6c4081a3c6c81bd63bbb317916f1d500c2466843`
- 本轮行为 tip：`bb949e8e508e18b32a59749b63b234e963749bd3`
- **作废**：`ab32aa1…`、「steer 成功后不再 followup（已废止旧说法）」

## A. Gateway chat.send 暂停事件序列（测试）

文件：`src/gateway/server-methods/chat.owner-pause-abort.test.ts`

1. 准备 transcript + 任务板 current=task-a，focusRevision=4  
2. 注入活动 `chatAbortControllers[run-a-active]` + buffer  
3. 调用 `chatHandlers["chat.send"]({ message: "暂停", … })`  
4. 期望：`signal.aborted`；controller map 移除；`abortEmbeddedPiRun(sessionId)`；`clearSessionQueues`；`dispatchInboundMessage` **未**调用；respond ack 含暂停 statusLine；`broadcastChat` final 含暂停文案；板 `wakeSuppress`；`claimTaskBoardContinue` → `wake_suppress`  
5. 对称测「取消当前」：abort、无 dispatch、current 空、tombstone

## B. 约束任务身份

文件：`src/conversation-task/session-task-board.constraint-identity.test.ts`  
- match → 写入 effectiveConstraints  
- 切换为 task-b 后仍用 expectedTaskId=task-a → false，B 无 A 约束  
- 空 id / 无 current / writeFileSync throw → false  

文件：`src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts`  
- mid-steer 切 B：steer 1 次、无 followup、文案「不视为完整成功」、B 无约束  

## C. board_readonly 局部检查点

- `src/auto-reply/reply/mid-task-aside.ts` + `.test.ts`  
- `agent-runner`：active 时 disposition；`board_readonly` 立即 return 文本  
- 读问句优先于 turn-relation（「有效约束有哪些」即使被标 amend 也不 steer）  
- reply_lane **本轮已落地**（见文末「普通插问落地实证」）  

## 定向测试结果

7 files / 23 passed（Asia/Shanghai 本机 vitest）。行为 tip `bb949e8e508e18b32a59749b63b234e963749bd3`。

## 能力边界一句话

消息送达与进度/板只读问句即时答已具备；一般普通插问 reply_lane 本轮已落地（ephemeral disableTools）；四项阻塞已针对性修复；Gateway 停止与约束身份交叉验证保留。

---


## 既有证据（保留）

# 切片 2 取证：任务执行期间保持对话可用

工作树：`/Users/daniel/AI VP/openbot`（`flykingvip-cloud/openbot-vp`，分支 `feat/ft-plan-speak-shopping-positive-admission-20261102`）。  
对照树 `/Users/daniel/AI项目/openbot` **只读未改**。  
取证时间：Asia/Shanghai 2026-11-02 ~22:10。  
方法：只读调用链与现有测试；**未**删除 `isChatBusy`，**未**改成全量并发。

## 0. 切片 1 核对（阶段 0）

| 项 | 结论 |
|---|---|
| UI 净差 | `origin/main...HEAD` **无** `ui/**`；PR files 7 个，无 UI |
| `shouldApplyShoppingPauseCta` | 全树无匹配（已删） |
| partial/block 出口测试 | `src/agents/pi-embedded-subscribe.plan-speak-outlet.test.ts` 存在 |
| 本机定向测试 | 4 files / 43 passed（outlet 5 + plan-speak 12 + payloads 10 + stall-continue 16） |
| 文档两句 | box `slice1-decision-to-reply-path.md`：block≠partial 路径；结构化结果「仅发现具体传递缺口时补充最小参数」 |
| 祖先门禁 | `origin/main` (`02f6b099…`) 为 HEAD 祖先 |
| HEAD | `5305c883e296e3e141b3d390ee11e7e3f5f8135f` |

**结论：切片 1 交付齐** → 进入切片 2 取证/实施。

---

## 1. 阻塞点一句话

**主阻塞在前端**：`chatRunId`/`chatSending` 使 `isChatBusy` 为真时，`handleSendChat` 把消息扣进本地 `chatQueue`，**根本不调用** `chat.send`；即便放行，默认后端队列模式 `collect` 也会把活跃 run 期间的入站编成 **followup 串行排队**，`steer` 注入不会自动发生，且 **steer ≠ 独立回复**。

---

## 2. 调用链（UI → Gateway → 执行器）

### 2.1 前端发送

```
composer onSend
  → handleSendChat (ui/src/ui/app-chat.ts)
       ├─ stop/undo/reset 特例
       ├─ if isChatBusy(host):  enqueueChatMessage → return   ← 主阻塞
       └─ else sendChatMessageNow
            → chatCapability.sendMessage
                 → controllers/chat send path
                      chatSending=true; chatRunId=<new runId>
                      client.request("chat.send", { idempotencyKey: runId, ... })
```

`isChatBusy`（同文件）：

```ts
return host.chatSending || Boolean(host.chatRunId);
```

`flushChatQueue` 仅在 `!isChatBusy` 时弹出下一条再 `sendChatMessageNow`。  
终局清理：`clearActiveChatRunState` 将 `chatRunId` 置空（`controllers/chat.ts`），之后才可能刷队列。

**复现证据（逻辑事件序列，非线上日志）：**

1. 用户发长程任务 A → `chat.send` 成功 → `chatRunId = run-A`
2. A 仍在工具循环 / 流式中
3. 用户输入「进度如何？」→ `handleSendChat` → `isChatBusy===true` → 仅 `chatQueue.push`，**无** `chat.send` RPC
4. 用户只看到队列里的本地草稿项（或输入被清空后排队），**没有**即时助手回复
5. 直到 A 终局清 `chatRunId` → `flushChatQueue` → 才第一次把插问送到服务端

现有 `ui/src/ui/app-chat.node.test.ts` **未覆盖** busy→enqueue 不发送；属缺口测试（实施时补失败用例再修）。

### 2.2 后端入站与队列（消息若已到达）

```
chat.send (gateway)
  → auto-reply get-reply-run
       isActive = isEmbeddedPiRunActive(sessionId)
       isStreaming = isEmbeddedPiRunStreaming(sessionId)
       resolvedQueue = resolveQueueSettings(...)   // 默认 mode = "collect"
       shouldSteer = mode ∈ {steer, steer-backlog}
       shouldFollowup = mode ∈ {followup, collect, steer-backlog}
  → runReplyAgent / agent-runner
       if shouldSteer && isStreaming:
            steered = queueEmbeddedPiMessage(sessionId, prompt)
                 → ACTIVE_EMBEDDED_RUNS.get(sessionId).queueMessage(text)
                 → activeSession.steer(text)          // 注入当前 run
            if steered && !shouldFollowup: return     // 无新回合、无独立回复
       activeRunQueueAction = resolveActiveRunQueueAction(...)
            collect + isActive + shouldFollowup → "enqueue-followup"
       enqueueFollowupRun(...) → 等当前 run 结束后 drain
```

默认通道队列（`src/auto-reply/reply/queue/settings.ts`）：

```ts
function defaultQueueModeForChannel(_channel?: string): QueueMode {
  return "collect";
}
```

`resolveActiveRunQueueAction`（`queue-policy.ts`）：活跃非心跳且 `shouldFollowup || mode==="steer"` → `enqueue-followup`。

因此：**默认路径下，即便前端放行，插问也不会在 A 进行中产出独立即时回复**；只是入 followup 队列。

### 2.3 Steering vs 独立回复

| 能力 | 触发 | 效果 | 是否算「即时对话」 |
|---|---|---|---|
| Steering | `queueMode` 为 steer / steer-backlog，且 run 正在 streaming | `session.steer(text)` 注入约束/插话到**同一** active run | 可能影响后续工具；**不保证**对插问消息产生归属清晰的独立回复；失败必须 `false`，不得伪装已生效 |
| Followup / collect | 默认 | 入队，等 A 结束后再跑新 turn | 有完整回复，但**非及时**；A 不被取消 |
| Interrupt | 显式 interrupt 模式 | 打断当前 run | 与「暂停/取消」不同，不可混用 |

`queueEmbeddedPiMessage` 失败原因（`runs.ts`）：`no_active_run` / `not_streaming` / `compacting` → 返回 `false`。

### 2.4 状态归属（问题点）

| 标记 | 含义（现状） | 问题 |
|---|---|---|
| `chatSending` | 本条 `chat.send` RPC 进行中 | 与后台任务占用纠缠进 `isChatBusy` |
| `chatRunId` | 当前 UI 认领的流式 run | 长程 A 的 runId 使整个会话「忙碌」；若简单并发新 send 会**覆盖** `chatRunId`，短回复终局可能清掉 A 的占用 → 串流/错误清理（场景 E 风险） |
| 后台任务 / 任务板 | `SessionTaskBoard` + embedded active run | 未单独暴露给 composer；与对话回复状态共用忙碌门 |

结论：**发送状态、对话回复状态、后台任务状态目前共用 `isChatBusy` 门闩**；禁止「只删 busy」——必须先拆占用，再谈送达。

### 2.5 任务关系与任务板（不在前端分类）

- `applyIncomingUserMessage` / `classifyTurnRelation`：`amend` / `aside` 留在当前任务；`new_work` 才 switch（挂起旧任务并 `wakeSuppress: true`）
- 焦点切换走原 `applyFocusSwitchGate` / focusSwitchProceed|Cancel，**不应**在 UI 另写业务分类
- 暂停挂起 / 取消挂起 / CLOSE：任务板原入口；`wakeSuppress`、`focusRevision`、tombstone 已有

### 2.6 停止保护相关原能力（切片 2 原范围）

| 场景 | 原机制 | 位置 |
|---|---|---|
| 暂停后不应再业务续跑 | `wakeSuppress`；continue decide/claim 跳过 | `session-task-board` park；`task-board-continue` |
| 续醒入队后、领取前主人暂停/改焦点 | `claimTaskBoardContinue` / `revalidateContinueTicket`：`revision_mismatch` / `wake_suppress` / `tombstoned` / `task_id_mismatch` | `task-board-continue.ts`；测试含 AC13 stale ticket |
| 取消后旧结果/旧唤醒 | tombstone + claim 拒绝；finishCurrentTask taskId 绑定 | board + continue |
| 同任务要求修改后旧唤醒 | `focusRevision` 不匹配 → claim 拒绝；**不扩大** revision 语义、不自动补造替代唤醒 | 同上 |

---

## 3. 实际并发能力与限制（改前诚实说明）

1. **UI 串行占用**：有 `chatRunId` 时本地队列吞掉全部用户话；输入框可打字，但不是「对话可用」。
2. **服务端默认串行 followup**：`collect` 保证不丢（cap/drop 策略内）且不打断 A，但**及时回复做不到**。
3. **Steer 可中途注入**，但是：
   - 默认未开；
   - 成功时往往**不**开新回复回合；
   - 流式输出仍挂在 run-A 上，消息归属易糊（场景 E）。
4. **没有**安全的「第二执行器」并行改同一任务/同一工作资源；若要独立插问回复与 A 并行，必须先设计资源隔离与 run 身份拆分——**不得**仅改队列 mode 或放开输入框宣称完成。

最小调整候选位置（实施阶段，按检查点拆）：

| 优先级 | 位置 | 意图 |
|---|---|---|
| P0 | `ui/.../app-chat.ts` + `controllers/chat.ts` | 拆「本条发送/短回复占用」与「后台 run 占用」；busy 时仍可 `chat.send`（保留 idempotency / stop 特例），避免覆盖/误清 A 的 run |
| P1 | `agent-runner` / queue 策略调用点 | 在**不**新造引擎前提下，区分：补充约束 → 复用 steer（失败如实）；插问需回复 → 走原 followup 或经设计的隔离回复；禁止伪装 |
| P2 | 任务板 claim/decide | 补/锁暂停与旧唤醒拒绝的事件序列测试；复用 `revalidateContinueTicket`，不多套规则 |

---

## 4. 验收场景 ↔ 改前预期

| 场景 | 改前 |
|---|---|
| A 执行中查进度 | 卡在前端队列；无及时回答 |
| A 执行中补约束 | 同上；到不了 steer/任务上下文 |
| A 执行中插问 B | 同上 |
| 暂停 A，回答 B | stop/abort 可走原入口；但 B 仍可能被 busy 队列拖延 |
| 插问期间 A 完成 | 若强行双 send 覆盖 chatRunId → 高风险串流；当前靠 busy 回避但牺牲对话 |
| 修改 A 后旧唤醒 | claim 侧已有 revision/tombstone 拒绝（需回归锁） |
| 多条连续到达 | 前端队列保序；服务端 collect 保序；但都不是即时处理 |

---

## 5. 禁止项备忘（实施约束）

- 不新增总控 agent / 裁决模型 / 任务引擎 / 续跑循环
- 不重排 `attempt.ts`；不新增状态枚举体系
- 不把任务切换、暂停、取消混成同一种中断
- 不混无关 UI 重构；不改额度/授权/协议终止
- 不扩大 `focusRevision` 语义；不自动补造替代唤醒
- 「消息成功入队」≠「主人已获得即时对话」——交付报告必须分开写

## 6. 下一步

1. 补前端失败测试：busy 时发送不得只 enqueue（或明确：在占用拆分后必须到达 `chat.send`）。
2. 最小拆分 run 占用后再放行送达。
3. 分别测 steer 成功/失败与 followup 回复；停止保护四场景事件序列/测试。
4. 写入交付报告；更新 Loom 范围与 PR。

## P0–P3 回炉取证（Asia/Shanghai）

- P0：preserve 失败不再恢复占用快照；见 chat.test P0 竞态。
- P1：steer 成功无 followup；失败保留 followup。
- P2：入站 暂停/取消当前/同任务修订 → claim。
- P3：进度查询板投影即时答。
- 事件序列：`src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts`
- 阻塞点变化：进度问不再被 collect followup 挡住；普通 aside 仍可能 followup。

## SHA binding (Asia/Shanghai 2026-11-02 23:17)

- HEAD: `b46ca89f2c614f6e7c42b7b1d35f91f2122d923a`
- Vitest: chat.test preserve/P0 + mid-task-dialogue + collect-amend-steer + event-sequence + inbound-stop → 150+3 passed on WT openbot-pr216-slice2.


## 四项阻塞回炉取证（Asia/Shanghai 2026-11-02）

- 阻塞1：`abortInFlight` on pause/cancel；gateway + agent-runner 走原 abort；事件序列断言 `abortEmbeddedPiRun`。
- 阻塞2：`effectiveConstraints` 全文；`stop.summary` 仅展示截断；claim/resume 含第 48 字之后关键句。
- 阻塞3：sole `appendSameTaskConstraint` / `commitSameTaskConstraint`；`mid-task-dialogue` 展示-only。
- 阻塞4：进度文案「任务板最近记录」；不输出 `wakeSuppress`；普通 aside **本轮已落地**（仍缺口见设计 §6）。
- 必测序列绿：`A→long constraint once→progress→pause abort→stale wake dead`。
- Vitest（定向）：event-sequence + inbound-stop + mid-task-dialogue + collect-amend-steer + turn-relation + session-task-board → 41 passed。

## SHA binding（四项阻塞回炉）

- 行为完整 SHA：`6c4081a3c6c81bd63bbb317916f1d500c2466843`
- 工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/216

## 普通插问落地实证（Asia/Shanghai，本轮）

### 机制

- 文件：`src/auto-reply/reply/mid-task-aside-reply-lane.ts`
- 调度：`agent-runner` 对 `reply_lane_pending` **立即** `runMidTaskAsideReplyLane`，不 enqueue followup
- 复用：`runEmbeddedPiAgent` + `disableTools: true`；**非**第二任务控制者
- 隔离：aside `sessionId` / `sessionFile` ≠ A；板 epoch 与约束在 lane 前后不变
- 取消：主人暂停/取消 → `abortEmbeddedPiRun(A)` + `abortMidTaskAsideLanes(parentSessionId)`

### 命令与结果

```
pnpm exec vitest run \
  …(切片1–3 + reply_lane + seed-audit 共 20 files)…
→ Test Files  20 passed | Tests  240 passed
```

定向 reply_lane / seed：

```
mid-task-aside-reply-lane.test.ts
agent-runner.aside-reply-lane.test.ts
mid-task-aside.test.ts
session-task-board.seed-audit.test.ts
→ 4 files / 12 passed
```

### seedSessionTaskBoard 审计

- 生产：仅定义导出；**无**生产 importer
- 引用：`*.test.ts` + docs + 定义本身（`session-task-board.seed-audit.test.ts` 守门）

### 诚实边界

| 项 | 状态 |
|---|---|
| 及时独立回复（不跟 A followup 串行） | 已落地 |
| 不写任务板 / disableTools | 已落地 |
| 暂停取消覆盖 aside | 已落地 |
| B 写入 A 的 jsonl 共址 | **仍缺口**（有意：避免会话锁争用） |
| Gateway chatRun 清桶专项 | **仍缺口**（复用既有 runId） |
| 第二任务控制者 / 关键词特例堆叠 | **不做** |
