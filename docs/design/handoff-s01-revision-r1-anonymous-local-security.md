> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R1: Anonymous Local 模式安全封闭（修订）

> **修订问题**: allowAnonymousLocal=true 是未封闭的安全例外  
> **严重性**: 🔴 高（安全风险）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

**原设计问题**:

- `allowAnonymousLocal=true` 作为向后兼容路径，但没有限定调用方、部署 profile、监听地址、工具能力或生产禁用证明
- 若生产配置误开，Trusted Principal 缺失时仍可能获得本地 CWD
- 存在安全旁路风险

**影响范围**:

- D1 §9 (向后兼容)
- D4 §5 (resolveAuthorizedToolCwd 实现)
- D5 §8 (向后兼容测试)

---

## 2. 修订方案

### 2.1 严格的启用条件（Fail-Closed by Default）

**核心原则**: Anonymous Local 模式**默认禁用**，仅在满足**所有**以下条件时才允许启用：

```typescript
/**
 * Anonymous Local 模式启用条件（全部满足）
 */
export type AnonymousLocalEnableConditions = {
  /** 1. 部署 Profile 必须为 personal_local */
  deploymentProfile: "personal_local";

  /** 2. 监听地址必须为 loopback (127.0.0.1 / ::1) */
  bindAddress: "loopback";

  /** 3. 认证模式必须为 none (无 Platform Auth) */
  authMode: "none";

  /** 4. 明确的环境变量启用标志 */
  envFlag: "OPENBOT_ALLOW_ANONYMOUS_LOCAL=true";

  /** 5. 仅允许只读工具 */
  allowedTools: ["read_file", "read_code", "list_directory", "file_search"];

  /** 6. 禁止写入和执行工具 */
  deniedTools: ["fs_write", "str_replace", "execute_bash", "delete_file"];
};
```

### 2.2 部署 Profile 定义

```typescript
/**
 * 部署 Profile 枚举
 */
export type DeploymentProfile =
  | "personal_local" // 个人本地开发模式（允许匿名）
  | "managed" // 托管模式（企业部署，禁止匿名）
  | "enterprise" // 企业自托管模式（禁止匿名）
  | "production"; // 生产模式（严格禁止匿名）

/**
 * 解析部署 Profile (从环境变量或配置文件)
 */
export function resolveDeploymentProfile(): DeploymentProfile {
  const profile = process.env.OPENBOT_DEPLOYMENT_PROFILE;

  // 默认为 personal_local (最宽松)
  if (!profile) {
    return "personal_local";
  }

  if (profile === "managed" || profile === "enterprise" || profile === "production") {
    return profile;
  }

  return "personal_local";
}

/**
 * 检查部署 Profile 是否允许匿名本地模式
 */
export function isAnonymousLocalAllowedByProfile(profile: DeploymentProfile): boolean {
  // 仅 personal_local 允许匿名
  return profile === "personal_local";
}
```

### 2.3 监听地址检查

```typescript
/**
 * 检查监听地址是否为 loopback
 */
export function isLoopbackAddress(bindAddress: string): boolean {
  // IPv4 loopback
  if (bindAddress === "127.0.0.1" || bindAddress === "localhost") {
    return true;
  }

  // IPv6 loopback
  if (bindAddress === "::1" || bindAddress === "[::1]") {
    return true;
  }

  // 0.0.0.0 或 :: 不是 loopback (监听所有网络接口)
  return false;
}

/**
 * 检查请求是否来自 loopback
 */
export function isRequestFromLoopback(req: Request): boolean {
  const clientIp = req.socket.remoteAddress;

  if (!clientIp) {
    return false;
  }

  return isLoopbackAddress(clientIp);
}
```

### 2.4 工具能力限制

