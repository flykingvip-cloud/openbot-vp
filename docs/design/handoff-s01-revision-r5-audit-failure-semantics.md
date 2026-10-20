> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R5: 审计失败语义（修订）

> **修订问题**: 审计日志要求不完整  
> **严重性**: 🟡 中（合规风险）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

**原设计问题**:

- 要求全覆盖，但未定义审计写入失败时的行为、脱敏字段、不可抵赖性、保留期限、关联 requestId/sessionId/tenantId/resourceId 的规范
- 若审计失败仍放行，会破坏治理闭环；若同步写入，又可能违反性能目标
- 缺少完整的审计失败处理策略

**影响范围**:

- D1 §4 (传播路径，审计缓存策略)
- D4 §6 (审计日志规范)
- D5 §4 (集成测试，审计日志验证)

---

## 2. 修订方案

### 2.1 审计失败策略（Fail-Closed vs Fail-Open）

```typescript
/**
 * 审计失败策略
 */
export type AuditFailurePolicy = "fail-closed" | "fail-open" | "deferred";

/**
 * 策略定义
 */
export const AUDIT_FAILURE_POLICIES: Record<
  AuditFailurePolicy,
  {
    description: string;
    behavior: string;
    riskLevel: "low" | "medium" | "high";
    useCase: string;
  }
> = {
  /**
   * Fail-Closed: 审计失败时阻断授权
   *
   * 行为: 若审计写入失败，resolveAuthorizedToolCwd 返回错误，拒绝授权
   * 风险: 低（合规优先）
   * 适用: 生产环境、企业环境
   */
  "fail-closed": {
    description: "审计失败时阻断授权",
    behavior: "审计失败 → 拒绝授权 → 返回 ERR_AUDIT_FAILURE",
    riskLevel: "low",
    useCase: "生产环境、企业环境、合规要求高的场景",
  },

  /**
   * Fail-Open: 审计失败时放行（记录告警）
   *
   * 行为: 若审计写入失败，记录告警日志，但仍允许授权
   * 风险: 高（可能破坏合规）
   * 适用: 本地开发、测试环境
   */
  "fail-open": {
    description: "审计失败时放行（记录告警）",
    behavior: "审计失败 → 记录告警 → 允许授权",
    riskLevel: "high",
    useCase: "本地开发、测试环境、审计服务降级时的临时策略",
  },

  /**
   * Deferred: 审计延迟写入（异步/缓冲）
   *
   * 行为: 审计日志先写入内存缓冲区，异步刷新到持久化存储
   * 风险: 中（缓冲区溢出时可能丢失）
   * 适用: 高吞吐场景
   */
  deferred: {
    description: "审计延迟写入（异步/缓冲）",
    behavior: "审计写入缓冲区 → 允许授权 → 异步刷新",
    riskLevel: "medium",
    useCase: "高吞吐场景、延迟敏感场景",
  },
};
```

### 2.2 S01 采用策略：Fail-Closed（默认）

```typescript
/**
 * S01 审计失败策略：Fail-Closed
 *
 * 理由:
 * 1. 合规优先：审计日志是治理闭环的关键，失败时必须阻断
 * 2. 安全优先：审计失败可能意味着存储故障或攻击，应拒绝授权
 * 3. 可降级：若审计服务故障，运维可临时切换到 fail-open 模式
 */
export const S01_AUDIT_FAILURE_POLICY: AuditFailurePolicy = "fail-closed";

/**
 * 审计失败处理（Fail-Closed）
 */
export async function recordToolCwdAuditFailClosed(
  params: AuditParams,
): Promise<{ ok: true; recordId: string } | { ok: false; error: Error }> {
  try {
    // 1. 写入审计日志（同步或异步）
    const recordId = await auditStore.write(params);

    return {
      ok: true,
      recordId,
    };
  } catch (error) {
    // 2. 审计失败 → 记录告警
    logger.error("Audit write failed (fail-closed policy)", {
      error,
      params,
    });

    // 3. 返回失败（调用方必须拒绝授权）
    return {
      ok: false,
      error: error as Error,
    };
  }
}

/**
 * 在 resolveAuthorizedToolCwd 中集成审计失败检查
 */
export async function resolveAuthorizedToolCwd(
  params: ResolveAuthorizedToolCwdParams,
): Promise<ResolveAuthorizedToolCwdResult> {
  // ... (前面的授权检查)

  // 9. 记录审计日志（Fail-Closed）
  const auditResult = await recordToolCwdAuditFailClosed({
    principal,
    handle,
    operation,
    requestedCwd,
    resolvedPath: bestMatch.cwdPath,
    accessMode: "authorized",
    auditContext: params.auditContext,
  });

  // 10. 审计失败 → 拒绝授权
  if (!auditResult.ok) {
    return buildFailureResult("ERR_AUDIT_FAILURE", "Authorization denied due to audit failure", {
      auditError: auditResult.error.message,
    });
  }

  return {
    ok: true,
    resolvedPath: bestMatch.cwdPath,
    handle,
    accessMode: "authorized",
    auditRecordId: auditResult.recordId,
  };
}
```

