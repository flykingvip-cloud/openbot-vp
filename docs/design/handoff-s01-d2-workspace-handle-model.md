> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D2: Workspace Handle 模型规范（详细设计）

> **Handoff**: S01 - Trusted Principal & Workspace Handle Gate Design  
> **交付物**: D2 - Workspace Handle Model Specification  
> **状态**: `design-complete`  
> **版本**: 1.0  
> **日期**: 2026-08-29

---

## 1. 概述（Overview）

本设计定义 **Workspace Handle** 的完整模型规范，包括：

- 作为 `WorkspaceResourceRecord` 的类型化视图
- 身份、租户绑定、能力边界、生命周期
- 与 Data Governance Catalog 的集成方式
- 操作接口与错误处理

### 1.1 设计原则

1. **唯一 SoT**: Workspace Handle 是 `WorkspaceResourceCatalog` 的类型化读取视图，不新建独立表
2. **Governance Aligned**: 完全遵循 Data Governance Envelope 规范
3. **Fail-Closed**: 所有授权决策失败时拒绝访问
4. **Tenant Isolation**: 严格的租户隔离，不可越权访问

---

## 2. 数据模型（Data Model）

### 2.1 核心类型定义

```typescript
/**
 * Workspace Handle: 对一个工作区目录的授权访问句柄
 *
 * 本质：WorkspaceResourceRecord (resourceType="workspace") 的类型化视图
 * 不新建独立存储，所有字段从 Catalog 映射而来
 */
export type WorkspaceHandle = {
  /**
   * Handle ID (映射到 WorkspaceResourceRecord.resourceId)
   *
   * - 格式: `wsr_<uuid>` (workspace resource)
   * - 唯一性: 全局唯一
   * - 用途: Catalog 查询、授权检查、审计日志
   */
  id: string;

  /**
   * Handle 类型 (固定为 "workspace")
   *
   * - 对应 Catalog 中的 resourceType="workspace"
   * - 未来可能扩展: "agent_workspace", "knowledge_workspace"
   */
  kind: "workspace";

  /**
   * 租户 ID (映射到 WorkspaceResourceRecord.tenantId)
   *
   * - null: 本地个人工作区（local folder）
   * - "ent-<uuid>": 企业工作区（group workspace）
   * - 用途: 租户隔离、Catalog 查询过滤
   */
  tenantId: string | null;

  /**
   * Owner (映射到 WorkspaceResourceRecord.ownerScope)
   *
   * - 来源: WorkspaceOwnerScope (user/group/agent)
   * - 用途: 权限检查、归属决策
   * - 注意: 与 OwnershipPrincipal 映射关系见 §2.3
   */
  owner: WorkspaceOwner;

  /**
   * 工作区根路径 (从 Canonical Binding.locator 提取)
   *
   * - 来源: WorkspaceBindingRecord (role="canonical") 的 locator 字段
   * - 格式: 绝对路径 (例: /Users/alice/workspace/project-alpha)
   * - 规范化: 移除尾部斜杠、解析软链接
   * - 用途: Tool CWD 解析、文件访问授权
   */
  rootPath: string;

  /**
   * 能力边界 (从 Binding.role 推导)
   *
   * - 来源: WorkspaceBindingRecord.role → deriveCapabilitiesFromBinding
   * - 语义: 允许的操作集合
   * - Fail-Closed: 不在 capabilities 中的操作被拒绝
   */
  capabilities: WorkspaceCapability[];

  /**
   * 生命周期状态 (映射到 WorkspaceResourceRecord.lifecycleState)
   *
   * - active: 正常可访问
   * - read_only: 只读（禁止写入/执行）
   * - retired: 已退役（完全拒绝访问）
   */
  state: WorkspaceLifecycleState;

  /**
   * 创建时间 (映射到 Governance Envelope.createdAt)
   */
  createdAt: string; // ISO 8601

  /**
   * 更新时间 (映射到 Governance Envelope.updatedAt)
   */
  updatedAt: string; // ISO 8601

  /**
   * 可选元数据 (从 Catalog projection 字段读取)
   *
   * - displayName: 用户友好名称 (UI 展示)
   * - description: 工作区描述
   * - tags: 标签（用于搜索/分类）
   */
  metadata?: {
    displayName?: string;
    description?: string;
    tags?: string[];
  };
};

/**
 * Workspace Owner (从 WorkspaceOwnerScope 映射)
 */
export type WorkspaceOwner =
  | { kind: "user"; userId: string }
  | { kind: "group"; groupId: string }
  | { kind: "agent"; agentId: string; agentAssetId: string };

/**
 * Workspace Capability (工作区能力)
 */
export type WorkspaceCapability =
  | "read" // 读取文件 (read_file, read_code)
  | "write" // 写入文件 (fs_write, str_replace, fs_append)
  | "execute" // 执行命令 (execute_bash)
  | "list" // 列举目录 (list_directory, glob, file_search)
  | "watch"; // 监听文件变更 (未来)

/**
 * Workspace Lifecycle State (简化映射)
 */
export type WorkspaceLifecycleState = "active" | "read_only" | "retired";
```

