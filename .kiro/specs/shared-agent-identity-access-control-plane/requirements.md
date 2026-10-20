# Requirements Document: Shared Agent Identity and Access Control Plane

Status: **Active for non-production Phase -1 implementation**

Production gate: **BLOCKED**

Source review: `docs/design/agent-growth-cloud-multitenant-architecture-review-2026-07-30.md`

## Introduction

本规格建立平台级 active membership、权威企业会话上下文、canonical Agent 身份和统一访问控制契约。它是 Growth、Billing、Agent 创建与 entitlement 的共享安全前置，不是 Growth 私有身份层。

用户于 2026-07-30 指示开始实施。本授权只覆盖本地、可回滚的 Phase -1；不代表专家签署，不批准 PostgreSQL、云资源、多 Gateway 写实例或生产迁移。

## Scope

本规格负责：

- active membership 的选择、持久化、验证、切换和撤销语义。
- 服务端权威 `membershipId + enterpriseId` 会话绑定。
- `AgentAccessContext` 的统一主体和企业边界。
- `AgentAsset` 术语 ADR、Registry、alias 和 legacy resolver 契约。
- 一期 `membership-owned` 与 `seat-owned` ownership。
- 统一 ACL extension/replacement 决策、service principal 和审计。
- Billing、Agent create、entitlement、Growth 的企业上下文迁移。

本规格不负责：

- Growth 算法、投影或 observation 业务语义。
- PostgreSQL Growth schema、RLS、outbox 或迁移。
- 多 Gateway 写实例。
- `team-owned` 或 `enterprise-owned` Agent。
- 独立 Growth 微服务。

## Glossary

- **Platform user**：平台级人身份，可加入多个 enterprise。
- **Membership**：platform user 在一个 enterprise 内的授权主体。
- **Active membership**：一次 enterprise/employee 会话明确绑定且持续验证的 membership。
- **Session binding**：持久化在服务端 session record 中的 `membershipId + enterpriseId`。
- **AgentAsset**：暂定的稳定 canonical Agent 业务资产身份，等待 ADR 最终冻结。
- **AgentAccessContext**：服务端从已验证 session 或 service principal 构造的访问上下文。
- **Route intent**：URL、header 或 RPC 中的 tenant 值，只表达路由意图，不是授权事实。

## Requirements

### Requirement 1: Active membership selection

**User Story:** 作为加入多个企业的平台用户，我希望明确选择当前企业，以免系统使用任意一条 membership。

#### Acceptance Criteria

1. WHEN enterprise/employee 会话被创建 THEN 系统 SHALL 明确解析一个 active membership。
2. WHEN 用户拥有多条 membership 且请求未携带可验证选择 THEN 系统 SHALL fail closed，不得选择第一条。
3. WHEN 用户只有一条 membership 且迁移 legacy session THEN 系统 MAY 进行唯一性升级，但必须验证 user 和 enterprise 绑定。
4. URL、header、RPC tenant SHALL 只作为 route intent，并与 active membership 的 enterprise 一致。
5. 平台域 session MAY 不绑定 membership；其企业操作必须走显式 delegation 或重新建立 enterprise-scoped session。

### Requirement 2: Authoritative session binding

**User Story:** 作为安全管理员，我希望企业上下文持久化在服务端 session 中，而不是每次按用户枚举 membership。

#### Acceptance Criteria

1. `PlatformAuthSessionRecord` SHALL 保存 enterprise/employee 会话的 `membershipId + enterpriseId`。
2. session 读取 SHALL 验证 membership 存在、属于 session user 且 enterprise 一致。
3. 新代码 SHALL NOT 使用 `findMembershipByUserId` 推导当前 enterprise。
4. 无效 binding SHALL 使 enterprise-scoped 身份解析失败，不得回退到另一条 membership。
5. 日志和错误 SHALL 不暴露其他 enterprise 或 membership 的存在性。

### Requirement 3: Revocation and lifecycle validation

**User Story:** 作为企业管理员，我希望 membership 被撤销后相关会话立即失去企业权限。

#### Acceptance Criteria