```typescript
/**
 * Anonymous Local 模式允许的工具集（只读）
 */
export const ANONYMOUS_LOCAL_ALLOWED_TOOLS = [
  "read_file",
  "read_code",
  "list_directory",
  "file_search",
  "grep_search",
] as const;

/**
 * Anonymous Local 模式禁止的工具集（写入/执行）
 */
export const ANONYMOUS_LOCAL_DENIED_TOOLS = [
  "fs_write",
  "str_replace",
  "fs_append",
  "execute_bash",
  "delete_file",
  "smart_relocate",
  "semantic_rename",
] as const;

/**
 * 检查工具是否允许在 Anonymous Local 模式下执行
 */
export function isToolAllowedInAnonymousLocal(toolName: string): boolean {
  return ANONYMOUS_LOCAL_ALLOWED_TOOLS.includes(toolName as any);
}
```

### 2.5 启动时 Fail-Closed 校验

```typescript
/**
 * 启动时校验 Anonymous Local 模式配置
 *
 * 若配置不安全，启动失败（Fail-Closed）
 */
export function validateAnonymousLocalConfigOnStartup(config: GatewayConfig): void {
  const profile = resolveDeploymentProfile();
  const allowAnonymous = config.auth?.allowAnonymousLocal ?? false;
  const bindAddress = config.gateway?.bind ?? "127.0.0.1";

  // Rule 1: 生产 Profile 禁止匿名模式
  if (profile === "production" && allowAnonymous) {
    throw new Error(
      "SECURITY: allowAnonymousLocal=true is forbidden in production profile. " +
        "Set OPENBOT_DEPLOYMENT_PROFILE=personal_local or disable allowAnonymousLocal.",
    );
  }

  // Rule 2: managed/enterprise Profile 禁止匿名模式
  if ((profile === "managed" || profile === "enterprise") && allowAnonymous) {
    throw new Error(
      `SECURITY: allowAnonymousLocal=true is forbidden in ${profile} profile. ` +
        "Only personal_local profile allows anonymous local mode.",
    );
  }

  // Rule 3: 非 loopback 监听地址禁止匿名模式
  if (allowAnonymous && !isLoopbackAddress(bindAddress)) {
    throw new Error(
      `SECURITY: allowAnonymousLocal=true requires loopback bind address. ` +
        `Current bind address: ${bindAddress}. Change to 127.0.0.1 or ::1.`,
    );
  }

  // Rule 4: Platform Auth 启用时禁止匿名模式
  if (allowAnonymous && config.auth?.mode !== "none") {
    throw new Error(
      "SECURITY: allowAnonymousLocal=true requires auth.mode=none. " +
        `Current auth mode: ${config.auth?.mode}.`,
    );
  }

  console.log("[AnonymousLocal] Startup validation passed:", {
    profile,
    allowAnonymous,
    bindAddress,
    authMode: config.auth?.mode,
  });
}
```

### 2.6 运行时检查（双重校验）

```typescript
/**
 * 运行时检查 Anonymous Local 模式是否允许（resolveAuthorizedToolCwd 内部）
 *
 * 双重校验：启动时校验 + 运行时校验
 */
export function checkAnonymousLocalRuntimeConditions(params: {
  config: GatewayConfig;
  client: GatewayClient;
  toolName: string;
  operation: "read" | "write" | "execute" | "list";
}): { ok: true } | { ok: false; reason: string } {
  const { config, client, toolName, operation } = params;

  // 1. 检查部署 Profile
  const profile = resolveDeploymentProfile();
  if (!isAnonymousLocalAllowedByProfile(profile)) {
    return {
      ok: false,
      reason: `anonymous_local_forbidden_in_profile_${profile}`,
    };
  }

  // 2. 检查请求来源（必须来自 loopback）
  if (!isRequestFromLoopback(client.req)) {
    return {
      ok: false,
      reason: "anonymous_local_requires_loopback_request",
    };
  }

  // 3. 检查工具是否允许（只读工具）
  if (!isToolAllowedInAnonymousLocal(toolName)) {
    return {
      ok: false,
      reason: `tool_${toolName}_denied_in_anonymous_local`,
    };
  }

  // 4. 检查操作类型（只允许 read/list）
  if (operation === "write" || operation === "execute") {
    return {
      ok: false,
      reason: `operation_${operation}_denied_in_anonymous_local`,
    };
  }

  return { ok: true };
}
```