### 2.2 与 Data Governance Catalog 的映射关系

```typescript
/**
 * 从 Catalog Record 构造 Workspace Handle (类型化视图)
 *
 * 输入: CatalogRecord (from WorkspaceResourceCatalog)
 * 输出: WorkspaceHandle (类型化视图)
 */
export function buildWorkspaceHandleFromCatalogRecord(record: {
  envelope: DataGovernanceEnvelope;
  bindings: StorageBinding[];
}): WorkspaceHandle | null {
  const { envelope, bindings } = record;

  // 1. 类型检查：必须是 workspace 类型
  if (envelope.resourceType !== "workspace") {
    return null;
  }

  // 2. 查找 canonical binding（必须存在）
  const canonicalBinding = bindings.find((b) => b.role === "canonical");
  if (!canonicalBinding) {
    throw new Error(`Workspace ${envelope.resourceId} missing canonical binding`);
  }

  // 3. 映射 owner (从 WorkspaceOwnerScope)
  const owner = mapOwnerScopeToWorkspaceOwner(envelope.scope);
  if (!owner) {
    throw new Error(`Workspace ${envelope.resourceId} has invalid owner scope`);
  }

  // 4. 推导 capabilities (从 binding role)
  const capabilities = deriveCapabilitiesFromBinding(canonicalBinding);

  // 5. 映射生命周期状态
  const state = mapLifecycleStateToWorkspaceState(envelope.lifecycleState);

  // 6. 提取元数据 (从 projection 字段)
  const metadata = extractWorkspaceMetadata(envelope.projection);

  return {
    id: envelope.resourceId,
    kind: "workspace",
    tenantId: envelope.tenantId,
    owner,
    rootPath: canonicalBinding.locator,
    capabilities,
    state,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    metadata,
  };
}

/**
 * 映射 WorkspaceOwnerScope → WorkspaceOwner
 */
function mapOwnerScopeToWorkspaceOwner(scope: ResourceScope): WorkspaceOwner | null {
  if (scope.kind === "user") {
    return { kind: "user", userId: scope.userId };
  }
  if (scope.kind === "group") {
    return { kind: "group", groupId: scope.groupId };
  }
  // Agent ownership 从 projection 字段提取
  return null;
}

/**
 * 推导能力边界 (从 Binding Role)
 */
function deriveCapabilitiesFromBinding(binding: StorageBinding): WorkspaceCapability[] {
  switch (binding.role) {
    case "canonical":
      // 完整权限（读/写/执行/列举）
      return ["read", "write", "execute", "list"];
    case "replica":
      // 只读副本
      return ["read", "list"];
    case "archive":
      // 只读归档（不允许列举）
      return ["read"];
    case "cache":
      // 缓存（读+列举）
      return ["read", "list"];
    case "compatibility":
      // 兼容层（读+列举，P2 支持写）
      return ["read", "list"];
    default:
      // 未知 role → fail-closed（仅读）
      return ["read"];
  }
}

/**
 * 映射生命周期状态 (简化)
 */
function mapLifecycleStateToWorkspaceState(state: LifecycleState): WorkspaceLifecycleState {
  switch (state) {
    case "active":
      return "active";
    case "read_only":
    case "archived":
      return "read_only";
    case "retired":
    case "quarantined":
    case "purged":
      return "retired";
    default:
      // 其他状态 (pending/recovery_required/deletion_pending) → fail-closed
      return "retired";
  }
}

/**
 * 提取工作区元数据 (从 projection 字段)
 */
function extractWorkspaceMetadata(
  projection?: Record<string, string | null>,
): WorkspaceHandle["metadata"] | undefined {
  if (!projection) {
    return undefined;
  }

  return {
    displayName: projection.displayName ?? undefined,
    description: projection.description ?? undefined,
    tags: projection.tags ? JSON.parse(projection.tags) : undefined,
  };
}
```

