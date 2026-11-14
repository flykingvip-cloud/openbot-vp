# P0 现役规则地图

- 盘点 SHA（本文件引用的行号均相对此 SHA，inventory baseline）：`9b65109f41dee30b892a6faff493e46e735cab8d`
- 当前工作树 HEAD（loom 登记用，可晚于盘点 SHA）：`4a786626a1e2892043f57b3832ddf2a407be284a`（= 再 fetch 后的 `origin/main`，含 #277）。#277 未触及 `src/agent-runtime/policy/**`、`src/agent-runtime/contracts/policy.ts` 及相关规则强制执行，故下列实现引用与当前 HEAD 在政策实现上兼容。
- 工作树：`/workspace/openbot-vp-runtime-rule-adaptation`，分支 `main`（已快进到当前 `origin/main`）
- 目录声明的 inventory pin（未更新）：`RULE_CATALOG_INVENTORY_BASELINE = efdb1b98d83e096a31e251095080de954f5883ec`
- 每条已登记规则的目录 `version` 仍是 `inventory:efdb1b98d83e096a31e251095080de954f5883ec`。这是 **inventory version**，**不是**本盘点实现 SHA，也不是发布版本或有效策略版本。该 pin 与 HEAD 不同**不单独**使规则版本无效。三种版本的兼容判断见 §5。
- 时间：2026-11-12（Asia/Shanghai）
- 生产配置、生产 flag、生产授权账本：未读取，配置现值记为 **未知**。配置来源 ≠ 调整授权。
- 目录 API（`listRuntimeRuleDeclarations` / `getRuntimeRuleDeclaration`）仅测试与再导出使用，**无生产调用**。目录是查询视图，不是控制面；硬约束由宿主执行，不依赖 Agent 或目录选中。

检索时区分了：定义、生产调用、测试、再导出、动态加载。职责不以目录位置或函数名单独推断。`src/gateway/collaboration-dispatch/policy-compiler.ts` 对编译器是再导出，不是第二实现。

## 0. 汇总

| 集合 | 数量 |
| --- | --- |
| 目录已登记 | 27 |
| 其中 `disposition: retain` | 25 |
| 其中 `disposition: pending_migration` | 2（`task.focus.switch`、`task.reply.completion`） |
| 本盘点现役未登记（临时编号 `INV-P0-*`，不冒充正式规则） | 5 |
| 明确不升格为规则 / 观察保留 | 见 §3 |
| 证据不足、未当作现役规则登记 | 见 §4 |

按本盘点主性质（一条规则若混合，取对适配约束更严的主标签；细节见各条）：

| 主性质 | 已登记条数 | ID |
| --- | --- | --- |
| 硬约束 | 13 | `task.binding.current`，`execution.admitted.binding`，`delivery.receipt.identity`，`execution.lifecycle.preparation`，`task.control.explicit`，`input.stamp.strip`，`task.acceptance.checks`，`task.constraints.normalize`，`task.park.abort_inflight`，`execution.async_wait.job_transition`，`execution.queue.claim`，`collab.submit.review_versioning`，`collab.governance.gate` |
| 条件强制 | 9 | `interaction.semantic.decision`，`execution.queue.action`，`execution.blocker.grade`，`interaction.source.recoverable`，`task.constraint.owner_gate`，`task.focus.switch`，`task.reply.completion`，`collab.peer.review_gate`，`collab.plan.gate` |
| 有界参数（常与硬下限并存） | 5 | `execution.retry.bounds`，`execution.continuation.bounds`，`model.context_window.guard`，`task.focus.wake`，`collab.policy.compile` |
| 偏好（目录主标签） | 0 | 协作 `replyLanguage` 挂在 `collab.policy.compile` 字段下，不单列目录 ID |
| 兼容 / 待退役（目录 disposition） | 2 | 同上 pending_migration 两条 |

动态适配资格总原则：硬约束 = **不可调整**；清洗 helper 不是可选规则；分类证据不足 = **待核准**，不自行放宽。

---

## 1. 已登记规则

每条均给出目录声明与当前树核对结果。目录 `enforcementPoints` 是声明标签；“强制执行点”以生产调用为准。

### 1.1 `task.binding.current`

- **语义：** 判断完成绑定是否仍对应当前未完成、未被 wakeSuppress、未被墓碑、且 attempt/交付版本/约束一致的任务。不创建任务，不写板，不单独执行取消。
- **唯一实现：** `src/agent-runtime/policy/task-binding.ts`：`isLiveTaskBinding` 第 4–21 行，`isTaskTombstoned` 第 23–29 行。盘点 SHA 如上。
- **消费者：** 生产：`state/mutations/execution-binding.ts`、`task-completion.ts`、`admit-task.ts`、`resume-current.ts`、`resume-parked.ts`、`interaction-proposal.ts`、`state/task-action.ts`（`checkTaskActionBoundary`）、`command/host-task-target.ts`、`state/continuation-ticket.ts`。触发：认领/完成/恢复/工具动作前重查。再导出：`policy/index.ts`。
- **输入 / 输出：** 入：`SessionTaskBoard`、`TaskCompletionBinding`、已归一化约束文本。出：boolean。
- **强制执行点：** state 变更与 `checkTaskActionBoundary`（工具前 hook 会再调）。未发现跳过绑定检查的第二套完成路径；未读的生产旁路 = 未知。
- **作用域：** 任务 / 会话任务板。
- **性质：** 硬约束（`category: invariant`，`management: code_required`）。
- **配置与默认值：** 无开关。生产值不适用。
- **依赖 / 冲突：** 目录依赖 artifacts：`contracts/task-binding.ts`、active constraints。与取消围栏、`task.constraints.normalize` 协同。
- **测试：** `policy/task-binding.test.ts`（证明谓词在一致/不一致约束与墓碑下的真假）。存在≠已在本机执行。
- **动态适配资格：** 不可调整。
- **遗留问题：** 无重复实现。目录 version 滞后。

### 1.2 `execution.admitted.binding`

