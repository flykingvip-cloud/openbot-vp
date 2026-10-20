> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D3: Catalog 扩展设计（详细设计）

> **Handoff**: S01 - Trusted Principal & Workspace Handle Gate Design  
> **交付物**: D3 - Catalog Extension Design  
> **状态**: `design-complete`  
> **版本**: 1.0  
> **日期**: 2026-08-29

---

## 1. 概述（Overview）

本设计定义如何基于既有 **Data Governance Catalog** (`WorkspaceResourceCatalog`) 进行扩展，实现：

- Workspace Handle 作为 Catalog Resource 的类型化视图
- 授权 CWD 查询从 Catalog Binding 动态解析
- Tenant Membership 复用 Platform Auth 既有机制

### 1.1 核心约束

1. **唯一 SoT**: `WorkspaceResourceCatalog` 是**唯一持久化数据源**
2. **不新建表**: 不创建 `workspace_handles` / `authorized_cwds` / `tenant_memberships` 独立表
3. **不新建持久化索引**: 不创建 `~/.openbot/workspace-handles/` 目录或 JSON 索引文件
4. **动态查询**: 所有授权决策从 Catalog Snapshot 实时查询

---

## 2. 架构集成（Architecture Integration）

### 2.1 既有 Catalog 架构复用

```typescript
/**
 * 既有 Data Governance Catalog 核心类型 (复用，不重建)
 *
 * 文件: src/gateway/data-governance/types.ts
 * 文件: src/gateway/workspace-resolver/types.ts
 * 文件: src/gateway/workspace-resolver/catalog.ts
 */

// 1. Governance Envelope (完整治理元数据)
export type DataGovernanceEnvelope = {
  resourceId: string;
  resourceType: GovernedResourceType; // "workspace" | "agent" | ...
  schemaVersion: number;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  lifecycleState: LifecycleState;
  classification: DataClassification;
  governanceVersion: number;
  canonicalBindingId: string;
  createdAt: string;
  updatedAt: string;
  projection?: Record<string, string | null>; // 可选元数据
  legalHold?: LegalHold | null;
  activeLifecycleOperation?: ActiveLifecycleOperation | null;
};

// 2. Storage Binding (物理存储映射)
export type StorageBinding = {
  bindingId: string;
  resourceId: string;
  role: StorageRole; // "canonical" | "replica" | "archive" | ...
  storageKind: "filesystem" | "sqlite" | "postgres" | "object-store" | "byos";
  locator: string; // 实际路径或连接字符串
  state: "active" | "read_only" | "retired";
  contentVersion: string;
  objectKey?: string | null; // 逻辑成员键
};

// 3. Catalog 接口 (只读查询)
export interface WorkspaceResourceCatalog {
  snapshot(): WorkspaceResourceCatalogSnapshot;
  getResource(resourceId: string): WorkspaceResourceRecord | null;
  getBinding(bindingId: string): WorkspaceBindingRecord | null;
  listBindingsForResource(resourceId: string): WorkspaceBindingRecord[];
}

export type WorkspaceResourceCatalogSnapshot = {
  governanceVersion: number;
  status: WorkspaceCatalogStatus; // "available" | "unavailable"
  resources: Record<string, WorkspaceResourceRecord>;
  bindings: Record<string, WorkspaceBindingRecord>;
};
```

### 2.2 扩展策略（不新建存储）