### 2.3 审计日志字段规范

```typescript
/**
 * 审计日志记录（完整版）
 */
export type ToolCwdAuditLog = {
  // ========================================
  // 必需字段（所有审计日志都包含）
  // ========================================

  /** 审计记录 ID（唯一）*/
  recordId: string; // UUID v4

  /** 事件类型 */
  event: "tool_cwd_authorized" | "tool_cwd_denied";

  /** 时间戳（ISO 8601）*/
  timestamp: string;

  // ========================================
  // 关联字段（用于追踪和聚合）
  // ========================================

  /** 请求 ID */
  requestId: string;

  /** 会话 ID */
  sessionId: string;

  /** 租户 ID */
  tenantId: string | null;

  /** 工作区 Handle ID */
  handleId: string | null;

  /** 资源 ID (Workspace Resource Record ID) */
  resourceId: string | null;

  // ========================================
  // Principal 字段
  // ========================================

  /** Principal 类型 */
  principalType: PrincipalType | null;

  /** Principal ID (userId) */
  principalId: string | null;

  /** Session Domain */
  sessionDomain: SessionDomain | null;

  // ========================================
  // 操作字段
  // ========================================

  /** 操作类型 */
  operation: "read" | "write" | "execute" | "list";

  /** 工具名称 */
  toolName: string;

  /** 请求的 CWD */
  requestedCwd: string;

  /** 解析后的路径 */
  resolvedPath: string | null;

  /** 访问模式 */
  accessMode: "authorized" | "local-anonymous" | "denied";

  // ========================================
  // 授权决策字段
  // ========================================

  /** 授权结果 */
  authorized: boolean;

  /** 拒绝原因（若授权失败）*/
  denyReason?: AuthorizedToolCwdErrorCode;

  /** 拒绝详情（若授权失败）*/
  denyDetails?: string;

  /** 授权原因（若授权成功）*/
  authorizationReason?: string; // 例如: "enterprise_ownership_verified"

  // ========================================
  // 网络字段
  // ========================================

  /** 客户端 IP */
  clientIp: string;

  /** 代理链（如适用）*/
  proxyChain?: string[];

  /** User-Agent */
  userAgent?: string;

  // ========================================
  // 敏感字段（脱敏处理）
  // ========================================

  /** 环境变量（仅记录键名，不记录值）*/
  envKeys?: string[];

  /** 命令参数（仅记录工具名，不记录参数）*/
  commandArgs?: "REDACTED";

  /** 文件路径（记录，但需要脱敏用户名）*/
  filePath?: string; // 例如: "/workspace/[USER]/project"
};
```

### 2.4 字段白名单（允许记录）