- **语义：** 已被准入的执行请求必须携带并核验其原始任务绑定；不替代准入分类本身。
- **唯一实现：** `src/agent-runtime/execution/runner/admitted-turn.ts`：`runAdmittedTurn` 第 31 行起，绑定检查约第 36–42 行（无绑定抛错；有绑定则 `host.task.isTaskExecutionBindingCurrent`）。
- **消费者：** 生产：`agent-runtime/wiring/reply-turn.ts`，`auto-reply/reply/agent-runner.ts`。cron/followup 场景适配器被要求走同一生命周期，但不是所有场景都强制调用 `runAdmittedTurn`（与总方案一致）。测试与治理注册表另有引用。
- **输入 / 输出：** 入：admitted turn 参数与 host。出：成功/最终结果或抛错。
- **强制执行点：** `runAdmittedTurn` 入口。绕过风险：未走该入口的场景宿主——方案明确不得强迫全部场景调用；是否另有执行入口见治理注册表，未在本盘点中把它们改写成第二执行器。
- **作用域：** 已准入回合 / 任务。
- **性质：** 硬约束。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 目录依赖 `task.binding.current`、`execution.lifecycle.preparation`。
- **测试：** `execution/runner/admitted-turn.test.ts`（含缺绑定拒绝）。另有 `admitted-turn.attempt-host.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 目录 version 滞后。

### 1.3 `interaction.semantic.decision`

- **语义：** 对入站交互做语义解释（回复 / 新任务 / 更新等），供路由与准入使用。不执行工具，不写任务状态。
- **唯一实现：** `src/agent-runtime/command/interpret-interaction.ts`：`interpretInteraction` 第 120 行起。
- **消费者：** 生产：`command/route-interaction.ts`（先解释再路由），`prepared-interaction.ts`。触发：入站交互。
- **输入 / 输出：** 入：message/context/可选 taskTarget 与 inference port。出：决策对象。精确契约见该文件与 `contracts/interaction.ts`。
- **强制执行点：** command 路由入口。调用方拥有后续效果。
- **作用域：** 入站交互（个人或经 command 的会话）。
- **性质：** 条件强制（分类；每次入站经该路径时必须执行，但不是可选策略开关）。
- **配置与默认值：** 目录：无总开关。
- **依赖 / 冲突：** 使用 `parseTaskAcceptanceChecks`（见 1.10）。不得用遗留 `classifyTurnRelation` 替换（目录 retirement 说明）。
- **测试：** `command/interpret-interaction.test.ts`、`route-interaction.test.ts`。
- **动态适配资格：** 不可调整（分类器不是可选规则）。
- **遗留问题：** 无。

### 1.4 `execution.retry.bounds`

- **语义：** 为 provider 运行循环的重试、过载故障转移退避和溢出压缩次数提供上限。不决定是否应该重试的业务原因。
- **唯一实现：** `src/agent-runtime/policy/run-limits.ts`：`OVERLOAD_FAILOVER_BACKOFF_POLICY` 第 3–8 行，`MAX_OVERFLOW_COMPACTION_ATTEMPTS=3` 第 10 行，`resolveMaxRunRetryIterations` 第 17–22 行（内部 BASE=24，PER_PROFILE=8，MIN=32，MAX=160）。
- **消费者：** 生产：`execution/runner/embedded-run-auth.ts`，`execution/recovery/context-overflow.ts`，`execution/runner/embedded-run-attempt.ts`。
- **输入 / 输出：** 入：`profileCandidateCount`。出：`[32,160]` 间整数；另有退避结构与压缩次数常量。
- **强制执行点：** embedded run / overflow compaction。未见用户脚本出口。
- **作用域：** provider 运行循环（平台级常量）。
- **性质：** 有界参数（`reviewed_parameters`），上限本身是硬封顶。
- **配置与默认值：** 源码常量如上。生产覆盖：未见独立配置，现值=源码（非外部生产文件）。
- **依赖 / 冲突：** 目录 artifacts：profile candidate count。
- **测试：** `policy/run-limits.test.ts`。存在≠已跑过。
- **动态适配资格：** 仅可提案 / 待核准（无运行时授权主体；不得发明新调权）。
- **遗留问题：** 无独立测试证明故障转移路径的完整退避时序。

### 1.5 `execution.continuation.bounds`

- **语义：** 会话任务板挂起任务数量与 continue 窗口（次数、冷却）。不是执行槽 `MAX_PARKED_SLOTS`。
- **唯一实现：** `src/agent-runtime/policy/task-board-limits.ts` 第 5–7 行：`MAX_PARKED_TASKS=3`，`TASK_BOARD_CONTINUE_MAX_PER_TASK=3`，`TASK_BOARD_CONTINUE_COOLDOWN_MS=15*60*1000`。
- **消费者：** 生产：`state/mutations/task-record.ts`，`context/sources/task-completion-notice.ts`，`conversation-task/session-task-board.ts`，`execution/runner/task-continuation.ts`，`state/continuation-ticket.ts`，`conversation-task/task-board-continue.ts`，以及 `execution/index.ts` 再导出。
- **输入 / 输出：** 常量，无函数契约。
- **强制执行点：** park / continue 预订之前的宿主写入路径。
- **作用域：** 会话任务板。
- **性质：** 有界参数，但**没有**第二套上下界函数（常量即边界）。
- **配置与默认值：** 源码常量。非用户配置。
- **依赖 / 冲突：** 不得与 `task.focus.wake` 的 `MAX_PARKED_SLOTS`（同为 3）混为同一规则。
- **测试：** 目录列出 `policy/task-board-limits.test.ts` —— **当前树不存在该文件**。实际相关测试：`conversation-task/task-board-continue.test.ts`，`focus-policy.test.ts`（覆盖面需按文件阅读，不能把“有测试文件”当成该常量套件通过）。
- **动态适配资格：** 待核准 / 仅可提案。首期不开放上调。
- **遗留问题：** 目录测试路径失效。

### 1.6 `delivery.receipt.identity`

- **语义：** 按 runId/deliveryId/taskId 等定位符确认待发货回执；缺少定位符不猜测、不清理。回复成功不等于已投递。
- **唯一实现：** `src/agent-runtime/delivery/dispatch/confirm-pending.ts`：`confirmPendingTurnDeliveryWithPorts` 第 10 行起。接线包装：`wiring/delivery-confirm.ts` 的 `confirmPendingTurnDelivery`。
- **消费者：** delivery / reply-turn 确认路径。触发：待投递记录的确认。
- **输入 / 输出：** 入：cfg、可选 runId/deliveryId/taskId/sessionKey、状态 delivered/failed/delivery_unknown。出：void（跳过或确认）。精确匹配失败则 return。
- **强制执行点：** `confirmPendingTurnDeliveryWithPorts`。无定位符时只记 verbose 日志并返回。
- **作用域：** 待投递回合 / 任务。
- **性质：** 硬约束（生命周期）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** pending-delivery 存储；可选 completeChecked。
- **测试：** `delivery/dispatch/confirm-pending.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 全渠道投递生产行为本阶段证据不足。

### 1.7 `execution.lifecycle.preparation`

