# ConversationTask 对话长程任务实施方案

> 版本：专家反馈修订版  
> 状态：方案冻结，等待 Cursor 团队接管。当前仅批准 P0/P1；暂不批准自动激活、生产改造或部署。P4.5 Orchestration Plane 仅批准**默认关闭的休眠内核 + 合同冻结**（见 `./p4-5-orchestration-plane.md`），不批准调度/node/browser 生产启用。  
> 基线：复用现有 Progress Ledger，不新增第二套任务进度系统。ConversationTask 与 Progress Ledger 之间的调度器是 Orchestrator（dispatcher），不是第二套进度状态机。  
> 执行架构总原则（2026-09-17 v2.1，P0–P11 已执行，不替代本方案编号）：见 `./execution-architecture-principles.md`。

## 1. 目标与非目标

目标是让员工继续正常对话，由 OpenBot 高精度识别需要持续推进的工作，并在满足严格激活条件后将其升级为可恢复、可验证、可审计的 `ConversationTask`。

目标链路：

```text
Conversation
  -> Detection
  -> Qualification
  -> Activation
  -> ConversationTask
  -> Orchestrator (dispatcher)
  -> Execution Events
  -> Progress Ledger
  -> Evidence / Acceptance
  -> Projection
```

Orchestrator 是 ConversationTask（身份）与 Progress Ledger（事实）之间的调度器：选择执行面、ack/enqueue/return，**不得**在 `chat.send` 上等待 browser 或 `system.run`。进度权威仍是 Ledger。详见 `./p4-5-orchestration-plane.md`。

本阶段非目标：

- 不把所有 `chat.send` 接入 Ledger。
- 不用模型自述、planner claim 或 run summary 生成事实进度。
- 不新增第二套 steps/progress/evidence 状态机。
- 不在个人助手第一阶段同时实现协作组 Mission。
- P0/P1 不创建正式任务、不启动 Agent、不改变生产行为。

## 2. 当前实现基线

现有系统已经具备：

- Progress Ledger append-only events、fold 和只读 projection。
- Evidence、Acceptance、Replan、Human Gate 与 invariant 校验。
- 长程 Cron 的 Ledger Binding。
- Chat、Cron、Task Detail、Pending Tasks 和管理读取的进度投影。
- 设计层对 `conversationTaskId` / `missionId` 的预留。

当前缺口：

- 没有 Task Candidate 与资格判定层。
- 没有个人助手 ConversationTask 领域对象和稳定会话绑定。
- 没有 Qualification 与 Activation 的明确边界。
- 没有用户修改目标、验收、交付方式时的不可变 Revision 合同。
- 没有 ConversationTask 到 Progress Ledger 的运行时绑定。
- 没有 ConversationTask 与 Progress Ledger 之间的 Orchestrator 调度器：无法在 fail-closed 授权下选择已有执行面（`web_search` / `web_fetch` / `browser` / `nodes`+`system.run` / workspace skills / `sessions_spawn`）。P4.5 冻结该合同并落地默认关闭内核；**不**启用调度、node、browser 或任何 live invoke。

现有职责必须保持：

| 模块             | 唯一职责                                     |
| ---------------- | -------------------------------------------- |
| ConversationTask | 任务身份、归属、目标、生命周期和会话绑定     |
| Orchestrator     | 执行面选择与调度（dispatcher，不拥有进度）   |
| Progress Ledger  | 执行事实、步骤、Evidence、Acceptance、Replan |
| Turn Contract    | 当前回合 mode、blocking gate、open work      |
| Pending Tasks    | 只承载需要人处理的 gate                      |
| Projection       | 合成并只读展示上述事实                       |

## 3. 核心领域边界

### 3.1 Task Candidate

Candidate 只表示系统怀疑当前对话可能形成持续工作。它不是任务，不得：

- 出现在正式任务列表；
- 创建 Ledger；
- 启动 Agent 或发送通知；
- 占用长期任务额度；
- 获得任何外部副作用权限。

Candidate 可以被丢弃、继续补充，或分类为 Reminder、Scheduled Action、ConversationTask。

### 3.2 ConversationTask

ConversationTask 表示 OpenBot 已接受该工作需要持久化、恢复和审计。它拥有：