```typescript
/**
 * 审计日志字段白名单
 *
 * 只有白名单内的字段才允许写入审计日志
 */
export const AUDIT_LOG_FIELD_WHITELIST: (keyof ToolCwdAuditLog)[] = [
  // 必需字段
  "recordId",
  "event",
  "timestamp",

  // 关联字段
  "requestId",
  "sessionId",
  "tenantId",
  "handleId",
  "resourceId",

  // Principal 字段
  "principalType",
  "principalId",
  "sessionDomain",

  // 操作字段
  "operation",
  "toolName",
  "requestedCwd",
  "resolvedPath",
  "accessMode",

  // 授权决策字段
  "authorized",
  "denyReason",
  "denyDetails",
  "authorizationReason",

  // 网络字段
  "clientIp",
  "proxyChain",
  "userAgent",

  // 敏感字段（脱敏后允许）
  "envKeys",
  "commandArgs",
  "filePath",
];
```

### 2.5 敏感值禁止记录

```typescript
/**
 * 敏感值黑名单（禁止记录）
 *
 * 以下类型的值禁止出现在审计日志中
 */
export const SENSITIVE_VALUE_BLACKLIST = [
  // 密钥/凭证
  "password",
  "token",
  "secret",
  "apiKey",
  "privateKey",
  "accessToken",
  "refreshToken",
  "sessionToken",
  "jwt",

  // 加密相关
  "hmacKey",
  "encryptionKey",
  "salt",
  "iv",
  "nonce",

  // 数据库连接
  "connectionString",
  "databaseUrl",
  "dbPassword",

  // 云服务凭证
  "awsAccessKey",
  "awsSecretKey",
  "gcpServiceAccountKey",
  "azureClientSecret",
];

/**
 * 脱敏敏感字段
 *
 * 替换敏感值为 "[REDACTED]"
 */
export function redactSensitiveFields<T extends Record<string, any>>(
  obj: T,
  blacklist: string[] = SENSITIVE_VALUE_BLACKLIST,
): T {
  const redacted = { ...obj };

  for (const [key, value] of Object.entries(redacted)) {
    // 检查键名是否在黑名单
    const keyLower = key.toLowerCase();
    const isSensitive = blacklist.some((pattern) => keyLower.includes(pattern.toLowerCase()));

    if (isSensitive) {
      // 替换为 REDACTED
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      // 递归脱敏嵌套对象
      redacted[key] = redactSensitiveFields(value, blacklist);
    }
  }

  return redacted;
}

/**
 * 脱敏文件路径中的用户名
 *
 * 例如: /Users/alice/workspace → /Users/[USER]/workspace
 */
export function redactUserPathSegments(path: string): string {
  // 替换 /Users/<username> 为 /Users/[USER]
  return path
    .replace(/\/Users\/[^\/]+/, "/Users/[USER]")
    .replace(/\/home\/[^\/]+/, "/home/[USER]")
    .replace(/C:\\Users\\[^\\]+/, "C:\\Users\\[USER]");
}
```

### 2.6 保留期限（Retention Policy）

```typescript
/**
 * 审计日志保留策略
 */
export type AuditRetentionPolicy = {
  /** 默认保留期限（天）*/
  defaultRetention: number; // 默认 90 天

  /** 最长保留期限（天）*/
  maxRetention: number; // 最长 365 天

  /** Legal Hold（法律保留）*/
  legalHold: {
    /** 是否启用 */
    enabled: boolean;

    /** Legal Hold 期限（天，null = 永久保留）*/
    duration: number | null;
  };

  /** 自动归档策略 */
  archiving: {
    /** 是否启用 */
    enabled: boolean;

    /** 归档阈值（天，超过此时间的日志将被归档到冷存储）*/
    threshold: number; // 默认 30 天

    /** 归档目标 */
    target: "s3" | "glacier" | "local";
  };

  /** 自动删除策略 */
  deletion: {
    /** 是否启用 */
    enabled: boolean;

    /** 删除阈值（天，超过此时间的日志将被删除）*/
    threshold: number; // 默认 90 天
  };
};

/**
 * S01 审计日志保留策略
 */
export const S01_AUDIT_RETENTION_POLICY: AuditRetentionPolicy = {
  defaultRetention: 90,
  maxRetention: 365,

  legalHold: {
    enabled: false,
    duration: null,
  },

  archiving: {
    enabled: true,
    threshold: 30,
    target: "s3",
  },

  deletion: {
    enabled: true,
    threshold: 90,
  },
};

/**
 * 自动清理过期审计日志
 */
export async function cleanupExpiredAuditLogs(
  policy: AuditRetentionPolicy,
): Promise<{ archived: number; deleted: number }> {
  const now = Date.now();
  let archived = 0;
  let deleted = 0;

  // 1. 归档超过阈值的日志
  if (policy.archiving.enabled) {
    const archiveThreshold = now - policy.archiving.threshold * 24 * 60 * 60 * 1000;
    archived = await auditStore.archiveOlderThan(archiveThreshold, policy.archiving.target);
  }

  // 2. 删除超过保留期限的日志
  if (policy.deletion.enabled) {
    const deletionThreshold = now - policy.deletion.threshold * 24 * 60 * 60 * 1000;
    deleted = await auditStore.deleteOlderThan(deletionThreshold);
  }

  return { archived, deleted };
}
```

