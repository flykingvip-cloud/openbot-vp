# OpenBot Commercial Runtime Wave 6 Handoff

Date: 2026-06-23

Status: **Delivered**

Prerequisite: Wave 5（`openbot-commercial-runtime-wave5-handoff-2026-06-23.md`）

---

## 交付摘要

| 轨道                    | 交付                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| **治理审批内联**        | Dashboard `aiGovernance.recentPendingApprovals` + 成本总览 / 待审批面板行内批准·拒绝             |
| **Supervisor 租户容量** | `tenant-commercial-capacity.ts` 聚合在途监督任务 + agent-run 并发；`supervisor.task.create` 闸口 |
| **Workflow 入口登记**   | 注册表新增 `supervisor_task_create` / `supervisor_tenant_capacity`（11 entries）                 |

---

## 后端

- `resolve-pending-governance-approvals.ts` — `recentPending`（最多 5 条）
- `resolve-enterprise-ai-governance.ts` — `recentPendingApprovals` 投影
- `tenant-commercial-capacity.ts` — `resolveSupervisorTenantCommercialCapacity`
- `commercial-run-gate.ts` — `assertSupervisorTenantCommercialCapacity`
- `server-methods/supervisor.ts` — `supervisor.task.create` 创建前租户容量校验

---

## 前台

- `overview-governance-panel.ts` — 待审批列表内联批准/拒绝（需 gateway 连接）
- `overview-page.ts` — 接入 `decideGovernanceApproval` + `onRefresh`
- `pending-approval-panel.ts` — 可选 `onDecideApproval` 快捷操作
- `enterprise-data-governance-center-surface.ts` — 首页待审批面板内联决策 + 局部刷新
- `home-controller.ts` — `reloadDataCapabilityPendingApprovals`

---

## No-bypass 注册表（新增）

- `supervisor_task_create` — `server-methods/supervisor.ts`
- `supervisor_tenant_capacity` — `tenant-commercial-capacity.ts`

---

## 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/supervisor/tenant-commercial-capacity.test.ts \
  src/gateway/billing/commercial-runtime-wave5.integration.test.ts \
  src/gateway/billing/commercial-run-entrypoints-audit.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts \
  ui/src/ui/views/enterprise-data-capability/panels.browser.test.ts

bun scripts/audit-commercial-run-entrypoints.ts
pnpm build
```

---

## 后续

- 审批内联操作的角色/权限门控（仅 admin 可见按钮）
- Supervisor 租户级 `spentCostUsd` 与套餐预算硬顶联动
- Engine dispatch 前二次容量校验（planned → dispatched 过渡）