- `goal`、`requesterId`、`ownerId`；
- `conversationId` 与稳定任务标识；
- `acceptanceRules`、`deadline`、`schedule`、`delivery`；
- 最小生命周期与 Revision 历史。

它不得拥有 `steps`、`progress`、`evidence`、`waiting`、`blocked`、`running`、`nodeId` 等执行运行态。若需要 `taskId → nodeId` 绑定，它属于 Orchestrator 分区，不得写入 `conversation_tasks` 行（A1 冻结表不变）。

### 3.3 Mission

Mission 仅用于多 Agent、多员工、协作空间、委派或共同交付。个人 AI 助手默认只创建 ConversationTask。Mission 必须作为 P7 独立规格实施，不能夹带进个人任务首发。

个人助手后续可用 `sessions_spawn`（`createSessionsSpawnTool`）子代理作为**有界 helper**；这不是 Mission，深度限制写在 Orchestrator 类型/注释即可。P4.5 不在 live path 上 spawn，也不得铸造 Mission。

## 4. 工作类型

| 类型                      | 定义                                                  | 示例                               | 是否建长程 Ledger     |
| ------------------------- | ----------------------------------------------------- | ---------------------------------- | --------------------- |
| L0 Chat                   | 普通问答或讨论                                        | “什么是毛利率？”                   | 否                    |
| L1 Short Action           | 当前 run 内可可靠完成                                 | “查一下今天华东区销售额”           | 否                    |
| Reminder                  | 未来提醒，无持续 Agent 执行                           | “下周一提醒我报销”                 | 否                    |
| Scheduled Action          | 指定时间执行一次固定动作                              | “明早生成一次日报”                 | 默认否，走调度对象    |
| L2 Long-running Execution | 当前 run 无法可靠完成，未来必须根据持久化状态继续推进 | 持续监控、等待外部条件、多周期验收 | 是，Activation 后创建 |

核心定义：

> 只有当工作无法在当前 interaction/run 内可靠完成，并且未来需要 OpenBot 根据持久化状态继续推进时，才属于 Long-running Execution。

未来时间、步骤数量、交付物或外部系统访问均不是单独的充分条件。

## 5. 四层判定 Runtime

### 5.1 Detection

回答“用户是否正在提出一项工作”。输入包括当前消息、有限的 Conversation State、活跃任务绑定和 Turn Contract。

```ts
type DetectionResult = {
  detected: boolean;
  signals: TaskSignals;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};
```

P1 只构建高精度 strong-signal detector，允许漏识别，禁止为了召回率制造大量任务。

### 5.2 Qualification

回答“这项工作属于哪一类”。Qualification 必须是可解释、可回放的纯判定，不得创建任务、写 Ledger 或启动 Agent。

```ts
type QualificationResult =
  | { kind: "chat"; reasons: string[] }
  | { kind: "short_action"; reasons: string[] }
  | { kind: "reminder"; reasons: string[] }
  | { kind: "scheduled_action"; reasons: string[] }
  | { kind: "long_running_candidate"; reasons: string[] }
  | { kind: "needs_clarification"; missing: string[]; reasons: string[] };
```

### 5.3 Activation

Qualification 不能直接创建 Ledger。只有同时满足以下最小条件才允许激活：

1. 有明确目标；
2. 有持续执行理由；
3. 有可持久化状态。

可持久化状态包括 acceptance、deadline、wait condition、next action、schedule、delivery 或可追踪 artifact/reference。

```text
Candidate
  -> Candidate Qualified
  -> Activation Gate
  -> ConversationTask(active)
  -> Ledger Binding
```

### 5.4 Authorization

Authorization 与任务持续时间正交：

```ts
type AuthorizationState = "none" | "authorized" | "human_gate_required";
```

任务激活不等于副作用授权。发送消息、写 CRM、修改业务数据、向群组发布或大范围分发必须单独校验，并在缺少授权时进入 Human Gate。

**Activation ≠ node authorization ≠ outbound authorization。** 三者独立，全部默认 OFF。

`SideEffectClass`（`none | outbound_message | external_write | broadcast`）保留为授权分类，不得用于执行面路由。路由使用更细的 `ExecutionSurface`（P4.5）：

