# Requirements Document

> 特性：**企业 AI 模型接入与统一治理（Enterprise AI Model Governance / BYOK）**
>
> 目标：平台为企业订阅提供基础模型；企业管理员可接入自有模型供应商与 API Key（BYOK）；平台模型与企业模型进入统一授权、路由、预算、健康检查与审计；员工运行 AI 任务时只能使用当前租户、当前席位实际有效的模型；凭证与调用数据严格租户隔离。

## Glossary

| 术语                                  | 定义                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **EnterpriseModelProviderConnection** | 租户级模型供应商连接（含 baseUrl、协议、credentialRef、健康状态）。                             |
| **EnterpriseModelAsset**              | 租户级模型资产（来源 `enterprise`，费用归属 `enterprise`）。                                    |
| **EnterpriseModelCeiling**            | 企业模型上界 = `SubscriptionModelSet ∪ ActiveTenantOwnedModelSet`。                             |
| **EffectiveModelSet**                 | 员工最终可用集合 = Ceiling ∩ SeatOrEmployeeGrant ∩ ActiveModelSet ∩ HealthyOrAllowedHealthSet。 |
| **BYOK**                              | Bring Your Own Key：企业自带供应商凭证与模型。                                                  |
| **runtimeModelId**                    | 租户隔离、稳定、可审计的运行时模型 ID；不得把敏感 tenant 信息暴露给上游。                       |
| **credentialRef**                     | 指向加密 vault 的引用；业务记录只存 ref，不存明文。                                             |

## Requirements

### R1 — 租户级连接与资产（非全局目录）

1. THE System SHALL NOT write enterprise BYOK models into global `models.providers` or the platform Resource Catalog as the source of truth.
2. THE System SHALL persist `EnterpriseModelProviderConnection` and `EnterpriseModelAsset` keyed by `tenantId`.
3. THE System SHALL keep platform subscription models projected from plan/catalog; SHALL NOT duplicate them as enterprise BYOK assets.

### R2 — 密钥安全

1. API Key plaintext SHALL only travel from enterprise-admin submit → trusted gateway.
2. Plaintext SHALL NOT appear in tenant config, ordinary JSON stores, logs, audit events, RPC responses, or UI state.
3. THE System SHALL reuse existing encrypted-local / enterprise credential vault patterns; SHALL NOT invent new crypto algorithms.
4. List/get APIs SHALL return credential status metadata only (never secrets).
5. Rotate SHALL follow: write new secret → verify → atomic switch → invalidate old.
6. Delete connection SHALL revoke/cleanup secret only after authorization and runtime dependency checks.

### R3 — 租户级 RPC

1. THE System SHALL expose tenant-scoped RPCs for provider connection CRUD/test/rotate/disable/delete and catalog list/discover/register/update/enable/disable.
2. `tenantId` SHALL be resolved via `requireEnterpriseScope` (or equivalent trusted context); clients MUST NOT forge other tenants.
3. Write operations SHALL require `enterprise-admin`.
4. `test` SHALL perform real protocol probes without normal inference cost, with structured error codes (invalid credential / network / timeout / rate limit / protocol mismatch / model unavailable).
5. Custom OpenAI-compatible providers SHALL support custom base URL and manual model IDs.
6. All write operations SHALL audit `tenantId`, actor, action, target, and result.

### R4 — Ceiling、授权与运行时

1. `enterprise-model-grant.grant` SHALL only accept `grantedModelIds ⊆ EnterpriseModelCeiling`.
2. Effective set SHALL enforce employee grant > seat grant; managed identity failure fail-closed; empty effective set hard deny.
3. Collaboration, cron, follow-up, CLI, employee chat, and bot-owned runs SHALL pass the same enterprise model gate.
4. BYOK invocation SHALL resolve credentialRef by trusted `tenantId`; tenant A MUST NOT use tenant B assets/secrets.
5. Runtime SHALL NOT mutate global `loadConfig()` to switch tenant models; SHALL pass explicit tenant context / tenant model runtime config.
6. Usage ledger SHALL record `modelId`, `source`, `billingOwner`, `tenantId`, `seatId`, and provider cost; enterprise BYOK cost SHALL NOT be mis-attributed as platform supplier cost.

### R5 — 企业 UI

1. System Settings → Integrations SHALL split into **AI Models** and **Message Channels**.
2. AI Models page SHALL show metrics, filters, model pool table, connection table, and an onboarding wizard.
3. Button actions SHALL call real RPCs (not only `loadOverview()`).
4. Connection status SHALL come from backend truth, not “config object exists”.
5. Model authorization UI SHALL use org member/seat selectors (no manual ID typing as primary path).
6. UI SHALL correctly parse object-form model configs; SHALL NOT use string `includes(providerId)` to associate providers and models.

### R6 — 迁移与兼容

1. THE System SHALL provide read-only migration analysis for global providers, resource catalog, and dangling entitlement/grants.
2. THE System SHALL NOT auto-assign global providers as a tenant’s BYOK assets without explicit confirmation / platform ownership rules.
3. Empty new stores SHALL NOT break existing platform and personal model paths.

### R7 — 测试与完成证据

1. THE System SHALL include focused tests covering create/verify/discover/register, admin gates, cross-tenant isolation, secret non-leakage, rotate, ceiling, grant rules, runtime paths, usage attribution, UI RPC wiring, object model parsing, platform regression, and dangling doctor checks.
2. Completion evidence SHALL include end-to-end platform and BYOK paths, denial cases, test results, and `pnpm tsgo` / `pnpm check` / `pnpm build` outcomes — not “page rendered”.
