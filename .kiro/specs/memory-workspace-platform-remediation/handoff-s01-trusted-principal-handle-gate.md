# S01 Trusted Principal / Workspace Handle 设计门禁

> **唯一 handoff**：本文档是 S01 trusted-principal / Handle 设计门禁的**唯一规范**。  
> **路径**：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`  
> **文档版本**: V1.6（#815/#820/#821 合入后：设计收敛与 R6 已接受；pass 3 `accepted`；#818 已归档；未签发实现解锁或生产授权）  
> **状态**: `design-accepted-implementation-locked`  
> **本切片**: D1–D5 设计契约位于非生产 contract 目录；**未修改** `src/memory/**`；**不得**进入生产部署  
> **R6 机器验收**: `scripts/verify-single-sot.mjs`（`pnpm verify:single-sot`）  
> **评审指针**: `docs/design/handoff-s01-design-review-guide.md`（不是第二套规范）  
> **Owner (design task)**: kiro-data-governance  
> **D1–D5 lander**: cursor-data-governance  
> **评审要求**: kiro-sot-reviewer / codex-architecture 设计评审通过后，方可进入实现评审  
> **独立评审 sidecar**: `docs/design/evidence/memory-workspace-s01-d1d5-design-review-codex-architecture.json`（pass 3 `accepted`，合入 #816 `cf8f09a0b2` 后签发；**不**填充 kiro-sot-reviewer；**不**签发实现评审 / Phase 1B unlock）

## 强制约束（MUST）

1. **Data Governance Catalog 是唯一 SoT**（`WorkspaceResourceCatalog` / Data Governance Envelope）。禁止第二套 Catalog 或平行持久化身份。
2. **Handle、membership、authorized CWD 只能是治理 Catalog 的 typed view / 受约束扩展**。Handle = `WorkspaceResourceRecord` 视图；authorized CWD = `WorkspaceBindingRecord.locator` 动态查询；membership = 既有 `PlatformAuthMembership` 只读引用。
3. **禁止独立创建三张 Catalog 表**：不得新建 `workspace_handles`、`authorized_cwds`、`tenant_memberships`（含同等独立 SQL 表、独立 JSON 索引、独立 CRUD API）。
4. **测试只使用经数据治理 owner 批准的非生产 adapter**（默认 `InMemoryWorkspaceResourceCatalog` / `createEmptyWorkspaceCatalog`）。**禁止直接操作 Aliyun RDS**（不得建表、插入、直连、编写 `INSERT INTO workspace_handles` 类 SQL）。
5. 本切片交付 D1–D5 设计契约与测试证据。**仍保持 design-only**：不修改 S01 代码、不改 scan、不写生产 Catalog、不执行 I3、不签发 unlock。
6. **不得修改 `src/memory/**`**。不得新增第二套 `MemoryWorkspaceHandle`生产入口。既有 U0 入口仍为`src/memory/memory-workspace-handle.ts`。Handle 设计契约只允许放在设计文档/证据目录或明确的非生产 `docs/design/contracts/`。

## 唯一规范来源（Normative Source）

**classification**

```
designComplete: true
implementationVerified: false
r6MachineCheck: scripts/verify-single-sot.mjs
S01 Design Convergence: Accepted
R6 Single-SoT Verification: Accepted
Implementation Unlock: Not issued
Production Authorization: Not issued
```

本文档是 S01 的 **唯一 handoff**。D1–D5 正文是本文件的章节；可执行契约是 `docs/design/contracts/s01-trusted-principal-handle-contract.ts`。评审顺序见 `docs/design/handoff-s01-design-review-guide.md`（指针，不是第二套规范）。

下列文件已作为 **SUPERSEDED as second spec** 归档（来自闭环 PR #818 的对齐重放）。它们可以出现在 git 基线，**不得覆盖本文**，也不得当作第二套 D1–D5。R6 以 `scripts/verify-single-sot.mjs` 为准。

索引：`docs/design/handoff-s01-818-archive.md`

- `docs/design/handoff-s01-d1-convergence-patch.md`
- `docs/design/handoff-s01-d2-d4-d5-convergence-patches.md`
- `docs/design/handoff-s01-revision-r1-anonymous-local-security.md`
- `docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md`
- `docs/design/handoff-s01-revision-r4-performance-benchmark.md`
- `docs/design/handoff-s01-revision-r5-audit-failure-semantics.md`
- `docs/design/handoff-s01-revision-r6-single-sot-verification.md`（该稿要求 `src/gateway/workspace-catalog/migrations`，与当前架构不一致；归档后仍不得当 R6 门禁）
- 其余 #818 文档（consolidated / R1–R8 / reference-map 等）见同一索引；全部 **SUPERSEDED as second spec**

当前 Catalog 架构：

| 角色                    | 实际路径                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| Catalog 端口            | `src/gateway/workspace-resolver/catalog.ts`                                  |
| Catalog 投影            | `src/gateway/data-governance/workspace-catalog-projection.ts`                |
| S01 契约                | `docs/design/contracts/s01-trusted-principal-handle-contract.ts`             |
| **不存在，R6 不得要求** | `src/gateway/workspace-catalog/`、`src/gateway/workspace-catalog/migrations` |

R6 只证明：无 phantom migrations 目录、契约未建独立表、测试注入 `InMemoryWorkspaceResourceCatalog`。它 **不是** 生产接线证据。

P99、R1/R3 安全测试、R5 审计失败行为： **design target, not verified**。

---

## 文档状态声明（Document Status Declaration）

**验收结论**:

- 本文档是 S01 设计门禁的**唯一 handoff**
- D1–D5 设计交付物保留在非生产 `docs/design/contracts/` 契约模块 + 非生产 adapter 测试
- R6 机器验收命令：`node scripts/verify-single-sot.mjs`（设计切片门禁，不是实现验证）
- 本任务**未修改** `src/memory/**`，也**未**新增第二套 `MemoryWorkspaceHandle` 生产入口
- **不是** S01 实现评审通过，也不是 S01 retirement accepted，也不是生产部署授权
- `implementationGate.status = not-met`（未接线 get-reply / 未写生产 Catalog）
- `implementationVerified: false`；P99 / R1 / R3 / R5 均为 design target, not production-verified
- 独立评审：kiro-sot-reviewer、codex-architecture。`codex-architecture` pass 3 已对合入主干的 V1.6 契约签发 `accepted`（SG1–SG5 closed；D1–D5 pass）。**不**填充 kiro-sot-reviewer，**不**签发实现评审 / Phase 1B unlock
- **最终裁决（#815 / #820 / #821）**: S01 Design Convergence = Accepted；R6 Single-SoT Verification = Accepted；Implementation Unlock = Not issued；Production Authorization = Not issued
- Trusted Principal、ACL、P99 SLA、审计失败语义：**设计目标，未在生产代码中证明**
- 后续实现必须从最新 `origin/main` 创建新 worktree，并重新走 S01 implementation gates

**守住的状态（Protected State）**:

```
S01 retirement: blocked
Item 7: not-met
remaining/liveWriteWatchIndex: 10 / 10
Phase 1B: blocked
productionCatalogWrite: none
deployAuthorized: false
schemaV2Write: disabled
I3: not executed
LIVE: forbidden
thisSlice: d1-d5-design-nonprod-contract
```

**基线**: 设计切片已合入主干（#815 R6、#816/#821 pass 3、#820 #818 归档）。后续实现 worktree 必须 `git fetch origin` 且 `merge-base --is-ancestor origin/main HEAD`。契约模块：`docs/design/contracts/s01-trusted-principal-handle-contract.ts`（非生产；已从 `src/gateway/data-governance/` 迁出）。

---

## 交付物清单（Deliverable Checklist）

本 handoff 需完成以下 5 个设计交付物，并满足 8 个 implementation gate preconditions：

- [x] **D1**: Trusted Principal 契约（来源、校验、传播、fail-closed 语义） — **Status: completed**
- [x] **D2**: Workspace Handle 模型规范（身份、租户绑定、能力边界、生命周期） — **Status: completed**
- [x] **D3**: Catalog 扩展设计（基于既有 Data Governance Catalog，Handle/授权 cwd/membership 作为受约束读取视图） — **Status: completed**
- [x] **D4**: `resolveAuthorizedToolCwd` 接口契约（TypeScript 类型 + Zod schema + 错误码） — **Status: completed**
- [x] **D5**: 防回归测试计划（单元/集成/失败场景/性能 SLA） — **Status: completed**

**Implementation Gate Preconditions (全部满足后才允许进入实现评审):**

1. [ ] Trusted Principal 来源链路可追溯且不可伪造 — **Status: not-met**
2. [ ] Workspace Handle 租户边界明确且不可越权 — **Status: not-met**
3. [ ] Catalog 扩展不违反 Data Governance 唯一 SoT 原则 — **Status: not-met**
4. [ ] `resolveAuthorizedToolCwd` 错误码完备且可测 — **Status: not-met**
5. [ ] 所有核心路径有单元测试覆盖计划 — **Status: not-met**
6. [ ] 失败场景（无授权/过期/越权）有明确拒绝语义 — **Status: not-met**
7. [ ] 性能 SLA 定义（P99 < 50ms for in-memory catalog lookup） — **Status: not-met**
8. [ ] 向后兼容路径（仅设计讨论；**不得**把 anonymous/local/host/`personalFallback` 接到 S01 生产读路径） — **Status: not-met**

---

## 0. 背景与定位（Scope Framing）

### 0.1 核心问题

当前 Agent Tool 执行（如 `read_file`、`execute_bash`）时，`cwd` 解析缺乏 **可信归属主体（Trusted Principal）** 的明确传播链：

- **归属不明**：`GatewayClient` 包含 `user?`、`sessionDomain?`，但无统一的 "who owns this session" 主体标识。
- **授权脱节**：Workspace 解析器（`workspace-resolver/`）能识别 group/steward/local 资源，但 **Tool CWD 授权未接入租户成员绑定**——员工可能访问到企业未授权的工作区。
- **可见域不统一**：`resolveQueryScope` 用于数据查询，但 Tool CWD 解析未复用该范式，导致 employee/enterprise/platform 域权限不一致。

### 0.2 目标

建立 **Trusted Principal → Workspace Handle → Authorized Tool CWD** 的可信授权链：

```
Trusted Principal (user.id, tenantId, sessionDomain)
    ↓ 校验
Workspace Handle (Catalog Resource 类型化视图)
    ↓ 授权查询
Authorized Tool CWD (从 Catalog Binding 动态解析)
```

**核心约束（Fail-Closed）**：

- 无 Trusted Principal → 拒绝 Tool 执行
- Workspace Handle 租户不匹配 → 拒绝
- Catalog 查询失败 → 拒绝（不猜测路径、不回退 host / `process.cwd` / `personalFallback`）
- `allowAnonymousLocal` 只是后续设计讨论项，**不得**接到 S01 生产调用点

### 0.3 非目标（本期不做）

- 不重写 `workspace-resolver/` 既有资源解析逻辑（复用 `resolveWorkspaceResource`）
- 不改变 `GatewayClient` 连接层字段（新增 Principal 解析 helper，不改 client 结构）
- 不实现细粒度文件级 ACL（Workspace Handle 是**目录级**授权）
- **不新建独立的 workspace_handles / authorized_cwds / tenant_memberships 表**（必须以 Data Governance Catalog 为唯一 SoT）
- **不直接操作 Aliyun RDS**；测试只用经批准的非生产 Catalog adapter
- **不修改** `src/auto-reply/reply/get-reply.ts`、不改 retirement scan、不写生产 Catalog、不执行 I3、不签发 unlock、不 LIVE

---

## D1: Trusted Principal 契约（来源、校验、传播、fail-closed 语义）

**Status: completed (design)** — 规范：unique handoff 本章 + `docs/design/contracts/s01-trusted-principal-handle-contract.ts`。下文示例代码是设计插图。R1/R3 安全测试是 **design target, not verified**。分支收敛补丁 **SUPERSEDED as second spec**。

可执行构造器是 `issueTrustedPrincipal`。形状匹配的 JSON **不是** Trusted Principal。

### 1.1 定义

Trusted Principal 只能从**已校验会话上下文**签发，字段：

- `userId` / `tenantId` / `sessionDomain` / `source` / `sessionId` / `resolvedAt` / `attestation`
- `source`: `platform-auth-session` | `trusted-proxy-header` | `device-token`
- `sessionId` 绑定会话；`attestation` 是对上述字段的 **keyed HMAC**（`createHmac("sha256", attestationSecret)`）。测试可用 `S01_ATTESTATION_TEST_SECRET`；生产必须换成 platform-auth 不可导出发行密钥。无密钥 SHA-256 重算必须被 `parseTrustedPrincipal` 拒绝
- 最大新鲜窗口：`S01_PRINCIPAL_MAX_AGE_MS`（24h）。过期或未来时间戳 fail-closed

### 1.2 来源与禁止从 wire 取身份

信任边界拆成两份对象：`S01PresentedSourceProof`（wire 出示）与 `S01ServerSourceContext`（服务端密钥 / allowlist）。`expectedHmac` / `expectedToken` / proxy allowlist **不得**出现在 presented proof 里。

`issueTrustedPrincipal` **必须先** `verifySourceProof(session, presented, server)`，否则不签发：

1. `platform-auth-session`：presented `hmac` 与 `signS01SessionHmac(server.sessionHmacSecret, sessionId)` 常量时间相等（生产密钥来自 session-cookie secret，不得由调用方同时提供两端）
2. `trusted-proxy-header`：`clientIp` 必须在 **server** `ipAllowlist`，且 `trustedUserHeader === userId`
3. `device-token`：presented `token` 与 **server** `expectedToken` 常量时间相等

**禁止**：从工具参数、请求 body、`requestedCwd` 或任何 untrusted wire 字段读取 `userId` / `tenantId` / `resourceId`。`issueTrustedPrincipal({ wireIdentity })` 在这些字段非空时返回 `null`，即使与会话一致。

`allowAnonymousLocal` 只是设计讨论项，求值器忽略该标志，S01 生产不得因此放行。

### 1.3 传播与 fail-closed

成功求值返回 `audit: { sessionId, resolvedAt, principalSource, auditRecordId }`，便于审计，不写生产 Catalog。

| 场景                                   | 错误码                                          |
| -------------------------------------- | ----------------------------------------------- |
| principal 缺失、伪造 attestation、过期 | `ERR_PRINCIPAL_REQUIRED`                        |
| membership 缺失或歧义                  | `ERR_TENANT_BINDING_REQUIRED`                   |
| membership 或 Handle 租户不匹配        | `ERR_TENANT_MISMATCH`                           |
| Catalog 不可用                         | `ERR_CATALOG_UNAVAILABLE`                       |
| 非法路径（含 `..`、非绝对路径）        | `ERR_INVALID_PATH`（不得映射成 principal 错误） |

---

## D2: Workspace Handle 模型规范（身份、租户绑定、能力边界、生命周期）

**Status: completed (design)** — 规范：unique handoff 本章 + `docs/design/contracts/s01-trusted-principal-handle-contract.ts`。分支 D2 收敛补丁 **SUPERSEDED as second spec**。

Handle 是 Data Governance Catalog 的 **typed view**，不是第二套 `MemoryWorkspaceHandle` 生产入口。U0 生产入口仍为 `src/memory/memory-workspace-handle.ts`。

**CogniWeave Memory Asset 的 `resourceId` 独立于 Workspace Handle `resourceId`。** Handle 不是 Memory Asset 身份。持久主键只有 `resourceId`（`S01_WORKSPACE_HANDLE_PERSISTENT_PK`）。

### 2.1 `WorkspaceHandleView`

投影自 `WorkspaceResourceRecord` + **唯一** `role=canonical` 的 `WorkspaceBindingRecord`：

- `id` = `resourceId`
- `tenantId` / `ownerId`（来自 `user_owned` | `position_owned` | `group_owned`；`unknown` fail-closed）
- `rootPath` = canonical binding `locator`（必须绝对、无 NUL）
- `capabilities` 由 canonical binding 的 `state` 推导（`retired` → 空；`read_only` → `read,list`；`active` → `read,write,execute,list`）
- `state` = Catalog lifecycle：`active` | `read_only` | `retired`（**没有** `suspended` / `archived` 枚举；retired/revoked 映射 `ERR_WORKSPACE_ARCHIVED`）
- `fencing`: `{ contentVersion, bindingId }`，来自 canonical binding，用于防过期令牌/陈旧视图

禁止 `{ kind: string }` owner 兜底。compatibility binding **不能**作为 Handle 根；仅存在 compatibility 或重复 canonical 时投影失败。

### 2.2 租户绑定

- Handle.tenantId 必须等于 principal.tenantId
- 跨租户路径匹配 → `ERR_TENANT_MISMATCH`
- 同租户仍须过 owner/seat/group：`user_owned` 要求 `ownerId === principal.userId`；`position_owned` / `group_owned` 由 membership port 的 `userHasSeat` / `userInGroup` 判定。失败 → `ERR_WORKSPACE_OWNER_DENIED`
- 不得在 Catalog miss 后合成 Handle

---

## D3: Catalog 扩展设计（基于既有 Data Governance Catalog 的受约束读取视图）

**Status: completed (design)** — 规范：unique handoff 本章 + 契约模块。Catalog 端口是 `src/gateway/workspace-resolver/catalog.ts`，**不是** `src/gateway/workspace-catalog/`。R6 不得要求 `workspace-catalog/migrations`。

**Data Governance Catalog 是唯一 SoT**（`WorkspaceResourceCatalog`）。

- Handle = `WorkspaceResourceRecord` 的 typed view
- 授权 CWD = `WorkspaceBindingRecord.locator` 的动态查询
- membership = `S01PlatformAuthMembershipPort`（既有 platform-auth 只读 SoT；测试注入 in-memory port；**禁止**把工具/wire `memberships[]` 数组当作求值输入）

**禁止独立创建三张 Catalog 表**：`workspace_handles`、`authorized_cwds`、`tenant_memberships`。

**禁止直接操作 Aliyun RDS**。测试只使用经数据治理 owner 批准的非生产 Catalog adapter（默认 `InMemoryWorkspaceResourceCatalog` / `createEmptyWorkspaceCatalog`）。

`createWorkspaceHandleViaCatalog` / `catalog.lifecycleCommand` mint **不是**本切片 D1–D5 测试，也不是本门禁前置。那是未来实现评审事项，且仍必须走 Catalog API + 批准 adapter，不得直连 RDS。本切片测试只注入 snapshot，不写生产 Catalog。

---

## D4: `evaluateS01AuthorizedToolCwd` 接口契约

**Status: completed** — 可执行名为 `evaluateS01AuthorizedToolCwd`（设计名 `resolveAuthorizedToolCwd`）。本期**不得**接到 `get-reply.ts` / `handler-bridge.ts`（implementationVerified: false）。

输入：`catalog`、`principal`、`requestedCwd`、`operation`、`memberships`（**port，不是数组**）、`attestationSecret`；可选 `now`、`allowAnonymousLocal`（忽略）。

成功输出：`ok: true`、绝对 `resolvedPath`、`handle`、`accessMode: "authorized"`、`audit`。

失败输出：`failClosed: true`、`retryable: false`、下列 11 个错误码之一：

| 错误码                        | 触发                                                                        |
| ----------------------------- | --------------------------------------------------------------------------- |
| `ERR_PRINCIPAL_REQUIRED`      | 缺失 / 伪造 / 无密钥重算 attestation / 过期 principal                       |
| `ERR_TENANT_BINDING_REQUIRED` | membership port 缺失、传入数组、或 membership 歧义                          |
| `ERR_TENANT_MISMATCH`         | membership 或路径命中的 Handle/locator 租户不匹配                           |
| `ERR_WORKSPACE_NOT_FOUND`     | Catalog miss 或 duplicate canonical                                         |
| `ERR_BINDING_NOT_CANONICAL`   | 路径只命中 compatibility / 非 canonical binding                             |
| `ERR_CAPABILITY_DENIED`       | 操作超出 binding 能力                                                       |
| `ERR_WORKSPACE_ARCHIVED`      | resource/binding `retired`，或 `expectedFencing` 与 `contentVersion` 不匹配 |
| `ERR_PATH_OUTSIDE_WORKSPACE`  | 租户下恰有一个 Handle，但请求路径不在其 locator 内                          |
| `ERR_CATALOG_UNAVAILABLE`     | Catalog snapshot unavailable                                                |
| `ERR_INVALID_PATH`            | 非绝对、含 `..` 或 NUL                                                      |
| `ERR_WORKSPACE_OWNER_DENIED`  | 同租户但非 owner / 无 seat / 非 group 成员                                  |

Canonical 选择：每个 resource **必须恰好一条** `role=canonical` binding，否则不投影。无 host / `process.cwd` / `personalFallback` 回退，无现场 Catalog 合成。

---

## D5: 防回归测试

**Status: completed** — `docs/design/contracts/s01-trusted-principal-handle-contract.test.ts`（bun:test + 批准的 `InMemoryWorkspaceResourceCatalog`）。**不是** `src/gateway/trusted-principal.test.ts`，也**不**通过 Catalog mint 创建 Handle。内存 adapter P99 < 50ms 是 **design SLA**（本切片已在批准 adapter 上跑通）；R5 审计失败行为未经生产实现验证。

覆盖：

- principal 缺失、伪造 attestation、过期 `resolvedAt`、wire 身份字段
- 服务端 HMAC / trusted-proxy **server** allowlist / device-token 来源校验失败
- 调用方自比 `hmac===expectedHmac`、无密钥 SHA-256 重算 attestation
- 同租户其他 owner、注入 `memberships[]` 数组、group/seat port
- Handle 缺失、retired、binding revoked、租户不匹配、stale fencing
- binding 缺失（compatibility-only → `ERR_BINDING_NOT_CANONICAL`）、重复 canonical
- path traversal、`ERR_PATH_OUTSIDE_WORKSPACE`、无授权 capability
- Catalog 不可用
- 双 workspace 集成解析
- 生产调用者冻结：扫描 `src/auto-reply`、`src/memory`、`src/gateway`，不得 import 本契约；`get-reply.ts` 仍用 `resolveEmployeeBuiltinStewardWorkspaceDir`
- 内存 adapter P99 < 50ms

---

## Implementation Gate Preconditions 验证

### Gate 1: Trusted Principal 来源链路可追溯且不可伪造

**Status: not-met**

**验证方法**:

- [ ] Cookie HMAC 签名校验（复用 `platform-auth` 既有机制）
- [ ] `resolveTrustedPrincipal` 单元测试覆盖所有来源路径
- [ ] 伪造签名测试（应拒绝）

### Gate 2: Workspace Handle 租户边界明确且不可越权

**Status: not-met**

**验证方法**:

- [ ] `validateTenantIsolation` 单元测试
- [ ] 跨租户访问集成测试（应拒绝 `ERR_TENANT_MISMATCH`）
- [ ] 同租户不同员工访问测试（需授权）

### Gate 3: Catalog 扩展不违反 Data Governance 唯一 SoT 原则

**Status: not-met**（实现未接线）。设计切片 R6 机器验收见 `scripts/verify-single-sot.mjs`：确认不存在 `src/gateway/workspace-catalog/migrations`，契约未 `CREATE TABLE` 独立表。那是 **design machine check**，不是 implementationVerified。

**验证方法**:

- [ ] 确认不新建 `workspace_handles` / `authorized_cwds` / `tenant_memberships` 表
- [ ] 确认所有 Handle/CWD 操作通过 `WorkspaceResourceCatalog` API
- [ ] 经数据治理 owner 批准测试适配器

### Gate 4: resolveAuthorizedToolCwd 错误码完备且可测

**Status: not-met**

**验证方法**:

- [ ] 全部 11 个错误码都有对应单元测试（`evaluateS01AuthorizedToolCwd`）
- [ ] Zod schema 校验通过
- [ ] 错误消息可读性人工评审

### Gate 5: 所有核心路径有单元测试覆盖计划

**Status: not-met**

**验证方法**:

- [ ] `issueTrustedPrincipal` / `parseTrustedPrincipal` 覆盖签发、伪造、过期、wire 拒绝
- [ ] `projectWorkspaceHandleView` 覆盖唯一 canonical、duplicate、compatibility-only
- [ ] `evaluateS01AuthorizedToolCwd` 覆盖失败矩阵、集成解析、生产调用者冻结

### Gate 6: 失败场景有明确拒绝语义

**Status: not-met**

**验证方法**:

- [ ] 失败场景测试矩阵所有场景通过
- [ ] 每个失败场景都有 `userMessage`
- [ ] 审计记录包含拒绝原因

### Gate 7: 性能 SLA 定义

**Status: not-met**

**验证方法**:

- [ ] P99 < 50ms 性能测试通过
- [ ] 并发测试平均耗时 < 100ms
- [ ] Catalog 查询延迟监控

### Gate 8: 向后兼容路径（不得接到 S01 生产）

**Status: not-met**

**验证方法**:

- [ ] 既有 `workspace-resolver/` 调用路径不回归
- [ ] `allowAnonymousLocal` 若进入实现评审，必须证明**不会**改写 S01 `personalFallback` / host / `process.cwd`
- [ ] S01 在 principal/Handle 缺失时仍 fail-closed / 不接线

---

## 严格禁止（生产保护）

本切片与后续设计阶段均**绝对禁止**：

- ❌ 修改 `src/auto-reply/reply/get-reply.ts`（S01 调用点）
- ❌ 修改 `src/memory/**` 生产写路径
- ❌ 新建或写入生产 Catalog（含 Aliyun RDS 生产库）
- ❌ 接入 resolver、Handle 或 trusted principal 的生产代码
- ❌ 修改 scan 的 `remaining` / `liveWriteWatchIndex`
- ❌ 删除或移动 S01 调用点
- ❌ 执行 I3（资源退休）、签发 unlock、开启 Phase 1B
- ❌ 设置 `deployAuthorized=true`
- ❌ 任何 LIVE/生产部署
- ❌ 独立创建 `workspace_handles` / `authorized_cwds` / `tenant_memberships`

---

## 设计评审清单（Design Review Checklist）

**评审者**: kiro-sot-reviewer / codex-architecture

- [ ] **D1**: Trusted Principal 契约明确，来源链路可追溯
- [ ] **D2**: Workspace Handle 模型完整，作为 Catalog Resource 视图
- [ ] **D3**: Catalog 扩展设计符合唯一 SoT 原则，不新建独立表
- [ ] **D4**: `resolveAuthorizedToolCwd` 接口契约完备，错误码语义明确
- [ ] **D5**: 测试计划覆盖单元/集成/失败场景/性能 SLA
- [ ] **安全性**: Fail-Closed 语义正确，不可伪造性证明充分
- [ ] **性能**: P99 < 50ms SLA 作为设计目标合理（**not verified**）
- [ ] **兼容性**: 不得把 anonymous/host/`personalFallback` 接到 S01 生产读路径
- [ ] **可测性**: 所有核心路径有对应测试计划
- [ ] **可维护性**: 复用 Catalog 机制，审计链路完整
- [ ] **测试环境约束**: 只使用经批准的非生产 adapter；禁止直接操作 Aliyun RDS

**评审通过标准**: 所有 5 个交付物完成，8 个 Gate Preconditions 全部满足。

---

## 附录 A: 参考文档

- `docs/design/operational-identity-governance.md` - 运营身份治理设计（Domain / Attribution 范式）
- `src/gateway/data-governance/types.ts` - Data Governance Envelope 与 Catalog 契约
- `src/gateway/workspace-resolver/catalog.ts` - WorkspaceResourceCatalog 端口（InMemory adapter）
- `src/gateway/data-governance/workspace-catalog-projection.ts` - Catalog 投影（不是 SQL migrations 目录）
- `scripts/verify-single-sot.mjs` - R6 机器验收（不要求 `src/gateway/workspace-catalog/migrations`）
- `docs/design/handoff-s01-design-review-guide.md` - 评审指针（不是第二套规范）
- `src/gateway/platform-auth/` - 平台认证与会话管理
- `src/gateway/scope-attribution.ts` - 可见域与归属解析
- `AGENTS.md` - 多 Agent 治理规则

---

## 附录 B: 实现阶段建议（待评审通过后启动）

**P0 (基础设施)**:

- `TrustedPrincipal` 类型定义与解析 helper
- Workspace Handle 作为 Catalog 视图的适配器
- 授权 CWD 从 Catalog Binding 动态查询

**P1 (核心授权)**:

- `resolveAuthorizedToolCwd` 完整实现
- Tenant isolation 校验
- 失败场景错误码

**P2 (集成与测试)**:

- Tool execution 集成（`read_file`, `fs_write`, `execute_bash`）
- 单元测试套件
- 性能基准测试

**P3 (生产就绪)**:

- 审计日志集成
- 监控指标（解析延迟、拒绝率）
- 运维工具（Catalog 诊断、Handle 迁移）

---

**文档状态**: 唯一 handoff；D1–D5 设计保留在非生产 contract 目录；未改 `src/memory/**`；不得生产部署  
**契约模块**: `docs/design/contracts/s01-trusted-principal-handle-contract.ts`  
**下一步**: 不得接线 S01 / 不得实现评审通过 / 不得 LIVE