- **语义：** provider 启动前的执行生命周期准备。chat 的 `runAdmittedTurn`、cron 与 followup 适配器应消费该生命周期，而不是另起一套。
- **唯一实现：** `src/agent-runtime/execution/runner/execution-lifecycle.ts`：`createExecutionLifecycle` 第 15 行起（文件头注释第 11 行说明场景宿主）。
- **消费者：** execution runner 装配。具体每个 cron/followup 是否全覆盖，需结合各适配器；本盘点确认模块存在且被 runner 使用，不声称所有场景百分之百调用。
- **输入 / 输出：** runId + host → lifecycle 对象。细节见该文件。
- **强制执行点：** before_provider_startup（目录标签）；实现为生命周期工厂。
- **作用域：** 执行尝试。
- **性质：** 硬约束（生命周期编排，非可选策略）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 与 admitted-turn 分担阶段。
- **测试：** `execution/runner/execution-lifecycle.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 目录 version 滞后。未对每一个 cron 入口做全路径穷举。

### 1.8 `task.control.explicit`

- **语义：** 仅解析固定中文/CONTINUE/CLOSE 句法的暂停、取消、恢复；不推断新工作、不切焦点、无副作用。
- **唯一实现：** `src/agent-runtime/policy/explicit-task-control.ts`：`parseExplicitTaskControl` 第 5–26 行（先 `stripInboundStamp`）。
- **消费者：** 生产：`conversation-task/session-task-board.cross-process-child.ts`，`gateway/server-methods/chat-resume-parked-recheck.ts`。写板由宿主执行。
- **输入 / 输出：** 入：文本。出：`ExplicitTaskControl | undefined`。
- **强制执行点：** 显式控制变更之前的解析。未匹配则 undefined，不当作控制命令。
- **作用域：** 当前或已挂起任务。
- **性质：** 硬约束（固定句法，无产品开关）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 依赖 `input.stamp.strip`。
- **测试：** `policy/explicit-task-control.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 无。

### 1.9 `input.stamp.strip`

- **语义：** 去掉入站文本开头的时间戳信封。是归一化 helper，不是可选策略，也不改变权限。
- **唯一实现：** `src/agent-runtime/policy/input-stamp.ts`：`stripInboundStamp` 第 3–5 行，正则第 1 行。`focus-switch.ts` 与 `turn-relation.ts` 再导出同一符号；`command/task-status.ts` 的 `stripInboundStampForDialogue` 委托该实现。测试断言引用相等。
- **消费者：** 显式控制、约束门、focus-switch、task-title、task-status、会话板等。
- **输入 / 输出：** string → string。
- **强制执行点：** 入站文本被用于控制/约束/启发式之前。
- **作用域：** 动作 / 入站文本。
- **性质：** 硬约束（必须先清洗）；**不是**可选规则。
- **配置与默认值：** 正则常量。
- **依赖 / 冲突：** 无规则依赖。
- **测试：** 目录所列四个测试文件均存在。`focus-switch.test.ts` / `task-status.test.ts` 含与权威实现等价的断言。
- **动态适配资格：** 不可调整。
- **遗留问题：** 无第二实现。目录 version 滞后。

### 1.10 `task.acceptance.checks`

- **语义：** 解析封闭的验收检查契约；未知算子、可执行字段、越界路径失败关闭。不执行检查本身。
- **唯一实现：** `src/agent-runtime/policy/acceptance-checks.ts`：`parseTaskAcceptanceChecks` 第 4–58 行。仅允许 `artifact.text.exact.v1`，最多 16 条，expected 总字节 ≤16384，禁止绝对路径/`..` 等。
- **消费者：** 生产：`state/mutations/admit-task.ts`，`command/interpret-interaction.ts`，`command/execution-admission.ts`，`delivery/acceptance/criteria.ts`。
- **输入 / 输出：** 入：unknown + criteriaCount。出：`{ok:true,checks}` 或 `{ok:false}`。
- **强制执行点：** 验收契约持久化 / 准入之前。失败则拒收。
- **作用域：** 任务验收契约。
- **性质：** 硬约束。
- **配置与默认值：** 未知算子拒绝。无外部开关。
- **依赖 / 冲突：** `contracts/quality.ts`。
- **测试：** 目录 `tests: []`。本盘点 **未找到** 以 `parseTaskAcceptanceChecks` 为名的测试文件（消费者测试可能间接覆盖，未当作专门通过证明）。
- **动态适配资格：** 不可调整。扩展 allow-list 须评审。
- **遗留问题：** 缺少专项测试；目录已诚实留空。

### 1.11 `task.constraints.normalize`

- **语义：** 把约束条目归一化，并计算当前有效约束文本。不写板，不判断是否修订。
- **唯一实现：** `src/agent-runtime/policy/constraints.ts`：`normalizeConstraintEntries` 第 4–37 行，`activeConstraintTexts` 第 40–44 行。
- **消费者：** 生产：绑定检查、`task-action.ts`、state 约束写入等多处（`activeConstraintTexts` 命中广泛）。
- **输入 / 输出：** 入：原始约束条目或 `TrackedTask`。出：规范化数组 / 文本列表。
- **强制执行点：** 约束读写之前。helper，但是硬前置。
- **作用域：** 任务约束。
- **性质：** 硬约束（归一化辅助，非可选策略）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 目录依赖 `task.constraint.owner_gate`。
- **测试：** 目录 `tests: []`。相关断言出现在 `explicit-task-control.test.ts` 与 `turn-relation.test.ts`（主要测 owner_gate 谓词，不是该归一化的完整套件）。
- **动态适配资格：** 不可调整。
- **遗留问题：** 专项测试不足。

### 1.12 `execution.queue.action`

- **语义：** 仅根据队列占用与已解析的交互语义决定 `run-now` / `enqueue-followup` / `drop`。不重新分类用户意图。
- **唯一实现：** `src/agent-runtime/policy/execution-queue.ts`：`resolveExecutionQueueAction` 第 2–18 行。
- **消费者：** 生产：`wiring/reply-turn.ts`。
- **输入 / 输出：** 入：isActive/isHeartbeat/shouldFollowup/`queueMode` 枚举。出：三动作之一。heartbeat 在 active 时 drop；followup 或 steer 则入队。
- **强制执行点：** 队列占用决策。调用方执行效果。
- **作用域：** 执行占用 / 会话。
- **性质：** 条件强制。
- **配置与默认值：** `queueMode` 来自会话/消息配置（schema help 提到 interrupt、steer+backlog 等）。生产现值未知。
- **依赖 / 冲突：** 目录依赖 `interaction.semantic.decision`（语义应先完成）。
- **测试：** `policy/execution-queue.test.ts`（枚举若干 queueMode）。
- **动态适配资格：** 待核准（改 queueMode 会改变占用行为，不是低影响偏好）。
- **遗留问题：** 无。

### 1.13 `execution.blocker.grade`