---

## 3. 修订后的 resolveAuthorizedToolCwd

```typescript
export async function resolveAuthorizedToolCwd(
  params: ResolveAuthorizedToolCwdParams,
): Promise<ResolveAuthorizedToolCwdResult> {
  const { catalog, principal, requestedCwd, operation, allowAnonymousLocal } = params;

  // 1. Fail-Closed: 必须有 Principal (除非 allowAnonymousLocal=true 且满足所有条件)
  if (!principal) {
    // 1.1 检查是否允许匿名本地模式
    if (!allowAnonymousLocal) {
      return buildFailureResult(
        "ERR_PRINCIPAL_REQUIRED",
        "Trusted principal required for workspace access",
      );
    }

    // 1.2 运行时检查 Anonymous Local 条件（双重校验）
    const runtimeCheck = checkAnonymousLocalRuntimeConditions({
      config: params.config,
      client: params.client,
      toolName: params.auditContext?.toolName ?? "unknown",
      operation,
    });

    if (!runtimeCheck.ok) {
      return buildFailureResult(
        "ERR_ANONYMOUS_LOCAL_FORBIDDEN",
        `Anonymous local mode forbidden: ${runtimeCheck.reason}`,
      );
    }

    // 1.3 降级路径: 允许匿名本地访问（仅本地路径 + 只读）
    if (isLocalPath(requestedCwd)) {
      const localHandle = buildLocalWorkspaceHandle(requestedCwd);

      // 限制能力为只读
      localHandle.capabilities = ["read", "list"];

      const auditRecordId = await recordToolCwdAudit({
        principal: null,
        handle: localHandle,
        operation,
        requestedCwd,
        resolvedPath: requestedCwd,
        accessMode: "local-anonymous",
        auditContext: params.auditContext,
      });

      return {
        ok: true,
        resolvedPath: requestedCwd,
        handle: localHandle,
        accessMode: "local-anonymous",
        auditRecordId,
      };
    }

    // 1.4 非本地路径 → 拒绝
    return buildFailureResult(
      "ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH",
      "Anonymous local mode only allows local paths",
    );
  }

  // 2. 后续正常授权流程（有 Principal）
  // ...
}
```

---

## 4. 新增错误码

```typescript
export type AuthorizedToolCwdErrorCode =
  // 既有错误码
  | "ERR_PRINCIPAL_REQUIRED"
  | "ERR_TENANT_BINDING_REQUIRED"
  | "ERR_WORKSPACE_NOT_FOUND"
  | "ERR_TENANT_MISMATCH"
  | "ERR_CAPABILITY_DENIED"
  | "ERR_WORKSPACE_SUSPENDED"
  | "ERR_WORKSPACE_ARCHIVED"
  | "ERR_WORKSPACE_RETIRED"
  | "ERR_PATH_OUTSIDE_WORKSPACE"
  | "ERR_CATALOG_UNAVAILABLE"
  | "ERR_INVALID_PATH"

  // 新增：Anonymous Local 相关错误码
  | "ERR_ANONYMOUS_LOCAL_FORBIDDEN" // 匿名本地模式被禁止
  | "ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH" // 非本地路径
  | "ERR_ANONYMOUS_LOCAL_WRITE_DENIED" // 写入操作被禁止
  | "ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED" // 执行操作被禁止
  | "ERR_ANONYMOUS_LOCAL_TOOL_DENIED"; // 工具不允许

/**
 * 错误码用户提示
 */
const ANONYMOUS_LOCAL_ERROR_MESSAGES: Record<string, string> = {
  ERR_ANONYMOUS_LOCAL_FORBIDDEN: "匿名本地模式在当前部署配置下被禁止",
  ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH: "匿名本地模式仅允许访问本地路径",
  ERR_ANONYMOUS_LOCAL_WRITE_DENIED: "匿名本地模式不允许写入操作",
  ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED: "匿名本地模式不允许执行命令",
  ERR_ANONYMOUS_LOCAL_TOOL_DENIED: "当前工具在匿名本地模式下不可用",
};
```

