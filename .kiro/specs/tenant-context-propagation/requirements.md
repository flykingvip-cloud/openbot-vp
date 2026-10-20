# Requirements Document

> 中文名：Gateway 租户上下文传播（Tenant-Context Propagation）— 共享 Gateway 逻辑隔离
> 状态：**实施中（P0–P4 主路径已签收；R7.2 路径 E2E 已绿；共享灰度待残余扫尾 + 真进程验收）**
> 前置：`docs/design/tenant-context-propagation-plan-2026-07-11.md`、`docs/design/openbot-saas-tenant-data-architecture.md`
> 未来（不在本 spec）：dedicated 专属实例拓扑见 `docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md`

## Introduction

本规格让运行中的 Gateway 在**请求期**按会话所属的**租户 / 用户**解析 L1 控制面与 L2 数据路径，使**一个 Gateway 进程可安全服务多个租户**（共享 Gateway，逻辑隔离）。当前运行时是「单租户」：`tenant-import` 能把数据**写进** `/data/tenants/<tid>/...`，但请求期读的是**单一** `data.root`，导入的租户数据喂不给会话。

本规格**只做共享 Gateway 的逻辑隔离**；专属实例（dedicated）拓扑是未来计划，不在此。**强约束**：对 local / 自托管用户**零行为变化**。

### 现状（带证据）

- `resolveDataRoot(cfg)` 只解析**单个** `data.root`，无 tenant/user 参数（`src/config/data-space.ts`）。
- per-tenant 解析器 `resolveTenantLiveRoot` / `resolveTenantsRoot` **只在** provision/import 路径使用（`src/gateway/server-methods/platform-tenant.ts`、`src/cli/program/register.platform.ts`），**无任何普通请求 handler** 使用（`src/gateway/tenant-store-paths.ts`）。
- `GatewayClient` 已带 `user` / `sessionDomain` / `sessionTenantId`（后者注释「trusted-proxy hint；非唯一权威」）（`src/gateway/server-methods/types.ts`）。身份链路已在，缺**权威推导 + 用于寻址**。
- 多数 store 已接受可选 `storePath?`（DI 就绪，如 `src/gateway/enterprise-seat-assets-store.ts`）；`loadTenantSeatAssetsStore`（K-07）即复用此形。
- L2 数据层 `resolveDataRoot(` 调用点约 15 处（`src/data/*`、`src/gateway/server-methods/data.ts`、`src/gateway/control-ui.ts` 等）。
- 状态目录 `CONFIG_DIR`（`~/.openbot`：凭证/会话/配置/部分 L1）调用点约 100 处——L0/L3 隔离范围更大、更晚（Requirement 9）。
- managed 模式已存在（`src/config/data-space.ts`）；`data.*` 系列 RPC 已 `LOCAL_ONLY` 拒绝（`src/gateway/server-methods/data.ts`）。

### 目标架构

```
连接/鉴权：会话 → 权威 TenantContext{tenantId,userId,domain}（不信任浏览器传入的 tenant hint）
    │
请求 handler：getTenantContext(client) → 寻址层 → store(storePath)
    │
寻址层 resolveDataRootForContext(ctx,cfg)：
    local（!managed）→ resolveDataRoot(cfg)                （零行为变化回退）
    managed + ctx    → /data/tenants/<tid>/users/<uid>/OpenBot （多租户逻辑隔离）
    managed + 无 ctx → 抛错（fail-closed，绝不回退全局）   （评审 高危1）
```

### 设计原则（强约束）

1. **身份权威（D1）**：`tenantId` **仅**由会话 user 的平台 membership（`platform-auth-slice` / `seat-assets`）解析，使用**专用 membership-only resolver**。**禁止复用 `resolveTrustedAttribution`**——其 workbench-actor 回退在缺 membership 时会采信 `client.sessionTenantId`（`src/gateway/employee-workbench-scope.ts`），使 hint 变成权威（评审 高危2）。`sessionTenantId` 仅**交叉校验**（不一致即拒绝）；membership 缺失即 **fail-closed**。**local/单运营者例外**：local 模式不经此权威（寻址层按 D2 回退全局），故本地即便无 membership 也不受影响。
2. **local 零变化 + managed fail-closed（D2）**：回退**仅**由数据模式决定——`!managed` 时 `resolveDataRootForContext` 逐字节等价 `resolveDataRoot(cfg)`（local 安全底线）；**managed 且缺 ctx 时抛错**，绝不回退全局（评审 高危1：把回退与「ctx 是否存在」挂钩会造成 fail-open）。
3. **单一寻址出口（D3）**：所有租户相关路径经寻址层；禁止 handler 直接用 `resolveDataRoot` / `CONFIG_DIR` 拼租户数据路径。
4. **分层激活 + 灰度（D4/D5）**：先 L1/L2（覆盖迁入数据）；多租户行为置于开关后，先单实例验证再放共享。
5. **可测隔离**：每层跨租户泄漏测试为硬门禁。