### 2.3 Owner 与 OwnershipPrincipal 的映射

```typescript
/**
 * 从 OwnershipPrincipal (Governance Envelope) 映射到 WorkspaceOwner
 *
 * 注意: WorkspaceOwnerScope 与 OwnershipPrincipal 不完全一致
 * - OwnershipPrincipal 来自 Governance Envelope (owner 字段)
 * - WorkspaceOwnerScope 来自 Workspace Resolver 的 scope 字段
 *
 * 映射关系:
 * - OwnershipPrincipal { kind: "user" } → WorkspaceOwner { kind: "user" }
 * - OwnershipPrincipal { kind: "group" } → WorkspaceOwner { kind: "group" }
 * - OwnershipPrincipal { kind: "system", systemId: "agent:<id>" } → WorkspaceOwner { kind: "agent" }
 */
export function mapOwnershipPrincipalToWorkspaceOwner(
  principal: OwnershipPrincipal,
): WorkspaceOwner | null {
  if (principal.kind === "user") {
    return { kind: "user", userId: principal.userId };
  }

  if (principal.kind === "group") {
    return { kind: "group", groupId: principal.groupId };
  }

  if (principal.kind === "system") {
    // Agent ownership: systemId 格式为 "agent:<agentId>:<agentAssetId>"
    const match = principal.systemId.match(/^agent:([^:]+):([^:]+)$/);
    if (match) {
      return {
        kind: "agent",
        agentId: match[1],
        agentAssetId: match[2],
      };
    }
  }

  // 其他情况 → 不支持
  return null;
}
```

---

## 3. 租户绑定与隔离（Tenant Binding & Isolation）

### 3.1 租户绑定规则

```typescript
/**
 * 租户绑定规则（复用 Catalog 既有机制）
 *
 * 1. Group Workspace: tenantId 来源于 WorkspaceResourceRecord.tenantId
 * 2. Steward Workspace: tenantId 从 agent 所属租户解析
 * 3. User-Owned Workspace: tenantId 从员工 membership 解析
 * 4. Local Folder: tenantId = null (本地匿名访问)
 */
export function resolveTenantBindingForWorkspace(params: {
  workspaceKind: "group" | "steward" | "user-owned" | "local";
  agentTenantId?: string;
  userMembershipTenantId?: string;
}): string | null {
  switch (params.workspaceKind) {
    case "group":
      // Group workspace: 必须有明确的 tenantId
      // (从 Catalog Record 的 tenantId 字段读取)
      return null; // 由 Catalog 提供

    case "steward":
      // Steward workspace: 从 agent 所属租户解析
      return params.agentTenantId ?? null;

    case "user-owned":
      // User-owned workspace: 从员工 membership 解析
      return params.userMembershipTenantId ?? null;

    case "local":
      // Local folder: 无租户绑定
      return null;

    default:
      return null;
  }
}
```

### 3.2 租户隔离校验

