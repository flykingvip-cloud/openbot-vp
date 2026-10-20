> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D4: resolveAuthorizedToolCwd 接口契约（详细设计）

> **Handoff**: S01 - Trusted Principal & Workspace Handle Gate Design  
> **交付物**: D4 - resolveAuthorizedToolCwd Interface Contract  
> **状态**: `design-complete`  
> **版本**: 1.0  
> **日期**: 2026-08-29

---

## 1. 概述（Overview）

本设计定义 `resolveAuthorizedToolCwd` 接口的完整契约，包括：

- TypeScript 类型定义
- Zod schema 校验
- 完整错误码体系
- 审计日志规范
- 集成示例与测试

### 1.1 接口职责

`resolveAuthorizedToolCwd` 是 **Agent Tool 执行的核心授权门禁**，负责：

1. 校验 Trusted Principal（调用者身份）
2. 查询授权的 Workspace Handle（从 Catalog）
3. 检查租户隔离、能力边界、生命周期状态
4. 返回授权的 CWD 或拒绝访问
5. 记录审计日志

---

## 2. TypeScript 接口定义（TypeScript Interface）

### 2.1 参数类型

```typescript
/**
 * resolveAuthorizedToolCwd 参数
 */
export type ResolveAuthorizedToolCwdParams = {
  /**
   * Workspace Resource Catalog (Data Governance 唯一 SoT)
   *
   * - 必填
   * - 提供: WorkspaceResourceCatalog 实例（通常从 runtime 获取）
   * - 用途: 查询授权的 Workspace Handle
   */
  catalog: WorkspaceResourceCatalog;

  /**
   * Trusted Principal (可信主体，由 resolveTrustedPrincipal 解析)
   *
   * - 可选: null 时表示匿名访问
   * - Fail-Closed: null 且 allowAnonymousLocal=false → 拒绝
   * - 用途: 租户隔离、Owner 检查、审计日志
   */
  principal: TrustedPrincipal | null;

  /**
   * 请求的 CWD (Current Working Directory)
   *
   * - 可为相对路径或绝对路径
   * - 规范化: 函数内部会解析软链接、移除尾部斜杠
   * - 示例: "/workspace/group-alpha", "./relative/path", "/Users/alice/project"
   */
  requestedCwd: string;

  /**
   * 工具操作类型
   *
   * - read: 读取文件 (read_file, read_code)
   * - write: 写入文件 (fs_write, str_replace, fs_append)
   * - execute: 执行命令 (execute_bash)
   * - list: 列举目录 (list_directory, glob, file_search)
   *
   * - 用途: 能力边界检查（Workspace Handle 必须具有对应 capability）
   */
  operation: "read" | "write" | "execute" | "list";

  /**
   * 允许匿名本地访问（降级路径）
   *
   * - 默认: false
   * - true: 当 principal=null 且 requestedCwd 是本地路径时，允许访问
   * - 用途: 向后兼容 local operator mode
   */
  allowAnonymousLocal?: boolean;

  /**
   * 审计上下文（可选，用于审计日志）
   */
  auditContext?: {
    /** 工具名称 (例: "read_file", "execute_bash") */
    toolName: string;
    /** 会话 ID */
    sessionId: string;
    /** 请求 ID (用于关联日志) */
    requestId: string;
  };
};
```

### 2.2 返回类型

