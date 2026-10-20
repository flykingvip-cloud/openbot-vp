# Platform Tenant Management IA

## Agents

- cursor-tenant-ia · role: owner · scope: 平台端租户管理两级 IA/UI 重构（统一列表含试用申请、真实管理员激活状态、详情页分区、筛选排序、浏览器测试） · paths: ui/src/ui/ports/platform/tenants/**, ui/src/styles/components.css, ui/src/ui/ports/port-shells.browser.test.ts, src/gateway/control-ui-contract.ts, src/gateway/platform-auth/session-context.ts, ui/src/ui/controllers/control-ui-bootstrap.ts, .kiro/specs/platform-tenant-management-ia/** · since: 2026-07-21

## Status

- [x] 统一列表对象建模（租户 + 试用申请，去重） — cursor-tenant-ia
- [x] 列表列 / 筛选 / 排序 / 轻量待办入口 — cursor-tenant-ia
- [x] 详情页 IA（身份区、需要处理、一级页签、申请详情） — cursor-tenant-ia
- [x] 真实管理员激活状态（pendingAdminActivations，禁止 seatUsed 推断） — cursor-tenant-ia
- [x] 不向前端暴露激活码 latestDisplayCode — cursor-tenant-ia
- [x] 激活状态文案区分过期 / 撤销 / 无码 / 临期 — cursor-tenant-ia
- [x] buildPlatformPendingAdminActivationsView 单元测试 — cursor-tenant-ia
- [x] 更新时间使用真实 updatedAt，不用 trialEndsAt 冒充 — cursor-tenant-ia
- [x] 移除伪「导出日志」操作 — cursor-tenant-ia
- [x] CSS 布局与视觉收敛 — cursor-tenant-ia
- [x] 浏览器测试与验收 — cursor-tenant-ia
- [x] 集成到 fix-scoped-package-templates — cursor-tenant-ia