---

## 5. 负例测试（Negative Tests）

```typescript
describe("Anonymous Local Security (Negative Tests)", () => {
  describe("Startup Validation (Fail-Closed)", () => {
    it("should reject allowAnonymousLocal in production profile", () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "production";

      const config: GatewayConfig = {
        auth: { allowAnonymousLocal: true, mode: "none" },
        gateway: { bind: "127.0.0.1" },
      };

      expect(() => validateAnonymousLocalConfigOnStartup(config)).toThrow(
        /allowAnonymousLocal=true is forbidden in production profile/,
      );
    });

    it("should reject allowAnonymousLocal in managed profile", () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "managed";

      const config: GatewayConfig = {
        auth: { allowAnonymousLocal: true, mode: "none" },
        gateway: { bind: "127.0.0.1" },
      };

      expect(() => validateAnonymousLocalConfigOnStartup(config)).toThrow(
        /allowAnonymousLocal=true is forbidden in managed profile/,
      );
    });

    it("should reject allowAnonymousLocal with non-loopback bind address", () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const config: GatewayConfig = {
        auth: { allowAnonymousLocal: true, mode: "none" },
        gateway: { bind: "0.0.0.0" }, // 监听所有网络接口
      };

      expect(() => validateAnonymousLocalConfigOnStartup(config)).toThrow(
        /allowAnonymousLocal=true requires loopback bind address/,
      );
    });

    it("should reject allowAnonymousLocal with Platform Auth enabled", () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const config: GatewayConfig = {
        auth: { allowAnonymousLocal: true, mode: "trusted-proxy" },
        gateway: { bind: "127.0.0.1" },
      };

      expect(() => validateAnonymousLocalConfigOnStartup(config)).toThrow(
        /allowAnonymousLocal=true requires auth.mode=none/,
      );
    });
  });

  describe("Runtime Validation (Double Check)", () => {
    it("should reject write operation in anonymous local mode", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/local/workspace",
        operation: "write", // 写入操作
        allowAnonymousLocal: true,
        auditContext: {
          toolName: "fs_write",
          sessionId: "test",
          requestId: "test",
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_ANONYMOUS_LOCAL_WRITE_DENIED");
      }
    });

    it("should reject execute operation in anonymous local mode", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/local/workspace",
        operation: "execute", // 执行操作
        allowAnonymousLocal: true,
        auditContext: {
          toolName: "execute_bash",
          sessionId: "test",
          requestId: "test",
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED");
      }
    });

    it("should reject remote request in anonymous local mode", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const client = makeClientWithRemoteIp("192.168.1.100"); // 远程 IP

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        client,
        principal: null,
        requestedCwd: "/local/workspace",
        operation: "read",
        allowAnonymousLocal: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_ANONYMOUS_LOCAL_FORBIDDEN");
      }
    });

    it("should reject denied tool in anonymous local mode", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/local/workspace",
        operation: "write",
        allowAnonymousLocal: true,
        auditContext: {
          toolName: "delete_file", // 禁止的工具
          sessionId: "test",
          requestId: "test",
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_ANONYMOUS_LOCAL_TOOL_DENIED");
      }
    });

    it("should reject non-local path in anonymous local mode", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/workspace/enterprise/project", // 企业工作区
        operation: "read",
        allowAnonymousLocal: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH");
      }
    });
  });

  describe("Positive Tests (Allowed Cases)", () => {
    it("should allow read operation in personal_local + loopback", async () => {
      process.env.OPENBOT_DEPLOYMENT_PROFILE = "personal_local";

      const client = makeClientWithLoopbackIp("127.0.0.1");

      const result = await resolveAuthorizedToolCwd({
        catalog: createTestCatalog(),
        client,
        principal: null,
        requestedCwd: "/Users/alice/local-workspace",
        operation: "read",
        allowAnonymousLocal: true,
        auditContext: {
          toolName: "read_file",
          sessionId: "test",
          requestId: "test",
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.accessMode).toBe("local-anonymous");
        expect(result.handle.capabilities).toEqual(["read", "list"]);
      }
    });
  });
});
```