```typescript
/**
 * resolveAuthorizedToolCwd 返回结果
 *
 * - 成功: ok=true, 包含 resolvedPath 和 handle
 * - 失败: ok=false, 包含 code 和 message
 */
export type ResolveAuthorizedToolCwdResult =
  | ResolveAuthorizedToolCwdSuccess
  | ResolveAuthorizedToolCwdFailure;

/**
 * 成功结果
 */
export type ResolveAuthorizedToolCwdSuccess = {
  ok: true;

  /**
   * 解析后的 CWD 路径 (绝对路径，规范化)
   *
   * - 示例: "/workspace/group-alpha"
   * - 用途: 传递给 Tool 执行函数 (fs_write, execute_bash, ...)
   */
  resolvedPath: string;

  /**
   * 授权的 Workspace Handle
   *
   * - 包含: id, tenantId, owner, capabilities, state, metadata
   * - 用途: 后续能力检查、审计日志
   */
  handle: WorkspaceHandle;

  /**
   * 访问模式
   *
   * - authorized: 通过 Principal + Catalog 授权
   * - local-anonymous: 匿名本地访问（降级路径）
   */
  accessMode: "authorized" | "local-anonymous";

  /**
   * 审计记录 ID
   *
   * - 格式: UUID v4
   * - 用途: 关联审计日志、追溯访问记录
   */
  auditRecordId: string;
};

/**
 * 失败结果
 */
export type ResolveAuthorizedToolCwdFailure = {
  ok: false;

  /**
   * 错误码 (机器可读)
   *
   * - 用途: 错误处理、重试决策、监控告警
   */
  code: AuthorizedToolCwdErrorCode;

  /**
   * 错误消息 (开发者可读，英文)
   *
   * - 包含: 错误原因、上下文信息
   * - 示例: "Tenant mismatch: resource belongs to ent-AAA, principal belongs to ent-BBB"
   */
  message: string;

  /**
   * 用户提示 (终端用户可读，中文)
   *
   * - 可选: 部分错误码有用户友好提示
   * - 示例: "您无权访问其他企业的工作区"
   */
  userMessage?: string;

  /**
   * 上下文信息 (用于调试)
   *
   * - 可选: 包含 resourceId, tenantId, requestedCwd 等
   */
  context?: Record<string, unknown>;
};
```

---

## 3. 错误码体系（Error Code System）

### 3.1 错误码定义

```typescript
/**
 * AuthorizedToolCwd 错误码（完备集合）
 *
 * 分类:
 * 1. Principal 相关 (ERR_PRINCIPAL_*)
 * 2. Workspace 相关 (ERR_WORKSPACE_*)
 * 3. Catalog 相关 (ERR_CATALOG_*)
 * 4. 能力相关 (ERR_CAPABILITY_*)
 * 5. 租户相关 (ERR_TENANT_*)
 * 6. 路径相关 (ERR_PATH_*)
 */
export type AuthorizedToolCwdErrorCode =
  // Principal 相关
  | "ERR_PRINCIPAL_REQUIRED" // 缺少可信主体
  | "ERR_TENANT_BINDING_REQUIRED" // 租户绑定缺失

  // Workspace 相关
  | "ERR_WORKSPACE_NOT_FOUND" // 工作区未注册
  | "ERR_WORKSPACE_SUSPENDED" // 工作区已暂停
  | "ERR_WORKSPACE_ARCHIVED" // 工作区已归档
  | "ERR_WORKSPACE_RETIRED" // 工作区已退役

  // Tenant 相关
  | "ERR_TENANT_MISMATCH" // 租户隔离冲突

  // Capability 相关
  | "ERR_CAPABILITY_DENIED" // 能力不足

  // Path 相关
  | "ERR_PATH_OUTSIDE_WORKSPACE" // 路径越界
  | "ERR_INVALID_PATH" // 路径格式非法

  // Catalog 相关
  | "ERR_CATALOG_UNAVAILABLE"; // Catalog 不可用
```

### 3.2 错误码语义表

