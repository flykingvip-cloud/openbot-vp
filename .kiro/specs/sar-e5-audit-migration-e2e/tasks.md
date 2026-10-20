# SAR E5 审计、迁移与端到端验收

## Agents

- cursor-sar-e5 · role: owner · scope: trace 关联、失败展示、停用开关与旧记录语义 · paths: docs/design/sar-e5-audit-migration-e2e-2026-10-17.md, .kiro/specs/sar-e5-audit-migration-e2e/tasks.md, src/gateway/enterprise-data/sar-audit-correlation.ts, src/gateway/enterprise-data/sar-failure-display.ts, src/gateway/enterprise-data/sar-execution-halt.ts, src/gateway/enterprise-data/sar-legacy-semantics.ts, src/gateway/enterprise-data/sar-e5-audit.test.ts, src/gateway/enterprise-data/data-gateway.ts, src/gateway/enterprise-data/sar-governance-bridge.ts, src/gateway/enterprise-data/types.ts, src/gateway/enterprise-data/store.ts · since: 2026-10-17

## Tasks

- [x] traceId 与 runId 可互查，关联记录不复制敏感全文 — cursor-sar-e5
- [x] 席位授权、审批和撤销对网站执行挡放 — cursor-sar-e5
- [x] 登录、基础设施、策略拒绝、结构变化、业务验证失败可区分 — cursor-sar-e5
- [x] 租户、能力、版本停用阻止新 run，且不虚报撤回副作用 — cursor-sar-e5
- [x] 旧记录缺字段不默认为已验证网站能力 — cursor-sar-e5