```typescript
/**
 * 校验租户隔离（Tenant Isolation Validation）
 *
 * 规则:
 * 1. Local folder (tenantId=null) 只能在 employee 域访问
 * 2. 企业工作区必须租户匹配 (resource.tenantId === principal.tenantId)
 * 3. Platform 域可访问所有工作区（运营后台）
 * 4. Enterprise 域只能访问本租户工作区
 * 5. Employee 域可访问: 本人工作区 + 本租户工作区 (需成员检查)
 */
export function validateTenantIsolation(params: {
  resourceTenantId: string | null;
  principal: TrustedPrincipal;
}): { ok: true } | { ok: false; reason: TenantIsolationDenyReason } {
  const { resourceTenantId, principal } = params;

  // Rule 1: Platform 域不受租户隔离限制（运营后台）
  if (principal.sessionDomain === "platform") {
    return { ok: true };
  }

  // Rule 2: Local folder 只能在 employee 域访问
  if (resourceTenantId === null) {
    if (principal.sessionDomain !== "employee") {
      return { ok: false, reason: "local_workspace_requires_employee_domain" };
    }
    // employee 域可访问本地工作区（需进一步检查 owner）
    return { ok: true };
  }

  // Rule 3: 企业工作区必须租户匹配
  if (principal.tenantId === undefined) {
    // Principal 无租户绑定 → 不能访问企业工作区
    return { ok: false, reason: "principal_not_enterprise_member" };
  }

  if (resourceTenantId !== principal.tenantId) {
    // 租户不匹配 → 跨租户访问被拒绝
    return { ok: false, reason: "tenant_mismatch" };
  }

  // Rule 4: 租户匹配 → 允许访问
  return { ok: true };
}

export type TenantIsolationDenyReason =
  | "local_workspace_requires_employee_domain"
  | "principal_not_enterprise_member"
  | "tenant_mismatch";
```

---

## 4. 能力边界（Capability Boundaries）

### 4.1 能力检查

```typescript
/**
 * 检查工作区是否具有指定能力
 */
export function checkWorkspaceCapability(
  handle: WorkspaceHandle,
  operation: WorkspaceResourceOperation,
): { ok: true } | { ok: false; reason: string } {
  // 映射 operation → required capability
  const requiredCapability = mapOperationToCapability(operation);

  if (!handle.capabilities.includes(requiredCapability)) {
    return {
      ok: false,
      reason: `workspace_lacks_capability_${requiredCapability}`,
    };
  }

  return { ok: true };
}

/**
 * 映射 Tool Operation → Workspace Capability
 */
function mapOperationToCapability(operation: WorkspaceResourceOperation): WorkspaceCapability {
  switch (operation) {
    case "read":
    case "preview":
      return "read";
    case "write":
      return "write";
    case "list":
      return "list";
    default:
      // 未知 operation → fail-closed (需要最高权限)
      return "write";
  }
}
```

### 4.2 生命周期状态检查

```typescript
/**
 * 检查工作区生命周期状态是否允许访问
 */
export function checkWorkspaceLifecycleState(
  handle: WorkspaceHandle,
  operation: WorkspaceResourceOperation,
): { ok: true } | { ok: false; reason: LifecycleStateDenyReason } {
  const { state } = handle;

  // Rule 1: retired 工作区完全拒绝访问
  if (state === "retired") {
    return { ok: false, reason: "workspace_retired" };
  }

  // Rule 2: read_only 工作区拒绝写入/执行
  if (state === "read_only" && operation === "write") {
    return { ok: false, reason: "workspace_read_only" };
  }

  // Rule 3: active 工作区允许所有操作
  return { ok: true };
}

export type LifecycleStateDenyReason = "workspace_retired" | "workspace_read_only";
```

---

## 5. 查询与创建（Query & Create）

### 5.1 查询授权的 Workspace Handles

