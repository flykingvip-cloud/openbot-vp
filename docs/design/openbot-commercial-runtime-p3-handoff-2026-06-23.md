# OpenBot Commercial Runtime P3 - Cursor 实施说明

Date: 2026-06-23

Audience: Cursor 执行者

Status: **Done** — P3（Credits v2 ADR §Migration P3+）

Prerequisite:

- P0 + P1 + P2 已落地（见 `openbot-commercial-runtime-p1-handoff-2026-06-23.md`、`openbot-commercial-runtime-p2-handoff-2026-06-23.md`）

Primary design source:

- `docs/design/openbot-credits-v2-adr-2026-06-23.md` §Migration P3+
- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`

---

## 1. P3 目标

在 P2 Wave 2（`pricingEngine` ledger 字段 + 开关）基础上，补齐 **观测与对账分列**：

| 项                 | 说明                                                         |
| ------------------ | ------------------------------------------------------------ |
| Economics 引擎分列 | 平台 / 企业 economics 投影按 `v1` / `v2` 分列 Credits 与毛利 |
| 对账 v1/v2 分列    | `billing-reconciliation` + dashboard 展示 ledger 分引擎消耗  |
| Ledger 明细        | `platform-economics.ledger` 返回 `pricingEngine` 供 UI 标注  |

**非目标：**

- 全量切换租户到 Credits v2
- toolFactor / runtimeFactor 非 stub 实现（留 P4）
- 审批流 workflow（P2 governance 占位延续）

---

## 2. 交付物

### 2.1 后端

| 模块           | 路径                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| 按引擎聚合     | `src/gateway/economics/aggregate-by-pricing-engine.ts`                      |
| 对账分列       | `src/gateway/billing/billing-reconciliation.ts`                             |
| 企业 economics | `src/gateway/billing/record-credit-usage.ts` → `resolveEnterpriseEconomics` |
| 平台 economics | `src/gateway/server-methods/platform-economics.ts`                          |

### 2.2 前端

| 模块               | 路径                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| 类型               | `ui/src/ui/capability/cost-economics/endpoints.ts`、`cost-budget-billing/endpoints.ts` |
| 企业治理对账       | `ui/.../overview-governance-panel.ts`                                                  |
| 平台 Economics KPI | `ui/.../pricing/economics-section.ts`                                                  |

---

## 3. 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/economics/aggregate-by-pricing-engine.test.ts \
  src/gateway/billing/billing-reconciliation.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

pnpm build
```

---

## 4. 完成标准

- [x] `reconcileEnterpriseCredits` 返回 `ledgerCreditsV1` / `ledgerCreditsV2`
- [x] `billing.dashboard.economics.byPricingEngine` 与 `platform-economics.overview.byPricingEngine` 可用
- [x] 总览治理面板展示 v1/v2 对账分列（`data-testid="cost-budget-governance-pricing-engine"`)
- [x] 平台 Economics 子页展示计价引擎 KPI
- [x] `pnpm build` 全绿，无 `[INEFFECTIVE_DYNAMIC_IMPORT]`
