# OpenBot Commercial Runtime P4 - Cursor 实施说明

Date: 2026-06-23

Audience: Cursor 执行者

Status: **Done** — P4（Credits v2 tool/runtime factors）

Prerequisite:

- P0–P3 已落地（见 `openbot-commercial-runtime-p*-handoff-2026-06-23.md`）

Primary design source:

- `docs/design/openbot-credits-v2-adr-2026-06-23.md`
- `docs/design/openbot-commercial-runtime-p3-handoff-2026-06-23.md` §非目标（P4 回收）

---

## 1. P4 目标

将 Credits v2 公式中 **stub 恒为 1** 的 `toolFactor` / `runtimeFactor` 替换为可解释、可测试的乘子，并贯通采集链路：

| 项            | 说明                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| Factor 纯函数 | `credits-v2-factors.ts`：benchmark + 0.25x–4x 钳制（与 token 因子一致）  |
| 门面接线      | `resolveCommercialCreditCost` 传入 tool/runtime 信号 + tier benchmark    |
| 采集          | `recordCreditUsage` / `usage-ingest.report-credits` / agent run 结束路径 |
| Ledger 审计   | 可选写入 `toolCallCount` / `durationMs` / `retryCount`                   |

**非目标：**

- 全量租户切换 Credits v2
- 审批流 workflow
- 按 tool class 动态改价目录（仅静态重工具加权）

---

## 2. 交付物

| 模块         | 路径                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| v2 乘子      | `src/gateway/billing/credits-v2-factors.ts`                                   |
| 门面         | `src/gateway/billing/resolve-commercial-credit-cost.ts`                       |
| 记录         | `src/gateway/billing/record-credit-usage.ts`                                  |
| ingest       | `src/gateway/server-methods/usage-ingest.ts`                                  |
| agent run    | `src/auto-reply/reply/agent-runner-execution.ts`、`agent-run-credit-usage.ts` |
| 类型         | `src/gateway/package-entitlement/types.ts`（ledger 可选维度）                 |
| 治理 UI 修复 | `overview-governance-panel.ts`（对齐租户也展示 v1/v2 分列）                   |

---

## 3. 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/credits-v2-factors.test.ts \
  src/gateway/billing/resolve-commercial-credit-cost.test.ts \
  src/auto-reply/reply/agent-run-credit-usage.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

pnpm build
```

---

## 4. 完成标准

- [x] `toolFactor` / `runtimeFactor` 在 v2 路径下随输入变化（非恒 1）
- [x] v1 路径与缺省信号时行为与 P3 一致
- [x] agent run 成功路径传入 `durationMs` / `retryCount` / `toolCallCount`（`buildCommercialRunCreditUsageInput` 在赋值后快照）
- [x] 健康租户总览仍展示 `cost-budget-governance-pricing-engine`
- [x] `pnpm build` 全绿