- **语义：** 仅对 blocker 叙述分级（mainline / side_path / already_cleared）。不做探测、I/O、调度。
- **唯一实现：** `src/agent-runtime/policy/blocker.ts`：`gradeBlocker` 第 13–39 行及相关谓词。
- **消费者：** 生产：`agents/turn-completion/contract.ts`；`isMainlineBlockNarrative` 还被 `delivery/acceptance/settlement.ts` 使用。效果由调用方落地。
- **输入 / 输出：** 入：narrative、deliverableProducible、可选 clearedReasons/probes。出：`BlockerGrade`。
- **强制执行点：** before_blocker_effect（目录标签）；实际是纯函数，强制效果在调用方。
- **作用域：** 任务阻塞叙述。
- **性质：** 条件强制（分类）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** `contracts/blocker.ts`。
- **测试：** `policy/blocker.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 分级规则若扩展需评审。

### 1.14 `model.context_window.guard`

- **语义：** 解析有效上下文窗口并判定告警/阻断。不选择模型。可选帽 `contextTokens` 只能把窗口收到不大于当时已解析窗口；对适配提案而言，普通收紧的上限是**当前有效窗口**（已计入现有帽），不只是模型窗口。
- **唯一实现：** `src/agent-runtime/policy/context-window.ts` 全文（第 3–74 行）。
- **消费者：** 生产强制：`agent-runtime/model/prepare-embedded-model.ts` 第 59–89 行（传入源码常量，shouldBlock 时抛 `FailoverError`）。仅解析、不阻断：`agents/pi-embedded-runner/compact.ts`、`extensions.ts`。`commands/onboard-custom.ts` 使用硬下限常量。
- **输入 / 输出：** 见 `ContextWindowInfo` / `ContextWindowGuardResult`。
- **强制执行点：** 模型准备主路径有阻断；compaction/extensions **未**调用 `evaluateContextWindowGuard`（执行缺口）。
- **作用域：** 模型调用 / agent 默认配置。
- **性质：** 有界参数 + 硬下限（16000）。告警阈 32000 只记日志。
- **配置与默认值：** 源码默认硬下限 16000、告警 32000、`DEFAULT_CONTEXT_TOKENS=200000`。可选帽 `agents.defaults.contextTokens` 是**值来源**，生产帽值未知。该配置可读 ≠ 动态调整授权已建立。
- **依赖 / 冲突：** OpenBotConfig models / agentContextTokens。
- **测试：** 目录 `tests: []`。实际有 `src/agents/context-window-guard.test.ts`、`prepare-embedded-model.test.ts`。
- **动态适配资格：** 硬下限不可调整。`contextTokens` 帽仅为首期个人 **shadow-proposal 候选**（不是运行时白名单；动态调整授权尚未建立），合约：`hardMin(16000) ≤ proposedValue ≤ currentEffectiveValue`。有效 32000 不得提案 64000。删除帽或恢复更高值属放宽，须单独授权并重核，不是普通收紧；删除参数不是合法回退。有效值未知或低于 hardMin 时不生成可执行调参提案。函数参数允许更低 hardMin，属 API 风险。
- **遗留问题：** 非主路径未统一阻断；目录未登记已有测试。

### 1.15 `interaction.source.recoverable`

- **语义：** 仅将狭义本地 I/O 降级（SyntaxError 与一组 errno）标为可恢复。认证、配额、取消、未知错误必须逃逸。
- **唯一实现：** `src/agent-runtime/policy/interaction-availability.ts`：`isRecoverableInteractionSourceError` 第 2–14 行。允许码：EACCES、EPERM、EIO、ENOSPC、EROFS、ENOENT、ENOTDIR。
- **消费者：** 生产：`command/execution-admission.ts`，`command/interaction-sources.ts`。
- **输入 / 输出：** unknown → boolean。
- **强制执行点：** interaction_source_error。调用方据此选择降级而非吞掉权限错误。
- **作用域：** 本地交互源。
- **性质：** 条件强制。
- **配置与默认值：** 无。扩大可恢复码须评审。
- **依赖 / 冲突：** 无。
- **测试：** 目录 `tests: []`。本盘点未找到以该符号为名的专项测试。
- **动态适配资格：** 不可调整。
- **遗留问题：** 缺专项测试。

### 1.16 `task.park.abort_inflight`

- **语义：** 在切焦点时是否中止进行中的执行（`cutContext || abortInFlight===true`）。不是分类器，不写板。
- **唯一实现：** `explicit-task-control.ts`：`shouldTaskParkAbortInFlight` 第 32–34 行。`park-abort.ts`、`turn-relation.ts` 再导出或消费该谓词。
- **消费者：** 生产：`conversation-task/park-abort.ts`，`conversation-task/turn-relation.ts`，`gateway/server-methods/chat.ts`（约第 6324 行）。
- **输入 / 输出：** 两个布尔 → boolean。
- **强制执行点：** before_focus_switch_abort、gateway chat live。
- **作用域：** 任务焦点切换 / 进行中回合。
- **性质：** 硬约束。
- **配置与默认值：** 无。
- **依赖 / 冲突：** artifacts：cutContext、abortInFlight。
- **测试：** 目录所列三个测试文件均存在。
- **动态适配资格：** 不可调整。
- **遗留问题：** 无第二权威实现。

### 1.17 `task.constraint.owner_gate`

- **语义：** 判断主人是否在修订/整体替换约束、是否应持久化约束、是否为执行屏障话语。查询、裸“继续”、斜杠命令不入库。不写板。
- **唯一实现：** `src/agent-runtime/policy/constraints.ts`：`isOwnerConstraintRevision` 第 96–109 行，`isOwnerConstraintFullReplace` 第 112–119 行，`isOwnerExecutionBarrierUtterance` 第 124–130 行，`shouldPersistOwnerConstraint` 第 133–156 行。历史 coverage 曾写实现位于 `turn-relation.ts`，**与当前树不符**（现已在 policy，currentOwner=policy）。
- **消费者：** 生产通过 policy 导出到 conversation-task / state 约束写入。测试亦覆盖 turn-relation 委托。
- **输入 / 输出：** 可选 message 文本 → boolean。内部先 stamp strip。
- **强制执行点：** before_owner_constraint_persist。板写入留在 state。
- **作用域：** 任务约束（主人）。
- **性质：** 条件强制（分类谓词）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 依赖 `input.stamp.strip`。
- **测试：** `explicit-task-control.test.ts`，`turn-relation.test.ts`。
- **动态适配资格：** 不可调整。
- **遗留问题：** 2026-11-09 coverage 文档对该条 currentOwner/路径已过期。

### 1.18 `execution.async_wait.job_transition`

- **语义：** 异步等待作业意图的状态转移与文件锁存储。不调度第二执行器。
- **唯一实现：** `src/agent-runtime/state/repository/async-wait-job.ts`：`transitionAsyncWaitJobIntent` 第 21 行，`recordAsyncWaitJobIntent` 第 48 行，以及 read/list/mark/clear 等。
- **消费者：** state 仓储与恢复链路（另有 `async-wait-job-recovery.ts` 等，**恢复链路未逐文件登记进目录**）。
- **输入 / 输出：** 作业意图记录与 sessionFile/jobId 等。精确字段见该模块。
- **强制执行点：** async_wait_job_lock。
- **作用域：** 执行尝试 / 会话作业文件。
- **性质：** 硬约束（生命周期）。
- **配置与默认值：** 无。
- **依赖 / 冲突：** file lock、async-wait-job-store。
- **测试：** `state/repository/async-wait-job.test.ts` 存在。另有多份 recovery 测试，但不能把“有 recovery 测试”当成全链路已关闭。
- **动态适配资格：** 不可调整。
- **遗留问题：** 目录覆盖缺口仍在：async-wait **恢复**链路未逐文件进目录。

### 1.19 `execution.queue.claim`

- **语义：** 认领排队中的执行并处理恢复附录/失败回滚板 attempt。协作路径不得因 ClaimContract 而跳过绑定。
- **唯一实现：** `src/agent-runtime/state/mutations/claim-queued-execution.ts`：`claimQueuedExecution` 第 84 行起；另有 `extractAsyncWaitRecoveryAppendix`、`mergeContinuePromptWithRecoveryAppendix`、`restoreBoardExecutionAttemptAfterFailedBind`。
- **消费者：** state 排队执行启动路径。
- **输入 / 输出：** 见函数入参（会话板、绑定、prompt 等）。未在此复述全部字段。
- **强制执行点：** before_queued_execution_start。
- **作用域：** 排队执行 / 任务。
- **性质：** 硬约束。
- **配置与默认值：** 无。
- **依赖 / 冲突：** 目录依赖 `task.binding.current`。
- **测试：** 目录列出 `claim-queued-execution.test.ts` —— **当前树不存在该文件**。实际存在：`claim-queued-execution.recovery-prompt.test.ts` 及若干 async-wait recovery 测试（证明恢复提示与 reclaim 片段，不是目录所写的那个文件名）。
- **动态适配资格：** 不可调整。
- **遗留问题：** 目录测试路径失效。

### 1.20 `task.focus.wake`

- **语义：** 唤醒资格（heartbeat/cron 不得创建身份；无 taskId 的 heartbeat 忽略）以及纯 park/switch 选择与执行槽上限。不认领、不写板、不唤醒宿主。
- **唯一实现：** `explicit-task-control.ts`：`evaluateWakeEligibility` 第 76–97 行，`decideWake` 第 200–227 行，`MAX_FOCUS_SLOTS=1` / `MAX_PARKED_SLOTS=3` 第 103–104 行，`isHeartbeatActionAllowed` 第 57–59 行，`HEARTBEAT_FORBIDDEN_ACTIONS` 第 49–53 行。
- **消费者：** 生产：`conversation-task/focus-policy.ts`，`conversation-task/index.ts`，`infra/heartbeat-focus.ts`，`cron/isolated-agent/main-session-focus.ts`。
- **输入 / 输出：** `WakeReason` + `FocusSnapshot` + incomingTaskId → `FocusDecision` / `WakeEligibility`。
- **强制执行点：** before_focus_wake、parked_slot_limit。宿主负责 claim/write/wake。
- **作用域：** 焦点 / 执行槽（不是任务板基数）。
- **性质：** 硬约束（资格与 heartbeat 禁令）+ 有界参数（槽位常量）。`management: reviewed_parameters`。
- **配置与默认值：** 源码常量。heartbeat 不能 create_identity / write_completion / replan。
- **依赖 / 冲突：** 目录依赖 `execution.continuation.bounds`，但语义上槽位与 `MAX_PARKED_TASKS` 不得混用。
- **测试：** `explicit-task-control.test.ts`，`conversation-task/focus-policy.test.ts`。
- **动态适配资格：** 禁令不可调整；槽位仅可提案/待核准，首期不开放。
- **遗留问题：** 两个“3”并存，需持续避免漂移。

### 1.21 `task.focus.switch`

- **语义：** 焦点切换启发式（决策）；transcript IO 留在 adapter。不单独执行 abort（委托 `task.park.abort_inflight`）。
- **唯一实现：** `src/conversation-task/focus-switch.ts`（currentOwner 仍为 conversation-task，`pending_migration`）。
- **消费者：** conversation-task 焦点切换路径。stamp/title 已委托 policy/context。
- **输入 / 输出：** 启发式函数集合；详见该文件。非单一纯门函数。
- **强制执行点：** before_focus_switch。
- **作用域：** 会话焦点 / 任务。
- **性质：** 条件强制；目录 disposition=`pending_migration`（兼容/待迁）。
- **配置与默认值：** 源码启发式阈值。
- **依赖 / 冲突：** `task.park.abort_inflight`、`input.stamp.strip`。
- **测试：** `conversation-task/focus-switch.test.ts`。
- **动态适配资格：** 不可调整（启发式不是可选手动规则）；迁移属工程任务而非运行时选择。
- **遗留问题：** 目标 owner 为 policy，尚未迁完。

### 1.22 `task.reply.completion`

- **语义：** 回复完成后的双关闭编排：会话板结算接受/已检查/不适用之后，才关闭 ConversationTask。不是闭环权威声明。激活关闭时 no-op。
- **唯一实现：** `src/conversation-task/reply-completion.ts`（currentOwner=conversation-task，targetOwner=state，`pending_migration`）。
- **消费者：** conversation-task 回复关闭路径。
- **输入 / 输出：** 编排函数；成功对外报道受板结算约束。
- **强制执行点：** after_reply_close；`recordCheckedTaskCompletion` 然后 `transitionTask` closed。
- **作用域：** 会话任务 + ConversationTask 适配器。
- **性质：** 条件强制（默认激活 OFF）。
- **配置与默认值：** `readConversationTaskFlags().activation`（环境变量 `OPENBOT_CONVERSATION_TASK_ACTIVATION` / `conversationTask.activation.enabled`），默认 OFF。生产值未知。
- **依赖 / 冲突：** `task.binding.current`；ConversationTask、ledger、SessionTaskBoard 不得合并。
- **测试：** `reply-completion.test.ts`，`reply-completion.window.test.ts`。
- **动态适配资格：** 不可把该开关当作可选策略让 Agent 打开；激活属产品/评审，不是首期调参。
- **遗留问题：** 完成语义权威闭环仍涉及多套存储；T9/完成窗口历史问题不在此补偿。

### 1.23 `collab.policy.compile`

- **语义：** 把 L2 群管理输入编译为 EffectiveCollaborationPolicy，计算 provenance、clamps 与 policyHash。不写活任务，不发送。
- **唯一实现：** `src/agent-runtime/policy/collaboration-compile.ts`：`compileEffectiveCollaborationPolicy` 第 199–362 行，`groupPolicyInputFromOperatingState` 第 364–426 行；分段在 `collaboration-compile-sections.ts`；hash 在 `collaboration-compile-hash.ts`；身份在 `collaboration-policy-identity.ts`（`POLICY_COMPILER_REVISION="1.2.0"`）。Gateway `policy-compiler.ts` / `policy-compiler-hash.ts` 为再导出。组合根：`resolve-effective-policy.ts`。
- **消费者：** 生产：`gateway/collaboration-dispatch/resolve-effective-policy.ts`（dispatch 与 learning 的唯一组合根），以及 lane、snapshot、governance/plan 等经 effective policy 的宿主。文件头“P1-A1 ... no consumers yet”**已过期**，与当前消费者不符。
- **输入 / 输出：** 入：`GroupPolicyInput`。出：含 invariants、strategy、五段能力、guidance、provenance、clamps 的有效策略。
- **强制执行点：** before_collab_dispatch、policyHash。但 `collaboration.lane.*` 默认 legacy 时，部分字段可能仍服务 OS 原值（再钳制）。生产 lane 未知。
- **作用域：** 群 / 群任务（L1 平台不变量 ∩ L2 群管理输入）。
- **性质：** 有界参数 + 内嵌硬不变量 + 若干可被 L2 选择的策略字段。主标签：有界参数/编译器。不得把整个编译器当成“可选规则包”。
- **配置与默认值：** `L1_DEFAULT`、`SYSTEM_INVARIANTS`、各 `L1_*_DEFAULTS`。L2 来自 operatingState。生产 OS/lane 值未知。
- **依赖 / 冲突：** 目录 artifacts 仍列举 gateway 旧路径；实现已迁到 policy，gateway 再导出。字段级冲突见决策表。双常量：`SYSTEM_INVARIANTS.maxVisibleRepliesCeiling` 与 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT` 均为 12。
- **测试：** 目录所列三个测试文件均存在，含越界钳制与 invariants 附着。
- **动态适配资格：** 不变量中的强制边界不可调整。不得把整个 compile 包当作可任意调参。仅字段 `maxVisibleBotRepliesPerRound` 为首期协作 **shadow-proposal 候选**（不是运行时白名单；动态调整授权尚未建立），合约：`1 ≤ proposedValue ≤ currentEffectiveValue`（且 ≤ 12）。例：有效上限 3 不得提案 5。非法提案须显式拒绝，不得用编译器钳制冒充原提案通过。自进/决策模式/密级等可覆盖默认首期不可调，其与 `l2CannotWidenL1` 的关系记为「语义及授权边界待核准」，不得自动视为硬约束违反。配置/operatingState 是值来源，不是调整授权。不改 lane，不建立第二套参数权威。
- **遗留问题：** 见决策表 §5（`l2CannotWidenL1` 待核准边界、双 ceiling、过期注释、钳制 vs 提案拒绝）。