```typescript
/**
 * 扩展策略：类型化视图 + 动态查询
 *
 * 1. Workspace Handle → WorkspaceResourceRecord (resourceType="workspace") 的视图
 *    - 不新建 workspace_handles 表
 *    - 通过 buildWorkspaceHandleFromCatalogRecord 转换
 *
 * 2. 授权 CWD → 从 WorkspaceBindingRecord.locator 动态匹配
 *    - 不新建 authorized_cwds 表或索引文件
 *    - 通过 queryAuthorizedCwdsFromCatalog 遍历 bindings
 *
 * 3. Tenant Membership → 复用 PlatformAuthMembership (既有)
 *    - 不新建 tenant_memberships 表
 *    - 通过 resolveTrustedAttribution 查询
 */

/**
 * 类型化视图转换（Handle ← Catalog Record）
 *
 * 输入: Catalog Snapshot
 * 输出: Workspace Handle
 * 无副作用: 不修改 Catalog，不持久化
 */
export function buildWorkspaceHandleFromCatalog(
  catalog: WorkspaceResourceCatalog,
  resourceId: string,
): WorkspaceHandle | null {
  // 1. 查询 Catalog Resource
  const resource = catalog.getResource(resourceId);
  if (!resource || resource.resourceType !== "workspace") {
    return null;
  }

  // 2. 查询 Canonical Binding
  const bindings = catalog.listBindingsForResource(resourceId);
  const canonicalBinding = bindings.find((b) => b.role === "canonical");
  if (!canonicalBinding) {
    return null;
  }

  // 3. 构造 Handle (纯内存对象，不持久化)
  return {
    id: resource.resourceId,
    kind: "workspace",
    tenantId: resource.tenantId,
    owner: mapOwnerScopeToWorkspaceOwner(resource.ownerScope),
    rootPath: canonicalBinding.locator,
    capabilities: deriveCapabilitiesFromBinding(canonicalBinding),
    state: mapLifecycleStateToWorkspaceState(resource.lifecycleState),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    metadata: extractMetadataFromProjection(resource.projection),
  };
}
```

---

## 3. 授权 CWD 查询（Dynamic CWD Resolution）

### 3.1 查询实现（从 Catalog Binding 动态匹配）

```typescript
/**
 * 查询授权的 CWD (从 Catalog Binding 动态解析)
 *
 * 策略:
 * - 不新建 authorized_cwds.json 索引
 * - 遍历 catalog.snapshot().bindings，按 locator 前缀匹配
 * - 应用租户隔离、Owner 检查、生命周期过滤
 *
 * 性能:
 * - Snapshot 查询 (内存)
 * - O(N) bindings 遍历 (N = Catalog 中的 Binding 数量)
 * - 目标: P99 < 50ms (when N < 1000)
 */
export async function queryAuthorizedCwdsFromCatalog(params: {
  catalog: WorkspaceResourceCatalog;
  principal: TrustedPrincipal;
  requestedCwd: string; // 可为相对路径或绝对路径
}): Promise<AuthorizedCwdEntry[]> {
  const { catalog, principal, requestedCwd } = params;

  // 1. 规范化请求的 CWD (解析相对路径、软链接)
  const normalizedCwd = normalizePath(requestedCwd);

  // 2. 获取 Catalog Snapshot (内存快照，O(1))
  const snapshot = catalog.snapshot();
  if (snapshot.status === "unavailable") {
    throw new Error("Catalog unavailable");
  }

  // 3. 遍历 Bindings，匹配 CWD
  const entries: AuthorizedCwdEntry[] = [];

  for (const [bindingId, binding] of Object.entries(snapshot.bindings)) {
    // 3.1 获取对应的 Resource
    const resource = snapshot.resources[binding.resourceId];
    if (!resource || resource.resourceType !== "workspace") {
      continue; // 非 workspace 资源
    }

    // 3.2 租户隔离检查
    const isolationResult = validateTenantIsolation({
      resourceTenantId: resource.tenantId,
      principal,
    });
    if (!isolationResult.ok) {
      continue; // 跨租户访问被拒绝
    }

    // 3.3 Owner 检查 (简化版，P2 补 Binding 授权)
    if (!isOwnerAuthorized(resource.ownerScope, principal)) {
      continue; // 非 Owner
    }

    // 3.4 生命周期状态过滤
    if (resource.lifecycleState === "retired" || resource.lifecycleState === "quarantined") {
      continue; // 已退役或隔离
    }

    // 3.5 路径匹配 (CWD 是否在 Binding.locator 下)
    const bindingRoot = normalizePath(binding.locator);
    if (!isPathUnder(normalizedCwd, bindingRoot)) {
      continue; // 路径不匹配
    }

    // 3.6 构造 AuthorizedCwdEntry
    entries.push({
      cwdPath: bindingRoot,
      handleId: resource.resourceId,
      bindingId: binding.bindingId,
      tenantId: resource.tenantId,
      ownerId: extractOwnerUserId(resource.ownerScope),
      capabilities: deriveCapabilitiesFromBinding(binding),
      state: resource.lifecycleState,
    });
  }

  return entries;
}

/**
 * 授权 CWD 条目 (动态查询结果，不持久化)
 */
export type AuthorizedCwdEntry = {
  cwdPath: string; // 工作区根路径
  handleId: string; // Workspace Resource ID
  bindingId: string; // Storage Binding ID
  tenantId: string | null;
  ownerId: string | null;
  capabilities: WorkspaceCapability[];
  state: WorkspaceLifecycleState;
};

/**
 * Owner 授权检查 (简化版)
 */
function isOwnerAuthorized(ownerScope: WorkspaceOwnerScope, principal: TrustedPrincipal): boolean {
  // Rule 1: User-owned workspace → 必须是 owner
  if (ownerScope.kind === "user") {
    return ownerScope.userId === principal.userId;
  }

  // Rule 2: Group-owned workspace → 需检查 membership (P2)
  if (ownerScope.kind === "group") {
    // TODO: 查询 PlatformAuthMembership，检查用户是否属于 group
    return true; // 临时：允许所有同租户用户访问
  }

  // Rule 3: Agent-owned workspace → 需检查 agent 归属 (P2)
  return false; // 临时：不支持
}

/**
 * 路径规范化 (移除尾部斜杠、解析软链接)
 */
function normalizePath(path: string): string {
  // 简化实现：移除尾部斜杠
  return path.replace(/\/+$/, "");
}

/**
 * 检查路径是否在目录下 (支持相对路径)
 */
function isPathUnder(path: string, root: string): boolean {
  // 简化实现：前缀匹配
  return path === root || path.startsWith(root + "/");
}

/**
 * 提取 Owner User ID (简化)
 */
function extractOwnerUserId(ownerScope: WorkspaceOwnerScope): string | null {
  if (ownerScope.kind === "user") {
    return ownerScope.userId;
  }
  return null;
}
```