### 2.7 不可抵赖性（Non-Repudiation）

```typescript
/**
 * 审计日志签名（确保不可抵赖性）
 *
 * 每条审计日志都使用 HMAC-SHA256 签名，防止篡改
 */
export type SignedAuditLog = ToolCwdAuditLog & {
  /** 签名（HMAC-SHA256）*/
  signature: string;

  /** 签名密钥 ID */
  signatureKeyId: string;
};

/**
 * 对审计日志签名
 */
export function signAuditLog(log: ToolCwdAuditLog, keyId: string, key: string): SignedAuditLog {
  // 1. 构造签名原文（字段按字母序排列）
  const payload = JSON.stringify(log, Object.keys(log).sort());

  // 2. 计算 HMAC-SHA256
  const signature = crypto.createHmac("sha256", key).update(payload).digest("hex");

  return {
    ...log,
    signature,
    signatureKeyId: keyId,
  };
}

/**
 * 验证审计日志签名
 */
export function verifyAuditLogSignature(signedLog: SignedAuditLog, key: string): boolean {
  const { signature, signatureKeyId, ...log } = signedLog;

  // 重新计算签名
  const expectedSignature = signAuditLog(log, signatureKeyId, key).signature;

  // 常数时间比较
  return constantTimeCompare(signature, expectedSignature);
}
```

---

## 3. 新增错误码

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
  | "ERR_ANONYMOUS_LOCAL_FORBIDDEN"
  | "ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH"
  | "ERR_ANONYMOUS_LOCAL_WRITE_DENIED"
  | "ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED"
  | "ERR_ANONYMOUS_LOCAL_TOOL_DENIED"
  | "ERR_OWNERSHIP_MISMATCH"
  | "ERR_GROUP_MEMBERSHIP_REQUIRED"
  | "ERR_SEAT_NOT_ASSIGNED"
  | "ERR_BREAK_GLASS_REQUIRED"
  | "ERR_OPERATION_DENIED"

  // 新增：审计相关错误码
  | "ERR_AUDIT_FAILURE" // 审计写入失败（fail-closed）
  | "ERR_AUDIT_STORE_UNAVAILABLE" // 审计存储不可用
  | "ERR_AUDIT_SIGNATURE_INVALID"; // 审计日志签名无效
