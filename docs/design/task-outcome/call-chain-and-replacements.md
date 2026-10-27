# 调用链与旧成功写入替换清单（askOutcome）

> W0（基线与证据收敛）修订：对齐 main tip 合入身份（#85 / #89 / #94），去掉过时「runner success → not_required 关闭」表述。
> W1（跨入口任务身份与唯一结果）**已合入** [#98](https://github.com/flykingvip-cloud/openbot-vp/pull/98) squash → main `b6c60550`：稳定身份 / 统一收尾 / 真实入口接线。
> **W2（消费者与技能/模式统一消费链）开工中**：A skill-quality / mode-quality 从 tip+eligibility 消费；B attempt 正样本仅在 closed+eligible 回填（不删 attempt 观测）；C cancelled 端到端不计能力失败/成长负样本；D evolution-control→recordRunOutcome 旁路 **仅 inventory，本轮不退役**。**未 merge / 未部署 / 未开 W3**。

## 已核实合入（gh，勿口述）

| PR                                                            | state  | mergeCommit                                | head tip    | 主题                                   |
| ------------------------------------------------------------- | ------ | ------------------------------------------ | ----------- | -------------------------------------- |
| [#85](https://github.com/flykingvip-cloud/openbot-vp/pull/85) | MERGED | `d00bdcca0f3ab5d43af9ed01c65d6a9f47c0a13b` | `ac21ae17…` | R83 persist/CAS/consumer               |
| [#89](https://github.com/flykingvip-cloud/openbot-vp/pull/89) | MERGED | `c3a40259e1e6a878e4608133733349eb39a1646d` | `f67c05ad…` | gateway boot hydrate awaiting-delivery |
| [#94](https://github.com/flykingvip-cloud/openbot-vp/pull/94) | MERGED | `d3cd349a378c2ccfb736807988e0d97c285272ff` | `9006274a…` | attempt 诚实归因 + confirm-no-id       |
| [#95](https://github.com/flykingvip-cloud/openbot-vp/pull/95) | MERGED | `1f698e378a3d1185b864b8bdcfe78e6d2b78c892` | `bf0f467a…` | W0 调用链基线与入口声明澄清            |
| [#98](https://github.com/flykingvip-cloud/openbot-vp/pull/98) | MERGED | `b6c60550fddf0e9aabae6c1a99f06622687ba103` | （squash）  | W1 稳定身份 / 统一收尾 / 真实入口接线  |

W2 基于 `origin/main` tip ≡ #98 merge `b6c60550…`。

## 新调用链（模块内）

```
entrypoint adapter 实例方法
  → TaskOutcomeResultService.submit
  → DurableTaskOutcomeStore (task + outbox)
  → OutcomeConsumerRuntime.drain (consumerId+eventId)
  → contribution projection + evaluation eligibility
  →（仅 closed + eligible）growth-bridge → appendEvolutionTaskOutcome
  →（W2）skill-quality / mode-quality handlers（tip+eligibility；cancelled 只进 cancelledCount）
  →（W2）attempt 正样本回填 confirmPatternOutcomeByRunId / skill task_outcome_confirmed
```

生产热路径（**已接线、有调用证据**）：

1. **chat / gateway 对话 turn**：`agent-runner-execution` → `ensureChatTurnTaskOutcome`（`ChatTaskOutcomeAdapter.createOrRestore`，持久 `entrypoint: "chat"`）→ 收尾 `recordGrowthTaskOutcome` → `recordRunnerTurnOutcome` → 按调用方传入的 acceptance/delivery 门闩推进；**不**在 runner 内发明 `not_required`。
2. **#89 hydrate**：gateway boot → `hydrateAllAgentsAwaitingDeliveries` / `recoverTaskOutcomeConsumersAtGatewayBoot`（`consumer-boot.ts` + `pending-delivery.ts`）。
3. **#94 attempt**：`attempt.ts` 末 pattern `success=null`（未证实失败时）；技能仍调 `recordLifecycleSkillsLoadedOnRun`，run 级 `outcome=null` 时跳过 prompt-named-use **成功**写入、不转 failure；工具级按 `toolMetas`。`confirmPendingTurnDelivery` 三 id 皆缺 → fail-soft + `confirm_skipped_no_locator_ids`。

## 入口适配器现状（W1 已修 create；接线分层）

| 类                               | 声明的 `entrypoint`            | `openTask` / create 实际写入                           | 生产接线                                                                                                                                                                                 |
| -------------------------------- | ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatTaskOutcomeAdapter`         | `readonly entrypoint = "chat"` | **`this.entrypoint` / 可选 override**                  | **已接线**：`ensureChatTurnTaskOutcome` ← `agent-runner-execution.ts`；followup → `ensureFollowupTurnTaskOutcome`（chat 身份）                                                           |
| `CronTaskOutcomeAdapter`         | `"cron"`                       | 父类 `createOrRestore` 读 **`this.entrypoint` → cron** | **已接线**：timer 持久 `currentFireId` → `run.ts` ensureCron；`completeRun` 统一收尾 `recordRunnerTurnOutcome`                                                                           |
| `CliTaskOutcomeAdapter`          | `"cli"`                        | 持久 **cli**                                           | **已接线**：`agentCommandInternal`（`commands/agent.ts`）prepare 后 `ensureCliTurnTaskOutcome`；authz_denied + 统一 finally；`cli-gateway-collab-entry-wiring.test.ts` 经 `agentCommand` |
| `CollabTaskOutcomeAdapter`       | `"collab"`                     | 持久 **collab**                                        | **已接线**：`claim-contract-entry.ts` claim 创建 + apply 收尾；同测经 claim/apply                                                                                                        |
| `GatewayAgentTaskOutcomeAdapter` | `"gateway_agent"`              | 持久 **gateway_agent**                                 | **已接线**：同函数 `governanceEntry===E2` → `ensureGatewayAgentTurnTaskOutcome`；经 `agentCommandFromIngress`；对话热路径仍可走 chat-entry                                               |

### W1 整改要点（#98，相对 tip `c181be43`）

1. **稳定身份**：调度层 allocate/persist `job.state.currentFireId`；followup=**独立子任务**（入队 `followupItemId` + 可选 `parentTaskId`）。
2. **统一收尾**：cron `completeRun` / followup `finally` 覆盖普通成功/异常/取消/前置失败。
3. **真实入口接线**：CLI / gateway_agent / collab claim 生产 ensure\*；测试经真实入口函数。

### 验收矩阵（实现侧自检；独立验收为准）

| 入口          | 创建                        | 重试身份           | 前置失败     | 运行结束    | 取消/重放      | 测经真实入口             |
| ------------- | --------------------------- | ------------------ | ------------ | ----------- | -------------- | ------------------------ |
| cron          | run.ts ensureCron           | currentFireId 持久 | 有           | completeRun | 有 / fire 复用 | cron-fire-id + closeout  |
| followup      | runner ensureFollowup       | followupItemId     | 有           | finally     | 同 item 稳定   | identity + closeout      |
| cli           | agent.ts ensureCli          | tip runId          | authz_denied | finally     | finally        | wiring.test agentCommand |
| gateway_agent | agent.ts ensureGateway      | tip runId          | authz_denied | finally     | finally        | wiring.test FromIngress  |
| collab        | claim-contract ensureCollab | group:item:claim   | claim 面     | apply       | claim 面       | wiring.test claim/apply  |
| chat          | 既有 ensureChat             | tip                | 既有         | 既有        | 既有           | 既有                     |

**诚实缺口**：`gateway/server-methods/agent.ts` 未改（走 commands/agent）；collab 其它 board RPC 未全覆盖；跨进程 cron 冷启动仍靠 store/hydrate；子 agent lane 跳过。临时热文件 lander 已恢复为模块路径 only（交付树无异 owner 热路径声明）。

**登记**：W1 已合入 main `b6c60550`；W2 实现中（A–C）；诚实缺口仍含 gateway/server-methods/agent、collab 其它 board RPC、cron 冷启动 hydrate、子 agent lane 跳过。**未 merge W2 / 未部署 / 未开 W3**。D 旁路 inventory：`evolution-control`→`recordRunOutcome`→直写 `appendEvolutionTaskOutcome` 仍在（operational-metrics-store），本轮不退役。

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
| `ingestPatternSampleFromRun` / `recordLifecycleSkillsLoadedOnRun`                            | `attempt.ts`                             | **观测；#94 已阻误成功**   | 非任务 tip；W2 经 consumer `attempt-backfill` 在 closed+eligible 回填 |
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
- P1（#94）：见上文 attempt / confirm-no-id。
- W2：`quality-handlers`（skill/mode）+ `attempt-backfill`；cancelled 投影可证；evolution 旁路仅 inventory。
