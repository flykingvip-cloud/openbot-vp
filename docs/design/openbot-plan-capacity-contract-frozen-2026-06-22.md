# 套餐 Capacity Contract 冻结表（Phase 0）

Date: 2026-06-22

Status: **Draft — 与 `scripts/seed-platform-plan-templates.ts` 对齐前为设计真源**

Related: `openbot-enterprise-ai-workforce-pricing-execution-breakdown-2026-06-22.md` §3

---

## 1. 用途

- 企业端 `plan-capacity-display.ts` 在 **无 EntitlementSnapshot** 时的 fallback
- 运营 / QA 验收五档数值的唯一参照
- Phase 0 完成后应同步更新 seed 脚本与 staging bundle

## 2. 五档数值（设计真源）

| 档位         | 团队成员 (Seats 合计) | AI 员工 (Bots) | 同时运行 (Concurrent) | Credits/月 | Tier      | Policy           |
| ------------ | --------------------- | -------------- | --------------------- | ---------- | --------- | ---------------- |
| Trial        | 3                     | 5              | 2                     | 500        | A         | Balanced         |
| Starter      | 10                    | 30             | 10                    | 5,000      | A+B       | Balanced         |
| Professional | 30                    | 120            | 40                    | 30,000     | A+B       | Balanced/Quality |
| Business     | 100                   | 500            | 150                   | 150,000    | A+B+C     | Quality/Bandit   |
| Enterprise   | —                     | —              | —                     | Budget     | 全 + BYOM | 定制             |

> **团队成员 / AI 员工**：运行时以 `Plan.seatQuota` / `Plan.botQuota` 为准；本表为未下发 Plan 时的 fallback。  
> **Concurrent / Credits**：运行时以 `EntitlementSnapshot` 为准；无 snapshot 时用本表或 `defaultMaxConcurrentRuns(botQuota)`。

## 3. 展示分层

| 层      | 字段来源                                  | 用户可见   |
| ------- | ----------------------------------------- | ---------- |
| L1 KPI  | maxSeats 合计、maxBots、maxConcurrentRuns | 卡片主视觉 |
| L2 能力 | `features.*`（仅 true）                   | bullet     |
| L3 技术 | allowedTiers、allowedPolicies             | 默认折叠   |

## 4. 与 seed 脚本差异（待 Phase 0 对齐）

当前 `scripts/seed-platform-plan-templates.ts` 中 Starter/Professional 的 botQuota、credits 与本表不一致。  
**Phase 0 验收**：staging 五档 snapshot 与本表一致，或 UI 明确标注「以 entitlement 为准」且 RPC 已下发。

## 5. 代码锚点

- 冻结常量（UI fallback）：`ui/src/ui/views/cost-budget/plan-capacity-contract.ts`
- 展示投影：`ui/src/ui/views/cost-budget/plan-capacity-display.ts`
- Entitlement 真源：`src/gateway/package-entitlement/types.ts`
