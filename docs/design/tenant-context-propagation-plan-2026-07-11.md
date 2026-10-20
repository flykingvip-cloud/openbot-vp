# 实施计划：Gateway 租户上下文传播（多租户共享 Gateway 使能）

> **作者**：`kiro`（工作流 `saas-tenant-data-architecture`）
> **日期**：2026-07-11
> **前置**：`docs/design/openbot-saas-tenant-data-architecture.md`（§4 四层模型、§7 managed 模式）
> **状态**：计划草案，待专家组评审 + 立 spec + 分配 owner

---

## 0. 目标 / 非目标

**目标**：让运行中的 Gateway 在**请求期**按会话所属租户/用户解析 L1 控制面与 L2 数据路径，使**一个 Gateway 进程可安全服务多个租户**（当前只能单租户单实例）。

**非目标**（本计划不做）：

- 不改 tenant-import / 迁移工具（已交付）。
- 不改 local / 自托管模式的行为——对非 managed 用户必须**零行为变化**（见 P0 的回退契约）。
- 不做跨区域驻留（OQ-5，另立）。

## 1. 现状（已在代码核对）

| 事实                                                                                              | 位置                                                                                   | 影响                                          |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `resolveDataRoot(cfg)` 只解析**单个** `data.root`，无 tenant/user 参数                            | `src/config/data-space.ts`                                                             | L2 数据请求期不区分租户                       |
| per-tenant 解析器只在 provision/import 路径用，**无普通 handler 使用**                            | `src/gateway/tenant-store-paths.ts` → 仅 `platform-tenant.ts` / `register.platform.ts` | 导入写得进、请求期读不出                      |
| `GatewayClient` 已带 `user` / `sessionDomain` / `sessionTenantId`（后者标注「hint，非唯一权威」） | `src/gateway/server-methods/types.ts`                                                  | 身份已流到 handler，缺**权威推导 + 用于寻址** |
| 多数 store 已接受可选 `storePath?`（DI 就绪）                                                     | 如 `enterprise-seat-assets-store.ts`                                                   | 寻址层改「传路径」即可，不必重写 store        |
| `resolveDataRoot(` 调用点 ~15 处（L2 数据层）                                                     | `data/*`、`gateway/server-methods/data.ts`、`gateway/control-ui.ts` 等                 | P2 主战场                                     |
| `CONFIG_DIR` 调用点 ~100 处（状态目录 `~/.openbot`：凭证/会话/配置/部分 L1）                      | 全仓                                                                                   | L0/L3 隔离是更大、更晚的范围                  |
| managed 模式已存在；`data.*` 系列 RPC 已 `LOCAL_ONLY` 拒绝                                        | `config/data-space.ts`、`server-methods/data.ts`                                       | managed 是激活开关                            |

**结论**：身份链路 + store DI + per-tenant 路径 API 都已具备零件，缺的是**权威租户上下文的推导**与**把它接到寻址层**，且必须保持 local 模式零变化。

## 2. 目标架构

**(a) `TenantContext`（权威、每请求）**

```ts
type TenantContext = {
  tenantId: string;
  userId: string;
  domain: "platform" | "enterprise" | "employee";
};
```

- **权威来源**：会话 user → 其租户成员关系（`platform-auth-slice` / `seat-assets`），**不是** `client.sessionTenantId`（该 hint 只用于**交叉校验**，不一致即拒绝 = 防越权）。
- platform 域：运维，无隐式租户；跨租户操作走**显式** `targetTenantId` 参数（如现有 `platform.tenant.*`）。
- enterprise/employee 域：强制绑定到 user 的单一租户。

**(b) 寻址层（扩 `tenant-store-paths.ts`）**

- `resolveDataRootForContext(ctx, cfg)`：**managed** → `<tenantsRoot>/<tid>/users/<uid>/OpenBot`；**local / 无 ctx** → 回退 `resolveDataRoot(cfg)`（**零行为变化契约**）。
- L1：`resolveTenantControlPlaneStorePath(tid, file)`（已存在）。
- 统一从这里出所有租户相关路径，禁止 handler 直接拼 `CONFIG_DIR`/`resolveDataRoot`。

**(c) 传播**

- 在鉴权/连接阶段解析 `TenantContext` 并挂到会话；handler 经 `context` 取 `getTenantContext(client)`，把解析出的 `storePath`/`dataRoot` 传进已 DI 化的 store 函数。

## 3. 分阶段任务（禁止跳阶；每阶段自带跨租户泄漏测试）

### P0 — 契约与基础（零行为变化）

- P0-1 定义 `TenantContext` + `getTenantContext(client, context)`（权威推导：user→tenant 成员映射 + hint 交叉校验）。新增 `src/gateway/tenant-context.ts`（owned，新文件）。
- P0-2 寻址层 `resolveDataRootForContext` + `resolveControlPlaneStorePathForContext`，**local/无 ctx 回退到现状**（扩 `tenant-store-paths.ts`）。
- P0-3 单测：local 模式解析结果与今日**逐字节一致**（回退契约）；managed 模式解析到 `/data/tenants/<tid>/users/<uid>/...`；hint 与权威不一致 → 抛错。
- **门禁**：P0 合入后，local 用户零差异（全量测试无回归）。

### P1 — L1 控制面 per-tenant