```ts
type ExecutionSurface =
  | "memory"
  | "skill"
  | "connector"
  | "web_read"
  | "browser"
  | "node_fs_read"
  | "node_exec"
  | "outbound_message"
  | "external_write"
  | "broadcast";
```

能力阶梯不得跳级（跳级 = `blocked_policy`）：memory/evidence → skill recipe → connected connector → web_read → browser（仅当需要交互/登录）→ node_fs_read/node_exec（仅当目标是用户机器）→ human_gate。

用户机器 = 已配对 `nodeId`（`listNodes` / `nodes` tool）。Gateway sandbox/workspace **不是**用户机器。零 node 或多个未绑定 node → Human Gate，零 invoke。不得静默回退到 sandbox 并声称“在你的电脑上找到了”。详见 `./p4-5-orchestration-plane.md`。

## 6. Task Signals

P1 不新增 Intent LLM，只输出确定性强信号：

```ts
type TaskSignals = {
  hasFutureIntent: boolean;
  hasWaitCondition: boolean;
  hasMultipleStages: boolean;
  hasRecurringIntent: boolean;
  hasDeliverable: boolean;
  hasCrossTurnDependency: boolean;
  hasExplicitAcceptance: boolean;
  hasPersistentState: boolean;
};
```

约束：

- `hasFutureIntent` 不能直接推出 L2；
- `hasWaitCondition` 可能只是 Turn Contract blocking gate；
- `hasDeliverable` 也可能是 L1；
- external side effect 不进入持续时间判定，只进入 Authorization；
- 关键词规则只声明 high-precision strong signals，不声明完整语义理解。

未来允许 `Deterministic Signal + Conversation State + Model-proposed Candidate`，但模型提议永远不能直接激活任务或写入执行事实。

## 7. ConversationTask 合同

```ts
type ConversationTaskLifecycle = "draft" | "active" | "closed" | "cancelled";

type ConversationTask = {
  id: string;
  conversationId: string;
  requesterId: string;
  ownerId?: string;
  goal: string;
  acceptanceRules: AcceptanceRule[];
  lifecycle: ConversationTaskLifecycle;
  deadlineAtMs?: number;
  schedule?: ScheduleSpec;
  delivery?: DeliverySpec;
  createdAtMs: number;
  updatedAtMs: number;
};
```

UI 状态必须由以下组合产生：

```text
ConversationTask.lifecycle + Progress Ledger + Turn Contract -> Projection
```

例如 `active + 3/5 + mode=ask + blockingGate=price_definition` 投影为“3/5，等你确认价差口径”。

## 8. Revision 与对话连续性

用户改变目标、验收、deadline 或 delivery 时，不得覆盖历史字段，也不得自动新建第二个任务。

```ts
type TaskRevisionEvent = {
  taskId: string;
  revision: number;
  field: "goal" | "acceptance" | "deadline" | "delivery";
  previousValue: unknown;
  nextValue: unknown;
  reason: "user_change" | "system_replan" | "authorization_change";
  actorId: string;
  atMs: number;
};
```

Revision 应触发相应 Ledger Replan/Revision 事件；旧步骤只能退役，不能删除。ConversationTask 是 Conversation 的执行状态，不是 Conversation 的替代品。

同一会话中的“改成 Q3”“先不要发送”“加入同比分析”应绑定当前活跃任务，并分别产生 Revision、Authorization Change 或 Replan。

## 9. Progress Ledger 接入

```text
ConversationTask
  -> stable taskId binding
  -> runtime tool/gate/validator events
  -> ledger writer
  -> fold
  -> projectProgress
  -> Chat / Task Detail
```

允许写入事实的来源：工具结果、验证器、人工确认、授权结果、定时触发和外部系统回执。

禁止来源：assistant 自述、planner claim、run summary、前端文本推断、工具卡标题。

既有 invariants 继续生效：`met` 必须有合法 Evidence；completed 不得强于 executed/verified；Replan 不覆盖历史；Projection 不得强于 Ledger。

## 10. UX 合同

采用“隐式升级、显式告知”，但不得把自动升级伪装成副作用授权。

- 低风险：“好的，我会持续跟进这项工作。”
- 缺少参数：“我可以持续处理。完成后需要发到哪个财务群？”
- 高风险：“任务已经建立，但发送给全部销售需要你的确认。”