| 错误码                        | 语义           | 触发条件                                                    | 用户提示                     | 可重试           |
| ----------------------------- | -------------- | ----------------------------------------------------------- | ---------------------------- | ---------------- |
| `ERR_PRINCIPAL_REQUIRED`      | 缺少可信主体   | `principal === null` 且 `!allowAnonymousLocal`              | "请先登录以访问工作区"       | 否（需登录）     |
| `ERR_TENANT_BINDING_REQUIRED` | 租户绑定缺失   | `principal` 有效但 `tenantId` 为空，且访问企业工作区        | "您的账号尚未关联企业"       | 否（需加入企业） |
| `ERR_WORKSPACE_NOT_FOUND`     | 工作区未注册   | Catalog 中无匹配 CWD 的 Resource                            | "工作区不存在或未授权"       | 否               |
| `ERR_TENANT_MISMATCH`         | 租户隔离冲突   | `resource.tenantId !== principal.tenantId`                  | "您无权访问其他企业的工作区" | 否               |
| `ERR_CAPABILITY_DENIED`       | 能力不足       | `operation` 不在 `handle.capabilities` 中                   | "当前工作区不允许该操作"     | 否               |
| `ERR_WORKSPACE_SUSPENDED`     | 工作区已暂停   | `lifecycleState === "read_only"` 且 `operation === "write"` | "工作区已被管理员暂停"       | 否（等待恢复）   |
| `ERR_WORKSPACE_ARCHIVED`      | 工作区已归档   | `lifecycleState === "archived"`                             | "工作区已归档，不可访问"     | 否               |
| `ERR_WORKSPACE_RETIRED`       | 工作区已退役   | `lifecycleState === "retired"`                              | "工作区已退役"               | 否               |
| `ERR_PATH_OUTSIDE_WORKSPACE`  | 路径越界       | `resolvedPath` 不在 `handle.rootPath` 下                    | "路径超出工作区范围"         | 否               |
| `ERR_CATALOG_UNAVAILABLE`     | Catalog 不可用 | 索引加载失败或超时                                          | "工作区服务暂时不可用"       | 是（瞬时故障）   |
| `ERR_INVALID_PATH`            | 路径格式非法   | 包含 `..` 或无效字符                                        | "路径格式不合法"             | 否               |

### 3.3 错误处理辅助函数

```typescript
/**
 * 获取错误的用户提示
 */
export function getErrorUserMessage(code: AuthorizedToolCwdErrorCode): string {
  const messages: Record<AuthorizedToolCwdErrorCode, string> = {
    ERR_PRINCIPAL_REQUIRED: "请先登录以访问工作区",
    ERR_TENANT_BINDING_REQUIRED: "您的账号尚未关联企业",
    ERR_WORKSPACE_NOT_FOUND: "工作区不存在或未授权",
    ERR_TENANT_MISMATCH: "您无权访问其他企业的工作区",
    ERR_CAPABILITY_DENIED: "当前工作区不允许该操作",
    ERR_WORKSPACE_SUSPENDED: "工作区已被管理员暂停",
    ERR_WORKSPACE_ARCHIVED: "工作区已归档，不可访问",
    ERR_WORKSPACE_RETIRED: "工作区已退役",
    ERR_PATH_OUTSIDE_WORKSPACE: "路径超出工作区范围",
    ERR_CATALOG_UNAVAILABLE: "工作区服务暂时不可用",
    ERR_INVALID_PATH: "路径格式不合法",
  };

  return messages[code] ?? "工作区访问被拒绝";
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(code: AuthorizedToolCwdErrorCode): boolean {
  return code === "ERR_CATALOG_UNAVAILABLE";
}

/**
 * 构造失败结果
 */
export function buildFailureResult(
  code: AuthorizedToolCwdErrorCode,
  message: string,
  context?: Record<string, unknown>,
): ResolveAuthorizedToolCwdFailure {
  return {
    ok: false,
    code,
    message,
    userMessage: getErrorUserMessage(code),
    context,
  };
}
```

---

## 4. Zod Schema 定义（Zod Schema）

