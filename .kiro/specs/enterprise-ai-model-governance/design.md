# Design Document

> 特性：企业 AI 模型接入与统一治理（Enterprise AI Model Governance / BYOK）
>
> 状态：实施中。本文先固化**已验证现状 + 缺口**，再给出目标领域模型与接缝；禁止在未读通现状前改代码。
>
> 关联：`.kiro/specs/model-entitlement-chain/`、`.kiro/specs/resource-catalog/`、`.kiro/specs/tenant-context-propagation/`、`.kiro/specs/cli-backend-onboarding/`。

## 0. 开工验证（As-Is，2026-07-21 代码核对）

### 0.1 声称现状核对

| #   | 声称                                          | 结论                          | 证据                                                                                                                                                                                                                   |
| --- | --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | 集成页按钮大多只 `loadOverview()`             | **部分确认**                  | `render-actions.ts` 的 `onRefresh`/`onRefreshIntegrations` → `loadOverview()`；`enterprise-access-control-surface.ts` 集成区按钮绑定上述 handler。例外：connector 身份/凭证与 `model-authorization-section` 有真实 RPC |
| B   | 通道/provider 统计来自全局                    | **确认**                      | `enterprise-read-model.ts`：`channelsSnapshot` + `configValue.models.providers`；`config.get({})` 未传 `tenantId`                                                                                                      |
| C   | 模型授权 RPC 有租户作用域与管理员检查         | **部分确认**                  | grant/revoke：`requireEnterpriseScope` + `isEnterpriseAdmin`；list 有租户作用域但**无** admin 门禁                                                                                                                     |
| D   | 运行时 = entitlement ∩ grant ∩ active catalog | **确认**（另有 tier profile） | `effective-set.ts`、`resolve-effective-model-set.ts`、`employee-model-gate.ts`                                                                                                                                         |
| E   | Resource Catalog 全局                         | **确认**                      | `models-catalog-store.ts` → `openbot-resource-model-catalog.json`                                                                                                                                                      |
| F   | tenant config 仅解析隔离                      | **部分确认**                  | `tenant-config.ts` 注释与 merge-patch；运行时仍单实例；企业 UI/gate 未接通 tenant `models.providers`                                                                                                                   |
| G   | UI 对象模型解析错误                           | **确认**                      | `enterprise-read-model.ts` 计数用 length，ID 只收 string → 「计数非零 / 未指定模型」                                                                                                                                   |
| H   | `includes(providerId)` 反模式                 | **确认**                      | `enterprise-access-control-surface.ts` 用 substring 关联                                                                                                                                                               |

### 0.2 当前数据流

```
企业集成 UI (占位)
  └─ loadOverview() → config.get({}) + channelsSnapshot（全局）
       └─ buildEnterprisePortReadModel() 展示「提供方/模型」假象

模型授权 UI
  └─ enterprise-model-grant.{list,grant,revoke}
       ├─ requireEnterpriseScope(tenant)
       ├─ entitlement store (tenant keyed)
       └─ seat/employee grant store
            校验：granted ⊆ entitlement.allowedModelIds（仅套餐投影，无 BYOK）

运行时 Gate
  └─ resolveEmployeeModelGate
       └─ resolveEffectiveModelSet
            = entitlement ∩ grant ∩ listEnabledResourceCatalogModelIds()
            （catalog = 平台全局；无租户 BYOK 资产）

凭证
  └─ LLM keys：全局 models.providers / auth-profiles
  └─ 企业数据连接器：connector-credential-store(metadata,tenant) + vault(密文)
       （可复用模式；尚未用于 LLM BYOK）
```

### 0.3 领域缺口

1. 无租户级 Provider Connection / Model Asset store。
2. 无 LLM BYOK vault（tenant 元数据 + credentialRef）。
3. Ceiling 不含 ActiveTenantOwnedModelSet；grant 只能 ⊆ 套餐 entitlement。
4. Catalog 全局，无法表达 per-tenant BYOK 上界。
5. 集成 UI 为壳；状态非后端真源。
6. 运行时无「按 tenantId 解析 BYOK credentialRef」路径；禁止用全局 `loadConfig()` 切换。
7. UsageLedger 缺 `source` / `billingOwner` 字段语义（BYOK vs platform）。
8. 无只读迁移 doctor（全局 provider / 悬空 entitlement/grant）。

