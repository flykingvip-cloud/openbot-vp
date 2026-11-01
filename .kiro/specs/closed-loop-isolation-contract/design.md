# Design：闭环合同冻结

权威叙述在 `docs/audits/2026-11-01-closed-loop-isolation-contract.md`。本文件只固定边界，避免另起一套状态机。

## 保留的权威

| 事实                   | 唯一写入点                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| 任务成败               | `src/task-outcome/judge.ts` 经由 `TaskOutcomeResultService`                      |
| 已关闭任务的合法改写   | 已有 `correction` 转移。生产路径今天未授权                                       |
| 通道是否送达           | `src/task-outcome/delivery-confirm.ts` 与 `set_delivery`                         |
| 大白转写是否被网关接受 | `deliverDiagnoseReportToConversation` 的返回值。不是任务 delivery                |
| 诊断 confirm           | `confirmDiagnoseEvolutionPrescription` 写 cron。不是运行时变更，也不是原任务复验 |
| 运行时变更授权         | evolution apply-authorization。本期保持关闭                                      |

## 明确不能复用的机制

- `pending-deliveries/`：原通道投递登记，键是 runId / taskId / deliveryId。通知失败不得把它变成 `awaiting_delivery`。
- TaskOutcome outbox：重试 `task.closed` / `task.corrected` 的消费者。一个回合会留下多条事件；ack 前失败会按 eventId 重试。这不是「一条用户通知只发一次」的队列。
- capability-gap 去重 Map 与空回复计数：进程内存。重启后子进程从 0 计。
- cron `resolveCronSurfaceSessionKey` 的 main 会话退回：现有 cron 行为。用户任务跟进不得走这条退回，也不得退回 `agent:main:main` 或 `diagnosis:canary:daibai`。
- 支持单 `closed`、经验曝光、治理回执：都不是任务关闭。

## 第一笔业务 PR 的切分

代码依赖允许 1 和 2 同批：否定写回产生新的 `outcomeVersion`，诊断读者必须按 `taskId + outcomeVersion` 读，版本变了要返回 `outcome_version_changed`，不能把新判定说成旧版本，也不能把读失败说成系统正常。

3 单独成下一批。收件人映射 `subjectRef → platformUserId` 今天不存在。在映射被明确之前，跟进通知只能失败关闭。把通知文案、UI 对 `delivered` 的解读和这条映射放进否定写回的同一 PR，会让回滚绑在一起，并且容易误用 cron 的 main 退回。

因此：**第一笔业务 PR 只含「显式否定 → 现有 correction」和「诊断只读权威 tip」。通知语义是第二笔，且第二笔仍不新开队列。** 两笔都要另一次用户授权后才能改生产代码。
