# Requirements：闭环隔离补验与合同冻结

本期只回答「现有机制实际做什么、底层 API 能做什么、第一笔业务改动准许改哪里」。不改变生产业务行为，不打开治理门，不部署。

## 已验证事实

1. 用户否定原任务今天没有写到 TaskOutcome。`deriveInboundFeedbackSignals` 未接入回复链。`applyGoalCorrectionMutation` 已接入 `get-reply-run`，但只改会话绑定的 workspace task context，且不区分引用、别的话题和明确目标。
2. TaskOutcome `correction` 追加版本并重新判定门闩。失败验收会关成 failure。它不创建新 attempt，不叫 reopen。生产构造的 `TaskOutcomeResultService` 没有 `correctionAllowlist`，直接调用会被拒绝。
3. 任务成败的权威结果是 tip 上的 `taskJudgement`。`reasonCode` 不是完整根因。工具失败只留在 attempt 观察里，不能单独把成功任务改成失败，也不能被诊断的 evolution jsonl 读者看见。
4. acceptance 没有 human / automatic 枚举。`not_required` 是合同豁免。未回复保持 `pending`。`passed` 可以来自预检的技术回执。
5. 大白 `chat.inject` 被接受写成 `delivered: true, reason: conversation_accepted`。这不改变原任务 lifecycle。`pending-deliveries` 和 TaskOutcome outbox 都不能当作这条通知的重试队列。
6. `scope.subjectRef` 不是 `platformUserId`。解析不到合法收件人时，诊断注入失败关闭；cron 浮出在缺少 owner 或 agent 不是内置管家时会退回该 agent 的 main 会话。跟进通知不得复用这个退回。
7. 诊断 confirm 写 cron，且 cron `delivery.mode` 为 `none`，payload 不带原 taskId。Issue 网关对 confirm / prescribe / apply / recheck / writeback 仍返回 `confirm_not_enabled`。支持单 `closed` 不改 TaskOutcome。`claimContract` 默认关。没有采纳列表时经验验证计划保持 `exposure_on_success_not_verified`。

## 本期交付

- 隔离测试覆盖上述事实，并分开断言当前路径与 API 能力。
- 审计差量、统一合同表、第一笔业务 PR 的精确范围和仍然未接线的缺口。
- Loom 任务登记。登记若与既有 `src/**` / `src/task-outcome/**` glob 重叠，必须把重叠写进审计，不接管旧任务。

## 非目标

不实现用户否定写回、诊断读者、通知改名或收件人映射。不打开 remediation、Issue 复查回写、skill auto、治理 auto、claimContract。不连接 LIVE 网关，不向真实用户发消息。