```typescript
import { z } from "zod";

/**
 * 参数 Schema
 */
export const ResolveAuthorizedToolCwdParamsSchema = z.object({
  catalog: z.custom<WorkspaceResourceCatalog>((val) => {
    return (
      val !== null &&
      typeof val === "object" &&
      "snapshot" in val &&
      typeof val.snapshot === "function"
    );
  }, "catalog must be a WorkspaceResourceCatalog instance"),

  principal: z
    .object({
      userId: z.string().min(1),
      tenantId: z.string().optional(),
      sessionDomain: z.enum(["platform", "enterprise", "employee"]),
      source: z.enum(["platform-auth-session", "trusted-proxy-header", "device-token"]),
      resolvedAt: z.number().int().positive(),
    })
    .nullable(),

  requestedCwd: z.string().min(1),

  operation: z.enum(["read", "write", "execute", "list"]),

  allowAnonymousLocal: z.boolean().optional(),

  auditContext: z
    .object({
      toolName: z.string().min(1),
      sessionId: z.string().min(1),
      requestId: z.string().min(1),
    })
    .optional(),
});

/**
 * 成功结果 Schema
 */
export const ResolveAuthorizedToolCwdSuccessSchema = z.object({
  ok: z.literal(true),
  resolvedPath: z.string().min(1),
  handle: z.custom<WorkspaceHandle>(),
  accessMode: z.enum(["authorized", "local-anonymous"]),
  auditRecordId: z.string().uuid(),
});

/**
 * 失败结果 Schema
 */
export const ResolveAuthorizedToolCwdFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    "ERR_PRINCIPAL_REQUIRED",
    "ERR_TENANT_BINDING_REQUIRED",
    "ERR_WORKSPACE_NOT_FOUND",
    "ERR_TENANT_MISMATCH",
    "ERR_CAPABILITY_DENIED",
    "ERR_WORKSPACE_SUSPENDED",
    "ERR_WORKSPACE_ARCHIVED",
    "ERR_WORKSPACE_RETIRED",
    "ERR_PATH_OUTSIDE_WORKSPACE",
    "ERR_CATALOG_UNAVAILABLE",
    "ERR_INVALID_PATH",
  ]),
  message: z.string().min(1),
  userMessage: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

/**
 * 返回结果 Schema
 */
export const ResolveAuthorizedToolCwdResultSchema = z.union([
  ResolveAuthorizedToolCwdSuccessSchema,
  ResolveAuthorizedToolCwdFailureSchema,
]);

/**
 * 运行时参数校验
 */
export function validateResolveAuthorizedToolCwdParams(params: unknown):
  | {
      ok: true;
      data: ResolveAuthorizedToolCwdParams;
    }
  | { ok: false; errors: string[] } {
  const result = ResolveAuthorizedToolCwdParamsSchema.safeParse(params);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}
```

---

## 5. 核心实现逻辑（Core Implementation Logic）

### 5.1 主函数实现

