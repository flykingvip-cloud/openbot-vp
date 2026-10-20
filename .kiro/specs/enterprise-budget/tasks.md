# Enterprise Budget — Phase 5

## Agents

- cursor-phase5 · role: owner · scope: enterprise_budget 计费模式、预算闸口、企业端 UI · paths: src/gateway/package-entitlement/billing-mode.ts, src/gateway/package-entitlement/resolve-billing-mode.ts, src/gateway/billing/runtime.ts, src/gateway/billing/record-credit-usage.ts, src/gateway/server-methods/billing.ts, src/gateway/server-methods/subscriptions.ts, ui/src/ui/views/cost-budget/\*\*, ui/src/ui/capability/cost-budget-billing/endpoints.ts · since: 2026-06-13

## 任务

- [x] 1. billing-mode 解析（monthlyCredits=0 → enterprise_budget）— cursor-phase5
- [x] 2. computeBudgetStatus 按 ledger providerCostCents 累计 — cursor-phase5
- [x] 3. record-credit-usage enterprise 路径写 ai_provider_cost — cursor-phase5
- [x] 4. billing.dashboard / subscriptions.get 返回 billingMode + economics — cursor-phase5
- [x] 5. 企业 cost-budget 总览展示 Enterprise 预算模式 — cursor-phase5
- [x] 6. 回归测试 runtime + record-credit-usage — cursor-phase5