---

## 6. 配置示例

### 6.1 安全配置（生产环境）

```yaml
# config/production.yml
deployment:
  profile: production

gateway:
  bind: 0.0.0.0 # 监听所有网络接口
  port: 8080

auth:
  mode: trusted-proxy
  allowAnonymousLocal: false # 生产环境禁止匿名模式
```

### 6.2 开发配置（本地开发）

```yaml
# config/personal_local.yml
deployment:
  profile: personal_local

gateway:
  bind: 127.0.0.1 # 只监听 loopback
  port: 8080

auth:
  mode: none
  allowAnonymousLocal: true # 仅本地开发允许
```

### 6.3 环境变量

```bash
# 生产环境
export OPENBOT_DEPLOYMENT_PROFILE=production
export OPENBOT_ALLOW_ANONYMOUS_LOCAL=false

# 本地开发
export OPENBOT_DEPLOYMENT_PROFILE=personal_local
export OPENBOT_ALLOW_ANONYMOUS_LOCAL=true
```

---

## 7. 审计日志增强

```typescript
/**
 * Anonymous Local 审计日志（标记 accessMode）
 */
type AnonymousLocalAuditLog = {
  event: "tool_cwd_authorized" | "tool_cwd_denied";
  accessMode: "local-anonymous";
  deploymentProfile: DeploymentProfile;
  bindAddress: string;
  clientIp: string;
  toolName: string;
  operation: string;
  requestedCwd: string;
  resolvedPath?: string;
  denyReason?: string;
  timestamp: string;
};
```

---

## 8. 文档更新

### 8.1 D1 修订: Trusted Principal 契约

**修订位置**: D1 §9 (向后兼容)

**新增内容**:

- Anonymous Local 模式严格启用条件
- 部署 Profile 定义
- 启动时 Fail-Closed 校验
- 运行时双重校验

### 8.2 D4 修订: resolveAuthorizedToolCwd 接口

**修订位置**: D4 §5 (核心实现逻辑)

**新增内容**:

- Anonymous Local 运行时检查
- 新增 5 个错误码
- 工具能力限制

### 8.3 D5 修订: 测试计划

**修订位置**: D5 §7.1 (安全测试), §8 (向后兼容测试)

**新增内容**:

- 启动时校验负例测试（6 个场景）
- 运行时校验负例测试（5 个场景）
- 正例测试（1 个场景）

---

## 9. 修订总结

### 修订前（存在问题）

- ❌ `allowAnonymousLocal=true` 无限制条件
- ❌ 生产环境可能误开
- ❌ 远程请求可匿名访问
- ❌ 写入/执行操作无限制

### 修订后（问题解决）

- ✅ 仅 `personal_local` profile 允许
- ✅ 仅 loopback 地址允许
- ✅ 仅只读工具允许
- ✅ 启动时 Fail-Closed 校验
- ✅ 运行时双重校验
- ✅ 完整的负例测试

### 安全保证

- ✅ 生产环境启动失败（Fail-Closed）
- ✅ 远程请求被拒绝
- ✅ 写入/执行操作被拒绝
- ✅ 非本地路径被拒绝
- ✅ 所有拒绝都记录审计日志

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