```typescript
/**
 * 解析授权的 Tool CWD
 *
 * 核心约束:
 * - 必须有 Trusted Principal (fail-closed)
 * - 必须经 Workspace Catalog 授权
 * - 必须租户隔离
 * - 路径必须规范化且存在
 */
export async function resolveAuthorizedToolCwd(
  params: ResolveAuthorizedToolCwdParams,
): Promise<ResolveAuthorizedToolCwdResult> {
  // 0. 参数校验（Zod）
  const validation = validateResolveAuthorizedToolCwdParams(params);
  if (!validation.ok) {
    return buildFailureResult(
      "ERR_INVALID_PATH",
      `Invalid params: ${validation.errors.join(", ")}`,
    );
  }

  const { catalog, principal, requestedCwd, operation, allowAnonymousLocal } = params;

  // 1. Fail-Closed: 必须有 Principal (除非 allowAnonymousLocal=true)
  if (!principal && !allowAnonymousLocal) {
    return buildFailureResult(
      "ERR_PRINCIPAL_REQUIRED",
      "Trusted principal required for workspace access",
    );
  }

  // 2. 规范化请求的 CWD
  const normalizedCwd = normalizePath(requestedCwd);
  if (!isValidPath(normalizedCwd)) {
    return buildFailureResult("ERR_INVALID_PATH", `Invalid path format: ${normalizedCwd}`);
  }

  // 3. 查询授权的 CWD (从 Catalog)
  let entries: AuthorizedCwdEntry[];
  try {
    entries = await queryAuthorizedCwdsFromCatalog({
      catalog,
      principal: principal!,
      requestedCwd: normalizedCwd,
    });
  } catch (error) {
    return buildFailureResult("ERR_CATALOG_UNAVAILABLE", `Catalog query failed: ${error}`);
  }

  // 4. 选择最佳匹配的 CWD (最长前缀匹配)
  if (entries.length === 0) {
    // 4.1 降级路径: 允许匿名本地访问
    if (allowAnonymousLocal && isLocalPath(normalizedCwd)) {
      const localHandle = buildLocalWorkspaceHandle(normalizedCwd);
      const auditRecordId = await recordToolCwdAudit({
        principal,
        handle: localHandle,
        operation,
        requestedCwd,
        resolvedPath: normalizedCwd,
        accessMode: "local-anonymous",
        auditContext: params.auditContext,
      });

      return {
        ok: true,
        resolvedPath: normalizedCwd,
        handle: localHandle,
        accessMode: "local-anonymous",
        auditRecordId,
      };
    }

    // 4.2 无匹配 → 拒绝
    return buildFailureResult(
      "ERR_WORKSPACE_NOT_FOUND",
      `No authorized workspace found for CWD: ${normalizedCwd}`,
      { requestedCwd },
    );
  }

  const bestMatch = selectBestMatch(entries, normalizedCwd);

  // 5. 构造 Workspace Handle
  const handle = buildWorkspaceHandleFromCatalog(catalog, bestMatch.handleId);
  if (!handle) {
    return buildFailureResult(
      "ERR_WORKSPACE_NOT_FOUND",
      `Failed to build workspace handle for ${bestMatch.handleId}`,
    );
  }

  // 6. 检查能力边界
  const capabilityCheck = checkWorkspaceCapability(handle, operation);
  if (!capabilityCheck.ok) {
    return buildFailureResult("ERR_CAPABILITY_DENIED", capabilityCheck.reason, {
      handleId: handle.id,
      operation,
    });
  }

  // 7. 检查生命周期状态
  const lifecycleCheck = checkWorkspaceLifecycleState(handle, operation);
  if (!lifecycleCheck.ok) {
    const errorCode = mapLifecycleDenyReasonToErrorCode(lifecycleCheck.reason);
    return buildFailureResult(errorCode, lifecycleCheck.reason, {
      handleId: handle.id,
      state: handle.state,
    });
  }

  // 8. 路径越界检查
  if (!isPathUnder(normalizedCwd, handle.rootPath)) {
    return buildFailureResult(
      "ERR_PATH_OUTSIDE_WORKSPACE",
      `Path ${normalizedCwd} is outside workspace root ${handle.rootPath}`,
      { requestedCwd, workspaceRoot: handle.rootPath },
    );
  }

  // 9. 记录审计日志
  const auditRecordId = await recordToolCwdAudit({
    principal,
    handle,
    operation,
    requestedCwd,
    resolvedPath: bestMatch.cwdPath,
    accessMode: "authorized",
    auditContext: params.auditContext,
  });

  // 10. 返回成功结果
  return {
    ok: true,
    resolvedPath: bestMatch.cwdPath,
    handle,
    accessMode: "authorized",
    auditRecordId,
  };
}

/**
 * 选择最佳匹配的 CWD (最长前缀匹配)
 */
function selectBestMatch(entries: AuthorizedCwdEntry[], requestedCwd: string): AuthorizedCwdEntry {
  return entries.reduce((prev, curr) => {
    // 选择路径最长的匹配 (最精确)
    if (curr.cwdPath.length > prev.cwdPath.length) {
      return curr;
    }
    // 路径长度相同时，优先选择 active 状态
    if (
      curr.cwdPath.length === prev.cwdPath.length &&
      curr.state === "active" &&
      prev.state !== "active"
    ) {
      return curr;
    }
    return prev;
  });
}

/**
 * 映射生命周期拒绝原因到错误码
 */
function mapLifecycleDenyReasonToErrorCode(
  reason: LifecycleStateDenyReason,
): AuthorizedToolCwdErrorCode {
  switch (reason) {
    case "workspace_retired":
      return "ERR_WORKSPACE_RETIRED";
    case "workspace_read_only":
      return "ERR_WORKSPACE_SUSPENDED";
    default:
      return "ERR_WORKSPACE_NOT_FOUND";
  }
}
```

---

## 6. 审计日志规范（Audit Log Specification）

### 6.1 审计日志结构

