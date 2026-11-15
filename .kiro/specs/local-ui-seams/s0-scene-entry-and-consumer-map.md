# S0 场景入口、公共服务消费者、状态写入口、当前测试与存现失败

- 盘点 SHA：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`
- 时区：Asia/Shanghai
- 本表冻结现状。未改运行行为，未重跑方案所称「后端 6 文件／82 项、前端 2 文件／7 项」，也未把那些测试当作新方案实现通过。

## 1. 场景入口

各场景保留各自宿主函数，不强制收口到同一个 `runAdmittedTurn`。它们已经或应当消费同一受控生命周期及兼容契约。

| 场景 | 宿主入口 | 交互（command）如何进入 | 执行如何进入 | 交付如何进入 | 本 SHA 观察 |
| --- | --- | --- | --- | --- | --- |
| 个体人类回复 | `src/auto-reply/reply/get-reply-run.ts` | `interactionIngress && !admittedBinding` 时调用 `replyTurnRuntime.interaction` → `runGatewayInteraction` → `runGovernedInteraction` | 仅在 `execution_admission` 被宿主接受（`accepted` / `accepted_turn`）或既有绑定恢复后，调用 `runReplyAgent`；`replyTurnRuntime.execution.runAdmittedTurn` 绑定 `bindAdmittedTurnHost()` | `replyTurnRuntime.delivery`：`prepareVisibleDelivery`、`completeReplyDelivery`、`confirmPendingTurnDelivery` | 交互判断位于 `runReplyAgent` 之前。交互前仍有会话文件解析、bootstrap／技能／历史读取、peer 目录等准备；这些准备失败走 `createInteractionSourceBoundary` 的受限模式，而不是静默跳过交互。会话模型租约仍走商业 `agent_run` 闸口（见下） |
| 群聊／协作回合 | `src/gateway/server-methods/chat.ts` 群路径 | 在 `groupDiscussionQueue.enqueue(rawSessionKey, ...)` **内部**调用 `understandGroupInteraction`（约第 5791 行）→ `runGatewayUnderstanding`（无个人看板 commit） | 理解结果为 `execution_request` 后，才进入成员 `resolveMemberAdmission` / `runStageBot`；`discuss-to-task-chat-hook.ts` 仅在语义 `execution_request` 且 `lifecycle === "long_task"` 时走正式建板，缺决定会抛错而不是回退关键词 | 群回执／成员投递仍由该宿主及既有协作投递链负责 | **已核准缺口仍在**：同文件约 5546 行在入队理解**之前** `void deliverChatSendMentions(...)`；约 5558 行起整轮理解与成员执行都在 `groupDiscussionQueue` 内，同群前一轮不结束则后一条也等待 |
| 个体 chat.send（非群讨论队列） | 同文件约 6679 行之后 | 提及路由之后才进入后续宿主 agent 回合 | 若 `deliverChatSendMentions` 返回 `skipHostAgent`（1:1 steward 提及被 `routeStewardConversationMentions` 标明 `handledRobotTask`），宿主不再开跑 | 提及投递本身会走 `MentionDelivery.deliver` | 这是个人通讯提及保留路径，与群路径的「理解前发送提及」不是同一分支，但同函数实现 |
| 命令行／网关 agent 命令 | `src/commands/agent.ts`：`agentCommand`、`agentCommandFromIngress` | 不走 `runGovernedInteraction`；命令宿主自带候选适配 | `createCommandExecutionLifecycle` + `assertControlledExecutionStages(..., "Command host")` | 命令结果／投递选项走既有 command delivery 端口 | 场景宿主保留，共用受控阶段 |
| 定时 isolated agent | `src/cron/isolated-agent/run.ts`：`runCronIsolatedAgentTurn` | 不走个体交互解释器 | `createExecutionLifecycle(cronRunId, bindAdmittedTurnHost())` + `assertControlledExecutionStages(..., "Cron host")` | 定时投递仍由该宿主消费既有 delivery 组件 | 同上 |
| 后续唤醒 followup | `src/auto-reply/reply/followup-runner.ts`：`createFollowupRunner` | 不把唤醒正文重新当作新的人类交互准入 | 同样 `createExecutionLifecycle` + `assertControlledExecutionStages(..., "Followup host")` | 跟随既有回复投递 | 长程等待／恢复使用既有 Wake，不另建执行器 |

## 2. 公共服务消费者

方案第 6 节的公共服务在本 SHA 的主要消费者如下。wiring 只做固定绑定。

| 组件 | 本轮相关实现 | 主要消费者 | 副作用归属 |
| --- | --- | --- | --- |
| model | `createAuthorizedModelSession`、`invokeInteractionCompletion`、`acquireAgentCommandCommercialRun` / `tryAcquireEnterpriseAgentRun`、`src/gateway/billing/authorize-commercial-run.ts` → `acquireAgentRunSlotWithQueuePolicy` | 个体／群交互（`runAuthorizedInteraction` / `runAuthorizedUnderstanding` 先 `session.authorize`）、执行生命周期 `createExecutionLifecycle.prepare`、命令商业闸口 | 租约、用量、回退属于 model／billing 宿主；交互代理不得创建业务任务。`resolveCommercialRunQueueMaxWaitMs()` 在未设置 `OPENBOT_COMMERCIAL_RUN_QUEUE_MAX_WAIT_MS` 时默认 **120_000** 毫秒 |
| context | `src/agent-runtime/context/`（`projectInteractionHistory`、bootstrap 装配、task-focus、peer 目录） | `get-reply-run.ts` 组装 `InteractionModelInput.context`；`understandGroupInteraction` 组装组参考视图 | 只提供受控投影；身份与授权仍由宿主解析 |
| policy | `src/agent-runtime/policy/`，目录见 `catalog.ts`（27 条，`RULE_CATALOG_INVENTORY_BASELINE=efdb1b98d83e096a31e251095080de954f5883ec`） | command 解析验收检查、route 受限通知、execution 队列动作、binding、协作规则 | 规则是代码目录，不是可动态编辑的上线脚本 |
| state | `sessionTaskState`（`src/agent-runtime/state/repository/session-task.ts`）及 `state/mutations/*`、async-wait 仓库 | wiring 将 `admitExecution: sessionTaskState.admitExecution` 注入个体交互；提案应用、完成核验、认领排队 | **只有受控 state 端口写个人／会话看板**；交互／执行／交付代理不直接写文件 |
| capabilities | `src/agent-runtime/capabilities/` 目录与调用边界；工具循环仍在既有 embedded / CLI runner | `runAdmittedTurn` / 命令与 cron 候选适配 | 动作前复检限制与取消；代理不签发授权 |
| wiring | `reply-turn.ts`、`interaction-turn.ts`、`task-acceptance.ts`、`delivery-confirm.ts`、`admitted-turn-host.ts` | 个体回复主机、群理解适配、验收与投递确认 | 只注入端口，不新增总控 |

## 3. 状态写入口（个人／会话看板及关键事实）

`sessionTaskState` 公开面（`src/agent-runtime/state/repository/session-task.ts`）：

- 读：`read`、`readForInteraction`、`captureBinding`、`bindingCurrent`、`turnAdmissionCurrent`
- 写：`admitExecution` → `commitAdmittedSessionTask`；`applyInteractionProposal` → `commitInteractionTaskProposal`；`applyExplicitControl`；`resumeCurrent`；`startExecution`；`completeChecked` → `recordCheckedTaskCompletion`

底层 mutation 目录（均在 `src/agent-runtime/state/mutations/`，S0 不删除）：`admit-task.ts`、`interaction-proposal.ts`、`explicit-control.ts`、`resume-current.ts`、`resume-parked.ts`、`task-completion.ts`、`task-control.ts`、`task-focus.ts`、`task-constraints.ts`、`execution-binding.ts`、`claim-queued-execution.ts`、`session-reset-focus.ts`。

其他受控写（非个人看板，但属于主链事实）：async-wait 仓库与恢复认领、`prepareVisibleDelivery` 调用的 `commitOutcome` / `registerAwaitingDelivery`、`confirmPendingTurnDeliveryWithPorts` 写回执并可能 `completeChecked`、协作侧 `controlledDiscussToTask`（组任务／工作项，不得写入个人看板）。

普通问答的 `accepted_turn` **不** 为当前回合伪造持久 `taskId`（`interactionAdmissionFact` 在 `accepted_turn` 时只标 `admitted: true`，无 `taskId`）。

## 4. 当前测试（静态清册，非本轮执行结果）

计数规则：对下列文件用正则统计顶层 `it(` / `test(`；`it.each` 另计。这是源码静态项数，**不是**本 SHA 的通过／失败证据。S0 未执行这些文件，也未改 CI。

与方案锚点**同目录或直接配套**的测试（摘录）：

| 文件 | 静态项数 |
| --- | ---: |
| `src/agent-runtime/command/interpret-interaction.test.ts` | 7 |
| `src/agent-runtime/command/route-interaction.test.ts` | 4 |
| `src/agent-runtime/model/interaction-completion.test.ts` | 22 |
| `src/agent-runtime/execution/runner/admitted-turn.test.ts` | 13 |
| `src/agent-runtime/execution/runner/admitted-turn.attempt-host.test.ts` | 2 |
| `src/agent-runtime/execution/runner/controlled-execution.test.ts` | 6 |
| `src/agent-runtime/execution/runner/execution-lifecycle.test.ts` | 4 |
| `src/agent-runtime/delivery/acceptance/criteria.test.ts` | 5 |
| `src/agent-runtime/delivery/acceptance/validation.test.ts` | 3 |
| `src/agent-runtime/delivery/dispatch/prepare-visible.test.ts` | 7 |
| `src/agent-runtime/delivery/dispatch/confirm-pending.test.ts` | 1 |
| `src/agent-runtime/delivery/dispatch/complete-reply.test.ts` | 7 |
| `src/agent-runtime/delivery/dispatch/pending-delivery.restart.test.ts` | 3（`it.each` 三种任务状态） |
| `src/agent-runtime/wiring/task-acceptance.test.ts` | 5 |
| `src/agent-runtime/wiring/execution-admission.test.ts` | 4 |
| `src/agent-runtime/wiring/interaction-candidate.test.ts` | 6 |
| `src/agent-runtime/wiring/prepared-interaction.test.ts` | 1 |
| `src/agent-runtime/wiring/turn-execution-admission.test.ts` | 6 |
| `src/agent-runtime/wiring/task-lifecycle.integration.test.ts` | 2 |
| `src/gateway/collaboration-learning/group-interaction-understanding.test.ts` | 1 |
| `src/auto-reply/reply/followup-runner.test.ts` 及 byok / ogui-wait | 24+2+1 |
| `src/auto-reply/reply/get-reply-run.*.test.ts`（aside / inbound-depth / media / ogui / user-modeling） | 2+31+5+17+5+3 |
| `src/commands/agent.test.ts` | 30（同目录还有大量 agent 治理／投递测试，不在此累加冒充定向门禁） |

本 SHA **没有**独立的 `governed-interaction.test.ts`、`interaction-output-contract.test.ts`、`reply-turn.test.ts`、`interaction-turn.test.ts`、`delivery-confirm.test.ts`、`cron/isolated-agent/run.test.ts`（cron 以 `run.*.test.ts` 等分文件存在）。

方案原文「本轮既有定向检查：后端 6 文件／82 项、前端 2 文件／7 项通过」只出现在实施方案中。本 box 上未能找回对应文件清单或本 SHA 的运行日志，**不在此复述为已复验通过**，也不把它们当作新设计已实现。

同目录已有历史验收文档（`collaboration-lifecycle-acceptance-2026-11-13.md`、`pr280-landing-review-2026-11-13.md`）记录的是 #280 候选 SHA（如 `51ea171da`、对照主干 `8a686145`）上的定向结果，不得倒算成 `a1433d9e` 本轮重跑。

## 5. 存现失败与已核准缺口（当前事实，S0 不修）

方案第 2 节已核准缺口，在本 SHA 源码中仍能对上，列为当前事实：

1. **群理解仍在 `groupDiscussionQueue` 内**（`chat.ts` 约 5558–5791 行）。同群前一轮不结束，下一条普通问题也等待。
2. **群消息在理解前调用 `deliverChatSendMentions`**（约 5546 行，早于入队理解）。该函数进入 `MentionDelivery.deliver`，并对 agent 目标调用 `interAgentBus.deliverMention`；1:1 steward 路径甚至可在 `handledRobotTask` 时 `skipHostAgent`。提及通道仍可能在澄清或拒准入之前启动独立处理。方案要求「提及只贡献参与者信息」尚未在本 SHA 落地。
3. **个体交互使用独立模型会话，但仍竞争商业 `agent_run` 并发**。`runAuthorizedInteraction` / `Understanding` 先 `session.authorize`；授权链经 `tryAcquireEnterpriseAgentRun` → `authorizeCommercialRun` → `acquireAgentRunSlotWithQueuePolicy`。queue 模式默认等待上限 120 秒（`resolveCommercialRunQueueMaxWaitMs`）。这不等于响应资源独立。
4. **空输出超时／一般模型超时的可见性与持久化**，方案写明无外发探针确认「空超时 0 气泡」「一般超时 0 持久化写入」。本 S0 未做这些探针，保持 GAP。
5. **`broadcastChatError`**（`chat.ts` 约 3519 行）通过 `broadcastChat` / `nodeSendToSession` 发送，并 `agentRunSeq.delete`；错误广播不是统一的耐久回执。断线重连能否看到异常，没有在本 SHA 看到统一保证。
6. **交付已有部分验收／回执**（`evaluateTaskAcceptance`、`prepareVisibleDelivery`、`confirmPendingTurnDelivery`、目前确定性校验器主要是 `artifact.text.exact.v1`），但不能据目录存在宣称所有内容质量、语义验收、组终稿均闭环。

此外，文档化但**未经本 SHA 重跑**的既有测试债（来自同目录 `pr280-landing-review-2026-11-13.md`，对照当时主干 `8a686145`）：发布账本断言落后、诊断路径环境、PDF 中文提取／字体、旧 TaskOutcome 清单等被记为范围外既有失败。S0 不把它们标 PASS，也不在本切片修复。
