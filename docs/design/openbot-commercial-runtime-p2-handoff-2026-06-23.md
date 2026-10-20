# OpenBot Commercial Runtime P2 - Cursor 实施说明

Date: 2026-06-23

Audience: Cursor 执行者

Status: Active handoff — 授权实施 **P2**（billing-plan Phase 4）

Primary design source:

- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`
- `docs/design/openbot-credits-v2-adr-2026-06-23.md`

Prerequisite:

- P0 + P1 已落地（见 `openbot-commercial-runtime-p1-handoff-2026-06-23.md`）

---

## 1. P2 目标

在 P1 基座上补齐 billing-plan **Phase 4** 与 P1 遗留项：

| 项                       | 说明                                                          |
| ------------------------ | ------------------------------------------------------------- |
| Concurrency `queue`      | `ConcurrencyPolicy.mode=queue` 时 FIFO 等待槽位，而非立即拒绝 |
| Budget Forecast Card     | 企业总览主卡片：月底预测、Credits ETA、并发/Bot 风险          |
| Credits v2 ADR           | 独立开关 + 迁移路径；**不**在本阶段全量切换计价               |
| Enterprise AI Governance | 审计/审批/合规增强（Wave 2，见 §3）                           |

**非目标（仍禁止）：**

- Commerce / order / proration 重构
- 全量替换现有 tier 固定扣点为 Credits v2 公式
- 新建 `Package` 替换 `Plan`

---

## 2. Wave 1 交付物（当前迭代）

### 2.1 后端 — Concurrency Queue

| 模块          | 路径                                                        |
| ------------- | ----------------------------------------------------------- |
| FIFO 等待队列 | `src/gateway/billing/agent-run-queue.ts`                    |
| 闸口接线      | `src/gateway/billing/authorize-commercial-run.ts`           |
| 集成测试      | `src/gateway/billing/p2-runtime-wiring.integration.test.ts` |

行为：

- `mode=block`：维持 P1 行为（硬拒绝）
- `mode=pay_as_you_go`：维持无限 burst
- `mode=queue`：租户级并发满时入队；`finishAgentRun` 释放后队首可获槽
- 席位级 `SEAT_CONCURRENCY_LIMIT_EXCEEDED` **不入队**（立即拒绝）
- 默认最大等待 `OPENBOT_COMMERCIAL_RUN_QUEUE_MAX_WAIT_MS`（缺省 120000）

### 2.2 前端 — Budget Forecast Card

| 模块       | 路径                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 主卡片     | `ui/src/ui/views/cost-budget-v2/panels/overview-budget-forecast-panel.ts` |
| 总览接线   | `ui/src/ui/views/cost-budget-v2/pages/overview-page.ts`                   |
| 浏览器测试 | `overview-page.browser.test.ts`                                           |

数据源：`operations-store` 的 `dashboard` + `forecast` + `budget`（与 `consumption-forecast.get` 同引擎）。

---

## 3. Wave 2（当前）

1. Credits v2 运行时开关（`features.creditsV2Enabled`）+ `resolveCommercialCreditCost()` 门面 + ledger `pricingEngine`
2. `authorizeCommercialRun` 与 `employee-model-gate` 双层 profile 校验收口（`resolveSeatEntitlementProfileForSeat`）
3. Enterprise AI Governance：`resolveEnterpriseAIGovernanceProjection` + dashboard `aiGovernance` + 总览治理面板

---

## 4. 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/agent-run-queue.test.ts \
  src/gateway/billing/p2-runtime-wiring.integration.test.ts \
  src/gateway/billing/p2-wave2-runtime-wiring.integration.test.ts \
  src/gateway/billing/resolve-commercial-credit-cost.test.ts \
  src/gateway/billing/resolve-seat-entitlement-profile-for-seat.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-page.browser.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

pnpm build
```

---

## 5. 完成标准

- [x] `queue` 模式：第二 run 在槽位释放后自动获槽（测试覆盖）
- [x] 总览页展示 `data-testid="cost-budget-forecast-panel"`
- [x] Credits v2 ADR 已落盘且与 P1 token-weight 桥接关系写清
- [x] Credits v2 开关 + `resolveCommercialCreditCost` + ledger `pricingEngine`
- [x] 双层 profile 校验 + `aiGovernance` dashboard 投影
- [x] `pnpm build` 全绿
