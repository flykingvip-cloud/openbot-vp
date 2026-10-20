# Enterprise Organization Monthly Usage

## Agents

- cursor-grok-org-usage · role: owner · scope: 组织页本月消耗与岗位多机器人用量聚合 · paths: .kiro/specs/enterprise-organization-monthly-usage/**, ui/src/ui/**, src/gateway/organization/\*\*, src/gateway/server-methods/enterprise-organization-monthly-usage.ts, src/gateway/server-methods.ts, src/gateway/method-scopes.ts · since: 2026-07-20

## Tasks

- [x] 1. 独立月度用量加载 — cursor-grok-org-usage
- [x] 2. 岗位完整 agentIds 聚合 — cursor-grok-org-usage
- [x] 3. 后端租户隔离 RPC — cursor-grok-org-usage
- [x] 4. 未加载/失败/无法归因不静默成 $0 — cursor-grok-org-usage
- [x] 5. 回归测试 — cursor-grok-org-usage

## Acceptance follow-up (2026-07-20)

- [x] Tenant session-dir isolation + cross-tenant same-name agent test
- [x] Month-window cache invalidation (startDate/endDate)
- [x] Organization refresh → loadEnterpriseTabShell(force) + monthly RPC
- [x] Seat mesh runtime aggregation across agentIds; runtimeStatus null does not block fallback
- [x] Port/cherry-pick onto `fix-scoped-package-templates`