### 1.24 `collab.submit.review_versioning`

- **语义：** 提交审阅的版本围栏（submissionId 匹配、空文、重复正文、验收标准、代理字段等）。不写 claim 锁。
- **唯一实现：** `src/agent-runtime/policy/collaboration-rules.ts`：`pendingSubmissionMatches` 第 325–353 行，`boardSubmissionStateContract` 第 372–408 行，`acceptanceCriteriaFullyChecked`、`assertAcceptanceProxyFields`、正文归一化等。
- **消费者：** 生产：`gateway/collaboration-dispatch` 提交审阅宿主（测试：`collab-s3-submit-review-versioning.test.ts`）。纯函数由宿主在 accept/return 前调用。
- **输入 / 输出：** 各纯函数的结构体入参 / `{ok}` 或原因。
- **强制执行点：** before_submit_review_accept。晚到旧版本不可接受。`accepted` 不自动推进。
- **作用域：** 群板条目 / 提交版本。
- **性质：** 硬约束。
- **配置与默认值：** 源码版本围栏。目录称 S3 特性开关默认 OFF，LIVE/Floor 不在 S3 范围。生产 flag 未知。`s3DoesNotTouchLiveOrDefaultFlagsOn` / `s3DoesNotOpenProductionGrayWrites` 为恒 true 的断言函数。
- **依赖 / 冲突：** 目录依赖 `collab.policy.compile`。
- **测试：** 目录所列文件存在。
- **动态适配资格：** 不可调整。
- **遗留问题：** 无。