## Glossary

- **TenantContext**：每请求的权威三元组 `{ tenantId, userId, domain }`。
- **权威推导**：由会话 user → 成员关系解析 `tenantId`，非取自请求参数或 `sessionTenantId` hint。
- **寻址层**：`src/gateway/tenant-store-paths.ts` 扩展出的 `resolveDataRootForContext` 等，是租户路径的唯一出口。
- **L0/L1/L2/L3**：凭证密钥 / 控制面 / 每用户数据 / 运行时会话（对齐架构文档 §4）。
- **managed / local**：SaaS 托管 / 自托管（`data.mode`）。

## Requirements

### Requirement 1: 权威租户上下文

**User Story:** 作为平台，我希望每个请求都携带由会话权威解析的租户/用户上下文，以便寻址与鉴权不被浏览器伪造。

#### Acceptance Criteria

1. WHEN 一个 enterprise/employee 域会话发起请求 THEN 系统 SHALL 由会话 user 的成员关系解析出唯一 `tenantId`，并构造 `TenantContext{tenantId,userId,domain}`。
2. WHEN 请求携带的 `client.sessionTenantId` 与权威解析的 `tenantId` 不一致 THEN 系统 SHALL 拒绝该请求（不采信 hint）。
3. WHEN 会话为 platform 域 THEN 系统 SHALL NOT 赋予隐式 `tenantId`；跨租户操作 SHALL 经显式 `targetTenantId` 参数（如现有 `platform.tenant.*`）。
4. WHEN 无法解析会话所属租户（缺成员关系）THEN 系统 SHALL 拒绝租户数据访问，而非回退到任意/默认租户。

### Requirement 2: local 零行为变化回退契约

**User Story:** 作为自托管用户，我希望多租户改造对我完全无感，本地数据路径一如既往。

#### Acceptance Criteria

1. WHEN `data.mode !== "managed"`（local / 自托管）THEN `resolveDataRootForContext(ctx,cfg)` SHALL 返回与 `resolveDataRoot(cfg)` **逐字节一致**的路径（回退**仅**由数据模式决定，与 `ctx` 是否存在无关）。
2. WHEN 在 local 模式跑全量测试 THEN 系统行为 SHALL 与本规格实施前无差异（无回归）。
3. WHEN `data.mode === "managed"` 且 `TenantContext` 缺失 THEN `resolveDataRootForContext` SHALL **抛错（fail-closed）**，SHALL NOT 回退到全局 `resolveDataRoot(cfg)`（否则某 handler 漏解析 ctx 即静默跨租户读写 = 泄漏；评审 高危1）。

### Requirement 3: L1 控制面按租户解析

**User Story:** 作为平台，我希望共享进程内每个租户只读写自己的控制面切片。

#### Acceptance Criteria

1. WHEN managed 模式下解析**按租户分区的 L1 store**（`seat-assets` / `enterprise-data`）THEN 系统 SHALL 使用 `resolveTenantControlPlaneStorePath(ctx.tenantId, …)` 得到的路径。
2. IF 某 L1 store 尚不支持注入 `storePath` THEN 系统 SHALL 为其补充 DI（不重写 store 实现）。（`seat-assets` / `enterprise-data` 的 loader 已接受 `storePath?`，无需改实现。）
3. WHEN 租户 A 会话读取 L1 数据 THEN 系统 SHALL NOT 返回任何租户 B 的 L1 数据。
4. 本规格**按租户分区的 L1** = `seat-assets` + `enterprise-data`（→ `tenants/<tid>/control-plane/`）。**`platform-auth` 保持全局 authority store（Q-A 裁决）**：它是 login→tenant 的 membership 权威（P0 `resolveMembershipAuthority` 全局读它；若 per-tenant 会「先知 tenant 才能查 membership，而查 membership 正是为知 tenant」的 chicken-and-egg），`platform-auth-slice.json` 仅为 `tenant-import` **迁移物**、**不**作 shared runtime 权威读路径。`organization` **派生自**全局 `platform-auth` + per-tenant `seat-assets`，**无独立** per-tenant store。**其余平台全局 keyed store**（`src/gateway/tenant-config.ts`、`src/gateway/billing/tenant-credits-store.ts`、billing 账本）同理保持全局、按 `tenantId` 过滤，不进本规格（见 design §L1 范围）。

### Requirement 4: L2 每用户数据按 (租户, 用户) 解析

**User Story:** 作为员工，我希望在共享进程里只能触达自己租户下自己的数据空间。

#### Acceptance Criteria

