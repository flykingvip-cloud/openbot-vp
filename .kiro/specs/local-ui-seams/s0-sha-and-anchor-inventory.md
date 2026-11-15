# S0 实际 SHA 与锚点清册

- Task: runtime-three-role-convergence-plan-20261113
- 切片：S0（冻结事实与契约映射）
- 盘点日期：2026-11-13，时区 Asia/Shanghai
- 工作树：`/workspace/openbot-vp-three-role-s0`（从 `/workspace/repos/openbot-vp` 新建的分离 HEAD worktree）
- 仓库远程：`https://github.com/flykingvip-cloud/openbot-vp.git`
- 本文件是 S0 事实冻结，不是落地证据，也不宣称三职责主链已经贯通。

## 1. SHA 对照

| 锚点 | 方案记载 | 本轮实际 | 关系 |
| --- | --- | --- | --- |
| 工作树 HEAD / 盘点源码 | （方案要求优先方案核查 HEAD，若已不可取则记录实际 SHA） | `a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f` | 与方案「核查 origin/main」完全一致；提交说明 `fix(runtime): unify task lifecycle and preserve member execution identity (#280)`；提交时间 2026-11-13 06:39:04 +0800（Asia/Shanghai） |
| 核查 origin/main | `a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f` | 抓取后 `origin/main` 与 `origin/HEAD` 仍为同一 SHA | 方案记载的 origin/main 未被新的主干提交推移 |
| 方案核查 HEAD | `565a044f75cecc93c141342def1c95cf6f6eec2f` | 本仓库本地对象、全部已抓取 refs、以及 GitHub `GET /repos/flykingvip-cloud/openbot-vp/commits/{sha}` 均返回不存在（422 No commit found） | **无法取出，也无法复核「祖先检查通过」**。未把它当作当前工作树 HEAD，也未混入其他功能分支 |
| 方案「最近生产源码提交」 | `e5db17974280627d75a7ce4ac2e1d269a994194b` | GitHub 同样 422；本 SHA 的 `deploy/production/releases.jsonl` 与 `deploy/production/LEDGER.md` 中无此字符串 | **无法核验**。不以方案 SHA 填写当前生产头 |
| 本 SHA 账本中仍开放的 LIVE | （方案未改写账本） | seq **165**，`gatewaySha=342de3076099e23004944916422f42d2d44ea186`，`liveFrom=2026-11-09T23:59:48.486Z`（Asia/Shanghai 2026-11-10 07:59:48），`liveTo` 为空 | 该提交是当前盘点 HEAD 的祖先（`git log origin/main` 可见）。这是**本 worktree 所含账本文件**的记录，不是本轮重新 DIGEST / 探活的生产证据 |

选取工作树提交的理由：方案核查 HEAD 在远程不可得；方案已核对的 origin/main SHA 与当前 `origin/main` 相同，且是 #280 合入后的主干头。未检出 `fix/five-pack-user-loop-seams`、`ui/diagnosis-r5-incremental-wire` 或其他功能分支。

既有 checkout 未改写：`/workspace/repos/openbot-vp` 仍在 `fix/five-pack-user-loop-seams` @ `5bb2a3129a90694e72352db16085c5c999394302`；`/workspace/openbot-vp-r5-diagnosis-wire` 仍在 `ui/diagnosis-r5-incremental-wire` @ `a0b764fc35c6a05ba1cc53ccb00157900e13e73b`。为查找方案 SHA，只对共享 git 目录做了 `git fetch`（含 heads/tags），未移动上述工作树 HEAD。

## 2. 方案第 2 节锚点路径（均以 `src/` 为前缀，本 SHA 复核）

下列路径在 `a1433d9e` 均存在。实现多在 `src/agent-runtime/` 下，与方案表格中的短路径一致。