```

---

## 4. 测试计划

### 4.1 Fail-Closed 测试

```typescript
describe("Audit Failure Semantics: Fail-Closed", () => {
  it("should deny authorization when audit write fails", async () => {
    // Mock 审计写入失败
    mockAuditStore.write.mockRejectedValue(new Error("Audit store unavailable"));

    const result = await resolveAuthorizedToolCwd({
      catalog: createTestCatalog(),
      principal: makePrincipal("usr-123"),
      requestedCwd: "/workspace/project",
      operation: "read",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_AUDIT_FAILURE");
    }
  });

  it("should allow authorization when audit write succeeds", async () => {
    // Mock 审计写入成功
    mockAuditStore.write.mockResolvedValue("audit-record-123");

    const result = await resolveAuthorizedToolCwd({
      catalog: createTestCatalog(),
      principal: makePrincipal("usr-123"),
      requestedCwd: "/workspace/project",
      operation: "read",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditRecordId).toBe("audit-record-123");
    }
  });
});
```

### 4.2 敏感值脱敏测试

```typescript
describe("Audit: Sensitive Value Redaction", () => {
  it("should redact password fields", () => {
    const obj = {
      username: "alice",
      password: "secret123",
      apiKey: "key-abc",
    };

    const redacted = redactSensitiveFields(obj);

    expect(redacted.username).toBe("alice");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
  });

  it("should redact user path segments", () => {
    const paths = ["/Users/alice/workspace", "/home/bob/project", "C:\\Users\\charlie\\code"];

    const redacted = paths.map(redactUserPathSegments);

    expect(redacted[0]).toBe("/Users/[USER]/workspace");
    expect(redacted[1]).toBe("/home/[USER]/project");
    expect(redacted[2]).toBe("C:\\Users\\[USER]\\code");
  });
});
```

### 4.3 保留期限测试

```typescript
describe("Audit: Retention Policy", () => {
  it("should archive logs older than 30 days", async () => {
    const policy: AuditRetentionPolicy = {
      ...S01_AUDIT_RETENTION_POLICY,
      archiving: { enabled: true, threshold: 30, target: "s3" },
    };

    // 插入 35 天前的日志
    const oldLog = makeAuditLog();
    oldLog.timestamp = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    await auditStore.write(oldLog);

    // 执行清理
    const result = await cleanupExpiredAuditLogs(policy);

    expect(result.archived).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it("should delete logs older than 90 days", async () => {
    const policy: AuditRetentionPolicy = {
      ...S01_AUDIT_RETENTION_POLICY,
      deletion: { enabled: true, threshold: 90 },
    };

    // 插入 95 天前的日志
    const oldLog = makeAuditLog();
    oldLog.timestamp = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    await auditStore.write(oldLog);

    // 执行清理
    const result = await cleanupExpiredAuditLogs(policy);

    expect(result.deleted).toBe(1);
  });
});
```

### 4.4 签名验证测试

```typescript
describe("Audit: Non-Repudiation (Signature)", () => {
  it("should sign audit log with HMAC-SHA256", () => {
    const log = makeAuditLog();
    const signed = signAuditLog(log, "key-2026", "test-secret-key");

    expect(signed.signature).toBeDefined();
    expect(signed.signatureKeyId).toBe("key-2026");
  });

  it("should verify valid signature", () => {
    const log = makeAuditLog();
    const signed = signAuditLog(log, "key-2026", "test-secret-key");

    const valid = verifyAuditLogSignature(signed, "test-secret-key");

    expect(valid).toBe(true);
  });

  it("should reject tampered log", () => {
    const log = makeAuditLog();
    const signed = signAuditLog(log, "key-2026", "test-secret-key");

    // 篡改日志
    signed.principalId = "attacker-999";

    const valid = verifyAuditLogSignature(signed, "test-secret-key");

    expect(valid).toBe(false);
  });
});
```

---

## 5. 修订总结

### 修订前（存在问题）

- ❌ 无审计失败处理策略
- ❌ 无字段白名单
- ❌ 无敏感值脱敏规则
- ❌ 无保留期限定义
- ❌ 无不可抵赖性保证

### 修订后（问题解决）

- ✅ Fail-Closed 策略（默认）
- ✅ 完整的审计日志字段规范
- ✅ 字段白名单（25 个字段）
- ✅ 敏感值黑名单（17 种）
- ✅ 路径脱敏规则
- ✅ 保留期限策略（90 天 + 归档）
- ✅ HMAC-SHA256 签名（不可抵赖）
- ✅ 新增 3 个错误码
- ✅ 完整的测试计划

### 合规保证

- ✅ 审计失败阻断授权（Fail-Closed）
- ✅ 敏感值不记录（脱敏）
- ✅ 日志不可篡改（签名）
- ✅ 保留期限可追溯（90 天）
- ✅ Legal Hold 支持

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
