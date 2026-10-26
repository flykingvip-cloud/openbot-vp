# 调用链与旧成功写入替换清单（askOutcome）

> W0（基线与证据收敛）修订：对齐 main tip 合入身份（#85 / #89 / #94），去掉过时「runner success → not_required 关闭」表述。
> W1（跨入口任务身份与唯一结果）：`createOrRestore` 持久真实 entrypoint；cron/followup 生产传 taskId；五入口 ensure\* + tip.entrypoint 测试。**未 merge / 未部署**。

## 已核实合入（gh，勿口述）

| PR                                                            | state  | mergeCommit                                | head tip    | 主题                                   |
| ------------------------------------------------------------- | ------ | ------------------------------------------ | ----------- | -------------------------------------- |
| [#85](https://github.com/flykingvip-cloud/openbot-vp/pull/85) | MERGED | `d00bdcca0f3ab5d43af9ed01c65d6a9f47c0a13b` | `ac21ae17…` | R83 persist/CAS/consumer               |
| [#89](https://github.com/flykingvip-cloud/openbot-vp/pull/89) | MERGED | `c3a40259e1e6a878e4608133733349eb39a1646d` | `f67c05ad…` | gateway boot hydrate awaiting-delivery |
| [#94](https://github.com/flykingvip-cloud/openbot-vp/pull/94) | MERGED | `d3cd349a378c2ccfb736807988e0d97c285272ff` | `9006274a…` | attempt 诚实归因 + confirm-no-id       |
| [#95](https://github.com/flykingvip-cloud/openbot-vp/pull/95) | MERGED | `1f698e378a3d1185b864b8bdcfe78e6d2b78c892` | `bf0f467a…` | W0 调用链基线与入口声明澄清            |

W1 基于 `origin/main` tip ≡ #95 merge `1f698e37…`。

## 新调用链（模块内）

```
entrypoint adapter 实例方法
  → TaskOutcomeResultService.submit
  → DurableTaskOutcomeStore (task + outbox)
  → OutcomeConsumerRuntime.drain (consumerId+eventId)
  → contribution projection + evaluation eligibility
  →（仅 closed + eligible）growth-bridge → appendEvolutionTaskOutcome
```

生产热路径（**已接线、有调用证据**）：

1. **chat / gateway 对话 turn**：`agent-runner-execution` → `ensureChatTurnTaskOutcome`（`ChatTaskOutcomeAdapter.createOrRestore`，持久 `entrypoint: "chat"`）→ 收尾 `recordGrowthTaskOutcome` → `recordRunnerTurnOutcome` → 按调用方传入的 acceptance/delivery 门闩推进；**不**在 runner 内发明 `not_required`。
2. **#89 hydrate**：gateway boot → `hydrateAllAgentsAwaitingDeliveries` / `recoverTaskOutcomeConsumersAtGatewayBoot`（`consumer-boot.ts` + `pending-delivery.ts`）。
3. **#94 attempt**：`attempt.ts` 末 pattern `success=null`（未证实失败时）；技能仍调 `recordLifecycleSkillsLoadedOnRun`，run 级 `outcome=null` 时跳过 prompt-named-use **成功**写入、不转 failure；工具级按 `toolMetas`。`confirmPendingTurnDelivery` 三 id 皆缺 → fail-soft + `confirm_skipped_no_locator_ids`。

## 入口适配器现状（W1 已修 create；接线分层）

| 类                               | 声明的 `entrypoint`            | `openTask` / create 实际写入                           | 生产接线                                                                                                                               |
| -------------------------------- | ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatTaskOutcomeAdapter`         | `readonly entrypoint = "chat"` | **`this.entrypoint` / 可选 override**                  | **已接线**：`ensureChatTurnTaskOutcome` ← `agent-runner-execution.ts`；followup → `ensureFollowupTurnTaskOutcome`（chat 身份）         |
| `CronTaskOutcomeAdapter`         | `"cron"`                       | 父类 `createOrRestore` 读 **`this.entrypoint` → cron** | **已接线**：`ensureCronTurnTaskOutcome` ← `cron/isolated-agent/run.ts`，`recordRunnerTurnOutcome({ taskId, entrypoint:"cron" })`       |
| `CliTaskOutcomeAdapter`          | `"cli"`                        | 持久 **cli**                                           | 生产入口面：`ensureCliTurnTaskOutcome`（`entrypoint-ensure.ts`）；**CLI run-loop 深接线仍待**（不以 bare `new Cli…openTask` 冒充闭环） |
| `CollabTaskOutcomeAdapter`       | `"collab"`                     | 持久 **collab**                                        | 生产入口面：`ensureCollabTurnTaskOutcome`（taskId 含 group/boardItem/claim）；**claim/accept 运行时深接线仍待**                        |
| `GatewayAgentTaskOutcomeAdapter` | `"gateway_agent"`              | 持久 **gateway_agent**                                 | 生产入口面：`ensureGatewayAgentTurnTaskOutcome`；对话热路径仍走 chat-entry                                                             |

W1 结论：`createOrRestore` 不再硬编码 `"chat"`；子类 tip.entrypoint 与声明一致。cron/followup 有生产 call-site 证据。CLI/collab/gateway_agent 以 ensure\* 为权威入口面 + `entrypoint-identity.test.ts` 覆盖成功/失败/取消/恢复/重复；深 run-loop 接线不在本轮强行入侵异 lander 热文件。

## 关闭语义（R85b 起；取代过时句）

**过时（已删除）**：`runner success closes with not_required acceptance/delivery`。

**现行**：

- `recordRunnerTurnOutcome`：**禁止**自行发明 `not_required`；仅当调用方显式传入 `acceptance` / `delivery` 才 `setAcceptance` / `setDelivery`（见 `runtime-from-runner.ts` R85b 注释）。
- 成功 run 默认停留在可验收/可交付中间态（`awaiting_acceptance` / incomplete），由 `resolveChatTurnCloseGates` / 契约分类决定是否 waiver：
  - 仅 **显式** `chat_turn` + 无 required validators → acceptance `not_required`；
  - 缺分类 / `unknown` / 执行意图 → acceptance **pending**（不自动免验）；
  - delivery 默认 `awaiting`→pending，须真实 send/confirm（#89 hydrate 保活 pending）。
- 任务级 evolution 样本：仅 tip `closed` 且 `computeEvaluationEligibility` 允许时由 consumer / `publishEvolutionFromTaskOutcome` 写入。

## 旧路径分类（详见 W0 报告；不按函数名批量删除）

| 写入                                                                                         | 文件                                     | 分类                       | 说明                                                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| `appendEvolutionTaskOutcome`（growth-bridge）                                                | `growth-bridge.ts`                       | **已替换路径上的合法写入** | 仅统一结果 + 资格允许时；含 revoke                                    |
| `appendEvolutionTaskOutcome`（operational-metrics `recordTaskOutcome` / `recordRunOutcome`） | `operational-metrics-store.ts`           | **待替换 / 旁路**          | 仍可直接记 succeeded；`evolution-control` RPC 仍调 `recordRunOutcome` |
| `recordToolOutcomes`                                                                         | `operational-metrics-store.ts`           | **合法独立观测**           | 工具计数；非任务成功                                                  |
| `recordGrowthTaskOutcome` → `recordRunnerTurnOutcome`                                        | `agent-runner-execution.ts`              | **已替换**                 | 热路径已切统一 TaskOutcome                                            |
| `ingestPatternSampleFromRun` / `recordLifecycleSkillsLoadedOnRun`                            | `attempt.ts`                             | **观测；#94 已阻误成功**   | 非任务 tip；正样本回填属 W2                                           |
| agent-runner 演化写失败可观测                                                                | `agent-runner-evolution-outcome.test.ts` | **合法独立观测**           | 保留                                                                  |

## loom / 热文件（W0 登记）

| 路径                                                 | landerTask                               | owner                 | reviewAfter     | 备注                                                        |
| ---------------------------------------------------- | ---------------------------------------- | --------------------- | --------------- | ----------------------------------------------------------- |
| `src/task-outcome/**`、`docs/design/task-outcome/**` | `askOutcome-p0-task-outcome-contract`    | `executor-acceptance` | 2026-11-30      | W0–W5 收尾唯一模块 owner                                    |
| `src/auto-reply/reply/agent-runner-execution.ts`     | `openbot-evolution-loop-fix:cursor-grok` | `cursor-grok`         | 2026-11-30      | 热文件；过期 reviewAfter ≠ 自动失效；改接线须临时协调后恢复 |
| `src/agents/pi-embedded-runner/run/attempt.ts`       | constitutional-runtime…（sharedPath）    | 见 registry           | （见 registry） | #94 已改；后续 attempt 仍须协调                             |

**原则**：过期 `reviewAfter` 不等于原归属自动失效；临时 lander 须在交付前恢复，不得双 owner。

## R83 / R85 / P1 要点（保留）

- Persist：`commitBundle` + tip/`versions/` + outbox；CAS：`withTaskLock`。
- Consume：durable projection；evolution 仅经 drain / growth-bridge（runner 不旁路写成功样本）。
- Failure：`fail_closed` + `reasonCode`。
- Entry：`ensureChatTurnTaskOutcome` / `ensureCronTurnTaskOutcome` / `ensureCli|Collab|GatewayAgent|FollowupTurnTaskOutcome`；`recordRunnerTurnOutcome` 强制 taskId（拒 `run:` 发明），可选 `entrypoint` 在 create 时写入。
- R85：recover tip；handler-independent ack；contribution flags；commandLog；requiredScope；correction 绑 callerSubjectRef；**关闭门闩由契约/调用方解析，非 runner 成功即 not_required**。
- P1（#94）：见上文 attempt / confirm-no-id；本批不做验收后正样本回填。
