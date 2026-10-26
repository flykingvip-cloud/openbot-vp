# 调用链与旧成功写入替换清单（askOutcome P0）

## 新调用链

```
entrypoint adapter (chat|gateway_agent|cron|cli|collab)
  → TaskOutcomeResultService.submit
  → DurableTaskOutcomeStore (task + outbox)
  → OutcomeConsumerRuntime.drain (consumerId+eventId)
  → contribution projection + evaluation eligibility
```

## 旧路径（本批替换策略）

| 旧写入 | 文件 | 本批处理 |
|--------|------|----------|
| `appendEvolutionTaskOutcome` 直接记 completed/failed | `src/gateway/agent-growth/evolution-task-outcomes.ts` | 保留存储格式；新增 `growth-bridge.ts` 仅在统一结果 + 评价资格允许时写入 |
| agent-runner 演化 outcome 写失败可观测 | `agent-runner-evolution-outcome.test.ts` | 保留；runner 现经 `recordRunnerTurnOutcome` |
| `recordRunOutcome` 直接记 turn 成功 | `agent-runner-execution.ts` | **已切换**：`recordGrowthTaskOutcome` → `recordRunnerTurnOutcome`（TaskOutcome + growth-bridge） |
| operational-metrics-store 内 append | `operational-metrics-store.ts` | 热路径不再经此 append 任务成功；工具计数仍用 `recordToolOutcomes` |

生产热路径：`agent-runner-execution.recordGrowthTaskOutcome` → `recordRunnerTurnOutcome` → `ChatTaskOutcomeAdapter` / `TaskOutcomeResultService` → 仅在 closed+eligible 时 `publishEvolutionFromTaskOutcome`。run 成功保持 `awaiting_acceptance`（incomplete），不发明任务成功。

热文件 `agent-runner-execution.ts` 的 loom `sharedPaths` lander 仍归 `openbot-evolution-loop-fix:cursor-grok`；本任务只拥有 `src/task-outcome/**`（含 `runtime-from-runner`）。
