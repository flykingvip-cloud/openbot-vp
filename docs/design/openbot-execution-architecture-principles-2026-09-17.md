# OpenBot Execution Architecture Principles

> **Status:** 原则层 **v2.1 已执行 P0–P11**。Execution / Focus 表未落生产库。生产 Activation / Orchestration live 仍 fail-closed。
> **Date:** 2026-09-17
> **性质:** 执行架构总原则。补充并约束现有合同，**不替代**其编号体系。
> **专家审核:** 方向性定版已吸收；操作员 2026-09-17 要求跳过签收、直接执行止血与验收。

## 0. 文档控制

| 字段           | 内容                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| **冻结范围**   | 原则、对象职责、禁止清单、与既有规范的引用关系                                         |
| **P0 已执行**  | 隐式 cron 绑卡切断；未绑定 `task_ledger` 退出提示词权威；Focus 策略纯函数              |
| **P1 已执行**  | 模型上下文省略定时结果卡；主会话有用户焦点时不注入完整成果                             |
| **P2 已执行**  | 新任务与当前焦点冲突时 `chat.send` 阻断并要求用户选择；不落 Focus 表                   |
| **P3 已执行**  | 用户确认挂起后，模型上下文丢掉栅栏之前的旧任务回合                                     |
| **P4 已执行**  | 会话续写不再铸造 `task_ledger` 身份；目标纠偏只更新已绑定行                            |
| **P5 已执行**  | 对话区选择卡增加「取消当前任务」（须用户点击同意）；不落任务表                         |
| **P6 已执行**  | FOCUS 被占时 cron 在对话区发挂起通知卡，不注入完整成果、不迁 Cron 身份                 |
| **P7 已执行**  | Cron 可引用 `conversationTaskId`；未绑定 job id 只作 wake key，不铸造身份              |
| **P8 已执行**  | 主会话 FOCUS 被占时 Heartbeat 不打 LLM 回合；空闲巡检仍可跑；不铸造身份                |
| **P9 已执行**  | 事件驱动 Heartbeat 在 FOCUS 被占时注入挂起通知卡，不打 LLM、不铸造身份                 |
| **P10 已执行** | 未绑定 Cron 的目标/验收是定时说明，不是 ConversationTask 身份；绑定后才用任务目标      |
| **P11 已执行** | 主会话进度条不再把未绑定 Cron 台账当成对话任务；结果卡标明本次执行，不是最终结果       |
| **未落地**     | Execution 表、Focus 持久化、生产 Activation flag、Phase 3+、Orchestration live         |
| **编号规则**   | 本文只用 `EA-I*` / `EA-B*`。不得占用 Ledger `I1–I8`、CTR `CT1–CT11`、任务聚焦 `I1–I25` |
| **编码准入**   | 仅 P0 止血切片。其余 runtime 仍走原 CTR / Ledger / task-focus 阶段门                   |

### 0.1 既有合同（不被本文取代）

| 合同                     | 路径                                                                                                                                                | 本文关系                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| ConversationTask Runtime | `.kiro/specs/conversation-task-runtime/execution-plan.md`                                                                                           | 身份对象与 Activation / Revision 权威            |
| CTR 存储冻结             | `.kiro/specs/conversation-task-runtime/p2-design-freeze.md`                                                                                         | `task_revisions` 已预留；P2 不写 Revision        |
| Progress Ledger          | `.kiro/specs/task-progress-ledger/design.md`                                                                                                        | 执行事实权威                                     |
| Orchestration Plane      | `.kiro/specs/conversation-task-runtime/p4-5-orchestration-plane.md`                                                                                 | 执行面调度器；默认关闭                           |
| 任务聚焦一体化           | [openbot-task-focus-unified-execution-review-2026-09-13](./openbot-task-focus-unified-execution-review-2026-09-13.md)                               | Ingress allowlist、Phase 3+ 仍不批准             |
| Phase 2 协作增补         | [openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md) | 多 agent Work Unit / Lease；个人助手不走 Mission |