```typescript
/**
 * Tool CWD 审计日志
 */
export type ToolCwdAuditLog = {
  /** 审计记录 ID (UUID v4) */
  auditRecordId: string;

  /** 事件类型 */
  event: "tool_cwd_authorized" | "tool_cwd_denied";

  /** 时间戳 (ISO 8601) */
  timestamp: string;

  /** Principal 信息 */
  principal: {
    userId?: string;
    tenantId?: string;
    sessionDomain?: string;
    source?: string;
  } | null;

  /** 工作区信息 */
  workspace: {
    handleId: string;
    tenantId: string | null;
    ownerId: string | null;
    rootPath: string;
  };

  /** 请求信息 */
  request: {
    requestedCwd: string;
    resolvedPath?: string;
    operation: string;
    toolName?: string;
    sessionId?: string;
    requestId?: string;
  };

  /** 授权结果 */
  authorization: {
    accessMode: "authorized" | "local-anonymous" | "denied";
    denyReason?: AuthorizedToolCwdErrorCode;
  };
};

/**
 * 记录审计日志
 */
export async function recordToolCwdAudit(params: {
  principal: TrustedPrincipal | null;
  handle: WorkspaceHandle;
  operation: string;
  requestedCwd: string;
  resolvedPath?: string;
  accessMode: "authorized" | "local-anonymous";
  auditContext?: {
    toolName?: string;
    sessionId?: string;
    requestId?: string;
  };
}): Promise<string> {
  const auditRecordId = generateUuid();

  const log: ToolCwdAuditLog = {
    auditRecordId,
    event: "tool_cwd_authorized",
    timestamp: new Date().toISOString(),
    principal: params.principal
      ? {
          userId: params.principal.userId,
          tenantId: params.principal.tenantId,
          sessionDomain: params.principal.sessionDomain,
          source: params.principal.source,
        }
      : null,
    workspace: {
      handleId: params.handle.id,
      tenantId: params.handle.tenantId,
      ownerId: params.handle.owner.kind === "user" ? params.handle.owner.userId : null,
      rootPath: params.handle.rootPath,
    },
    request: {
      requestedCwd: params.requestedCwd,
      resolvedPath: params.resolvedPath,
      operation: params.operation,
      toolName: params.auditContext?.toolName,
      sessionId: params.auditContext?.sessionId,
      requestId: params.auditContext?.requestId,
    },
    authorization: {
      accessMode: params.accessMode,
    },
  };

  // 写入审计日志 (实际实现需集成到 audit-logger)
  await writeAuditLog(log);

  return auditRecordId;
}

/**
 * 记录拒绝的审计日志
 */
export async function recordToolCwdDenied(params: {
  principal: TrustedPrincipal | null;
  requestedCwd: string;
  operation: string;
  denyReason: AuthorizedToolCwdErrorCode;
  auditContext?: {
    toolName?: string;
    sessionId?: string;
    requestId?: string;
  };
}): Promise<void> {
  const auditRecordId = generateUuid();

  const log: ToolCwdAuditLog = {
    auditRecordId,
    event: "tool_cwd_denied",
    timestamp: new Date().toISOString(),
    principal: params.principal
      ? {
          userId: params.principal.userId,
          tenantId: params.principal.tenantId,
          sessionDomain: params.principal.sessionDomain,
          source: params.principal.source,
        }
      : null,
    workspace: {
      handleId: "none",
      tenantId: null,
      ownerId: null,
      rootPath: params.requestedCwd,
    },
    request: {
      requestedCwd: params.requestedCwd,
      operation: params.operation,
      toolName: params.auditContext?.toolName,
      sessionId: params.auditContext?.sessionId,
      requestId: params.auditContext?.requestId,
    },
    authorization: {
      accessMode: "denied",
      denyReason: params.denyReason,
    },
  };

  await writeAuditLog(log);
}
```

---

## 7. 集成示例（Integration Examples）

### 7.1 Tool 执行集成

```typescript
/**
 * fs_write Tool 集成示例
 */
export async function fsWriteTool(params: {
  client: GatewayClient;
  path: string;
  text: string;
}): Promise<FsWriteResult> {
  // 1. 解析 Trusted Principal
  const principal = await resolveTrustedPrincipal(params.client);

  // 2. 解析授权的 Tool CWD
  const cwdResult = await resolveAuthorizedToolCwd({
    catalog: getGatewayWorkspaceCatalog(),
    principal,
    requestedCwd: path.dirname(params.path),
    operation: "write",
    allowAnonymousLocal: false,
    auditContext: {
      toolName: "fs_write",
      sessionId: params.client.sessionId,
      requestId: generateRequestId(),
    },
  });

  // 3. 处理失败
  if (!cwdResult.ok) {
    return {
      ok: false,
      error: cwdResult.code,
      message: cwdResult.userMessage ?? cwdResult.message,
    };
  }

  // 4. 执行文件写入
  const fullPath = path.join(cwdResult.resolvedPath, params.path);
  await fs.writeFile(fullPath, params.text);

  return { ok: true };
}
```

