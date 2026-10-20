# Requirements — Package Entitlement V2（AI Workforce Capacity）

> 中文名：套餐权益 V2 — Seat / Bot / Concurrency / Credits / Policy 统一约束  
> 依赖：`cost-budget-billing`、`package-entitlement`、`subscription-commerce`（不替换 Plan/PlanVersion）

## Introduction

在既有 **Plan + PlanVersion（锁价）** 与 **EntitlementSnapshot（能力）** 分层上，补齐：

1. **Concurrency** 租户级并发 Run 控制
2. **constraint-engine** 统一配额检查
3. **agent-run-registry** 运行时 Run 注册
4. （P1）**consumption-forecast** 资源预测 — 本规格 P0 仅预留接缝

**非目标（P0）：** 不重命名 Plan→Package；不改 Credits 扣点公式（token-weight 属 P2）。

## Glossary

- **EntitlementSnapshot**：PlanVersion 旁路能力快照（`maxBots`、`maxConcurrentRuns`、`overagePolicy` 等）
- **Agent Run**：一次模型/agent 执行任务（运行时实例，≠ Bot 资产）
- **constraint-engine**：纯函数配额检查（Bot / Concurrency / Credits）
- **agent-run-registry**：活跃 Run 注册表（并发计数真源）

## Requirements

### R1: EntitlementSnapshot 扩展

1. WHEN 平台 upsert plan entitlement, THE store SHALL 持久化 `maxConcurrentRuns`（非负整数；0=不限并发）
2. WHEN 平台 upsert plan entitlement, THE store SHALL 持久化 `overagePolicy`（`block` | `credits_only` | `pay_as_you_go` + `allowBurstConcurrency`）
3. WHEN 读取旧 snapshot 缺字段, THE reader SHALL 应用默认值（向后兼容）

### R2: constraint-engine

1. THE engine SHALL 纯函数检查 Bot / Concurrency / Credits 约束
2. WHEN `maxBots > 0` 且 activeBots ≥ maxBots, THEN SHALL 返回 `BOT_LIMIT_EXCEEDED`
3. WHEN `maxConcurrentRuns > 0` 且 activeRuns ≥ limit 且 `allowBurstConcurrency=false`, THEN SHALL 返回 `CONCURRENCY_LIMIT_EXCEEDED`
4. WHEN creditsRequired > creditsRemaining 且 monthlyCredits > 0, THEN SHALL 返回 `CREDITS_EXHAUSTED`

### R3: agent-run-registry

1. WHEN Run 启动, THE registry SHALL 注册 `runId` + `enterpriseId` + 可选 `agentId`
2. WHEN Run 结束, THE registry SHALL 标记 `finishedAt`
3. THE registry SHALL 支持 `countActiveRuns(enterpriseId)`

### R4: 运行时强制

1. WHEN `resources.create-bot`, THE handler SHALL 使用 EntitlementSnapshot.maxBots（回退 planVersion.botQuota）
2. WHEN enterprise-scoped agent run 启动, THE runtime SHALL acquire 并发槽；失败则拒绝执行
3. WHEN run 完成或失败, THE runtime SHALL release 并发槽

### R5: 产品叙事（UI，P0 最小）

1. THE 企业 resources.summary SHALL 返回 `concurrencyUsed` / `concurrencyLimit`

## Properties

- **Property 1**：并发 acquire/release 后 active count 准确
- **Property 2**：重复 release 幂等
- **Property 3**：无 enterprise 作用域时 fail-open（不阻断非租户 run）