`.kiro` 入口：[execution-architecture-principles](https://github.com/upbeyond/openbot/blob/main/.kiro/specs/conversation-task-runtime/execution-architecture-principles.md)。

### 0.2 五句话（核心原则）

| 对象                 | 只回答                   | 不准回答                     |
| -------------------- | ------------------------ | ---------------------------- |
| **ConversationTask** | 我是谁、要完成什么       | 这次跑到哪了、用户看到哪张卡 |
| **Execution**        | 这一次为什么跑、跑完没有 | 任务是什么、上下文怎么拼     |
| **Session**          | 这一次用哪段上下文       | 这是哪项任务                 |
| **Progress Ledger**  | 实际发生了什么           | 任务目标、当前焦点           |
| **Projection**       | 用户该看到什么           | 任何可写事实                 |

冻结句：**ConversationTask 是任务身份，Session 是执行上下文。**

---

## 1. 对象关系

```text
ConversationTask                 ← 身份，ID 长期稳定
 ├── Task Version (1, 2, 3…)     ← Goal / Acceptance / Delivery 等演进
 ├── Scheduling state            ← FOCUS | PARKED | 其余生命周期不占槽
 ├── Execution #n                ← 一次运行
 │     ├── wakeReason
 │     ├── Session               ← 仅上下文
 │     └── tool calls / outcome
 └── Progress Ledger             ← 跨 Execution 累计的事实

Projection = Identity + current Version + Ledger + Evidence + Turn Contract
           ≠ 最后一条 assistant message
```

入口（Chat / 用户改目标 / Cron / Heartbeat / 外部事件）只产生 **Wake** 或 **Task Mutation**。是否进入 FOCUS、开哪次 Execution、用哪种 Session Strategy，由 Task Scheduler + Execution Policy 决定，不由入口自己决定。

---

## 2. 五个核心对象

下列字段是合同形状。标「已有」的对齐现行类型；标「合同新增」的实现前不得私自落表。

### 2.1 ConversationTask（身份 · 已有）

权威类型：`src/conversation-task/types.ts` 的 `ConversationTask`。

| 字段                                     | 含义                                        | 谁可写                  |
| ---------------------------------------- | ------------------------------------------- | ----------------------- |
| `id`                                     | 任务语义身份，长期稳定                      | Activation 创建后不可改 |
| `conversationId`                         | 发现/绑定时的对话，**不是**执行会话         | 身份层                  |
| `requesterId` / `ownerId`                | 提出人 / 责任人                             | 身份层                  |
| `goal`                                   | 当前目标正文                                | 仅经 Revision 事件更新  |
| `acceptanceRules`                        | 验收条文                                    | 仅经 Revision 事件更新  |
| `deadlineAtMs` / `schedule` / `delivery` | 截止、唤醒规格、交付面                      | 仅经 Revision 事件更新  |
| `lifecycle`                              | `draft` / `active` / `closed` / `cancelled` | 身份状态机              |

现行 `lifecycle` 描述任务是否被系统接受与是否关闭。它**不是** FOCUS/PARKED 槽位（见 EA-B2）。

ConversationTask **不得**携带（已冻结 `CONVERSATION_TASK_FORBIDDEN_FIELDS` + CT2）：

`steps` · `progress` · `evidence` · `waiting` · `blocked` · `running` · `ledger` · `nodeId`

### 2.2 Task Version（演进 · 已有事件，P2 预留未写）

权威类型：`TaskRevisionEvent`。P2 已建 `task_revisions` schema，**不写** Revision、不改 active goal/acceptance/delivery（见 `p2-design-freeze.md`）。

| 字段                          | 含义                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `taskId`                      | 同一身份                                                 |
| `revision`                    | 单调递增版本                                             |
| `field`                       | `goal` / `acceptance` / `deadline` / `delivery`          |
| `previousValue` / `nextValue` | 变更前后                                                 |
| `reason`                      | `user_change` / `system_replan` / `authorization_change` |
| `actorId` / `atMs`            | 谁、何时                                                 |

「改成分析 Q3」必须追加 `TaskGoalChanged` 类 Revision，**禁止**原地 `UPDATE goal`，**禁止**因此 mint 第二个 Task。LLM 可以提议 re-plan，不能直接写 Version（EA-I7 / EA-I8）。

### 2.3 Focus / Parked（调度槽 · 合同新增，不是新身份表）

```ts
type FocusState = {
  taskId?: string;
  reason?: "user_request" | "resume" | "deadline" | "cron" | "blocking_resolved";
  acquiredAt?: number;
};

type ParkedState = {
  taskId: string;
  parkedAt: number;
  reason: string;
};
```

约束：

- 每个数字员工 **FOCUS = 1**，**PARKED ≤ 3**。
- 这是 execution scheduling slots，**不是** ConversationTask 基数上限。
- waiting / dormant / scheduled / completed / cancelled 可以任意多，但不占 FOCUS/PARKED。
- 禁止 `Focus` 表、`ParkedTask` 表作为第二套「当前在做什么」。

### 2.4 Execution（一次运行 · 合同新增）

```ts
type WakeReason =
  | "user_message"
  | "user_task_update"
  | "cron"
  | "heartbeat"
  | "external_event"
  | "approval_resolved"
  | "retry"
  | "resume";

type SessionStrategy = "reuse_primary" | "isolated" | "background";

type Execution = {
  executionId: string;
  taskId: string;
  taskRevision: number;
  wakeReason: WakeReason;
  sessionStrategy: SessionStrategy;
  sessionKey?: string;
  startedAtMs: number;
  endedAtMs?: number;
  outcome?: "succeeded" | "failed" | "blocked" | "cancelled";
};
```

每一次用户触发、Cron、Heartbeat、Resume、Retry 都是一次新的 Execution。Session、工具调用、outcome 挂在 Execution 上，不挂在 Task 根上。

### 2.5 Progress Ledger（事实 · 已有）

权威：`.kiro/specs/task-progress-ledger/design.md`。Ledger 绑定 `taskId`（未来 `conversationTaskId`）；Cron 的单次 occurrence 只宜作为子键，不得另造任务身份。

`executed` ≠ `verified` ≠ `completed`。`met` 必须有白名单 evidence。模型自述、assistant 文本、tool card 标题不得写 status。

### 2.6 Projection（只读视图 · 已有合成规则）

```text
Projection = ConversationTask.lifecycle
           + current Task Version
           + Progress Ledger
           + Evidence
           + Turn Contract
```

「最终结果 / 任务目标 / 卡片」只能读上述合成。禁止：最后一条 assistant message → 卡片 → 状态。

可信终态路径：

```text
Task → Acceptance met → Evidence verified → Task completed → Final Result Projection
```

---

## 3. 七条边界（EA-B）

### EA-B1 身份唯一真源

只有 ConversationTask 能定义：Task ID、Goal、Owner、Requester、Deadline、Acceptance、Delivery、Lifecycle、Version。

其他对象只能引用 `taskId`：

| 对象    | 可以说                 | 不可以说                   |
| ------- | ---------------------- | -------------------------- |
| Session | 当前正在执行 Task-123  | 我认为自己在做「竞品分析」 |
| Ledger  | Task-123 已完成 Step 3 | 我创建了 Task-456          |
| Cron    | 唤醒 Task-123          | 顺手创建一个新任务身份     |

### EA-B2 槽位不是任务基数

FOCUS/PARKED 限制同时可调度的执行槽。系统可存在任意多个 ConversationTask。禁止把「最多四个任务」写进产品或存储约束。

### EA-B3 焦点不是新表

Focus / Parked 是 ConversationTask 上的调度态，或由 scheduler 投影。禁止第三处「当前执行什么」。

### EA-B4 Cron 是 Wake Trigger

禁止「认领 / 拥有 Task」。Cron 只按 `schedule` 发出 `Wake(taskId, reason=cron)`。是否进入 FOCUS、是否挂起、开哪次 Execution，由 Task Scheduler / Focus Policy 决定。

User / Webhook / Heartbeat / Approval Completed / 外部事件与 Cron **同一地位**，都是 Wake Trigger。

### EA-B5 Heartbeat 不是第二套调度器

Heartbeat 只巡检：可唤醒、超时、等待条件、新外部事件。然后把候选交给**同一个** Task Scheduler。

禁止：创建任务、猜测目标、直接写完成、自己 replan。禁止再出现 Heartbeat Scheduler / Task Scheduler / Agent Scheduler 三套并行决策。

### EA-B6 Focus 不等于 Session Strategy

Focus 只表示当前优先任务。Session 选择属于 Execution Policy：

- `reuse_primary`：沿用主会话上下文
- `isolated`：隔离执行会话
- `background`：后台执行会话

同一 FOCUS 的 Execution #1 / #2 / #3 可以采用不同策略。

### EA-B7 Execution 是一等公民

运行态属于 Execution + Ledger，不属于 ConversationTask 行。这与 CTR CT2 / `CONVERSATION_TASK_FORBIDDEN_FIELDS` 一致，不是第二套进度状态机。

---

## 4. 八条不变量（EA-I）

| ID        | 原则                                                        | 主要对齐                        |
| --------- | ----------------------------------------------------------- | ------------------------------- |
| **EA-I1** | ConversationTask 是任务语义身份的唯一 Source of Truth       | CTR §3.2 / §7                   |
| **EA-I2** | Session 不是任务身份，只是 Execution Context                | 本文冻结句                      |
| **EA-I3** | Execution 是一次实际运行；一个 Task 可有多次 Execution      | 合同新增对象                    |
| **EA-I4** | Focus/Parked 是调度槽位，不限制 Task 总数                   | EA-B2                           |
| **EA-I5** | Cron / Heartbeat / User / Event 都只是 Wake Trigger         | EA-B4 / EA-B5                   |
| **EA-I6** | Ledger 是执行事实，Projection 只读                          | Ledger I1–I8；CTR §7 合成规则   |
| **EA-I7** | LLM 可提出目标、计划或 re-plan，不得直接写 execution truth  | Ledger「禁止模型自述」；CTR CT9 |
| **EA-I8** | Goal / Acceptance / Delivery 的修改必须事件化并保留版本历史 | CTR §8 `TaskRevisionEvent`      |

冲突裁决：对象字段与 Activation / Revision / Ledger evidence 规则以 CTR 与 Ledger 为准；本文只补 **Session / Execution / Wake / Focus 槽** 这些原合同未写成总原则的层。编号冲突时保留对方原号，本文只用 `EA-*`。

---

## 5. 禁止清单

### 5.1 禁止的身份冒充

- `sessionKey` / `sessionId` 当作 `taskId`
- Cron job id 当作任务语义身份（job 只能引用 `conversationTaskId`）
- `memory/task_ledger.json` 继续作为权威目标或「authoritative primary objective」
- 前端「最终结果」从最后一条 assistant 或最后一张 cron 卡反推任务目标
- `chat.inject` 的定时结果把后续 `chat.send` 隐式标成 `kind: cron`（与任务聚焦 Phase 0 allowlist：`chat` 禁止 source=`cron` 同向）

### 5.2 禁止的新系统

- 第四套任务身份表（`ParkedTask` / `FocusTask` / `tasks2`）
- 第二套 Progress Ledger 或用 ConversationTask 行存 steps/progress
- Heartbeat 自建调度器或目标猜测器
- 个人助手范围铸造 Mission（CTR CT11 / P7）

### 5.3 禁止的写入

- LLM 文本写 Ledger status / acceptance `met`
- 无 Revision 事件的 goal/acceptance/delivery 原地覆盖
- Wake Trigger 在 FOCUS 被占时把正文打进正在跑的主会话
- 模型从旧 transcript 自行恢复已 PARKED / DORMANT 任务

---

## 6. 与现网三处身份的收编（原则，不是本轮施工单）

| 现网点                | 收编后角色                                                                           |
| --------------------- | ------------------------------------------------------------------------------------ |
| ConversationTask      | 唯一任务语义身份                                                                     |
| Cron job              | Wake Trigger + `schedule`；可引用 `conversationTaskId`。目标/验收迁出仍待 Activation |
| `task_ledger.json`    | 退出权威。注入已停；续写摘要进 checkpoint；rollover / 未绑定纠偏不再写入             |
| isolated cron session | 某次 Execution 的 `sessionStrategy=isolated`，不再等于任务身份                       |
| Progress Ledger       | 不变：只记事实                                                                       |
| 工作台卡片            | 只读 Projection                                                                      |

现网事故对照（2026-09-17 市场助手）：调研指令被 `cronReplyContext` 标到「Progress Ledger 前端测试」，最终结果读 cron 卡，「100 字总结」来自同一主会话旧上下文。违反 EA-I1、EA-I2、EA-B1、EA-B4、§5.1。

---

## 7. 调度与唤醒（原则）

```text
Entry (chat / mutation / cron / heartbeat / event)
        │
        ▼
ConversationTask   （已有则引用；符合 Activation 才创建）
        │
        ├── Task Mutation Event  → Version+1（不新开身份）
        └── Wake(taskId, wakeReason)
                │
                ▼
        Task Scheduler / Focus Policy
                │
                ├── FOCUS 空闲 → 开 Execution
                ├── FOCUS 被占 → PARKED（已满 3 则拒绝并通知）
                └── 需要人 → PARKED + 协助入口（取消须用户同意）
                │
                ▼
        Execution + Session Strategy
                │
                ▼
        Agent Runtime → Execution Events → Progress Ledger → Projection
```

Orchestrator（P4.5）仍只选择执行面（skill / web_read / browser / …），**不拥有**任务身份，也不替代 Task Scheduler。两者都默认关闭，直到各自阶段门批准。

---

## 8. 本文仍不授权（P0 以外）

- 打开 ConversationTask activation / projection / authorization 生产 flag（环境变量与控制面仍 fail-closed）
- 进入任务聚焦 Phase 3a/3b/4/5
- 启用 Orchestration live invoke
- 新建 Mission、Execution 表或 Focus 持久化表
- 云端部署 / cutover

P0–P11 切片（操作员 2026-09-17 批准，含本轮对剩余项的授权）：切断隐式 cron 绑卡；停止未绑定 `task_ledger` 的提示词权威注入与身份铸造；落地 `focus-policy` 纯函数；用户新任务与当前焦点冲突时确认后再进入主会话；确认挂起或取消后模型不再读取栅栏前的旧回合；FOCUS 被占时 cron / heartbeat 只通知不打断；Cron / Heartbeat 只引用 ConversationTask，不铸造身份；未绑定 Cron 的目标/验收降为定时说明；对话区进度条与结果卡不得把未绑定 Cron 当成 ConversationTask 最终结果。遵守 EA-B1 / EA-B4 / EA-B5 / EA-B6 / §5.1 / §5.3，不新开任务表。生产 Activation 与 Orchestration live 仍须独立运维门闩，不在本切片默认打开。

---

## 9. P0 验收

- [x] 五句话与 EA-B / EA-I 写入合同
- [x] Execution / FocusState 仍是合同对象，本轮不落生产表
- [x] 本文不替代 CTR / Ledger / task-focus 既有 I 号
- [x] `resolveChatSendCronContext` 不再从 transcript 推断 cron
- [x] 未绑定 `taskContextId` 时，`task_ledger` 不再作为 authoritative primary objective
- [x] `decideWake` 覆盖 acquire / require_user_choice / park / reject_park_full / reject_identity_create

## 10. P1 验收

- [x] `omitCronResultSurfaces` 从 agent history 去掉定时结果卡
- [x] `sanitizeSessionHistory` 调用省略
- [x] 主会话 4 小时内有用户发言时，不注入完整成果（P6 改为注入挂起通知）
- [x] 空闲主会话仍可注入卡片（模型侧仍会省略）

## 11. P2 验收

- [x] `evaluateFocusSwitch` 把「新任务 vs 当前焦点」判为 `require_user_choice`，追问/闲聊放行
- [x] `chat.send` 在用户未确认时返回 `focus_switch_blocked`，不写入新的用户回合
- [x] 用户选「挂起并做新任务」后带 `focusSwitchProceed=true` 放行
- [x] 用户选「继续当前」不发送新任务，草稿保留
- [x] 询问落在对话区选择卡，不出现在输入框上方
- [x] 不新建 Focus / Parked / Execution 表，不打开 Activation / Phase 3+

## 12. P3 验收

- [x] `focusSwitchProceed` 给本回合加上 `[FOCUS_PARKED]` 栅栏
- [x] `omitParkedPriorTurns` 从 agent history 去掉栅栏之前的回合
- [x] UI 用既有 inbound-meta 剥离栅栏，对话区不露出内部标记
- [x] 仍不落 Focus / Execution 表，不打开 Activation

## 13. P4 验收

- [x] `commitSessionContinuity` 把未完成事项摘要写入 checkpoint，不再写 `task_ledger.json`
- [x] `applyGoalCorrectionMutation` 未绑定 `taskContextId` 时不创建 ledger 行
- [x] 已绑定行仍可更新；`buildSessionContinuityPrompt` 仍只读绑定行
- [x] 不打开 Activation，不把 ledger 升回身份权威

## 14. P5 验收

- [x] 对话区选择卡增加「取消当前任务，去做新的」，点击即用户同意
- [x] `focusSwitchCancel=true` 放行并写入 `[FOCUS_CANCELLED]` 栅栏
- [x] `omitParkedPriorTurns` 对取消栅栏同样丢掉旧回合
- [x] UI 剥离取消标记；不落 Focus / Parked / Execution 表

## 15. P6 验收

- [x] 主会话 FOCUS 被占时，`surfaceCronJobResult` 注入挂起通知而非完整成果
- [x] 通知带 `cronResultKind=parked_notice`，模型历史仍由 `omitCronResultSurfaces` 省略
- [x] 对话区选择卡提供「查看结果 / 先不管」，不隐式绑回 `kind: cron`
- [x] 不把 Cron job 身份迁到 ConversationTask，不落 Focus / Execution 表

## 16. P7 验收

- [x] Cron job 可带 `conversationTaskId` 引用，normalize 拒绝 session/cron key 冒充
- [x] 未绑定 job 的 wake slot 是 `cron:<jobId>`，Ledger 仍落在现有 `job.id`
- [x] 绑定后 Focus / Ledger 使用 ConversationTask id
- [x] 不打开 Activation，不从 cron 创建 ConversationTask，不落 Focus / Execution 表

## 17. P8 验收

- [x] 主会话 4 小时内有用户发言时，interval/manual 巡检跳过 LLM，原因 `focus-occupied`
- [x] 事件驱动 heartbeat（cron/exec/wake/hook）在 FOCUS 被占时 park，不打进当前对话
- [x] FOCUS 空闲时巡检与事件唤醒仍可跑
- [x] Heartbeat 不铸造 ConversationTask，不落 Focus / Execution 表

## 18. P9 验收

- [x] 事件驱动 heartbeat（exec/wake/hook）在 FOCUS 被占时注入挂起通知，不调用 LLM
- [x] cron 原因复用定时挂起通知卡；exec 使用 `[HEARTBEAT_PARKED_NOTICE]`
- [x] 通知从 agent history 省略；对话区选择卡「先不管」，不隐式开新任务
- [x] 注入成功后排空系统事件，避免空闲后再打一轮模型
- [x] interval 巡检被占时仍静默跳过，不发通知卡
- [x] 不打开 Activation，不落 Focus / Execution 表

## 19. P10 验收

- [x] 未绑定 Cron 编译为 `## 定时说明`，UI 向导/详情不再把 job 文案标成「任务目标」
- [x] 未绑定 isolated 运行注入「本次定时执行说明」，不声称 ConversationTask 身份
- [x] 绑定 `conversationTaskId` 后才使用「任务目标」契约，并可只读回看 ConversationTask goal
- [x] 不铸造 ConversationTask，不打开生产 Activation / Orchestration live，不落 Focus / Execution 表

## 20. P11 验收

- [x] 主会话进度条优先 ConversationTask projection；未绑定 Cron 台账不得贴到 `agent:*:main`
- [x] 仅隔离 cron session（key 含 `cron:<jobId>`）可显示该 job 的 ledger 条
- [x] 新结果卡标题为「定时执行结果」，页脚为「定时任务 ID」；旧「定时任务结果 / 任务 ID」仍可解析并省略出模型历史
- [x] 显式跟进提示声明这是本次执行成果，不是当前对话任务身份
- [x] 不打开 Activation，不落 Focus / Execution 表

此后改原则须升小版本并保留变更记录。
