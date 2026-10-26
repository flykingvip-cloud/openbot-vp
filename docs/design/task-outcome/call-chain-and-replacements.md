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
| agent-runner 演化 outcome 测试假定直接 append | `agent-runner-evolution-outcome.test.ts` | 不改热文件逻辑本批；桥接为唯一新增推荐入口 |
| operational-metrics-store 内 append | `operational-metrics-store.ts` | 热文件 shared lander；本批提供桥接，PR 说明后续由 lander 切换 |

本批**不**在 PR 中改写 `agent-runner-execution.ts` 大热文件，避免与其他 owner WIP 冲突；对话纵向闭环以 `ChatTaskOutcomeAdapter` + 集成测试证明接线契约，生产热路径切换列为合入后 follow-up（同一接口）。