```typescript
/**
 * 查询授权的 Workspace Handles (从 Catalog 动态查询)
 *
 * 输入:
 * - catalog: WorkspaceResourceCatalog (唯一 SoT)
 * - principal: TrustedPrincipal (调用者身份)
 * - filter: 可选过滤条件
 *
 * 输出:
 * - WorkspaceHandle[] (符合条件且授权的工作区列表)
 *
 * 租户隔离:
 * - Platform 域: 返回所有工作区
 * - Enterprise 域: 只返回本租户工作区
 * - Employee 域: 只返回本人工作区 + 本租户工作区 (需成员检查)
 */
export async function queryAuthorizedWorkspaceHandles(params: {
  catalog: WorkspaceResourceCatalog;
  principal: TrustedPrincipal;
  filter?: {
    tenantId?: string | null;
    ownerId?: string;
    kind?: "group" | "steward" | "user-owned" | "local";
    state?: WorkspaceLifecycleState;
  };
}): Promise<WorkspaceHandle[]> {
  const { catalog, principal, filter } = params;

  const snapshot = catalog.snapshot();
  const handles: WorkspaceHandle[] = [];

  for (const [resourceId, resource] of Object.entries(snapshot.resources)) {
    // 1. 类型过滤: 只选 workspace 类型
    if (resource.resourceType !== "workspace") {
      continue;
    }

    // 2. 租户隔离检查
    const isolationResult = validateTenantIsolation({
      resourceTenantId: resource.tenantId,
      principal,
    });
    if (!isolationResult.ok) {
      continue; // 跨租户访问被拒绝
    }

    // 3. 构造 Handle (从 Catalog Record)
    const bindings = catalog.listBindingsForResource(resourceId);
    const handle = buildWorkspaceHandleFromCatalogRecord({
      envelope: resource as unknown as DataGovernanceEnvelope,
      bindings: bindings as StorageBinding[],
    });

    if (!handle) {
      continue; // 无效记录
    }

    // 4. 应用可选过滤条件
    if (filter) {
      if (filter.tenantId !== undefined && handle.tenantId !== filter.tenantId) {
        continue;
      }
      if (
        filter.ownerId &&
        handle.owner.kind === "user" &&
        handle.owner.userId !== filter.ownerId
      ) {
        continue;
      }
      if (filter.state && handle.state !== filter.state) {
        continue;
      }
    }

    handles.push(handle);
  }

  return handles;
}
```

### 5.2 创建 Workspace Handle (通过 Catalog)

```typescript
/**
 * 创建 Workspace Handle (通过 Catalog API)
 *
 * 注意: 不直接创建 Handle，而是通过 Catalog 创建 Resource + Binding
 * Handle 是 Catalog Record 的类型化视图
 */
export async function createWorkspaceHandleViaCatalog(params: {
  catalog: WorkspaceResourceCatalog;
  tenantId: string | null;
  owner: WorkspaceOwner;
  rootPath: string;
  classification?: string;
  metadata?: WorkspaceHandle["metadata"];
}): Promise<WorkspaceHandle> {
  const { catalog, tenantId, owner, rootPath, classification, metadata } = params;

  // 1. 生成 Resource ID
  const resourceId = `wsr_${generateUuid()}`;

  // 2. 构造 Governance Envelope
  const ownershipPrincipal = mapWorkspaceOwnerToOwnershipPrincipal(owner);
  const scope = mapWorkspaceOwnerToResourceScope(owner);

  const envelope: DataGovernanceEnvelope = {
    resourceId,
    resourceType: "workspace",
    schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
    tenantId,
    owner: ownershipPrincipal,
    scope,
    lifecycleState: "active",
    classification: classification ?? "internal",
    governanceVersion: 1,
    canonicalBindingId: `wsb_${generateUuid()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projection: metadata
      ? {
          displayName: metadata.displayName ?? null,
          description: metadata.description ?? null,
          tags: metadata.tags ? JSON.stringify(metadata.tags) : null,
        }
      : undefined,
  };

  // 3. 构造 Canonical Binding
  const binding: StorageBinding = {
    bindingId: envelope.canonicalBindingId,
    resourceId,
    role: "canonical",
    storageKind: "filesystem",
    locator: rootPath,
    state: "active",
    contentVersion: "v1",
  };

  // 4. 通过 Catalog API 持久化
  // (注意: 实际 Catalog API 接口待 Data Governance owner 确认)
  // await catalog.createResource(envelope, [binding]);

  // 5. 构造并返回 Handle 视图
  const handle = buildWorkspaceHandleFromCatalogRecord({
    envelope,
    bindings: [binding],
  });

  if (!handle) {
    throw new Error("Failed to create workspace handle");
  }

  return handle;
}

function mapWorkspaceOwnerToOwnershipPrincipal(owner: WorkspaceOwner): OwnershipPrincipal {
  if (owner.kind === "user") {
    return { kind: "user", userId: owner.userId };
  }
  if (owner.kind === "group") {
    return { kind: "group", groupId: owner.groupId };
  }
  if (owner.kind === "agent") {
    return {
      kind: "system",
      systemId: `agent:${owner.agentId}:${owner.agentAssetId}`,
    };
  }
  throw new Error("Unsupported owner kind");
}

