# 数字员工：可观察 · 可验证 · 可治理

> Progress Ledger 把长程执行从「模型自称完成」收成可审计事实。  
> 产品原则：OpenBot 不向用户展示「AI 想做什么」，而向用户展示「数字员工已经完成什么、正在执行什么、为什么停下，以及距离验收还缺什么」。

## 可观察

```
Execution Events（只追加）
        ↓ fold
Progress Ledger（可重建）
        ↓ projectProgress
Progress Projection（只读）
        ↓
Chat 条 · Cron 列表/详情 · 工作台人闸 · 管理后台
```

- 事实源是事件，不是库里的当前 status。
- 同一事件日志 fold 两次，Ledger 必须字节级一致。
- 时效看 `lastMeaningfulChangeAt`，不看心跳 `updatedAt`。
- `quiet` 仍写账本，只是不推 Chat / 通知。

## 可验证

- Evidence 只允许：`tool_result` / `data_snapshot` / `artifact` / `external_receipt` / `validation_result` / `human_confirmation` / `system_observation`。
- 「我已经成功发送邮件」不是 evidence。`assistant_text` / `model_claim` / `run_summary_guess` 一律拒绝。
- `TOOL_SUCCEEDED` 只到 `executed`。验收 `met` 与步骤 `completed` 必须另有合法校验或回执。
- 主分数永远是「N/M 项验收已满足」，不与执行步数混写成裸 `2/5`。

## 可治理

| 层       | 约束                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| I1–I8    | LLM 不写 status；completed ⇒ executed∧verified；met ⇒ 合法 evidence；replan 不改历史；投影不得强于账本                             |
| Replan   | 模型只提议；runtime 追加 `REPLAN_APPENDED`；旧步骤只退役                                                                           |
| 人闸     | 仅 `blocked_user` / `blocked_authorization` 进工作台待办；执行步骤不进                                                             |
| 管理后台 | `progress-ledger.admin.list` **只读同一 Projection**（`readAdminProgressLedger` → `attachProgressToCronJobs` → `projectProgress`） |
| 指标     | `writesAccepted` / `writesRejected` / `projectionViolations` / `violationsById.I1–I8`                                              |

Flag：`gateway.progressLedger.enabled` / `OPENBOT_PROGRESS_LEDGER_ENABLED`，默认关。关闭时不建账本、不投影、管理列表为空。

上线顺序与执行约束见 `rollout.md`。2026-08-22 隔离灰度已签字（`canary-signoff-20260822.md`）。下一步是按 **当时** `origin/main` 做生产代码 cutover 检查；生产 flag 仍关，另令才开。**不能仅凭 PR 已合并或灰度已签字绕过 forward-only。** 独立 Turn Contract 模块不是本波前置。

## 读路径对照

| 表面                       | 函数                      | 可否写           |
| -------------------------- | ------------------------- | ---------------- |
| Cron 列表 / 详情 / Chat 条 | `readCronProgressView`    | 否               |
| 工作台待办（人闸）         | `listCronHumanGates`      | 否               |
| 管理后台                   | `readAdminProgressLedger` | 否               |
| 运行时                     | `appendLedgerEvent`       | 是（校验后追加） |

禁止：run 摘要当 canonical、模型 checklist 当步骤、管理后台另写一套进度。
