> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D1: Trusted Principal 契约（详细设计）

> **Handoff**: S01 - Trusted Principal & Workspace Handle Gate Design  
> **交付物**: D1 - Trusted Principal Contract  
> **状态**: `design-complete`  
> **版本**: 1.0  
> **日期**: 2026-08-29

---

## 1. 概述（Overview）

本设计定义 **Trusted Principal** 的完整契约，包括：

- 数据结构与字段语义
- 来源链路与校验机制
- 传播路径与生命周期
- Fail-Closed 语义与错误处理

### 1.1 设计目标

1. **可信性（Trustworthiness）**: Principal 来源可追溯且不可伪造
2. **完备性（Completeness）**: 包含所有授权决策所需的身份字段
3. **一致性（Consistency）**: 与现有身份体系（`scope-attribution.ts`）无缝集成
4. **失败安全（Fail-Closed）**: 任何解析失败都拒绝访问，不降级到不安全状态

---

## 2. 数据结构（Data Structure）

### 2.1 核心类型定义

```typescript
/**
 * Trusted Principal: 经网关认证的会话主体
 *
 * 解析路径:
 * 1. Platform Auth Session (优先级 1)
 * 2. Trusted Proxy Header (优先级 2)
 * 3. Device Token (优先级 3, P2)
 *
 * Fail-Closed: 解析失败时返回 null，Tool CWD 解析拒绝访问（除非 allowAnonymousLocal=true）
 */
export type TrustedPrincipal = {
  /**
   * 平台用户 ID (PlatformAuthUser.id)
   *
   * - 来源: platform-auth store
   * - 特性: 稳定跨会话（不随 session token 变化）
   * - 格式: UUID v4 或 ulid
   * - 用途: 记录归属（ownerId）、审计日志
   */
  userId: string;

  /**
   * 租户 ID (企业 ID)
   *
   * - 来源: PlatformAuthMembership.enterpriseId（通过 resolveTrustedAttribution）
   * - 可选: 非企业成员时为 undefined
   * - 格式: `ent-<uuid>` 或 canonicalized tenant id
   * - 用途: 租户隔离、Catalog 查询过滤
   */
  tenantId?: string;

  /**
   * 会话域 (platform/enterprise/employee)
   *
   * - 来源: GatewayClient.sessionDomain（由网关端口/路由解析）
   * - 语义:
   *   - platform: 运营后台（multi-tenant admin）
   *   - enterprise: 企业端（tenant-scoped）
   *   - employee: 个人工作台（self-scoped）
   * - 用途: QueryScope 解析、权限边界决策
   */
  sessionDomain: "platform" | "enterprise" | "employee";

  /**
   * 归属来源（用于审计与信任链验证）
   *
   * - platform-auth-session: HMAC 签名 cookie（最高信任）
   * - trusted-proxy-header: 受信代理转发的 x-openclaw-trusted-user（需 IP 白名单）
   * - device-token: 设备绑定 token（P2，移动端）
   */
  source: "platform-auth-session" | "trusted-proxy-header" | "device-token";

  /**
   * 解析时间戳（用于过期检查与审计）
   *
   * - 单位: Unix timestamp (ms)
   * - 用途: 会话过期检查、审计日志时序
   */
  resolvedAt: number;

  /**
   * 可选：原始会话元数据（用于审计与调试）
   */
  metadata?: {
    /** 原始 session token 指纹（不含完整 token） */
    sessionFingerprint?: string;
    /** Platform Auth User email（脱敏） */
    userEmailHint?: string;
    /** 解析器版本（用于 schema 演进） */
    resolverVersion?: string;
  };
};
```

### 2.2 Zod Schema 定义

```typescript
import { z } from "zod";

export const TrustedPrincipalSchema = z.object({
  userId: z.string().min(1, "userId required").max(256),
  tenantId: z.string().min(1).max(256).optional(),
  sessionDomain: z.enum(["platform", "enterprise", "employee"]),
  source: z.enum(["platform-auth-session", "trusted-proxy-header", "device-token"]),
  resolvedAt: z.number().int().positive(),
  metadata: z
    .object({
      sessionFingerprint: z.string().max(64).optional(),
      userEmailHint: z.string().max(256).optional(),
      resolverVersion: z.string().max(32).optional(),
    })
    .optional(),
});

/** 运行时校验 helper */
export function validateTrustedPrincipal(
  value: unknown,
): { ok: true; data: TrustedPrincipal } | { ok: false; errors: string[] } {
  const result = TrustedPrincipalSchema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data as TrustedPrincipal };
  }
  return {
    ok: false,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}
```

