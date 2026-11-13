# S0 现有接口到三职责契约映射

- 盘点 SHA：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`
- 对照方案第 3 节。映射只使用现有契约与返回值。S0 **未新增**任何契约文件，包括 `contracts/events.ts`。
- 决策提案、已提交事实、消费回执按方案 5.1 分开记录；收到提案不等于准入。

## 1. 交互代理（command）

方案输入：当前合法来源消息、经授权筛选的历史／记忆／知识视图、当前目标与版本、允许提出的决定类型、可用性说明。身份、权限和租户由宿主解析。

现有输入类型：`InteractionModelInput`（`src/agent-runtime/contracts/interaction.ts`）。字段为 `message`、可选 `images`、宿主捕获的 `taskTarget`、已授权 `context`、可选 `availability`、`abortSignal`。`taskTarget` 注释写明「由可信宿主捕获，绝不从引用历史推断」。

方案输出继续复用 `reply` / `clarify` / `execution_request` / `task_change` / `task_control`。现有类型：`InteractionModelDecision`。`execution_request.request.lifecycle` 仅为 `"turn" | "long_task"`，省略即 turn，与方案「不为当前回合伪造持久 taskId」一致。

解释与路由：

- `interpretInteraction`：只把推理端口的提案解析成决定；`task_change` / `task_control` 必须绑定 `input.taskTarget`，否则改为澄清，或在目标不一致时抛错。注释：「One inference answers or proposes work. It cannot authorize, create or execute that work.」
- `routeInteraction`：注释写明不跑工具、不调度重试、不派发执行。`reply`/`clarify` → `RoutedInteraction.respond`；任务修订／控制 → `task_proposal`（仍是提案）；仅 `execution_request` 才调用 `admitExecutionRequest`。
- `interactionAdmissionFact`：只有 `accepted`（含 `taskId`）或 `accepted_turn`（无持久 taskId）才是准入事实；`protocolDowngrade` 明确「不是准入事实」。
- `runGovernedUnderstanding`：「一次受治理解释，无个人看板或执行副作用」。群宿主走这条。
- `runGovernedInteraction`：在理解之外绑定 `bindExecutionAdmissionPorts`，`commit` 由 wiring 注入 `sessionTaskState.admitExecution`。

副作用宿主：

- 推理：`invokeInteractionCompletion`（model 适配，无工具、不写任务）。
- 租约／预算：`runAuthorizedInteraction` / `Understanding` 的 `session.authorize`（model 宿主）。
- 个人看板准入写入：仅个体路径的 `ports.commit`（state）。群路径没有这个 commit。
- 用户可见回复、中断在途执行、应用 `task_change`/`task_control`：`get-reply-run.ts` 作为场景宿主消费 `RoutedInteraction`，经 `applyInteractionProposal` / `onInteractionTaskResume` 等受控端口，而不是解释器自己写。

## 2. 执行代理（execution）

方案输入：主链核准的工作范围、计划视图、当前绑定版本、已过滤的能力目录、步骤结果及剩余预算视图。

现有接近输入：

- 持久任务：`ExecutionAdmissionInput` / `TaskCompletionBinding`（`requestId`、期望焦点／写世代、可选 `expectedTaskId`、提案）。
- 当前回合：`TurnExecutionAdmission`（`requestId`、`sessionFile`、`goal`、`acceptance`、`focusRevision`、`writeEpoch`）。注释：「不是任务、恢复票或工具许可」。
- `runAdmittedTurn(request, host)`：在 admitted-turn 入口按 `task.binding.current` / `execution.admitted.binding` 校验后再进入尝试。

方案输出：下一动作、局部方法调整、等待、需修订计划、阻塞、候选成果。本 SHA 将这些决定仍放在既有模型／工具循环内（`createControlledExecutionUseCase` 的固定阶段 `prepare → assert_budget → infer → record_usage → dispose → record_execution_outcome`）。**没有**单独的「执行代理规划模型」输出类型，S0 不新造一层。

副作用宿主：

- 阶段就绪与模型租约：`createExecutionLifecycle`（execution + model 端口）。
- 工具与能力调用：既有 embedded / CLI runner 与 capabilities 边界。
- 看板状态：`sessionTaskState.startExecution`、claim、完成等 state 端口。
- 命令／cron／followup：各自宿主调用同一 `createExecutionLifecycle`（或 command 孪生）并 `assertControlledExecutionStages`，保留任务所有权和投递，不新开 prepare/infer 环。

执行代理不签发授权，不写组合同关闭，不独自决定投递。

## 3. 交付代理（delivery）

方案输入：候选成果身份／版本／hash、原验收标准、确定性检查结果、必要证据和当前回执。

现有接近输入／输出：

- `TaskAcceptanceCheck` / `TaskAcceptanceEvaluation` / `ValidationReceipt`（`quality.ts`）。评价状态为 `passed | failed | pending`。当前声明的确定性校验器是 `artifact.text.exact.v1`。
- `evaluateBoundTaskAcceptance`：按已接纳任务与工作区读产物，不相信模型收尾散文；读写世代变化则把评价降为 `pending`。
- `prepareVisibleDelivery`：准备可见回执，注释写明「只有传输确认才能标 delivered」；可把验收结果写入 outcome，并 `registerAwaitingDelivery`。
- `CommandDeliveryReceipt`（`delivery.ts`）：`delivered | failed | delivery_unknown`，「Never grants acceptance or permission to retry」。
- `confirmPendingTurnDeliveryWithPorts` / wiring `confirmPendingTurnDelivery`：回执决策在 delivery，写存储／`completeChecked` 通过注入的 state 端口。
- `completeReplyDelivery`：完成可见回复的传输侧组合。

副作用宿主：真实 sending / ack 仍是既有受控投递组件与场景宿主（chat / reply / command / cron）。交付代理不得自己派发模型执行、修改任务板、签收渠道消息或默认保存知识库。投递失败不改写执行事实。

## 4. 内部反馈如何贯通（不新增 Event Bus）

本 SHA 已用结构化返回值，而不是代理私聊：

| 反馈环 | 现有载体 | 缺口（记录，不在 S0 补契约袋） |
| --- | --- | --- |
| 修订环 | `task_change` 提案 → 宿主 `applyInteractionProposal` → 焦点／约束版本 → 执行前 `bindingCurrent` | 回执需区分收到／生效／在途影响；S1/S3 再验 |
| 阻塞环 | execution 结果、`BlockerGrade`、policy/blocker | 结构化障碍类别与「已授权替代继续／需人交互」的完整映射仍待 S3 收口 |
| 质量修订环 | `TaskAcceptanceEvaluation` 回到宿主，不由 delivery 调 `runAdmittedTurn` | 语义／组终稿校验器大量 pending；不可用模型口头 passed 补位 |
| 交付环 | pending-delivery 身份、`CommandDeliveryReceipt`、`confirmPendingTurnDelivery` | `delivery_unknown` 不得盲发；错误广播不耐久 |

身份字段优先使用已有 `requestId` / 消息 id、`taskId` / work-item、`executionAttempt`/`runId`、`deliverableVersion`/`artifactHash`、`deliveryId`。S0 判断：**现有契约足够完成映射**，没有出现「缺契约就无法列表映射」的阻断，因此不新增契约文件。

## 5. 副作用宿主一览

| 动作 | 允许的宿主 | 不允许 |
| --- | --- | --- |
| 产出交互／执行／交付提案 | command / execution / delivery 适配 | 提案本身当作事实 |
| 准入、修订生效、停止、认领 | state 受控 mutation + 场景宿主调用 | 模型输出复制 tenant/owner/grant；交互代理直接写看板 |
| 工具／能力调用 | capabilities + 既有 runner | 交付代理派 runner；旁路匿名执行 |
| 实际发送与回执 | 既有投递端口 + 场景宿主 | 以「消息已发送」或 `broadcastChatError` 冒充耐久成功 |
| 知识库保存／分享／发布 | 既有权限边界，且须用户主动 | 交付成功默认入库 |