UI 只渲染 Projection，禁止显示内部评分、模型猜测或无 Evidence 的完成状态。Pending Tasks 只显示人的 gate，不混入普通 Execution Steps。

## 11. 实施阶段

### P0：合同冻结与离线数据集

交付：

- 本文类型与边界转成正式 domain contracts；
- 正例、反例、模糊例和跨回合样例集；
- Reminder/Scheduled/L2 分类金标；
- 不变式与 threat model；
- feature flag 和判定日志合同。

出口：专家确认合同无双状态、无越权、无普通 Chat 建账。

### P1：离线 Detection 与 Qualification

交付：

- strong-signal extractor；
- Qualification 纯函数；
- 离线 replay/evaluation；
- explainable reason codes；
- shadow-only metrics。

硬约束：不创建 ConversationTask、不写 Ledger、不启动 Agent、不改变 Chat/Cron/生产 UI。

### P2：Activation Gate 与个人 ConversationTask

前置：P0/P1 重新验收并明确批准。

交付：Candidate 生命周期、Activation Gate、ConversationTask store、稳定会话绑定、取消/关闭及幂等。

### P3：Revision 与 Continuity

交付：TaskRevision、active-task resolution、跨回合修改、重复任务防护、历史审计。

### P4：Progress Ledger Binding

交付：ConversationTask Binding、Execution Events、Evidence/Acceptance/Replan、Canonical Projection。

### P4.5：Orchestration Plane（休眠内核）

交付：Orchestrator 合同冻结 + 默认关闭的纯路由内核（`src/task-orchestration/`）。Chat 路径 ack/enqueue/return，永不在 `chat.send` 上等待 browser/`system.run`。四个独立 flag（`shadowEnabled` / `dispatchEnabled` / `nodeEnabled` / `browserEnabled`）全部默认 OFF，**不得**复用 CTR 的五开关。

硬约束：不启用 activation、projection、authorization；不 live invoke `web_search`/`browser`/`nodes`/`sessions_spawn`；不把 `steps`/`progress`/`nodeId` 写入 ConversationTask。生产启用调度/node/browser = **NOT APPROVED**。准入见 `./p4-5-admission-package.md`。

### P5：Authorization 与 Human Gate

交付：副作用分类、授权判定、`blocked_authorization` / `blocked_user`、Pending Tasks 与审计。

### P6：个人助手灰度

仅面向内部员工、指定助手或指定租户；默认关闭，支持立即回退。未达到指标不得扩大灰度。

### P7：协作组 Mission

独立规格实施 owner/requester/participants、Workspace ACL、delegation、Mission 合并与审计，不与个人 ConversationTask 首次发布捆绑。

## 12. 测试矩阵

| 输入/场景                              | 预期                                           |
| -------------------------------------- | ---------------------------------------------- |
| “什么是毛利率？”                       | L0；不建任务，不建 Ledger                      |
| “查一下今天华东区销售额”               | L1；当前 run 完成                              |
| “下周一提醒我提交报销”                 | Reminder；不建 Long-running Ledger             |
| “明早生成一次日报”                     | Scheduled Action；不得仅凭未来时间升级 L2      |
| “每周监控竞品价格，异常时分析并通知我” | L2 Candidate；Activation 后才建任务            |
| “等客户回复后继续”                     | 默认可能只是 blocking gate；无明确目标不得激活 |
| “我以后想研究这个问题”                 | Candidate 可丢弃；不得创建正式任务             |
| “把 Q2 改成 Q3”                        | 原任务 TaskRevision v2；不建新任务             |
| “整理后发给全部销售”                   | 任务类型与发送授权分开；发送必须 Human Gate    |
| 模型声称“已经完成”                     | 不写 Ledger，不改变 Acceptance                 |
| 同一消息重复投递                       | 幂等，不产生重复任务或重复事件                 |
| flag off                               | 与当前 Chat/Cron 行为一致                      |

## 13. 指标与目标

核心指标：

- `Task Upgrade Precision`：升级为 L2 的任务中真正需要持续生命周期的比例；首轮目标 `>= 95%`。
- `Task Survival`：正式任务在首轮之后仍需继续推进的比例；大量首轮结束表示过度升级。

辅助指标：