1. WHEN managed 模式下解析 L2 数据（agents / knowledge / memory / conversations / access-grants / export 等 ~15 站点）THEN 系统 SHALL 以 `resolveDataRootForContext(ctx,cfg)` 派生路径。
2. WHEN 派生 agent workspace 等子路径 THEN 系统 SHALL 从 ctx 数据根派生（对齐架构文档 §8.1「由 data.root 派生」）。**注（评审 中高3）**：当前 `resolveAgentWorkspaceDir`（`src/agents/agent-scope.ts`）由 `resolveStateDir()` 驱动、且 session store（`src/gateway/session-utils.ts`）为全局，二者**均不走 data-space**；把它们改为按 ctx 派生是**独立设计决策 D7**（见 design），不是本条的小改。P2 若未落 D7，agent workspace / session 仍是共享面，本条只覆盖走 `resolveDataRoot` 的 L2 数据。
3. WHEN 员工会话访问 L2 THEN 系统 SHALL 仅解析到 `users/<ctx.userId>/` 子树。

### Requirement 5: 单一寻址出口

**User Story:** 作为维护者，我希望租户寻址集中一处，避免散落的直接拼路径成为隔离漏洞。

#### Acceptance Criteria

1. WHEN 任何 handler 需要租户数据路径 THEN 它 SHALL 经寻址层，SHALL NOT 直接调用 `resolveDataRoot(` 或用 `CONFIG_DIR` 拼租户数据路径。
2. WHEN CI 运行守卫扫描 THEN 系统 SHALL 标记（并阻断）：(a) 绕过寻址层的租户路径拼接（`resolveDataRoot(` / `CONFIG_DIR`）；**(b)（评审 中5）** request handler 直接调用**默认落到全局路径的 store loader**——即无租户参数的默认加载器（如 `src/gateway/enterprise-data/store.ts` 的 `loadStore()`、`src/gateway/server-methods/enterprise-data.ts`、`src/gateway/platform-auth/config.ts` 等直接命中全局路径的 loader）。抽象绕过与直接拼路径同等危险，守卫须同时覆盖。

### Requirement 6: 运行期路径守卫

**User Story:** 作为平台安全，我希望即便寻址出错，也不会把一个租户的请求落到另一个租户的目录。

#### Acceptance Criteria

1. WHEN managed 模式解析出任一租户数据路径 THEN 系统 SHALL 断言该路径落在 `resolveTenantLiveRoot(ctx.tenantId)` 之内（`isPathWithinRoot`），越界 SHALL 抛错而非静默读写。

### Requirement 7: 跨租户隔离可测（门禁）

**User Story:** 作为平台，我希望每个阶段都有自动化证明「租户 A 读不到租户 B」。

#### Acceptance Criteria

1. WHEN 每个实施阶段合入 THEN 系统 SHALL 附带跨租户泄漏测试（双租户会话，断言 A 读不到 B 的 L1/L2），且为该阶段合入的硬门禁。
2. WHEN 收口阶段完成 THEN 系统 SHALL 有一个「同进程双租户」E2E（provision A+B → 各自导入 → 各自会话只见自身数据）。**其证明力取决于 P3（评审 中高4）**：P3（L3/L0）**未**完成时该 E2E **仅**证明 **L1/L2 路径隔离**（runtime session / 凭证仍是全局状态：`src/gateway/session-utils.ts`、`src/gateway/enterprise-data/connector-oauth-session-persistence.ts`、`src/gateway/user-operational-identity-secrets-persistence.ts`），**不能**证明「共享 Gateway 可灰度」；须 P3 完成后该 E2E 方可作为「共享服务就绪」证据。

### Requirement 8: 多租户灰度开关

**User Story:** 作为运维，我希望共享多租户行为可灰度、可快速回退到单实例。

#### Acceptance Criteria

1. WHEN 未开启多租户开关（如 `OPENBOT_MULTITENANT`）THEN 系统 SHALL 维持单租户/单实例解析行为。
2. WHEN 关闭该开关 THEN 系统 SHALL 立即退回单实例行为，无需改代码。
3. WHEN 开启该开关用于**真正的多租户共享服务**（一个进程服务多租户）THEN P3（L3/L0 隔离）SHALL 已完成；否则该开关**仅**允许单租户单实例部署（每进程一租户，进程边界隔离 L0/L3）。

### Requirement 9: L3/L0 隔离（共享进程；可分期）

**User Story:** 作为平台，我希望共享进程里运行时会话与凭证也按租户隔离（用于纯共享部署）。

#### Acceptance Criteria

1. WHEN 共享进程内多租户会话并存 THEN 运行时会话存储 SHALL 按 `(tenantId, userId)` 加键隔离。
2. WHEN 解析凭证/密钥 THEN 系统 SHALL 按租户隔离（对齐 auth-profiles 优先级链）。
3. IF 首版采用单租户单实例（每进程一租户）THEN 本 Requirement SHALL 可延后（进程边界天然隔离 L0/L3）。**但（评审 中高4）**延后 P3 时「共享 Gateway 灰度」SHALL NOT 声明就绪——R7.2 双租户 E2E 此时只证 L1/L2；共享服务就绪以 P3 完成 + 该 E2E 通过为准。
