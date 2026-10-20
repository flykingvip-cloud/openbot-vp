# OpenBot Commercial Runtime Wave 3+ — 产品化加固 Handoff

Date: 2026-06-23

Status: **Delivered** — Governance Wave 3 + Rollout / No-bypass / 前台收口（首版）

Prerequisite: P0–P4 Commercial Runtime 主线已通（见 `openbot-commercial-runtime-p*-handoff-*.md`）

总方案：`docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md` §Phase 4、§G8、§G10

---

## 四路任务地图

| 轨道                      | 目标                            | Wave 3 交付                                                             |
| ------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| **A. Governance**         | 审批 / 审计 / 合规 / 私有模型   | `resolve-enterprise-ai-governance` 接 enterprise-data 审批 + 审计覆盖率 |
| **B. Credits v2 Rollout** | 灰度 / 校准 / 偏差监控          | `credits-v2-rollout.ts` + `credits-v2-calibration.ts` + dashboard drift |
| **C. No-bypass**          | 全入口 `authorizeCommercialRun` | `commercial-run-entrypoints.registry.ts` + audit 脚本 + 回归测试        |
| **D. 前台语义**           | 去模型化价值口径                | i18n + 治理面板文案                                                     |

---

## A. Governance Wave 3

### 后端

- `resolve-pending-governance-approvals.ts` — 读 `governance-approval-store` pending 计数
- `resolve-commercial-audit-coverage.ts` — ledger `authorizationDecisionId` 覆盖率
- `resolve-enterprise-ai-governance.ts` — 汇总 `complianceStatus` / `complianceIssues` / `privateModelStatus`

### 验收

- `pendingApprovalsCount` 非占位 0（有 pending 时 > 0）
- dashboard `aiGovernance.auditCoverageRatio` 可用
- 治理面板展示待审批与合规问题

---

## B. Credits v2 Rollout

### 环境变量

| 变量                                    | 含义                                      |
| --------------------------------------- | ----------------------------------------- |
| `OPENBOT_CREDITS_V2_ROLLOUT`            | `off` \| `canary` \| `full`（默认 `off`） |
| `OPENBOT_CREDITS_V2_CANARY_ENTERPRISES` | canary 租户 ID 列表（逗号分隔）           |

租户 `features.creditsV2Enabled=true` 且 rollout 阶段允许时，才走 v2 计价。

### 校准与偏差

- `credits-v2-calibration.ts` — 对 ledger 行回放 v1/v2 价差分布
- `resolve-commercial-runtime-drift.ts` — 对账偏差 + v2 占比 + 校准摘要（dashboard `commercialRuntimeDrift`）

Runbook：`docs/design/openbot-credits-v2-rollout-runbook-2026-06-23.md`

---

## C. No-bypass Audit

- 真源注册表：`commercial-run-entrypoints.registry.ts`
- CI/本地：`scripts/audit-commercial-run-entrypoints.ts`
- 回归：`commercial-run-entrypoints-audit.test.ts`

---

## D. 前台语义

企业端默认口径：

- Credits → **AI 工作额度**
- Bot → **AI 员工**
- Concurrency → **AI 同时工作能力**
- Seat → **团队成员** / 席位

---

## 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/resolve-enterprise-ai-governance.test.ts \
  src/gateway/billing/credits-v2-rollout.test.ts \
  src/gateway/billing/credits-v2-calibration.test.ts \
  src/gateway/billing/commercial-run-entrypoints-audit.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

bun scripts/audit-commercial-run-entrypoints.ts
pnpm build
```

---

## 后续（未纳入本波）

- ownerSeatId / visibility 全链 E2E（Bot 共享 / 交接 / 审计）
- Chat / Workflow / API 等新增入口持续登记 no-bypass 注册表
- legacy 配置入口全面清理（settings 子面板残余 Bot/Credits 文案）
- 审批流 UI 操作闭环（当前为计数 + 合规投影，非完整审批工作台）