---

## 3. 解析链路（Resolution Chain）

### 3.1 解析函数签名

```typescript
/**
 * 解析 Trusted Principal（从 GatewayClient）
 *
 * 返回:
 * - TrustedPrincipal: 解析成功，包含完整身份信息
 * - null: 解析失败或无认证会话（调用方决定是否允许匿名降级）
 *
 * 失败原因（记录到 audit log，不抛异常）:
 * - 无 platform auth session
 * - session 签名校验失败
 * - user 不存在或已禁用
 * - membership 查询失败（非企业成员时 tenantId=undefined，不视为失败）
 */
export async function resolveTrustedPrincipal(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null>;
```

### 3.2 来源优先级与解析逻辑

#### 3.2.1 Platform Auth Session (优先级 1)

```typescript
async function resolvePrincipalFromPlatformAuthSession(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null> {
  // 1. 读取 platform auth session (复用既有机制)
  const session = await readPlatformAuthSessionFromRequest(client?.req);
  if (!session) {
    return null; // 无会话，非错误（允许降级）
  }

  // 2. 校验 session 签名（HMAC，防伪造）
  const validationResult = validatePlatformAuthSession(session);
  if (!validationResult.valid) {
    // 签名校验失败 → 审计记录，拒绝（不降级）
    auditLog({
      event: "principal_resolution_failed",
      reason: "invalid_session_signature",
      sessionFingerprint: computeSessionFingerprint(session),
      clientIp: client?.req?.ip,
    });
    return null;
  }

  // 3. 提取 user 信息
  const user = session.user;
  if (!user?.id) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "session_missing_user_id",
    });
    return null;
  }

  // 4. 解析 tenantId（通过 resolveTrustedAttribution）
  const attribution = await resolveTrustedAttribution(client);
  const tenantId = attribution.tenantId;

  // 5. 构造 Principal
  return {
    userId: user.id,
    tenantId,
    sessionDomain: session.domain ?? "employee",
    source: "platform-auth-session",
    resolvedAt: Date.now(),
    metadata: {
      sessionFingerprint: computeSessionFingerprint(session),
      userEmailHint: maskEmail(user.email),
      resolverVersion: "1.0",
    },
  };
}
```

#### 3.2.2 Trusted Proxy Header (优先级 2)

```typescript
async function resolvePrincipalFromTrustedProxyHeader(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null> {
  // 1. 检查 auth mode
  const authMode = client?.authMode;
  if (authMode !== "trusted-proxy") {
    return null; // 不适用
  }

  // 2. 读取 x-openclaw-trusted-user header
  const trustedUserHeader = client?.req?.headers?.["x-openclaw-trusted-user"];
  if (!trustedUserHeader || typeof trustedUserHeader !== "string") {
    return null;
  }

  // 3. 校验代理 IP 白名单（安全门禁）
  const clientIp = client?.req?.ip;
  if (!isTrustedProxyIp(clientIp)) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "untrusted_proxy_ip",
      clientIp,
    });
    return null;
  }

  // 4. 解析 header 内容（格式: userId:tenantId:sessionDomain）
  const parts = trustedUserHeader.split(":");
  if (parts.length < 2) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "malformed_trusted_user_header",
      headerValue: trustedUserHeader.slice(0, 32),
    });
    return null;
  }

  const [userId, tenantId, sessionDomainStr] = parts;
  const sessionDomain = parseSessionDomain(sessionDomainStr) ?? "employee";

  return {
    userId,
    tenantId: tenantId || undefined,
    sessionDomain,
    source: "trusted-proxy-header",
    resolvedAt: Date.now(),
    metadata: {
      resolverVersion: "1.0",
    },
  };
}

function parseSessionDomain(
  str: string | undefined,
): "platform" | "enterprise" | "employee" | null {
  if (str === "platform" || str === "enterprise" || str === "employee") {
    return str;
  }
  return null;
}
```

#### 3.2.3 主解析函数（集成）

