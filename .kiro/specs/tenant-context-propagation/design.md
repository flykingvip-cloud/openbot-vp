# Design Document

> 中文名：Gateway 租户上下文传播（Tenant-Context Propagation）— 共享 Gateway 逻辑隔离
> 状态：**实施中（P0–P4 主路径已签收；R7.2 路径 E2E 已绿；共享灰度待残余 + 真进程验收）**
> 关联：`requirements.md`、`docs/design/tenant-context-propagation-plan-2026-07-11.md`、`docs/design/openbot-saas-tenant-data-architecture.md`（§4 四层、§7 managed）
> 证据约定：所有「现状」结论带 `path` 代码证据，便于就地核对。

## Overview

让共享 Gateway 在请求期按会话所属租户/用户解析 L1/L2 路径，从而一个进程安全服务多租户；对 local 用户零变化。零件已具备（身份链路、store DI、per-tenant 路径 API、managed 模式），缺的是**权威租户上下文推导**与**把它接到寻址层**。

### 非目标

- 不做 dedicated 专属实例拓扑（未来计划）。
- 不改 tenant-import / 迁移工具（已交付）。
- 不引入 DB/MQ（沿用「租户/owner 键控 JSON + 进程内」范式）。

## Architecture

```
┌── 连接/鉴权 (src/gateway/auth.ts, ws-connection) ──────────────────────┐
│  会话 → client.{user, sessionDomain, sessionTenantId(hint)}            │
│  resolveTenantContext(client): 权威 tenantId（成员关系）+ hint 交叉校验 │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ TenantContext{tenantId,userId,domain}
┌── 请求 handler ───────────▼───────────────────────────────────────────┐
│  getTenantContext(client) → 寻址层 → store(storePath) / dataRoot        │
└───────────────────────────┬───────────────────────────────────────────┘
┌── 寻址层 (src/gateway/tenant-store-paths.ts 扩展) ─────────────────────┐
│  resolveDataRootForContext(ctx,cfg):                                   │
│    local(!managed) → resolveDataRoot(cfg)   [R2 零变化]                 │
│    managed + ctx   → <tenantsRoot>/<tid>/users/<uid>/OpenBot            │
│    managed + 无ctx → 抛错 (fail-closed，评审 高危1)                     │
│  resolveControlPlaneStorePathForContext(ctx,file) → L1 切片            │
│  assertWithinTenantRoot(ctx, resolvedPath)  [R6 守卫]                   │
└────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### C1. `src/gateway/tenant-context.ts`（新，kiro owned；**P0 已落地**）

```ts
// domain 只含 enterprise|employee（platform → resolveTenantContext 返回 null）
export type TenantContext = { tenantId: string; userId: string; domain: "enterprise" | "employee" };

/** 权威解析（R1，async）；platform/无域 → null；hint 不一致 / 缺 membership / 缺 user → 抛 TenantContextError。 */
export function resolveTenantContext(client: GatewayClient | null): Promise<TenantContext | null>;