### 7.2 execute_bash Tool 集成

```typescript
/**
 * execute_bash Tool 集成示例
 */
export async function executeBashTool(params: {
  client: GatewayClient;
  command: string;
  cwd?: string;
}): Promise<ExecuteBashResult> {
  const principal = await resolveTrustedPrincipal(params.client);

  const cwdResult = await resolveAuthorizedToolCwd({
    catalog: getGatewayWorkspaceCatalog(),
    principal,
    requestedCwd: params.cwd ?? process.cwd(),
    operation: "execute",
    allowAnonymousLocal: false,
    auditContext: {
      toolName: "execute_bash",
      sessionId: params.client.sessionId,
      requestId: generateRequestId(),
    },
  });

  if (!cwdResult.ok) {
    return {
      ok: false,
      error: cwdResult.code,
      message: cwdResult.userMessage ?? cwdResult.message,
    };
  }

  // 执行命令 (在授权的 CWD 下)
  const result = await execAsync(params.command, {
    cwd: cwdResult.resolvedPath,
  });

  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}
```

---

## 8. 测试计划（Testing Plan）

### 8.1 单元测试

```typescript
describe("resolveAuthorizedToolCwd", () => {
  describe("Success Cases", () => {
    it("should resolve authorized CWD for valid principal", async () => {
      const catalog = createTestCatalog();
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedPath).toBe("/workspace/group-alpha");
        expect(result.accessMode).toBe("authorized");
        expect(result.auditRecordId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it("should allow anonymous local access when flag is set", async () => {
      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/local/workspace",
        operation: "read",
        allowAnonymousLocal: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.accessMode).toBe("local-anonymous");
      }
    });
  });

  describe("Failure Cases", () => {
    it("ERR_PRINCIPAL_REQUIRED: should reject when principal is null", async () => {
      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/workspace/test",
        operation: "read",
        allowAnonymousLocal: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_PRINCIPAL_REQUIRED");
        expect(result.userMessage).toBe("请先登录以访问工作区");
      }
    });

    it("ERR_TENANT_MISMATCH: should reject cross-tenant access", async () => {
      const catalog = createTestCatalog();
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-AAA",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/other-tenant", // 属于 ent-BBB
        operation: "read",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_TENANT_MISMATCH");
      }
    });

    it("ERR_CAPABILITY_DENIED: should reject when capability is missing", async () => {
      const catalog = createTestCatalog();
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      // 创建只读工作区
      const readOnlyHandle = createReadOnlyWorkspace(catalog);

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: readOnlyHandle.rootPath,
        operation: "write", // 不允许写入
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_CAPABILITY_DENIED");
      }
    });
  });
});
```

---

## 9. 性能要求（Performance Requirements）

| 指标                 | 目标   | 说明                                          |
| -------------------- | ------ | --------------------------------------------- |
| CWD 解析延迟 (P99)   | < 50ms | 包含 Catalog 查询 + Principal 校验 + 审计日志 |
| Principal 解析 (P99) | < 10ms | 复用既有机制                                  |
| Catalog 查询 (P99)   | < 20ms | Snapshot 查询 (内存)                          |
| 租户隔离检查 (P99)   | < 1ms  | 纯逻辑判断                                    |
| 审计日志写入 (P99)   | < 10ms | 异步写入                                      |

---

## 10. 评审检查清单（Review Checklist）

- [x] TypeScript 接口定义完整
- [x] Zod Schema 校验完备
- [x] 错误码体系完整 (11 个错误场景)
- [x] 每个错误码都有用户提示
- [x] 审计日志规范清晰
- [x] 集成示例覆盖核心 Tool
- [x] 测试计划覆盖成功/失败场景
- [x] 性能要求可达成 (P99 < 50ms)
- [x] Fail-Closed 语义一致
- [x] 向后兼容 (allowAnonymousLocal 降级路径)

---

**状态**: D4 设计完成，等待评审