### 1.25 `collab.governance.gate`

- **语义：** 按已编译的 `EffectivePolicy.governance` 决定 finalize / publish_proposal / self_advance 是否允许。不是第三套规则源。观察者不可批准。
- **唯一实现：** `collaboration-rules.ts`：`classifyGovernanceActor` 第 139–173 行，`evaluateGovernanceGate` 第 176–243 行。
- **消费者：** 生产：gateway `governance-gate` 宿主（`governance-gate.test.ts`）。
- **输入 / 输出：** 入：action、actor、effective.governance。出：`GovernanceGateResult`。
- **强制执行点：** before_governance_allow。
- **作用域：** 群治理动作。
- **性质：** 硬约束（对已经生效的治理字段而言）。默认 `botMaySelfAdvanceWithoutHuman=false`、`finalDecisionMode=human_required`。
- **配置与默认值：** 无单独产品关闭开关；字段来自有效策略。生产值未知。
- **依赖 / 冲突：** 依赖 compile。不新增 confirm 模式。
- **测试：** `governance-gate.test.ts`，`collaboration-rules.test.ts`。
- **动态适配资格：** 门本身不可调整；其输入字段放宽必须重新授权，首期不开放。
- **遗留问题：** 无。

### 1.26 `collab.peer.review_gate`

- **语义：** 当 `requirePeerReview` 为真时，accept 需要至少一条非作者评审。flag 关闭则允许。不驱动 admission，不控制 `recordPeerReview` 写入。
- **唯一实现：** `collaboration-rules.ts`：`peerReviewAcceptAllowed` 第 415–428 行，`peerReviewMustNotDriveAdmission` 第 410–412 行（恒 true）。
- **消费者：** 生产：gateway `peer-review-gate` 宿主。
- **输入 / 输出：** `{requirePeerReview, nonAuthorReviewCount}` → ok / peer_review_required。
- **强制执行点：** before_peer_review_accept。
- **作用域：** 群板提交 accept。
- **性质：** 条件强制（配置默认 false）。
- **配置与默认值：** `collaboration.task.requirePeerReview`，zod optional boolean，help 写明默认 false。生产值未知。
- **依赖 / 冲突：** 依赖 compile。`drivesAdmission` 必须保持 false。
- **测试：** `peer-review-gate.test.ts`，`collaboration-rules.test.ts`。
- **动态适配资格：** 不可作为首期可选项（打开即新增验收门槛）。
- **遗留问题：** 无。

