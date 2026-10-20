# Design — Package Entitlement V2

## ADR-1：不替换 Plan

Plan/PlanVersion 承载锁价与 commerce；EntitlementSnapshot 承载 **AI Workforce Capacity**。专家方案中的 `Package` 映射为 EntitlementSnapshot + PlanVersion.snapshot 组合。

## ADR-2：Subscription 不存 activeRuns

活跃 Run 由 `agent-run-registry` 派生；禁止在 Subscription 上维护数组（双写风险）。

## ADR-3：Fail-open 无租户作用域

与 `resolve-agent-run-scope` 一致：解析不到 enterpriseId 时不强制并发（避免误杀现网 bot）。

## 模块

| 模块           | 路径                                                                |
| -------------- | ------------------------------------------------------------------- |
| 类型           | `src/gateway/package-entitlement/types.ts`                          |
| Snapshot store | `src/gateway/package-entitlement/plan-version-entitlement-store.ts` |
| 企业权益解析   | `src/gateway/billing/resolve-enterprise-entitlement.ts`             |
| 约束引擎       | `src/gateway/billing/constraint-engine.ts`                          |
| Run 注册表     | `src/gateway/billing/agent-run-registry.ts`                         |
| Run 治理       | `src/gateway/billing/agent-run-governance.ts`                       |

## P1 预留：Forecast Layer

`src/gateway/consumption-forecast/` 将消费：UsageLedger 序列、agent-run-registry 历史、Bot 增长。P0 registry 须记录 `startedAt`/`finishedAt` 供 P1 信号聚合。