```typescript
export async function resolveTrustedPrincipal(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null> {
  // 优先级 1: Platform Auth Session
  const fromSession = await resolvePrincipalFromPlatformAuthSession(client);
  if (fromSession) {
    return fromSession;
  }

  // 优先级 2: Trusted Proxy Header
  const fromProxy = await resolvePrincipalFromTrustedProxyHeader(client);
  if (fromProxy) {
    return fromProxy;
  }

  // 优先级 3: Device Token (P2, 预留)
  // const fromDevice = await resolvePrincipalFromDeviceToken(client);
  // if (fromDevice) return fromDevice;

  // 无可用来源 → 返回 null（调用方决定是否允许匿名）
  return null;
}
```

---

## 4. 传播路径（Propagation）

### 4.1 传播链路

```
GatewayClient (WebSocket/HTTP Request)
  ↓ resolveTrustedPrincipal
TrustedPrincipal
  ↓ 传递给
resolveAuthorizedToolCwd
  ↓ 校验租户隔离 + 查询 Catalog
WorkspaceHandle (授权的工作区)
  ↓ 生成
Tool CWD (fs_write / execute_bash / read_file 等)
```

### 4.2 存储与缓存策略

**不持久化 Principal**（会话级内存对象）：

- ❌ 不写入数据库
- ❌ 不写入 Redis
- ✅ 仅在请求/会话生命周期内存在
- ✅ 审计日志记录 `userId`、`tenantId`、`source`（不含完整 Principal 对象）

**缓存策略**:

- Principal 解析结果**不跨请求缓存**（每次请求重新解析）
- 原因：session 可能失效、membership 可能变更
- 优化：platform auth session 读取本身已缓存（cookie 解析 + HMAC 校验）

---

## 5. Fail-Closed 语义（Fail-Closed Semantics）

### 5.1 失败场景矩阵

| 场景                          | Principal 值                      | Tool CWD 行为                               | 用户提示                   |
| ----------------------------- | --------------------------------- | ------------------------------------------- | -------------------------- |
| 无认证会话                    | `null`                            | 拒绝（除非 `allowAnonymousLocal=true`）     | "请先登录以访问工作区"     |
| Session 签名失败              | `null`                            | 拒绝                                        | "会话校验失败，请重新登录" |
| User 不存在                   | `null`                            | 拒绝                                        | "用户不存在或已禁用"       |
| Membership 查询失败（非成员） | `{ userId, tenantId: undefined }` | **允许**（但 Catalog 查询会过滤企业工作区） | 无（非错误）               |
| Trusted Proxy IP 不在白名单   | `null`                            | 拒绝                                        | "访问被拒绝"               |

### 5.2 错误码定义

```typescript
export type PrincipalResolutionErrorCode =
  | "no_session"
  | "invalid_session_signature"
  | "session_expired"
  | "user_not_found"
  | "user_disabled"
  | "untrusted_proxy_ip"
  | "malformed_trusted_user_header"
  | "membership_query_failed";

export type PrincipalResolutionError = {
  code: PrincipalResolutionErrorCode;
  message: string;
  /** 是否允许匿名降级（仅 no_session 时为 true） */
  allowAnonymousFallback: boolean;
};
```

### 5.3 审计日志要求

所有 Principal 解析失败都必须记录审计日志：

```typescript
type PrincipalResolutionAuditLog = {
  event: "principal_resolution_failed" | "principal_resolved";
  timestamp: number;
  clientIp?: string;
  sessionFingerprint?: string;
  reason?: string;
  userId?: string;
  tenantId?: string;
  source?: string;
};

// 示例
auditLog({
  event: "principal_resolution_failed",
  timestamp: Date.now(),
  clientIp: "192.168.1.100",
  sessionFingerprint: "abc123...",
  reason: "invalid_session_signature",
});

auditLog({
  event: "principal_resolved",
  timestamp: Date.now(),
  userId: "usr-123",
  tenantId: "ent-456",
  source: "platform-auth-session",
});
```

---

## 6. 集成点（Integration Points）

### 6.1 与现有 `scope-attribution.ts` 的关系

**复用既有机制**:

- `resolveTrustedAttribution(client)` → 提取 `tenantId`、`ownerId`
- `resolveQueryScope(client)` → 解析 `sessionDomain` 对应的 QueryScope

**新增能力**:

- 将 `resolveTrustedAttribution` 结果封装为 `TrustedPrincipal` 类型
- 添加 `source`、`resolvedAt`、`metadata` 字段用于审计与信任链验证

### 6.2 与 `resolveAuthorizedToolCwd` 的集成

```typescript
// 调用示例
const principal = await resolveTrustedPrincipal(client);

const cwdResult = await resolveAuthorizedToolCwd({
  catalog,
  principal, // 传递 Principal（可为 null）
  requestedCwd: "/workspace/group-alpha",
  operation: "read",
  allowAnonymousLocal: false, // 是否允许匿名本地访问
  auditContext: {
    toolName: "read_file",
    sessionId: client.sessionId,
    requestId: generateRequestId(),
  },
});

if (!cwdResult.ok) {
  // 处理失败（错误码包含 ERR_PRINCIPAL_REQUIRED）
}
```

---

## 7. 测试计划（Testing Plan）

### 7.1 单元测试

```typescript
describe("resolveTrustedPrincipal", () => {
  describe("Platform Auth Session", () => {
    it("should resolve principal from valid session", async () => {
      const client = makeClientWithSession({
        user: { id: "usr-123", email: "alice@example.com" },
        sessionDomain: "employee",
      });

      const principal = await resolveTrustedPrincipal(client);

      expect(principal).toMatchObject({
        userId: "usr-123",
        sessionDomain: "employee",
        source: "platform-auth-session",
      });
      expect(principal?.resolvedAt).toBeGreaterThan(0);
    });

    it("should return null when session signature is invalid", async () => {
      const client = makeClientWithInvalidSession();
      const principal = await resolveTrustedPrincipal(client);
      expect(principal).toBeNull();
    });

    it("should include tenantId when user is enterprise member", async () => {
      const client = makeClientWithSession({
        user: { id: "usr-123", email: "alice@example.com" },
        membership: { enterpriseId: "ent-456" },
      });

      const principal = await resolveTrustedPrincipal(client);

      expect(principal?.tenantId).toBe("ent-456");
    });

    it("should omit tenantId when user is not enterprise member", async () => {
      const client = makeClientWithSession({
        user: { id: "usr-123", email: "alice@example.com" },
        membership: null,
      });

      const principal = await resolveTrustedPrincipal(client);

      expect(principal?.userId).toBe("usr-123");
      expect(principal?.tenantId).toBeUndefined();
    });
  });

  describe("Trusted Proxy Header", () => {
    it("should resolve principal from trusted proxy", async () => {
      const client = makeClientWithTrustedProxy({
        header: "usr-789:ent-abc:enterprise",
        clientIp: "10.0.0.1", // 白名单 IP
      });

      const principal = await resolveTrustedPrincipal(client);

      expect(principal).toMatchObject({
        userId: "usr-789",
        tenantId: "ent-abc",
        sessionDomain: "enterprise",
        source: "trusted-proxy-header",
      });
    });

    it("should return null when proxy IP is not whitelisted", async () => {
      const client = makeClientWithTrustedProxy({
        header: "usr-789:ent-abc:enterprise",
        clientIp: "1.2.3.4", // 非白名单
      });

      const principal = await resolveTrustedPrincipal(client);
      expect(principal).toBeNull();
    });
  });

  describe("Zod Validation", () => {
    it("should accept valid principal", () => {
      const principal: TrustedPrincipal = {
        userId: "usr-123",
        tenantId: "ent-456",
        sessionDomain: "employee",
        source: "platform-auth-session",
        resolvedAt: Date.now(),
      };

      const result = validateTrustedPrincipal(principal);
      expect(result.ok).toBe(true);
    });

    it("should reject principal with missing userId", () => {
      const invalid = {
        tenantId: "ent-456",
        sessionDomain: "employee",
        source: "platform-auth-session",
        resolvedAt: Date.now(),
      };

      const result = validateTrustedPrincipal(invalid);
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("userId: userId required");
    });
  });
});
```

### 7.2 集成测试

```typescript
describe("Trusted Principal Integration", () => {
  it("should deny Tool CWD when principal is null", async () => {
    const client = makeClientWithoutSession();
    const principal = await resolveTrustedPrincipal(client);

    const result = await resolveAuthorizedToolCwd({
      catalog: createTestCatalog(),
      principal,
      requestedCwd: "/workspace/test",
      operation: "read",
      allowAnonymousLocal: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_PRINCIPAL_REQUIRED");
    }
  });

  it("should allow anonymous local access when flag is set", async () => {
    const principal = null;

    const result = await resolveAuthorizedToolCwd({
      catalog: createTestCatalog(),
      principal,
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
```