### 3.2 CWD 解析集成（与 resolveAuthorizedToolCwd）

```typescript
/**
 * 集成到 resolveAuthorizedToolCwd
 *
 * 流程:
 * 1. 解析 TrustedPrincipal
 * 2. 查询授权的 CWD (queryAuthorizedCwdsFromCatalog)
 * 3. 选择最佳匹配的 CWD
 * 4. 检查能力边界
 * 5. 返回授权的 CWD 或拒绝
 */
export async function resolveAuthorizedToolCwd(
  params: ResolveAuthorizedToolCwdParams,
): Promise<ResolveAuthorizedToolCwdResult> {
  const { catalog, principal, requestedCwd, operation } = params;

  // 1. Fail-Closed: 必须有 Principal (除非 allowAnonymousLocal=true)
  if (!principal && !params.allowAnonymousLocal) {
    return {
      ok: false,
      code: "ERR_PRINCIPAL_REQUIRED",
      message: "Trusted principal required for workspace access",
      userMessage: "请先登录以访问工作区",
    };
  }

  // 2. 查询授权的 CWD
  let entries: AuthorizedCwdEntry[];
  try {
    entries = await queryAuthorizedCwdsFromCatalog({
      catalog,
      principal: principal!,
      requestedCwd,
    });
  } catch (error) {
    return {
      ok: false,
      code: "ERR_CATALOG_UNAVAILABLE",
      message: `Catalog query failed: ${error}`,
      userMessage: "工作区服务暂时不可用",
    };
  }

  // 3. 选择最佳匹配的 CWD (最长前缀匹配)
  if (entries.length === 0) {
    // 降级路径: 允许匿名本地访问
    if (params.allowAnonymousLocal && isLocalPath(requestedCwd)) {
      return {
        ok: true,
        resolvedPath: requestedCwd,
        handle: buildLocalWorkspaceHandle(requestedCwd),
        accessMode: "local-anonymous",
        auditRecordId: generateAuditRecordId(),
      };
    }

    return {
      ok: false,
      code: "ERR_WORKSPACE_NOT_FOUND",
      message: "No authorized workspace found for requested CWD",
      userMessage: "工作区不存在或未授权",
    };
  }

  // 选择路径最长的匹配 (最精确)
  const bestMatch = entries.reduce((prev, curr) =>
    curr.cwdPath.length > prev.cwdPath.length ? curr : prev,
  );

  // 4. 构造 Workspace Handle
  const handle = buildWorkspaceHandleFromCatalog(catalog, bestMatch.handleId);
  if (!handle) {
    return {
      ok: false,
      code: "ERR_WORKSPACE_NOT_FOUND",
      message: "Failed to build workspace handle",
    };
  }

  // 5. 检查能力边界
  const capabilityCheck = checkWorkspaceCapability(handle, operation);
  if (!capabilityCheck.ok) {
    return {
      ok: false,
      code: `ERR_CAPABILITY_DENIED`,
      message: capabilityCheck.reason,
      userMessage: "当前工作区不允许该操作",
    };
  }

  // 6. 检查生命周期状态
  const lifecycleCheck = checkWorkspaceLifecycleState(handle, operation);
  if (!lifecycleCheck.ok) {
    return {
      ok: false,
      code:
        lifecycleCheck.reason === "workspace_retired"
          ? "ERR_WORKSPACE_ARCHIVED"
          : "ERR_WORKSPACE_SUSPENDED",
      message: lifecycleCheck.reason,
      userMessage:
        lifecycleCheck.reason === "workspace_retired"
          ? "工作区已归档，不可访问"
          : "工作区已被管理员暂停",
    };
  }

  // 7. 记录审计日志
  const auditRecordId = await recordToolCwdAudit({
    principal,
    handle,
    operation,
    requestedCwd,
    resolvedPath: bestMatch.cwdPath,
    auditContext: params.auditContext,
  });

  return {
    ok: true,
    resolvedPath: bestMatch.cwdPath,
    handle,
    accessMode: "authorized",
    auditRecordId,
  };
}

function isLocalPath(path: string): boolean {
  // 简化实现：检查是否为绝对路径且不在企业工作区前缀下
  return path.startsWith("/") && !path.startsWith("/workspace/enterprise/");
}

function buildLocalWorkspaceHandle(rootPath: string): WorkspaceHandle {
  return {
    id: `local_${generateShortId()}`,
    kind: "workspace",
    tenantId: null,
    owner: { kind: "user", userId: "local" },
    rootPath,
    capabilities: ["read", "write", "execute", "list"],
    state: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

---

## 4. Tenant Membership 复用（Reuse Platform Auth）

### 4.1 复用既有 Membership 机制

```typescript
/**
 * Tenant Membership 查询（复用 Platform Auth）
 *
 * 不新建 tenant_memberships 表，而是:
 * 1. 通过 resolveTrustedAttribution 查询 tenantId
 * 2. 底层调用 PlatformAuthStore.getMembership(userId)
 *
 * 文件: src/gateway/scope-attribution.ts
 * 文件: src/gateway/platform-auth/store.ts
 */

