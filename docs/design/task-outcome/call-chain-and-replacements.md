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

## R83 remediation (post #83)

- Persist: `commitBundle` publishes one commit then materializes tip + immutable `versions/` snapshot + outbox; reopen replays unapplied commits.
- Concurrency: per-task exclusive lock in `withTaskLock` around version check + commit (proven by two OS processes).
- Consume: `OutcomeConsumerRuntime` durable projection; evolution publish only via drain handlers (no runner bypass).
- Failure attribution: `fail_closed` with structured `reasonCode` (not boolean→acceptance_failed).
- commandId digest idempotency; correction allowlist; restore scope/subject checks.

- Entry: `ensureChatTurnTaskOutcome` at `agent-runner-execution` turn start; `recordRunnerTurnOutcome` requires taskId (no `run:` invent).

- R85: recover tip monotonic; handler-independent ack; contribution count flags + always rebuild; commandLog in commit bundle; requiredScope mandatory; correction binds callerSubjectRef; runner success closes with not_required acceptance/delivery.

## askOutcome P1（attempt 诚实归因 + confirm-no-id）

- `attempt.ts` 末：pattern `success` 在未证实 run 失败时为 `null`（不当成功）；技能 **仍调用** `recordLifecycleSkillsLoadedOnRun`，run 级 `outcome=null` 时跳过 prompt-named-use 成功写入、**不**转 failure；工具级按 `toolMetas` 证据记录。本批 **不做** 验收后回填（正样本可能减少）。
- `confirmPendingTurnDelivery`：三 id 皆缺时 fail-soft + 固定事件 `confirm_skipped_no_locator_ids` 诊断；不猜 session pending、不清 pending。有定位键时路径不变（含 #89 hydrate）。
- 不动 hydrate / consumer-boot；不在 attempt 末读另一命名空间 TaskOutcome tip。
