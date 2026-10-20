# Entitlement V2 — Phase 3 Credits

## Agents

- cursor-phase3 · role: owner · scope: Credits 计量、Usage Ledger、EntitlementSnapshot · paths: src/gateway/package-entitlement/\*_, src/gateway/billing/credit-meter._, src/gateway/billing/tenant-credits-store.ts, src/gateway/billing/usage-ledger-store.ts, src/gateway/billing/record-credit-usage.\* · since: 2026-06-13

## 任务

- [x] 1. EntitlementSnapshot 旁路 store（`plan-version-entitlement-store.ts`）— cursor-phase3
- [x] 2. credit-meter 纯函数 + tenant-credits + usage-ledger store — cursor-phase3
- [x] 3. record-credit-usage 编排 + usage-ingest.report-credits — cursor-phase3
- [x] 4. employee-model-gate creditReporting + agent-runner 挂钩 — cursor-phase3
- [x] 5. platform-plan-bundle / subscriptions.get / billing.dashboard 接入 — cursor-phase3
- [x] 6. 定价页 UI：Tier 勾选 + Policy + monthlyCredits 编辑 — cursor-phase3