- P1-1 审计 L1 store（`platform-auth-slice`、`seat-assets`、`enterprise-data`、`organization`）是否都可注入 `storePath`；缺的补 DI（不重写实现）。
- P1-2 相关 handler 改为 `resolveControlPlaneStorePathForContext(ctx, …)` 取路径。
- P1-3 跨租户测试：租户 A 会话读不到租户 B 的 seat/enterprise-data。

### P2 — L2 每用户数据（~15 个 `resolveDataRoot(` 站点）

- P2-1 逐站点把 `resolveDataRoot(cfg)` 换成 `resolveDataRootForContext(ctx, cfg)`：`agents`/`knowledge`/`memory`/`conversations`/`access-grants`/`data-export`/`data-root-info`/`migration-*`。
- P2-2 `resolveAgentWorkspaceDir` 等派生路径改为从 ctx 数据根派生（呼应 §8.1「由 data.root 派生」）。
- P2-3 跨租户 + 跨用户测试：员工只能触达自己 `users/<uid>/` 子树。

### P3 — L3 运行时会话 / L0 凭证隔离（仅共享 Gateway 需要）

- P3-1 会话存储按 `(tenantId, userId)` 加键（`~/.openbot/agents/.../sessions` → 租户命名空间）。
- P3-2 凭证/密钥解析按租户隔离（呼应 auth-profiles 优先级链）。
- P3-3 若首版走**单租户单实例**，P3 可延后（每进程天然隔离 L0/L3）。

### P4 — 强制隔离 + 收口

- P4-1 加运行期守卫：managed 模式下任何解析出的路径**必须**落在 `resolveTenantLiveRoot(ctx.tenantId)` 之内（`isPathWithinRoot`），越界即抛。
- P4-2 全量跨租户泄漏测试套件（每层一组）+ 一个「双租户同进程」E2E。
- P4-3 managed 模式移除/禁用单根回退（local 保留）。

## 4. 关键设计决策（评审重点）

- **D1 权威来源**：tenant 由 user 成员关系推导，`sessionTenantId` 仅交叉校验（不一致=拒绝）。防止 hint 伪造越权。
- **D2 回退契约**：local/自托管**零变化**——`resolveDataRootForContext` 无 ctx 时等价 `resolveDataRoot(cfg)`。这是整个重构的安全底线。
- **D3 单一寻址出口**：所有租户路径经寻址层；加 lint/grep 守卫禁止 handler 直接 `resolveDataRoot(`/`CONFIG_DIR` 拼数据路径。
- **D4 分层激活**：P0–P2 先让 L1/L2 多租户就绪（覆盖迁移进来的数据）；L0/L3（P3）按部署模型决定是否需要。
- **D5 灰度**：managed 多租户行为可置于开关后（如 `data.mode=managed` + `OPENBOT_MULTITENANT=1`），先单实例验证再放共享。

## 5. 多 agent 协调与归属（本重构横跨多所有权面）

这不是单 agent 能独立落的——横跨多个 owner 的热文件，**必须立 spec + 由操作者开隔离 worktree + 指定 owner 统一 land**：

| 面                        | 代表文件                                                           | 现所有权（需确认）                     |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| 寻址层 + 上下文（新文件） | `tenant-store-paths.ts`、`tenant-context.ts`（新）                 | `saas-tenant-data-architecture:kiro`   |
| L2 数据模块               | `src/data/*`（memory/export/conversation/access-grants/migration） | `data-directory:cursor-data-directory` |
| gateway 数据 handler      | `src/gateway/server-methods/data.ts` 等                            | 无 task / 混合                         |
| L1 控制面 store           | `platform-auth-*`、`enterprise-seat-assets-store`                  | 企业/平台相关 owner                    |
| 会话/凭证（P3）           | `src/gateway/*session*`、auth-profiles                             | 另属                                   |

建议：以本文件为蓝本立 `.kiro/specs/tenant-context-propagation/`，`## Agents` 签入各面 owner，`loom register` 归属，**worktree 隔离**后按 P0→P4 顺序 land（每阶段独立绿 + 跨租户测试）。

## 6. 测试策略

- 每阶段**跨租户泄漏测试**为门禁：构造租户 A/B 双会话，断言 A 读不到 B 的 L1/L2。
- 回退契约测试（P0）：local 模式解析与 HEAD 逐字节一致。
- P4 收口：一个「同进程双租户」E2E（provision A+B → 各自导入 → 各自会话只见自己数据）。
- 复用 `isPathWithinRoot` / 现有 tenant-import 隔离测试思路。

## 7. 风险与回滚

- **R1 爆炸半径**：~15 个 L2 站点 + L1 store + 会话/凭证；用 D2 回退契约 + D5 开关把风险关在 managed 灰度内，local 全程零风险。
- **R2 权威推导错误 = 串租户**（严重）：D1 + P4 路径守卫双保险；跨租户测试为硬门禁。
- **R3 多 agent 交织**：见 §5，必须 worktree + spec，不在共享脏树上做。
- **回滚**：每阶段在开关后，可关 `OPENBOT_MULTITENANT` 退回单实例行为。

## 8. 建议落地方式

1. 专家组评审本计划（尤其 D1 权威来源、D2 回退契约）。
2. 立 `.kiro/specs/tenant-context-propagation/`（requirements/design/tasks），`## Agents` 签入 owner。
3. 操作者开隔离 worktree。
4. 按 P0→P4 顺序、每阶段独立绿 + 跨租户测试门禁地 land。
5. 首版云端仍走**单租户单实例**（今天可用）；P0–P2 + P4 完成后再开**共享 Gateway** 灰度。