## 1. 目标领域模型

### 1.1 EnterpriseModelProviderConnection

| 字段                                                 | 说明                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| tenantId, connectionId                               | 租户隔离主键                                                                                         |
| providerType, displayName                            | 如 openai / anthropic / openai-compatible                                                            |
| baseUrl, api/protocol                                | 自定义兼容端点                                                                                       |
| credentialRef                                        | vault 引用                                                                                           |
| status                                               | draft → credential*saved → verifying → verified → models_discovered → active / invalid*\* / disabled |
| healthStatus, lastVerifiedAt, lastVerificationResult | 探测结果                                                                                             |
| createdAt, updatedAt, disabledAt                     |                                                                                                      |

落盘：`CONFIG_DIR/openbot-enterprise-model-connections.json`（按 tenantId 分区）。

### 1.2 EnterpriseModelAsset

| 字段                                                        | 说明                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| tenantId, assetId, connectionId                             |                                                        |
| runtimeModelId                                              | 稳定、租户隔离、可审计；**不**把明文 tenant 泄露给上游 |
| upstreamModelId                                             | 供应商侧模型 ID                                        |
| displayName, source=`enterprise`, billingOwner=`enterprise` |                                                        |
| tier, capabilities, enabled, healthStatus                   |                                                        |
| contextWindow, cost metadata                                |                                                        |
| createdAt, updatedAt                                        |                                                        |

落盘：`CONFIG_DIR/openbot-enterprise-model-assets.json`。

**runtimeModelId 方案**：`ent/<connectionShort>/<upstreamCanonical>`，其中 `connectionShort` 为 connectionId 的稳定短散列（非原始 tenantId），保证跨租户同名 upstream 不冲突，且上游请求头/路径只带 `upstreamModelId`。

### 1.3 Ceiling 与 EffectiveSet

```
EnterpriseModelCeiling
  = SubscriptionModelSet          // 现有 entitlement.allowedModelIds（套餐投影）
  ∪ ActiveTenantOwnedModelSet     // enabled+healthy BYOK assets 的 runtimeModelId

EffectiveModelSet
  = EnterpriseModelCeiling
  ∩ SeatOrEmployeeGrant
  ∩ ActiveModelSet                // 平台 catalog enabled ∪ 租户 asset enabled
  ∩ HealthyOrAllowedHealthSet
```

实现策略：扩展 `computeEffectiveModelSet` 输入，增加 `tenantOwnedActiveModelIds`；将「catalog」语义升级为 `activeModelIds = platformCatalog ∪ tenantOwned`。grant 校验改为 `⊆ resolveEnterpriseModelCeiling(tenantId)`。

### 1.4 凭证

复用 `encrypted-local-store` 或仿 `connector-credential-vault`：

- metadata 在 connection store（tenant 过滤）
- 密文在独立 vault 文件 `openbot-enterprise-model-secrets.json`
- credentialId / secret id 建议：`emc/<tenantId>/<connectionId>`（tenant 在 id 内便于吊销；**响应脱敏**，不回传）

轮换：put new → test → 原子更新 credentialRef / generation → delete/invalidate old。

### 1.5 运行时租户解析（阻塞边界）

**禁止**：改全局 `loadConfig()` / 进程级变量切换租户模型。

**正确边界**：

1. Gate 已解析 `tenantId` → ceiling 含 BYOK runtimeModelIds。
2. 模型执行前：若 modelId 属于租户资产，则从 connection vault 取 key + baseUrl，构造 **per-request provider override**（显式参数传入 agent runner / model-auth），不写回全局 config。
3. 若架构无法安全注入 per-request override：在本 design 记录阻塞点，先实现解析层 API（`resolveTenantModelRuntimeConfig(tenantId, modelId)`），再最小改动调用点传参。