- Candidate 创建/丢弃/激活率；
- L0/L1/Reminder/Scheduled/L2 分布；
- Reminder 误升级率；
- 重复任务创建率；
- Revision/Replan 率；
- Human Gate 命中率；
- Evidence 完整率；
- 用户主动停止和取消率。

第一阶段优先 Precision，允许 Recall 暂低。离线回放和影子判定未达到目标，不得进入自动激活。

## 14. Feature Flags 与可观测性

至少拆分以下开关，禁止一个总开关跨越全部风险边界：

```text
conversationTask.detection.enabled
conversationTask.qualification.enabled
conversationTask.activation.enabled
conversationTask.projection.enabled
conversationTask.authorization.enabled
```

P4.5 另增四个 **Orchestrator 专用**开关，全部默认 OFF，**不得**复用上面五个 CTR flag：

```text
conversationTask.orchestration.shadowEnabled
conversationTask.orchestration.dispatchEnabled
conversationTask.orchestration.nodeEnabled
conversationTask.orchestration.browserEnabled
```

CTR `activation` ON 不得被当成 Orchestrator 启用。缺失 flag / 空 allowlist / CTR 仍为 shadow-only ⇒ Orchestrator 观察 0、写入 0、invoke 0。

P0/P1 只允许 detection/qualification shadow mode。日志必须记录 reason code、输入摘要的隐私安全指纹、判定版本和结果，不记录不必要的原始敏感文本。

## 15. 安全、权限和数据隔离

- 所有读取和写入沿用现有 tenant、employee、conversation ACL。
- Candidate 不得扩大 Conversation 可见范围。
- ConversationTask owner 不等于外部系统授权主体。
- 任务关闭、取消、归档后的数据保留遵循现有 Conversation Lifecycle。
- 外部副作用必须 fail closed。
- 协作组 ACL 与个人任务不能复用隐含默认值，P7 单独评审。

## 16. 阶段门禁

### P0/P1 批准范围

当前批准：合同、数据集、detector、Qualification、离线回放、shadow metrics。

当前禁止：正式任务创建、Ledger Binding、Agent 启动、UI 任务条、生产自动升级和 Mission。

### P2 准入条件

全部满足后才可请求批准：

1. Candidate / ConversationTask / Mission 边界有测试和评审证据；
2. Qualification、Activation、Authorization 无职责重叠；
3. Reminder、Scheduled Action、Long-running 分类回放通过；
4. Upgrade Precision 达到 `>= 95%` 的约定样本门槛；
5. 误升级、重复投递、用户改目标和副作用反例全部通过；
6. feature flag、回滚和观测设计通过运维评审；
7. 安全、tenant isolation 和授权边界通过专项评审。

### P6 生产门禁

- 基于 freshly fetched `origin/main`；
- 候选 SHA 必须等于 `origin/main` tip；
- 通过 forward-only 与 delivery alignment；
- 仅按租户/员工/助手小范围灰度；
- 默认关闭，具备即时停用和可审计 release record；
- 不从脏工作树、侧分支或未合并提交部署。

## 17. Cursor 团队执行指令

1. 先阅读本方案与现有 Progress Ledger 规格，不得另建执行状态系统。
2. 按仓库规定完成 Loom 接管，实际执行者成为唯一 owner。
3. 先提交 P0 合同、样例集和测试计划，禁止同时编写 Activation runtime。
4. P1 仅做离线/影子判定，输出评估报告和逐类 confusion matrix。
5. 达到 P2 门禁后停止实施，提交专家验收，不得自行进入自动激活。
6. 后续每阶段独立提交、独立测试、独立验收；协作组 Mission 必须另开规格。

## 18. 最终批准声明

批准 P0/P1 设计与离线验证；不批准当前方案直接进入 P2 自动激活。

本项目的目标不是增加一个更聪明的 Chat Router，而是建立 OpenBot 从 Conversation 到可持续、可恢复、可验证、可审计数字员工任务生命周期的事实入口。任何实现都必须服从以下事实链：

```text
Candidate
  -> Qualification
  -> Activation
  -> ConversationTask
  -> Orchestrator (dispatcher)
  -> Execution Events
  -> Progress Ledger
  -> Evidence
  -> Acceptance
  -> Projection
```