| 区域 | 方案短路径 | 本 SHA 实际路径 | 主要导出／符号 |
| --- | --- | --- | --- |
| 交互解释及准入 | `command/interpret-interaction.ts`、`route-interaction.ts`、`governed-interaction.ts` | `src/agent-runtime/command/interpret-interaction.ts`、`route-interaction.ts`、`governed-interaction.ts` | `interpretInteraction`、`InteractionInferencePort`、`routeInteraction`、`RoutedInteraction`、`interactionAdmissionFact`、`runGovernedInteraction`、`runGovernedUnderstanding` |
| 交互模型适配 | `model/interaction-completion.ts`、`interaction-output-contract.ts` | `src/agent-runtime/model/interaction-completion.ts`、`interaction-output-contract.ts` | `buildInteractionCompletionContext`、`invokeInteractionCompletion`、`INTERACTION_OUTPUT_NAME`、`INTERACTION_OUTPUT_TOOL`、`usesNativeInteractionOutput` |
| 个体回复主机 | `auto-reply/reply/get-reply-run.ts` | `src/auto-reply/reply/get-reply-run.ts` | 在 `interactionIngress && !admittedBinding` 时调用 `replyTurnRuntime.interaction`；其后才调用 `runReplyAgent` |
| 群交互宿主 | `gateway/server-methods/chat.ts`、`group-interaction-understanding.ts` | `src/gateway/server-methods/chat.ts`、`src/gateway/collaboration-learning/group-interaction-understanding.ts` | `groupDiscussionQueue`、`deliverChatSendMentions`、`understandGroupInteraction` → `runGatewayUnderstanding` |
| 执行后端 | `execution/runner/admitted-turn.ts`、`controlled-execution.ts`、`execution-lifecycle.ts` | `src/agent-runtime/execution/runner/admitted-turn.ts`、`controlled-execution.ts`、`execution-lifecycle.ts` | `runAdmittedTurn`、`CONTROLLED_EXECUTION_STAGE_ORDER`、`createControlledExecutionUseCase`、`createExecutionLifecycle` |
| 命令／定时／排队 | `commands/agent.ts`、`cron/isolated-agent/run.ts`、`auto-reply/reply/followup-runner.ts` | `src/commands/agent.ts`、`src/cron/isolated-agent/run.ts`、`src/auto-reply/reply/followup-runner.ts` | `agentCommand` / `agentCommandFromIngress`、`runCronIsolatedAgentTurn`、`createFollowupRunner`；三处均 `assertControlledExecutionStages(...)` |
| 验收及交付 | `delivery/acceptance`、`dispatch/prepare-visible.ts`、`confirm-pending.ts`、`complete-reply.ts` | `src/agent-runtime/delivery/acceptance/`、`src/agent-runtime/delivery/dispatch/prepare-visible.ts`、`confirm-pending.ts`、`complete-reply.ts` | `evaluateTaskAcceptance`、`settleTurnCompletionWithPorts`、`prepareVisibleDelivery`、`confirmPendingTurnDeliveryWithPorts`、`completeReplyDelivery` |
| 装配 | `wiring/reply-turn.ts`、`interaction-turn.ts`、`task-acceptance.ts`、`delivery-confirm.ts` | `src/agent-runtime/wiring/reply-turn.ts`、`interaction-turn.ts`、`task-acceptance.ts`、`delivery-confirm.ts` | `replyTurnRuntime`、`runGatewayInteraction`、`runGatewayUnderstanding`、`evaluateBoundTaskAcceptance`、`confirmPendingTurnDelivery` |
| 共享契约 | `contracts/interaction.ts`、`execution.ts`、`quality.ts`、`delivery.ts`、`task-binding.ts` 等 | `src/agent-runtime/contracts/` 下同名文件，另有 `acceptance.ts`、`command.ts`、`task.ts`、`task-control.ts`、`turn-result.ts`、`continuation.ts`、`policy.ts`、`context.ts`、`capability.ts`、`blocker.ts`、`inference.ts`、`interaction-availability.ts`、`task-stop.ts`、`learning.ts`、`prompt.ts` | 见契约映射表。**不存在** `src/agent-runtime/contracts/events.ts` |

同名但非本锚点的路径（不得误当作方案落点）：`ui/src/ui/controllers/chat.ts`、`src/commands/agent.ts` 以外的 `src/gateway/server-methods/agent.ts`、`src/shared/domain/execution.ts`、`src/cron/delivery.ts` 等。`src/task-outcome/delivery-confirm.ts` 与 wiring 的 `delivery-confirm.ts` 并存，wiring 才是方案装配锚点。

## 3. 明确不存在的目标文件

`src/agent-runtime/contracts/events.ts` 在本 SHA 不存在。仓库中其他 `events.ts`（如 `src/gateway/events.ts`、`src/slack/monitor/events.ts`）属于既有通道／监视器，不是三职责事件总线。S0 **没有**新增该契约，也不把它们假装成方案中的 Event Bus。