## 2. RPC 设计

### 2.1 Provider

| Method                                        | Scope           | Admin                                                                                           |
| --------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `enterprise-model-provider.list`              | enterprise read | 建议 admin（与 list grants 策略对齐：本期写路径严格 admin；list 限 enterprise domain + tenant） |
| `enterprise-model-provider.create`            | write           | admin                                                                                           |
| `enterprise-model-provider.update`            | write           | admin                                                                                           |
| `enterprise-model-provider.test`              | write           | admin                                                                                           |
| `enterprise-model-provider.rotate-credential` | write           | admin                                                                                           |
| `enterprise-model-provider.disable`           | write           | admin                                                                                           |
| `enterprise-model-provider.delete`            | write           | admin                                                                                           |

### 2.2 Catalog

| Method                                        | Scope | Admin  |
| --------------------------------------------- | ----- | ------ |
| `enterprise-model-catalog.list`               | read  | tenant |
| `enterprise-model-catalog.discover`           | write | admin  |
| `enterprise-model-catalog.register`           | write | admin  |
| `enterprise-model-catalog.update`             | write | admin  |
| `enterprise-model-catalog.enable` / `disable` | write | admin  |

结构化错误码：`ENTERPRISE_MODEL_*`（INVALID_CREDENTIAL / NETWORK_UNREACHABLE / TIMEOUT / RATE_LIMITED / PROTOCOL_MISMATCH / MODEL_UNAVAILABLE / DEPENDENCY_BLOCKED / FORBIDDEN / NOT_FOUND）。

注册：`method-scopes.ts` + `session-domain.ts`（enterprise）。

## 3. UI 信息架构

拆分「系统设置 > 集成」：

1. **AI 模型** — 指标 / 筛选 / 模型池 / 连接表 / 接入向导 / 授权选择器
2. **消息通道** — 原通道配置与统计（继续可先读全局 channels，通道租户化不在本期强制）

向导步骤：选提供方 → 配 baseUrl/协议/凭证 → 测试 → 发现或手工登记 → Tier/能力/预算/初始授权 → 启用。

## 4. 迁移（只读）

Doctor / RPC `enterprise-model-migration.analyze`：

- 扫描全局 `config.models.providers`
- 扫描平台 Resource Catalog
- 报告 entitlement/grant 悬空 modelId
- 报告 provider 已配置但未进 active catalog 的模型
- **不**自动归属到某企业

## 5. 文件落点

| 路径                                                                      | 职责                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/gateway/enterprise-model/*`                                          | types、connection-store、asset-store、vault、ceiling、probe、audit、migration-analyze、runtime-resolve |
| `src/gateway/server-methods/enterprise-model-provider.ts`                 | provider RPC                                                                                           |
| `src/gateway/server-methods/enterprise-model-catalog.ts`                  | catalog RPC                                                                                            |
| `src/gateway/model-entitlement/effective-set.ts` 等                       | ceiling 接入（接管修改）                                                                               |
| `ui/src/ui/capability/enterprise-model-*`                                 | typed client                                                                                           |
| `ui/src/ui/ports/enterprise/views/enterprise-ai-models-surface.ts`        | AI 模型页                                                                                              |
| `ui/src/ui/ports/enterprise/views/enterprise-message-channels-surface.ts` | 通道页拆分                                                                                             |

## 6. 归属与 Loom

- Spec：`enterprise-ai-model-governance`
- Agent：`cursor-enterprise-model-gov`
- 新路径为主；对 `src/gateway/model-entitlement/**` 中 ceiling/grant 接缝文件与相关 UI 做 **verify-then-take**（工作树干净，无他方 WIP）。
- 共享热文件 `method-scopes.ts` / `session-domain.ts`：只追加本任务方法，提交前后跑 attribution。

## 7. 非目标（本期）

- 通道（消息）完整租户运行时实例化
- 自动把全局 provider 迁成某企业 BYOK
- 支付/扣费规则重写（仅正确标记 billingOwner / source）
- 新加密算法 / 外部 KMS 必选