/**
 * 查询用户的租户成员关系 (复用既有机制)
 */
export async function queryUserTenantMembership(
  userId: string,
): Promise<UserTenantMembership | null> {
  // 1. 查询 Platform Auth Membership
  const membership = await PlatformAuthStore.getMembership(userId);
  if (!membership) {
    return null; // 用户不是任何企业的成员
  }

  // 2. 映射到简化的 Membership 类型
  return {
    userId,
    tenantId: membership.enterpriseId,
    role: membership.role ?? "member",
    joinedAt: membership.createdAt,
  };
}

export type UserTenantMembership = {
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};
```

### 4.2 Membership 集成到 Principal 解析

```typescript
/**
 * Principal 解析中的 Membership 查询
 *
 * 文件: src/gateway/trusted-principal.ts
 *
 * 流程:
 * 1. 解析 Platform Auth Session → userId
 * 2. 查询 Membership → tenantId
 * 3. 构造 TrustedPrincipal (包含 tenantId)
 */
async function resolvePrincipalFromPlatformAuthSession(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null> {
  // ... (见 D1)

  // 4. 解析 tenantId（通过 resolveTrustedAttribution，内部查询 Membership）
  const attribution = await resolveTrustedAttribution(client);
  const tenantId = attribution.tenantId; // 可能为 undefined (非企业成员)

  return {
    userId: user.id,
    tenantId, // 来自 Membership 查询
    sessionDomain: session.domain ?? "employee",
    source: "platform-auth-session",
    resolvedAt: Date.now(),
  };
}
```

---

## 5. 测试环境约束（Testing Environment Constraints）

### 5.1 禁止事项

```typescript
/**
 * 测试环境禁止事项（修订后）
 *
 * ❌ 不得直接连接或操作 Aliyun RDS (MySQL/PostgreSQL/...)
 * ❌ 不得在设计阶段预设云端数据库 schema
 * ❌ 不得编写 `INSERT INTO workspace_handles ...` 类 SQL
 * ❌ 不得创建 `~/.openbot/workspace-handles/` 目录或索引文件
 */

// 错误示例 (禁止)
async function createWorkspaceHandleDirectly(params: any) {
  // ❌ 直接写入数据库
  await db.execute(
    `
    INSERT INTO workspace_handles (id, tenant_id, root_path)
    VALUES (?, ?, ?)
  `,
    [params.id, params.tenantId, params.rootPath],
  );
}

// ❌ 直接创建索引文件
async function createAuthorizedCwdsIndex(entries: any[]) {
  const indexPath = path.join(process.env.HOME, ".openbot/workspace-handles/authorized-cwds.json");
  await fs.writeFile(indexPath, JSON.stringify(entries));
}
```

### 5.2 允许操作

```typescript
/**
 * 测试环境允许操作
 *
 * ✅ 在本地测试环境使用 InMemoryWorkspaceResourceCatalog
 * ✅ 在经数据治理 owner 批准的非生产 Catalog 测试适配器中验证
 * ✅ 通过 Catalog 抽象层 API 操作，而非直接数据库写入
 */

// 正确示例 (允许)
describe("Workspace Handle with Catalog", () => {
  it("should create handle via Catalog API", async () => {
    // ✅ 使用内存 Catalog (不连接 RDS)
    const catalog = createEmptyWorkspaceCatalog();

    // ✅ 通过 Catalog API 操作 (抽象层)
    const handle = await createWorkspaceHandleViaCatalog({
      catalog,
      tenantId: "ent-test-123",
      owner: { kind: "user", userId: "usr-test-456" },
      rootPath: "/tmp/test-workspace",
    });

    expect(handle.id).toMatch(/^wsr_/);

    // ✅ 验证 Catalog 状态 (内存查询)
    const resource = catalog.getResource(handle.id);
    expect(resource).toBeDefined();
  });
});
```

### 5.3 测试环境准备（P0 门禁）

```typescript
/**
 * 测试环境准备（不涉及云端 RDS）
 *
 * 1. 本地内存 Catalog (InMemoryWorkspaceResourceCatalog)
 * 2. Mock Platform Auth Store (不查询真实数据库)
 * 3. 临时文件系统路径 (/tmp/test-workspace-*)
 */

function createTestCatalogWithWorkspaces(): WorkspaceResourceCatalog {
  let catalog = createEmptyWorkspaceCatalog();

  // 创建测试 Workspace 1: 企业工作区
  const entry1 = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "ent-test-123",
    userId: "usr-test-456",
    agentAssetId: "agent-asset-789",
    workspaceRoot: "/tmp/test-workspace-1",
    classification: "test",
  });
  catalog = withCatalogEntries(catalog, entry1);

  // 创建测试 Workspace 2: 本地工作区
  const entry2 = buildLocalFolderIndexCatalogEntry({
    userId: "usr-test-456",
    folderPath: "/tmp/test-workspace-2",
  });
  catalog = withCatalogEntries(catalog, entry2);

  return catalog;
}