### 1.27 `collab.plan.gate`

- **语义：** 群板状态到私有 todolist 交付映射：草稿是否允许、交付是否需已确认计划、是否允许交付自进。`cancelled`/`blocked`/`accepted` 等不可普通自进。口头调度不创建板事实；自由聊天不是 todolist。
- **唯一实现：** `collaboration-rules.ts`：`boardTodolistDeliveryMapping` 第 449–526 行，`isTodolistConfirmedForDelivery` 第 569–573 行，`claimBoardActionAllowed` 第 550–552 行，以及 `oralDispatchCreatesBoardFact` 等恒 false 辅助断言。exec bag 组装仍在 gateway `plan-gate-exec.ts`（目录 retirement 说明）。
- **消费者：** 生产：gateway plan-gate 宿主（`collab-s2-plan-gate-all-paths.test.ts`）。
- **输入 / 输出：** 板状态 → 映射结构；todolist.status===`confirmed` 才算确认。
- **强制执行点：** before_plan_gate_exec。未知状态失败关闭。
- **作用域：** 群板条目 + 成员私有 todolist（明确不是群板子记录）。
- **性质：** 条件强制（随板状态变化）+ 对取消/终态的硬拒绝。
- **配置与默认值：** 平台不默认打开自进（`s2DoesNotDefaultSelfAdvanceOn` 恒 true）。LIVE/Floor 翻转不在本门范围。生产值未知。
- **依赖 / 冲突：** 依赖 compile。取消围栏与本映射交叉。
- **测试：** 目录所列文件存在。
- **动态适配资格：** 不可调整（尤其是 cancelled 不可自进）。
- **遗留问题：** 私有 todolist / handoff 周边此前被标为可补登记；handoff 见未登记项。

---

## 2. 现役未登记项（临时盘点编号，不是正式规则 ID）

以下实现已在生产路径使用，但 **没有** 目录稳定 ID。编号仅用于本盘点，禁止当作可发布规则或编入有效策略。

### INV-P0-001 已接受成果外发与组终稿资格

- **语义：** 已接受成员成果/组终稿的资格、外发授权、授信签发与渠道账户出站范围。资格不等于授权，授权不等于发送。调用方自带 granted 标志不被读取。入站 `allowFrom` 绝不能当作出站依据。空目的地 = 无依据（pending），不是全允许。
- **唯一实现：** `src/agent-runtime/policy/accepted-artifact-delivery.ts`（例如 `evaluateAcceptedArtifactOutboundAuthorization` 第 152–188 行，`evaluateGroupFinalOverallAcceptance` 第 320–361 行，`evaluateGroupFinalDeliveryEligibility` 第 367–404 行，`issueOutboundArtifactGrant` 第 412–437 行，`evaluateChannelAccountOutboundScope` 第 457 行起，`establishTrustedDeliveryIssuer` / `deriveAcceptedArtifactIssuanceBasis`）。
- **消费者：** 生产：`command/accepted-artifact-delivery.ts`，`state/collaboration/accepted-artifact-delivery-txn.ts` 与 `-read.ts`。**注意：** `src/cron/isolated-agent/delivery-dispatch.ts` 有同名本地函数 `normalizeDeliveryTarget(channel,to): string`（第 24 行），只做飞书/Lark 目标整形，**不是**本模块实现，也未 import 本模块。
- **输入 / 输出：** 见该文件类型（身份、目标、grant、issuer、facts）。组终稿资格在身份完整且已 accepted 时仍返回 `authorization_pending` / `outbound_auth_unwired`。
- **强制执行点：** command/state 交付事务。未接线的外发授权失败关闭为 pending，不发送。
- **作用域：** 租户 + 群 + 任务 + 条目 + actor + 出站目标。
- **性质：** 硬约束。
- **配置与默认值：** 无放宽开关。生产授权账本未读=未知。
- **依赖 / 冲突：** 与 `collab.plan.gate` / 验收标准相关，但权威独立。T9 缺口独立存在。
- **测试：** `policy/accepted-artifact-delivery.test.ts`，`policy/group-final-delivery.test.ts`。
- **动态适配资格：** 不可调整。不得进入 shadow-proposal 候选或运行时白名单，不得在本任务补偿 T9。
- **遗留问题：** `outbound_auth_unwired` 表明组终稿外发授权尚未完全接线。同名 cron helper 易造成误判消费者。

### INV-P0-002 协作交接（handoff）

- **语义：** 交接批准解析、责任形状、对 live 状态应用交接、历史去重。owner 转移/approver 必须 human 批准。
- **唯一实现：** `src/agent-runtime/policy/collaboration-handoff.ts`：`resolveHandoffApproval` 第 61–73 行，`classifyHandoffApplyAgainstLive` 第 117 行起，`applyHandoffContractToResponsibility` 第 96–115 行等。
- **消费者：** 生产：`gateway/collaboration-dispatch/handoff-contract.ts`，`gateway/collaboration-learning/handoff-contract-entry.ts`，`state/collaboration/handoff-txn.ts`。
- **输入 / 输出：** 见 `HandoffContractView` 等类型。
- **强制执行点：** gateway / state 交接宿主。纯函数本身不写库。
- **作用域：** 群任务责任。
- **性质：** 硬约束 / 条件强制（按 kind/role）。
- **配置与默认值：** 源码角色规则。
- **依赖 / 冲突：** 与治理角色、群任务状态交叉。
- **测试：** `collaboration-rules.test.ts` 等有限引用；专项覆盖程度待补，不把存在当通过。
- **动态适配资格：** 不可调整。
- **遗留问题：** 未进目录；先前 coverage 已承认 handoff 周边未盘全。

### INV-P0-003 `SYSTEM_INVARIANTS` 的直接消费

