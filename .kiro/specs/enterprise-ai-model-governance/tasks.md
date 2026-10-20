# Implementation Plan

> 关联：`.kiro/specs/enterprise-ai-model-governance/design.md`、`requirements.md`。
>
> 实施按绿色检查点拆分提交；每次提交用 `scripts/committer`，带 `Task: enterprise-ai-model-governance` 与 `Agent: cursor-enterprise-model-gov`。

## Agents

- cursor-enterprise-model-gov · role: owner · scope: 企业 AI 模型 BYOK 连接/资产/RPC/ceiling/运行时/用量标记/UI 拆分与向导 · paths: .kiro/specs/enterprise-ai-model-governance/**, src/gateway/enterprise-model/**, src/gateway/server-methods/enterprise-model-_.ts, src/gateway/server-methods/enterprise-model-_.test.ts, src/gateway/model-entitlement/effective-set.ts, src/gateway/model-entitlement/resolve-effective-model-set.ts, src/gateway/model-entitlement/employee-model-gate.ts, src/gateway/server-methods/model-entitlement-management.ts, src/gateway/method-scopes.ts, src/gateway/platform-auth/session-domain.ts, src/gateway/billing/usage-ledger-store.ts, src/gateway/package-entitlement/types.ts, ui/src/ui/capability/enterprise-model-_/\*\*, ui/src/ui/ports/enterprise/views/enterprise-ai-models_.ts, ui/src/ui/ports/enterprise/views/enterprise-message-channels\*.ts, ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts, ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts, ui/src/ui/ports/enterprise/render-actions.ts, ui/src/ui/views/model-authorization-section.ts, ui/src/ui/capability/model-authorization/\*\*, scripts/worktree-audit.ts · since: 2026-07-21

## Overview

分 6 个提交检查点交付闭环：store+RPC → ceiling/runtime → usage/audit/doctor → AI 模型 UI → 通道拆分 → 迁移/回归/文档。

## Tasks

### Phase 0：开工与规格（本阶段）

- [x] 0.1 核对 git status（干净）、验证 As-Is（design §0）、创建 requirements/design/tasks
  - — cursor-enterprise-model-gov
- [x] 0.2 Loom register + attribution 清洁后再改代码
  - — cursor-enterprise-model-gov

### Phase 1：Store + Vault + Provider/Catalog RPC

- [x] 1.1 类型与 store：connection / asset / vault / audit
  - 新建 `src/gateway/enterprise-model/`（types、connection-store、asset-store、credential-vault、audit、ids）
  - _Requirements: R1, R2_
- [x] 1.2 Probe：OpenAI-compatible 等轻量探测（模型列表/健康，无推理费用）
  - 结构化错误码
  - _Requirements: R3_
- [x] 1.3 RPC handlers + method-scopes + session-domain
  - `enterprise-model-provider.*` / `enterprise-model-catalog.*`
  - 测试：admin 门禁、跨租户隔离、密钥不泄露、轮换
  - _Requirements: R2, R3_
- [ ] 1.4 提交检查点 1（scripts/committer + attribution）

### Phase 2：Ceiling + 运行时解析

- [ ] 2.1 `resolveEnterpriseModelCeiling` + 扩展 `computeEffectiveModelSet` / `resolveEffectiveModelSet`
  - grant 校验改为 ⊆ Ceiling
  - _Requirements: R4_
- [ ] 2.2 `resolveTenantModelRuntimeConfig`：BYOK per-request credential/baseUrl（禁止全局 loadConfig 切换）
  - 接入 employee-model-gate / agent 调用链必要接缝
  - _Requirements: R4_
- [ ] 2.3 测试：ceiling 合并、grant 拒绝、跨租户、disabled/unhealthy、空集合 hard deny、平台路径回归
  - _Requirements: R4, R7_
- [ ] 2.4 提交检查点 2

### Phase 3：用量、审计、Doctor

- [ ] 3.1 UsageLedger 增加/填充 `source` + `billingOwner`（BYOK vs platform）
  - _Requirements: R4_
- [ ] 3.2 只读 migration analyze + doctor dangling entitlement/grant
  - _Requirements: R6, R7_
- [ ] 3.3 提交检查点 3

### Phase 4：企业 AI 模型 UI + 向导

- [ ] 4.1 typed UI client（capability/enterprise-model-\*）
- [ ] 4.2 AI 模型页：指标、筛选、模型池、连接表、向导；按钮真实 RPC
- [ ] 4.3 修复 object model 解析；移除 `includes(providerId)`
- [ ] 4.4 授权 UI：成员/席位选择器 + 批量授权摘要
  - _Requirements: R5, R7_
- [ ] 4.5 提交检查点 4

### Phase 5：消息通道页拆分

- [ ] 5.1 从集成大页拆出消息通道表面；导航入口更新
  - _Requirements: R5_
- [ ] 5.2 提交检查点 5

### Phase 6：迁移说明、门禁、完成证据

- [ ] 6.1 聚焦测试全绿；`pnpm tsgo` / `pnpm check` / `pnpm build`；无 INEFFECTIVE_DYNAMIC_IMPORT
- [ ] 6.2 完成报告：证据清单、变更文件、迁移说明、剩余风险
  - _Requirements: R6, R7_
- [ ] 6.3 提交检查点 6

### Phase 16：生产基线集成与切流（2026-07-25）

- [ ] 16.1 将企业模型治理最终修订移植到 `deploy/user-modeling-v92`
  - WIP：已完成 Loom 接管和第一个 store/RPC 检查点移植；共享树同时出现他任务未合并冲突 `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts`，按共享热文件规则暂停，待隔离工作树或原 owner 收口。 — codex-production-release
- [ ] 16.2 聚焦测试、`pnpm tsgo`、全量 UI/网关构建与 release-check 门禁 — codex-production-release
- [ ] 16.3 构建不可变镜像，验证 staging 与回滚镜像 — codex-production-release
- [ ] 16.4 生产切流，验证 health/ready、UI 产物、RPC、租户隔离与 BYOK 数据通路 — codex-production-release