/** null 即抛（managed 必须有租户的请求路径用）。 */
export function requireTenantContext(client: GatewayClient | null): Promise<TenantContext>;
```

- **权威来源（D1/D6，membership-only）**：会话 `user`(email) → `findUserByEmail` → `findMembershipByUserId` → `enterpriseId`（专用 `resolveMembershipAuthority`）。**不复用 `resolveTrustedAttribution`**——其 workbench-actor 回退在缺 membership 时采信 `client.sessionTenantId`（`employee-workbench-scope.ts`），会让 hint 变权威（评审 高危2）。
- `sessionTenantId` **仅交叉校验**（R1.2）；缺 membership → fail-closed（R1.4）。local/单运营者不经此权威（寻址层按 D2 回退）。

### C2. 寻址层扩展（`src/gateway/tenant-store-paths.ts`，kiro owned）

```ts
export function resolveDataRootForContext(ctx: TenantContext | null, cfg: OpenBotConfig): string;
export function resolveControlPlaneStorePathForContext(
  ctx: TenantContext,
  storeFile: string,
): string;
export function assertWithinTenantRoot(ctx: TenantContext, resolved: string): void; // R6
```

- **回退仅按数据模式（D2，评审 高危1）**：`!isManagedDataMode(cfg)` → `return resolveDataRoot(cfg)`（逐字节等价，local 零变化）。
- **managed + 无 ctx → 抛错（fail-closed）**，绝不回退全局（漏解析 ctx 即跨租户泄漏）。
- managed + ctx → `path.join(resolveTenantLiveRoot(ctx.tenantId), "users", ctx.userId, "OpenBot")`（经 `assertSafeUserSegment` 守卫）。

### C3. Store DI 审计（L1）

多数 store 已接受 `storePath?`（如 `enterprise-seat-assets-store.ts`）。审计 `platform-auth-slice` / `enterprise-data` / `organization`，缺 DI 的补齐（**不重写实现**，仅加可选 `storePath` 形参 + 透传，R3.2）。

### C4. handler 改造点（L2，~15 处 `resolveDataRoot(`）

`src/data/*`（memory / export / conversation-archive / access-grants / migration-\*）与 `src/gateway/server-methods/data.ts`、`control-ui.ts` 等：`resolveDataRoot(cfg)` → `resolveDataRootForContext(ctx,cfg)`。**注（评审 中高3）**：`resolveAgentWorkspaceDir`（`src/agents/agent-scope.ts`，由 `resolveStateDir()` 驱动）与 session store（`src/gateway/session-utils.ts`，全局）**不在这 ~15 处内**、不走 data-space；改为按 ctx 派生是**独立决策 D7**（范围/风险更大），单列，勿并入 C4。

### C5. 守卫扫描（R5.2）

lint/grep 守卫，禁止 request handler 层：(a) 直调 `resolveDataRoot(` / 用 `CONFIG_DIR` 拼租户路径；(b) **调用默认落全局路径的 store loader**（无租户参数的默认加载器，如 `src/gateway/enterprise-data/store.ts` 的 `loadStore()`、`src/gateway/platform-auth/config.ts`、`src/gateway/server-methods/enterprise-data.ts` 命中的全局 loader）。allowlist 寻址层本身 + local-only 面。抽象绕过与直接拼路径同级危险，须同守（评审 中5）。

## Data Models

- 复用 `/data/tenants/<tid>/{control-plane,shared,users/<uid>/OpenBot}`（tenant-import 已建）。
- `TenantContext` 为**请求期瞬态**，不落盘。
- `OPENBOT_TENANTS_ROOT` 决定租户卷根（SaaS 设 `/data/tenants`）。

## L1 范围（评审 开放问题1）

**按租户分区的 L1**（P1 转换目标）= `seat-assets` + `enterprise-data` → `tenants/<tid>/control-plane/`（二者 loader 已 DI-ready，接受 `storePath?`）。

**保持全局、不进 per-tenant 卷**：

- `platform-auth`（**Q-A 裁决**）：login→tenant 的 membership 权威（P0 `resolveMembershipAuthority` 全局读它；per-tenant 会 chicken-and-egg）。`platform-auth-slice.json` 仅 `tenant-import` 迁移物，非 shared runtime 权威读路径。
- `organization`：**派生自**全局 `platform-auth` + per-tenant `seat-assets`（`server-methods/enterprise-organization.ts`），**无独立** store。
- 其余平台全局 keyed store（`src/gateway/tenant-config.ts`、`src/gateway/billing/tenant-credits-store.ts`、billing 账本）：隔离靠「按 `tenantId` 过滤」而非路径分区。

此钉死避免 P1 完成后这些 store 显得被遗漏却无归属。

## Error Handling

- R1.2 hint 不一致 / R1.4 缺成员关系 → `errorShape(ErrorCodes.FORBIDDEN|INVALID_REQUEST, …)`，落审计（含尝试的 tenant/user）。
- R6 越界路径 → 抛（视为编程/隔离错误，不静默）。
- local 模式：以上分支不触发（无 ctx 走回退）。

## Testing Strategy

- **R2 回退契约测试**：local 模式解析结果与 HEAD 逐字节一致。
- **每阶段跨租户泄漏测试**（R7.1，硬门禁）：双租户会话，断言 A 读不到 B 的 L1/L2。
- **收口 E2E**（R7.2）：同进程双租户 provision→import→会话隔离。**证明力受 P3 制约（中高4）**：P3 未完成时仅证 L1/L2 路径隔离（session/凭证仍全局），不证「共享 Gateway 可灰度」。
- 复用 `isPathWithinRoot` 与既有 tenant-import 隔离测试思路。

## 实施分期（对齐 tasks.md）

- **P0** 契约与基础（C1/C2 + R2 fail-closed，零行为变化）— **已落地**（membership-only + fail-closed，21 单测）。
- **P1** L1 控制面 per-tenant（C3 + R3，范围见 §L1 范围）。
- **P2** L2 每用户数据（C4 + R4）；**不含** agent-workspace / session-store（D7 另计）。
- **P3** L3 会话 / L0 凭证隔离（R9）；单实例可延后，但**共享灰度须先过 P3**（中高4）。
- **P4** 守卫（含默认全局 loader，C5）+ 跨租户测试套件 + managed 去回退（R5/R6/R7）。

## 设计决策（评审重点）

- **D1 身份权威**（R1）：tenant 由成员关系推导，hint 仅校验。防越权。
- **D2 回退契约**（R2）：整改安全底线；local 零风险。
- **D3 单一寻址出口**（R5）：集中寻址 + 守卫扫描。
- **D4 分层激活**：P0–P2 覆盖迁入数据；L0/L3（P3）按部署模型决定。
- **D5 灰度**（R8）：managed 多租户置于 `OPENBOT_MULTITENANT` 开关后；**真正共享服务须 P3 完成**（中高4）。
- **D6 membership-only 权威**（R1，评审 高危2）：专用 `resolveMembershipAuthority`（email→user→membership→enterpriseId），**不复用** `resolveTrustedAttribution`（其 workbench 回退采信 hint）。hint 仅交叉校验；缺 membership fail-closed；local/单运营者不经此权威。
- **D7 agent-workspace / session-store 归属（独立决策，评审 中高3）**：`resolveAgentWorkspaceDir`（`agent-scope.ts` ← `resolveStateDir()`）与 session store（`session-utils.ts`）当前走 state-dir、非 data-space；改为按 ctx 派生是独立、更大范围的重构，**不并入 P2**，与 P3（L3 会话）协同，需单独设计 + owner。
- **D9 Channel 入站 v1 范围（2026-07-13）**：Telegram / Discord / 其他 messaging channel 入站**无** `GatewayClient` membership 上下文，**共享 Gateway v1（B4）不含 channel 多租户隔离**。v1 签收范围 = Control UI / WebSocket RPC / platform-auth 已登录会话主路径。Channel 须单独设计：入站消息 → 租户/席位解析（allowlist + routing binding）→ 再接入 `resolveTenantContext`；在 design 落地前 **`OPENBOT_MULTITENANT=1` 不得用于 channel 流量**。Cron / heartbeat / CLI 等同理单列（无 client 路径见守卫 allowlist）。
- **D8 ctx 线程机制（Q-B 裁决）**：**显式透传**——请求边界 `resolveTenantContext(client)` 解析一次，向下传 `ctx` 或预计算的 `storePath`/locator seam；**首版不使用 `AsyncLocalStorage`**。理由：租户隔离是安全边界，显式链路可静态审计 / grep / 做 leakage test，也适配 P1 那些深层 runtime 调用点。ALS 可后续作易用性封装，不做首版权威 source of truth。

## 多 agent 协调（横跨多所有权面，必须 worktree）

| 面                          | 代表文件                                                 | 归属                                   |
| --------------------------- | -------------------------------------------------------- | -------------------------------------- |
| 上下文 + 寻址层（新/owned） | `src/gateway/tenant-context.ts`、`tenant-store-paths.ts` | `tenant-context-propagation:kiro`      |
| L2 数据模块                 | `src/data/*`                                             | `data-directory:cursor-data-directory` |
| gateway 数据 handler        | `src/gateway/server-methods/data.ts` 等                  | 无 task / 混合（协调）                 |
| L1 控制面 store             | `platform-auth-*`、`enterprise-seat-assets-store`        | 企业/平台相关 owner                    |
| 会话/凭证（P3）             | `src/gateway/*session*`、auth-profiles                   | 另属                                   |

各面 owner 须在 `tasks.md ## Agents` 签入并 `loom register`；由操作者开隔离 worktree 后按 P0→P4 顺序 land。