- **语义：** 平台级协作不变量（协议 1.1、可见回复天花板 12、非成员/观察者不可写、归档不可调度、个人会话不继承群技能白名单、`l2CannotWidenL1`、不可绕过保密等）。`l2CannotWidenL1` 须区分 L1 **强制边界**与 **可覆盖默认**；L2 将某默认 false 改为 true，不得自动视为违反硬约束。
- **唯一实现：** `collaboration-rules.ts` 第 10–24 行。编译器嵌入 `effective.invariants`。另有宿主直接读取天花板：`gateway/collaboration-dispatch/hotfix-rollcall-v1.ts`。
- **与 1.23 的关系：** 逻辑上属于 compile 的硬核，但也被直接引用，且存在第二份同值常量 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT=12`（`gateway/collaboration-dispatch/types.ts` 第 8 行）。
- **性质：** 硬约束（就强制边界而言）。可覆盖默认与该不变量的关系见决策表，不在此改写为第二套硬规则。
- **动态适配资格：** 强制边界不可调整。可覆盖默认的翻转属「语义及授权边界待核准」，首期不开放，但不得自动升格为硬约束违反。
- **遗留问题：** 双常量权威；`l2CannotWidenL1` 对可覆盖默认的语义及授权边界待核准（决策表 §4.2、§5）。不单独冒充正式规则 ID。

### INV-P0-004 `claimBoardActionAllowed` / 板动作合法源状态

- **语义：** 按当前板状态是否允许 claim/apply/submit/accept/return/cancel 等。是状态机表，不是 ClaimContract 数据对象本身。
- **唯一实现：** `collaboration-rules.ts`：`CLAIM_BOARD_ACTION_SOURCES` 第 536–546 行，`claimBoardActionAllowed` 第 550–552 行。
- **消费者：** 协作 claim 宿主（与 plan/submit 门一同使用，证据需结合具体 import；本盘点以符号生产引用为准，未把 ClaimContract 本身登记为规则）。
- **性质：** 硬约束（状态机）。
- **动态适配资格：** 不可调整。
- **遗留问题：** 未单独进目录；与 1.24/1.27 边界需在后续目录扩展时避免重复权威。

### INV-P0-005 工具前任务动作围栏

- **语义：** 每个工具动作重查原任务是否仍为当前绑定，以及模型所见约束是否已变。拒绝文案覆盖暂停、取消、完成或替换。
- **唯一实现：** `src/agent-runtime/state/task-action.ts`：`checkTaskActionBoundary` 第 20–38 行（调用 `isLiveTaskBinding` + `activeConstraintTexts`）。执行点：`capabilities/invocation/before-call.ts` 的 `runBeforeToolCallHook`（约第 104 行起）。
- **消费者：** 能力调用包装。这是 `task.binding.current` 的晚到执行点，不是新的可选手动规则。
- **性质：** 硬约束（取消/变更围栏）。
- **动态适配资格：** 不可调整。
- **遗留问题：** 未在目录 enforcementPoints 中显式列出 before-call；建议后续把该执行点补到 `task.binding.current` 的声明中，而不是新规则 ID。

---

## 3. 明确不升格为规则 / 观察保留

| 项 | 理由（当前树） |
| --- | --- |
| `resolvePromptModeForSession`（`policy/prompt-mode.ts` 第 3–8 行） | 按 sessionKey 是否 cron/subagent 在 `minimal`/`full` 之间硬分支。是提示装配 helper，不是用户可选策略。生产消费者：`embedded-attempt-tools.ts`。历史 coverage 已将其排除出目录，本盘点同意。 |
| ClaimContract / 群板数据形状 / 任务对象 / 能力声明 | 领域对象或声明，不是授权，也不是可开关规则。目录测试仍断言不把 ClaimContract 登记为规则。 |
| `classifyTurnRelation` | 仍定义于 `conversation-task/turn-relation.ts`，源码调用见于 `task-orchestration/complex-task-loop.ts`。保持观察，不登记。不得用它替换 `interaction.semantic.decision`。 |
| `normalizeDeliveryTarget`（cron 本地函数） | 同名不同义的字符串整形 helper，不是出站授权规则。 |
| 输入清洗、正文 trim、hash、deepFreeze | helper / 身份原语，不是可选规则。 |
| hooks / plugin `getGlobalHookRunner` | before-call 会动态 import hook runtime；这是扩展点，不是已登记规则，也不足以在本阶段升格为可适配策略（证据不足，见 §4）。 |

## 4. 覆盖边界与证据不足

本盘点覆盖：`src/agent-runtime/contracts/policy.ts`、`policy/*`、目录声明的实现文件、以及由符号检索得到的生产消费者（command/state/execution/delivery/gateway/cron/followup/capabilities）。

未当作完整现役规则清单的部分：

1. 全渠道 delivery 的生产行为与生产 flag 实际值（未读生产配置）。
2. hooks / Lobster / OpenProse / 任意插件表达式——before-call 存在动态 import 与 hook runner，但没有足够证据把它们登记为可适配规则；也不得执行模型生成脚本或动态模块。
3. async-wait 恢复全链路未逐文件登记。
4. ConversationTask / ledger / SessionTaskBoard 完成权威的长期闭环。
5. 扩展目录、资源目录、数据治理 catalog 等**其他“catalog”**与本规则目录不是同一权威。
6. 未安装依赖、未跑全库测试；测试结论只基于文件与用例存在性。

## 5. 目录元数据与三种版本的兼容判断

不得把“`inventory:efdb1b98…` 与 HEAD 不同”单独解释为规则版本无效。须区分：

| 种类 | 本盘点中的所指 | 与 HEAD 不同是否自动无效 |
| --- | --- | --- |
| 目录 inventory version | 全部 27 条声明的 `version=inventory:efdb1b98d83e096a31e251095080de954f5883ec` | 否。这是目录盘点元数据，预期可落后于 HEAD，也可落后于本盘点实现 SHA `9b65109f…`。 |
| 实现版本 implementation version | 规则实现源码。本文件行号与行为引用固定在 `9b65109f…`。工作树已快进到 `4a786626…`（#277） | 否。仅当政策实现路径相对绑定 SHA 发生未再盘点的变更，或提案绑定的实现版本未知/不匹配时，才判不兼容。#277 未触及政策实现，故对已盘点规则：`4a786626` 与 `9b65109f` 兼容。 |
| 有效策略版本 effective policy version | 运行时真正生效者，如 `POLICY_COMPILER_REVISION=1.2.0`、`COLLABORATION_POLICY_PROTOCOL_VERSION=1.1`、已编译 `policyHash`、现行有效窗口 / `collaboration.lane` / operatingState | 取决于提案绑定的预期版本。未知则不得生成可执行调参提案。滞后或过期状态应明确拒绝。 |

其他目录漂移（记录，不修代码）：

- 两条目录测试路径缺失：`task-board-limits.test.ts`、`claim-queued-execution.test.ts`。
- 若干规则目录 `tests: []`，但树中已有测试（如 context-window）。
- 2026-11-09 的 `rule-catalog-coverage.md` 对 collab 规则仍写 `pending_migration` 且实现位于 gateway；当前目录已改为 policy + `retain`。本文件以盘点 SHA 源码为准，不沿用过期 coverage 行。