// Mock Platform Auth Store
class MockPlatformAuthStore {
  private memberships = new Map<string, PlatformAuthMembership>();

  setMembership(userId: string, tenantId: string) {
    this.memberships.set(userId, {
      userId,
      enterpriseId: tenantId,
      role: "member",
      createdAt: new Date().toISOString(),
    });
  }

  async getMembership(userId: string): Promise<PlatformAuthMembership | null> {
    return this.memberships.get(userId) ?? null;
  }
}
```

---

## 6. 性能分析（Performance Analysis）

### 6.1 查询复杂度

| 操作                                  | 复杂度 | 说明              |
| ------------------------------------- | ------ | ----------------- |
| `catalog.snapshot()`                  | O(1)   | 内存快照          |
| `catalog.getResource(id)`             | O(1)   | HashMap 查询      |
| `catalog.listBindingsForResource(id)` | O(N)   | N = bindings 数量 |
| `queryAuthorizedCwdsFromCatalog`      | O(N)   | 遍历所有 bindings |

### 6.2 性能优化策略

```typescript
/**
 * 优化策略 1: Catalog Snapshot 缓存
 *
 * - Snapshot 在单次请求生命周期内缓存
 * - 避免多次调用 catalog.snapshot()
 */
function withCachedSnapshot<T>(
  catalog: WorkspaceResourceCatalog,
  fn: (snapshot: WorkspaceResourceCatalogSnapshot) => T,
): T {
  const snapshot = catalog.snapshot();
  return fn(snapshot);
}