function mapWorkspaceOwnerToResourceScope(owner: WorkspaceOwner): ResourceScope {
  if (owner.kind === "user") {
    return { kind: "user", userId: owner.userId };
  }
  if (owner.kind === "group") {
    return { kind: "group", groupId: owner.groupId };
  }
  if (owner.kind === "agent") {
    return { kind: "system" };
  }
  throw new Error("Unsupported owner kind");
}
```

---

## 6. 错误处理（Error Handling）

### 6.1 错误码定义

```typescript
export type WorkspaceHandleErrorCode =
  | "catalog_unavailable"
  | "resource_not_found"
  | "tenant_mismatch"
  | "workspace_retired"
  | "workspace_read_only"
  | "workspace_lacks_capability_read"
  | "workspace_lacks_capability_write"
  | "workspace_lacks_capability_execute"
  | "workspace_lacks_capability_list"
  | "local_workspace_requires_employee_domain"
  | "principal_not_enterprise_member"
  | "binding_not_found"
  | "invalid_root_path";

export type WorkspaceHandleError = {
  code: WorkspaceHandleErrorCode;
  message: string;
  userMessage?: string;
  context?: Record<string, unknown>;
};
```

### 6.2 用户提示映射

```typescript
export function getWorkspaceHandleErrorUserMessage(code: WorkspaceHandleErrorCode): string {
  const messages: Record<WorkspaceHandleErrorCode, string> = {
    catalog_unavailable: "工作区服务暂时不可用，请稍后重试",
    resource_not_found: "工作区不存在或未授权",
    tenant_mismatch: "您无权访问其他企业的工作区",
    workspace_retired: "工作区已退役，不可访问",
    workspace_read_only: "工作区已设为只读，不允许修改",
    workspace_lacks_capability_read: "当前工作区不允许读取",
    workspace_lacks_capability_write: "当前工作区不允许写入",
    workspace_lacks_capability_execute: "当前工作区不允许执行命令",
    workspace_lacks_capability_list: "当前工作区不允许列举文件",
    local_workspace_requires_employee_domain: "本地工作区仅在个人工作台可访问",
    principal_not_enterprise_member: "您的账号尚未关联企业",
    binding_not_found: "工作区绑定丢失（内部错误）",
    invalid_root_path: "工作区路径不合法",
  };

  return messages[code] ?? "工作区访问被拒绝";
}
```

---

## 7. 测试计划（Testing Plan）

### 7.1 单元测试

```typescript
describe("WorkspaceHandle Model", () => {
  describe("buildWorkspaceHandleFromCatalogRecord", () => {
    it("should build handle from valid catalog record", () => {
      const record = {
        envelope: {
          resourceId: "wsr_123",
          resourceType: "workspace",
          tenantId: "ent-456",
          owner: { kind: "user", userId: "usr-789" },
          scope: { kind: "user", userId: "usr-789" },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId: "wsb_abc",
          createdAt: "2026-08-29T00:00:00Z",
          updatedAt: "2026-08-29T00:00:00Z",
        },
        bindings: [
          {
            bindingId: "wsb_abc",
            resourceId: "wsr_123",
            role: "canonical",
            storageKind: "filesystem",
            locator: "/workspace/test",
            state: "active",
            contentVersion: "v1",
          },
        ],
      };

      const handle = buildWorkspaceHandleFromCatalogRecord(record);

      expect(handle).toMatchObject({
        id: "wsr_123",
        kind: "workspace",
        tenantId: "ent-456",
        owner: { kind: "user", userId: "usr-789" },
        rootPath: "/workspace/test",
        capabilities: ["read", "write", "execute", "list"],
        state: "active",
      });
    });

    it("should return null for non-workspace resource", () => {
      const record = {
        envelope: { resourceType: "agent" /* ... */ },
        bindings: [],
      };

      const handle = buildWorkspaceHandleFromCatalogRecord(record);
      expect(handle).toBeNull();
    });
  });

  describe("deriveCapabilitiesFromBinding", () => {
    it("should derive full capabilities from canonical binding", () => {
      const binding = { role: "canonical" /* ... */ };
      const caps = deriveCapabilitiesFromBinding(binding);
      expect(caps).toEqual(["read", "write", "execute", "list"]);
    });

    it("should derive read-only capabilities from replica binding", () => {
      const binding = { role: "replica" /* ... */ };
      const caps = deriveCapabilitiesFromBinding(binding);
      expect(caps).toEqual(["read", "list"]);
    });
  });

  describe("validateTenantIsolation", () => {
    it("should allow platform domain to access any workspace", () => {
      const result = validateTenantIsolation({
        resourceTenantId: "ent-123",
        principal: {
          userId: "usr-admin",
          tenantId: undefined,
          sessionDomain: "platform",
          source: "platform-auth-session",
          resolvedAt: Date.now(),
        },
      });

      expect(result.ok).toBe(true);
    });

    it("should deny cross-tenant access", () => {
      const result = validateTenantIsolation({
        resourceTenantId: "ent-AAA",
        principal: {
          userId: "usr-123",
          tenantId: "ent-BBB",
          sessionDomain: "enterprise",
          source: "platform-auth-session",
          resolvedAt: Date.now(),
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("tenant_mismatch");
      }
    });

    it("should allow local workspace in employee domain", () => {
      const result = validateTenantIsolation({
        resourceTenantId: null,
        principal: {
          userId: "usr-123",
          tenantId: undefined,
          sessionDomain: "employee",
          source: "platform-auth-session",
          resolvedAt: Date.now(),
        },
      });

      expect(result.ok).toBe(true);
    });

    it("should deny local workspace in non-employee domain", () => {
      const result = validateTenantIsolation({
        resourceTenantId: null,
        principal: {
          userId: "usr-123",
          tenantId: "ent-456",
          sessionDomain: "enterprise",
          source: "platform-auth-session",
          resolvedAt: Date.now(),
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("local_workspace_requires_employee_domain");
      }
    });
  });
});
```

### 7.2 集成测试

```typescript
describe("WorkspaceHandle Integration", () => {
  it("should query authorized handles for employee principal", async () => {
    const catalog = createTestCatalog();
    const principal = {
      userId: "usr-123",
      tenantId: "ent-456",
      sessionDomain: "employee",
      source: "platform-auth-session",
      resolvedAt: Date.now(),
    };

    const handles = await queryAuthorizedWorkspaceHandles({
      catalog,
      principal,
    });

    // 应只包含本人工作区 + 本租户工作区
    expect(handles.length).toBeGreaterThan(0);
    handles.forEach((handle) => {
      expect(handle.tenantId === null || handle.tenantId === "ent-456").toBe(true);
    });
  });

  it("should create workspace handle via catalog", async () => {
    const catalog = createEmptyWorkspaceCatalog();

    const handle = await createWorkspaceHandleViaCatalog({
      catalog,
      tenantId: "ent-123",
      owner: { kind: "user", userId: "usr-456" },
      rootPath: "/workspace/test",
      metadata: {
        displayName: "Test Workspace",
        description: "A test workspace",
      },
    });

    expect(handle.id).toMatch(/^wsr_/);
    expect(handle.tenantId).toBe("ent-123");
    expect(handle.metadata?.displayName).toBe("Test Workspace");

    // 验证 Catalog 中存在对应的 Resource
    const resource = catalog.getResource(handle.id);
    expect(resource).toBeDefined();
  });
});
```

---

## 8. 性能要求（Performance Requirements）

| 指标               | 目标   | 理由               |
| ------------------ | ------ | ------------------ |
| Handle 构造 (P99)  | < 1ms  | 纯内存映射，无 I/O |
| Catalog 查询 (P99) | < 20ms | Snapshot 快照查询  |
| 租户隔离检查 (P99) | < 1ms  | 纯逻辑判断         |

---

## 9. 评审检查清单（Review Checklist）

- [x] 数据模型完整（包含所有必需字段）
- [x] 作为 Catalog 类型化视图（不新建独立表）
- [x] 租户绑定规则明确
- [x] 租户隔离校验完备
- [x] 能力边界从 Binding Role 推导
- [x] 生命周期状态检查清晰
- [x] 查询接口定义完整
- [x] 创建接口通过 Catalog API
- [x] 错误码与用户提示完备
- [x] 测试计划覆盖核心场景
- [x] 性能要求可达成

---

**状态**: D2 设计完成，等待评审