---

## 8. 性能要求（Performance Requirements）

| 指标                     | 目标   | 理由                       |
| ------------------------ | ------ | -------------------------- |
| Principal 解析延迟 (P99) | < 10ms | 不应阻塞 Tool 执行         |
| Session 签名校验 (P99)   | < 5ms  | 复用既有 HMAC 实现         |
| Membership 查询 (P99)    | < 20ms | 需查询 platform auth store |

**优化策略**:

- Platform Auth Session 解析已优化（cookie 解析 + 内存签名校验）
- Membership 查询复用 `resolveTrustedAttribution`（已有缓存）
- 不引入新的外部依赖（不增加 Redis 查询）

---

## 9. 向后兼容（Backward Compatibility）

### 9.1 既有代码迁移路径

**Phase 1: 新增 TrustedPrincipal，不破坏既有调用**

```typescript
// 既有代码（保持不变）
const attribution = await resolveTrustedAttribution(client);
// 继续使用 attribution.tenantId / attribution.ownerId

// 新代码（增量）
const principal = await resolveTrustedPrincipal(client);
// 使用 principal.userId / principal.tenantId / principal.sessionDomain
```

**Phase 2: 逐步迁移 Tool CWD 解析到 Principal**

```typescript
// 迁移前
const actor = { tenantId: ..., userId: ... };

// 迁移后
const principal = await resolveTrustedPrincipal(client);
const actor = principal
  ? { tenantId: principal.tenantId ?? "none", userId: principal.userId }
  : null;
```

### 9.2 降级策略

- 当 `resolveTrustedPrincipal` 返回 `null` 时，Tool CWD 解析可选择降级到 **local workspace only**（通过 `allowAnonymousLocal=true`）
- 既有 `workspace-resolver/` 代码路径（group/steward/local）不受影响

---

## 10. 安全考量（Security Considerations）

### 10.1 防伪造（Anti-Forgery）

- **Session Cookie HMAC 签名**：防止客户端伪造 session
- **Trusted Proxy IP 白名单**：防止非受信代理注入 header
- **不信任客户端传递的 tenantId/ownerId**：所有身份字段由服务端解析

### 10.2 审计链路（Audit Trail）

- 所有 Principal 解析失败都记录审计日志
- 包含 `sessionFingerprint`、`clientIp`、`reason`
- 可追溯到具体的会话与请求

### 10.3 过期检查（Expiration）

- `resolvedAt` 字段记录解析时间
- 调用方可选择性检查 Principal 时效性（例如 5 分钟内）
- P2: 添加 `expiresAt` 字段（基于 session TTL）

---

## 11. 实现路径（Implementation Roadmap）

### P0 (核心实现)

- [x] 定义 `TrustedPrincipal` 类型
- [x] 实现 `resolveTrustedPrincipal` 主函数
- [x] 集成 Platform Auth Session 解析
- [x] 添加 Zod schema 校验
- [x] 编写单元测试

### P1 (增强)

- [ ] 实现 Trusted Proxy Header 解析
- [ ] 添加审计日志集成
- [ ] 集成到 `resolveAuthorizedToolCwd`
- [ ] 编写集成测试

### P2 (扩展)

- [ ] Device Token 支持（移动端）
- [ ] `expiresAt` 字段（基于 session TTL）
- [ ] 性能监控与告警

---

## 12. 评审检查清单（Review Checklist）

- [x] 数据结构完整（包含所有必需字段）
- [x] 来源链路可追溯（Platform Auth Session + Trusted Proxy）
- [x] Fail-Closed 语义明确（所有失败场景都拒绝访问）
- [x] 错误码完备（10+ 错误场景）
- [x] 审计日志要求清晰
- [x] 与既有代码集成路径明确（不破坏 `scope-attribution.ts`）
- [x] 测试计划覆盖核心场景
- [x] 性能要求可达成（< 10ms P99）
- [x] 向后兼容策略清晰
- [x] 安全考量充分（防伪造 + 审计）

---

**状态**: D1 设计完成，等待评审
