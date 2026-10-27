# 调用链与旧成功写入替换清单（askOutcome）

> W0（基线与证据收敛）修订：对齐 main tip 合入身份（#85 / #89 / #94），去掉过时「runner success → not_required 关闭」表述。
> W1（跨入口任务身份与唯一结果）**已合入** [#98](https://github.com/flykingvip-cloud/openbot-vp/pull/98) squash → main `b6c60550`。
> W2（消费者与技能/模式统一消费链）**已合入** [#99](https://github.com/flykingvip-cloud/openbot-vp/pull/99) squash → main `f3a19e08`。
> W3（任务类型验收与总预算）**已合入** [#102](https://github.com/flykingvip-cloud/openbot-vp/pull/102) squash → main `f53e027b`。
> W4（经验有效性与受控进化）**已合入** [#109](https://github.com/flykingvip-cloud/openbot-vp/pull/109) squash → main `b8ff8ea4`：曝光≠verified。
> W5（结构与运行收尾）**日志有界**已合入 [#112](https://github.com/flykingvip-cloud/openbot-vp/pull/112) → main `23314d48`；**不**宣布 W0–W5 全部收尾。
> **Wrap-up（本轮）**：修 W4 P1（任务级曝光 / 可等待落盘 / 共现≠有效）；W3 tip 预算最小生产接线（`recordRunnerTurnOutcome`）；矩阵改为四态。**未 merge / 未部署**。

## 已核实合入（gh，勿口述）

| PR                                                              | state  | mergeCommit                                | head tip    | 主题                                   |
| --------------------------------------------------------------- | ------ | ------------------------------------------ | ----------- | -------------------------------------- |
| [#85](https://github.com/flykingvip-cloud/openbot-vp/pull/85)   | MERGED | `d00bdcca0f3ab5d43af9ed01c65d6a9f47c0a13b` | `ac21ae17…` | R83 persist/CAS/consumer               |
| [#89](https://github.com/flykingvip-cloud/openbot-vp/pull/89)   | MERGED | `c3a40259e1e6a878e4608133733349eb39a1646d` | `f67c05ad…` | gateway boot hydrate awaiting-delivery |
| [#94](https://github.com/flykingvip-cloud/openbot-vp/pull/94)   | MERGED | `d3cd349a378c2ccfb736807988e0d97c285272ff` | `9006274a…` | attempt 诚实归因 + confirm-no-id       |
| [#95](https://github.com/flykingvip-cloud/openbot-vp/pull/95)   | MERGED | `1f698e378a3d1185b864b8bdcfe78e6d2b78c892` | `bf0f467a…` | W0 调用链基线与入口声明澄清            |
| [#98](https://github.com/flykingvip-cloud/openbot-vp/pull/98)   | MERGED | `b6c60550fddf0e9aabae6c1a99f06622687ba103` | （squash）  | W1 稳定身份 / 统一收尾 / 真实入口接线  |
| [#99](https://github.com/flykingvip-cloud/openbot-vp/pull/99)   | MERGED | `f3a19e08fea8ad830504230ed3700625ee6cdbcf` | （squash）  | W2 消费者 / 技能·模式统一消费          |
| [#102](https://github.com/flykingvip-cloud/openbot-vp/pull/102) | MERGED | `f53e027bdafa1ccf229144a1c5619b35f67b9299` | （squash）  | W3 任务类型验收与任务级总预算          |
| [#109](https://github.com/flykingvip-cloud/openbot-vp/pull/109) | MERGED | `b8ff8ea4b193f8d16b846b9a080fc0cf8acb525b` | （squash）  | W4 经验有效性（曝光≠verified）         |

W5 merge tip `23314d48`（#112）。Wrap-up 基于更新后的 `origin/main`（含 #114 memory 等）。

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
  →（W3）tip taskContract；tip budget 投影 + **chat runner 路径** `recordRunnerTurnOutcome` 累计/超限 `budget_exceeded`（其余路径未覆盖）
  →（W4 wrap-up）tip experienceExposure（run/task 键）；成功+曝光=「成功任务中的曝光」；**adopted∩exposure** 才 outcome_verified→策展
  →（W5）evolution-loop-log：进程内 captured 有界 ring（`EVOLUTION_LOOP_LOG_CAPTURE_MAX`）；console JSON 仍为生产观测
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

**登记**：W1–W5 合入 tip 见上表。Wrap-up 修 W4 P1 + W3 chat-runner 预算接线 + 四态矩阵。**不**另起主动记忆/容错/预算控制层。诚实缺口：evolution `recordRunOutcome` 旁路不退役；W1 遗留入口；W3 非 runner 路径未接 tip 预算；adopted 无自动推断；pending 仍进程内。**本 wrap-up PR 未 merge / 未部署**。

**既有超时/重试/回退/用量（W3 inventory，不另起）**：`CloseReasonCode.timeout` + eligibility；supervisor `retry.nextStop`（iterations/cost/duration）；agents `model-fallback`；gateway billing / enterprise-model budget-gate。任务总预算 tip 只做投影与关闭归因，不替代上述机制。

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

| 写入                                                                                         | 文件                                     | 分类                       | 说明                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `appendEvolutionTaskOutcome`（growth-bridge）                                                | `growth-bridge.ts`                       | **已替换路径上的合法写入** | 仅统一结果 + 资格允许时；含 revoke                                                                                        |
| `appendEvolutionTaskOutcome`（operational-metrics `recordTaskOutcome` / `recordRunOutcome`） | `operational-metrics-store.ts`           | **旁路仍在（W5 不退役）**  | 仍可直接记 succeeded；canary/working-dna / evolution-control RPC 仍调；退役条件=证明 tip/growth-bridge 已替代全部生产写入 |
| `recordToolOutcomes`                                                                         | `operational-metrics-store.ts`           | **合法独立观测**           | 工具计数；非任务成功                                                                                                      |
| `recordGrowthTaskOutcome` → `recordRunnerTurnOutcome`                                        | `agent-runner-execution.ts`              | **已替换**                 | 热路径已切统一 TaskOutcome                                                                                                |
| `ingestPatternSampleFromRun` / `recordLifecycleSkillsLoadedOnRun`                            | `attempt.ts`                             | **观测；#94 已阻误成功**   | 非任务 tip；W2 经 consumer `attempt-backfill` 在 closed+eligible 回填                                                     |
| agent-runner 演化写失败可观测                                                                | `agent-runner-evolution-outcome.test.ts` | **合法独立观测**           | 保留                                                                                                                      |
| `learning-recall` 注入累加 reuse                                                             | `learning-recall-context.ts`             | **W4 已替换语义**          | 注入=injected 曝光；策展改 outcome_verified；reuseCount 为 legacy 别名                                                    |
| `evolution-loop-log` 进程内 `captured[]`                                                     | `evolution-loop-log.ts`                  | **W5 已收尾（有界）**      | ring `EVOLUTION_LOOP_LOG_CAPTURE_MAX`；生产仍靠 console JSON；非耐久账本                                                  |

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
- W3：复用 `chat-entry` 验收门闩 + tip `taskContract` 拒发明；`budget.ts` 投影 supervisor D-BUDGET（`budget_exceeded` eligibility）。
- W4：learning-recall 四段指标；注入≠策展；wrap-up：run/task 键曝光；成功+曝光≠verified；adopted∩exposure 才 outcome_verified→策展。
- W5：`evolution-loop-log` 有界 captured；总矩阵收敛；旁路 inventory-only（未证明替代则不退役）；清理过时「W4 进行中 / 无界 captured」表述。

## 总验收矩阵（四态：接口可用 / 生产接通 / 行为已验证 / 未完成）

**禁止**把下列各项统一标成「收尾完成」或「原计划已完成」。日志有界（W5）可标行为已验证；其余按实态。

| 阶段 | 主题            | main tip                     | 接口可用        | 生产接通                                      | 行为已验证                               | 未完成（诚实）                                                |
| ---- | --------------- | ---------------------------- | --------------- | --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| W0   | 基线与证据      | `1f698e37` #95               | 是              | n/a（文档）                                   | 文档分类                                 | 「已完成」仅限有调用证据入口                                  |
| W1   | 跨入口身份/收尾 | `b6c60550` #98               | 是              | 部分入口                                      | 已接线入口测                             | server-methods/agent；collab 其它 RPC；子 agent               |
| W2   | 技能/模式消费   | `f3a19e08` #99               | 是              | tip 消费链                                    | handlers 测                              | evolution 旁路仍 inventory                                    |
| W3   | 验收与总预算    | `f53e027b` #102 + wrap-up    | 是（投影/门闩） | **一条**：`recordRunnerTurnOutcome` 累计/超限 | wrap-up 测：同 task 重试累计、超限停止   | supervisor 其它热路径；ParentChild；非 chat runner            |
| W4   | 经验有效性      | `b8ff8ea4` #109 + wrap-up P1 | 是（四段字段）  | tip exposure + consumer                       | wrap-up：并发不串、落盘后 ack、共现≠策展 | adopted **无**自动推断；pending 仍进程内；无采用则不 verified |
| W5   | 结构/矩阵       | `23314d48` #112              | 是              | loop-log 观测                                 | **有界 ring 行为已验证**                 | 旁路不退役；**不**宣布 W0–W5 全部收尾                         |

**复用 / 断点 / 减少（wrap-up）**

| 项      | 复用什么                                         | 修哪个断点                | 减少什么                                          |
| ------- | ------------------------------------------------ | ------------------------- | ------------------------------------------------- |
| W4 关联 | tip `experienceExposure`；`run:`/`task:` pending | agentId 并发串经验        | 禁止 agentId 猜测；无可靠关联则跳过验证           |
| W4 落盘 | `recordLearningExperienceStage`（可等待）        | 先 ack 后写丢数           | drain await；失败不 markConsumed；correction 撤销 |
| W4 口径 | 既有四段指标 + 策展阈值                          | 共现当有效                | Option A：无 adopted＝成功任务中的曝光；不策展    |
| W3 预算 | `budget.ts` / supervisor D-BUDGET                | tip 有快照无执行限制      | 只接 chat `recordRunnerTurnOutcome`；不另造账本   |
| W5 矩阵 | call-chain 表                                    | 假「全部收尾」            | 四态分列；日志有界单独通过                        |
| 旁路    | growth-bridge                                    | `recordRunOutcome` 绕 tip | **不删除**（未证明替代）                          |