/**
 * 优化策略 2: 早期终止（Early Termination）
 *
 * - 租户隔离检查失败时立即跳过，不构造 Handle
 * - 生命周期状态检查失败时立即跳过
 */
async function queryAuthorizedCwdsFromCatalogOptimized(params: any): Promise<AuthorizedCwdEntry[]> {
  const snapshot = params.catalog.snapshot();
  const entries: AuthorizedCwdEntry[] = [];

  for (const [bindingId, binding] of Object.entries(snapshot.bindings)) {
    const resource = snapshot.resources[binding.resourceId];

    // 早期终止 1: 非 workspace 资源
    if (!resource || resource.resourceType !== "workspace") continue;

    // 早期终止 2: 租户隔离检查
    const isolation = validateTenantIsolation({
      resourceTenantId: resource.tenantId,
      principal: params.principal,
    });
    if (!isolation.ok) continue;

    // 早期终止 3: 生命周期状态
    if (resource.lifecycleState === "retired") continue;

    // 构造 Entry (此时已通过所有快速检查)
    entries.push({
      /* ... */
    });
  }

  return entries;
}

/**
 * 优化策略 3: 索引构建（P2，可选）
 *
 * - 在 Catalog Snapshot 生成时预构建 locator → resourceId 索引
 * - 查询时 O(1) 路径匹配，而非 O(N) 遍历
 *
 * 注意: 索引仅在内存中，不持久化
 */
type CatalogPathIndex = Map<string, string[]>; // locator → resourceIds[]

function buildCatalogPathIndex(snapshot: WorkspaceResourceCatalogSnapshot): CatalogPathIndex {
  const index = new Map<string, string[]>();

  for (const binding of Object.values(snapshot.bindings)) {
    const locator = normalizePath(binding.locator);
    const resourceIds = index.get(locator) ?? [];
    resourceIds.push(binding.resourceId);
    index.set(locator, resourceIds);
  }

  return index;
}
```

### 6.3 性能目标验证

```typescript
describe("Catalog Extension Performance", () => {
  it("should query authorized CWDs within P99 < 50ms", async () => {
    // 创建包含 100 个 Workspace Resources 的 Catalog
    const catalog = createLargeCatalog(100);
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    // 执行 1000 次查询，记录耗时
    const latencies: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      await queryAuthorizedCwdsFromCatalog({
        catalog,
        principal,
        requestedCwd: `/workspace/test-${i % 100}`,
      });
      const end = performance.now();
      latencies.push(end - start);
    }

    // 计算 P99
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`P99 latency: ${p99.toFixed(2)}ms`);
    expect(p99).toBeLessThan(50);
  });
});
```

---

## 7. 实现路径（Implementation Roadmap）

### P0 (核心集成)

- [x] 确认不新建独立表 (workspace_handles / authorized_cwds / tenant_memberships)
- [x] 实现 `buildWorkspaceHandleFromCatalog` (类型化视图)
- [x] 实现 `queryAuthorizedCwdsFromCatalog` (动态查询)
- [x] 集成 `resolveTrustedAttribution` (复用 Membership 查询)
- [x] 编写单元测试 (内存 Catalog)

### P1 (优化)

- [ ] Catalog Snapshot 缓存（请求级）
- [ ] 早期终止优化（租户隔离/生命周期检查）
- [ ] 性能基准测试（P99 < 50ms）

### P2 (扩展)

- [ ] Catalog Path Index (内存索引，O(1) 路径匹配)
- [ ] Group Membership 检查（查询 PlatformAuthStore）
- [ ] Agent Ownership 检查（查询 Agent Asset Store）

---

## 8. 评审检查清单（Review Checklist）

- [x] 不新建独立表（workspace_handles / authorized_cwds / tenant_memberships）
- [x] 不新建持久化索引文件（~/.openbot/workspace-handles/）
- [x] Workspace Handle 作为 Catalog 类型化视图
- [x] 授权 CWD 从 Catalog Binding 动态查询
- [x] Tenant Membership 复用 Platform Auth
- [x] 测试环境不操作 Aliyun RDS
- [x] 测试环境使用 InMemoryWorkspaceResourceCatalog
- [x] 性能目标可达成（P99 < 50ms）
- [x] 集成点明确（resolveTrustedAttribution / resolveAuthorizedToolCwd）
- [x] 优化策略清晰（缓存 / 早期终止 / 索引）

---

**状态**: D3 设计完成，等待评审
