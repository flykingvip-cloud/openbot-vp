# OpenBot Commercial Runtime Wave 5 Handoff

Date: 2026-06-23

Status: **Delivered**

Prerequisite: Wave 4（`openbot-commercial-runtime-wave4-handoff-2026-06-23.md`）

---

## 交付摘要

| 轨道                      | 交付                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| **Supervisor / Workflow** | `commercial-run-gate.ts` + `worker-executor` 占槽/释放              |
| **CLI agent 全量闸口**    | `commands/agent/commercial-run-gate.ts` 接入 `agentCommandInternal` |
| **E2E 回归**              | 充值分桶 / 升级快照 / burst / v2 rollout 门控                       |
| **治理快捷操作**          | 成本总览内嵌审批分类 chips + `#approvals` 深链                      |

---

## No-bypass 注册表（新增）

- `supervisor_gateway_worker` — `worker-executor.ts`
- `supervisor_commercial_gate` — `supervisor/commercial-run-gate.ts`
- `cli_agent_command` — `agent.ts` + `commercial-run-gate.ts`（`acquireAgentCommandCommercialRun`）

---

## 验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/commercial-runtime-wave5.integration.test.ts \
  src/commands/agent/commercial-run-gate.test.ts \
  src/gateway/billing/commercial-run-entrypoints-audit.test.ts \
  ui/src/ui/views/cost-budget-v2/pages/overview-governance.browser.test.ts

bun scripts/audit-commercial-run-entrypoints.ts
pnpm build
```

---

## 后续

- Supervisor 引擎 batch 多 task 并行时的租户级预算聚合
- 治理审批面板内联 approve/reject（需 gateway 写权限上下文）
- Workflow 专用入口文件登记（若从 supervisor 外独立拆出）