1. 每次从 session 构造 enterprise context 时 SHALL 重新验证 membership 当前仍存在且有效。
2. membership 删除、撤销或 enterprise 冻结 SHALL 拒绝后续 enterprise-scoped 请求。
3. 切换 active membership SHALL 产生新的权威 binding 和安全审计，不得在客户端本地改 tenant。
4. 旧 binding 不得被其他同 user membership 自动替代。

### Requirement 4: Authoritative gateway context

**User Story:** 作为下游业务模块，我希望直接消费已验证的 membership 和 enterprise，而不是重复解析 email。

#### Acceptance Criteria

1. `GatewayClient` SHALL 区分权威 `sessionMembershipId/sessionEnterpriseId` 与非权威 `sessionTenantId` hint。
2. WebSocket client context SHALL 只从已验证 platform session context 写入权威字段。
3. 共享 resolver SHALL 构造 membership actor 或 service-principal actor 的 `AgentAccessContext`。
4. 下游 SHALL NOT 接受客户端构造的 `AgentAccessContext`。
5. 未授权和不存在 Agent SHALL 使用一致的非泄漏响应语义。

### Requirement 5: Billing as the first consumer

**User Story:** 作为企业用户，我希望 Billing 只按当前 active membership 计算企业作用域。

#### Acceptance Criteria

1. platform-auth 启用且 client 带权威 binding 时，Billing SHALL 使用该 binding。
2. requested tenant 与权威 enterprise 不一致时，Billing SHALL fail closed。
3. platform-auth 启用但只有 email、没有权威 binding 时，多 membership 用户 SHALL fail closed。
4. legacy 单 membership 会话 MAY 在受控兼容期唯一解析；不得使用 first-match。
5. 无平台会话的本地单运营者 fallback SHALL 保持独立且受现有本地部署边界约束。

### Requirement 6: Compatibility and migration

**User Story:** 作为本地部署运维，我希望安全收紧不破坏无平台会话的单运营者模式。

#### Acceptance Criteria

1. store normalization SHALL 接受缺少新字段的 legacy session record。
2. legacy record 只有唯一 membership 时 MAY 升级；零条或多条时 SHALL fail closed。
3. `auth.mode=none` 且无 platform session 的本地行为 SHALL 保持不变。
4. `auth.mode=token` 与 device token 的身份冲突在独立决策前 SHALL 不被本切片改变。
5. rollout SHALL 提供命中 legacy fallback、ambiguous session 和 tenant mismatch 的指标。

### Requirement 7: Agent identity and ownership ADR

**User Story:** 作为平台架构师，我希望 Agent 术语与 owner 语义在建表前冻结。

#### Acceptance Criteria

1. ADR SHALL 区分 `AgentDefinition`、`AgentAsset`、`AgentDeployment`、`AgentSnapshot/AgentRevision`。
2. ADR SHALL 决定既有 `AgentInstance` 保留还是迁移。
3. Growth boundary SHALL 使用 `(enterpriseId, agentAssetId)`，不得使用裸 legacy `agentId`。
4. 一期 owner SHALL 只支持 membership 和 seat。
5. legacy resolver 无法唯一映射时 SHALL quarantine，不得猜测。

### Requirement 8: Unified access policy

**User Story:** 作为平台安全负责人，我希望 Growth 复用统一 ACL，而不是新增平行授权系统。

#### Acceptance Criteria

1. 设计 SHALL 明确扩展还是替换现有 `EnterpriseAccessPolicy`。
2. 一期 subject SHALL 覆盖 membership、seat 和 service principal。
3. permission SHALL 区分读取、执行、写 observation、修正、repair、管理、聚合和导出。
4. policy SHALL 支持 allow/deny、条件、审计和兼容迁移。
5. `onBehalfOfMembershipId` SHALL 只能收窄权限，不能扩大 service principal 权限。

## Phase -1 exit criteria

- 多 enterprise 用户不会被 first-membership 推导到错误企业。
- tenant/owner 参数篡改被拒绝。
- membership 撤销使相关请求失效。
- Billing、Agent create、entitlement 和 Growth 有统一迁移计划。
- 共享控制面成为跨实例权威前，PostgreSQL Growth 保持关闭。
