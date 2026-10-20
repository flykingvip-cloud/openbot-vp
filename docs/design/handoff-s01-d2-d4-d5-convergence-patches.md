> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D2/D4/D5 规范收敛补丁（合并）

> **补丁日期**: 2026-08-29  
> **修订来源**: R2 (Authorization Matrix), R5 (Audit Failure)  
> **状态**: 规范性修订（Normative）

---

## 补丁 3: D2 授权矩阵收敛

### 目标文档

`handoff-s01-d2-workspace-handle-model.md`

### 修订声明

D2 §3 "租户绑定与隔离" 的简化授权规则被 R2 的 (Principal × Resource × Operation) 授权矩阵完全取代。

### 原始内容（已取代）

```markdown
[SUPERSEDED BY R2]

旧规则:

- Platform 域可访问所有工作区
- Employee 域可访问"本人工作区 + 本租户工作区"
```

**问题**:

- ❌ "同租户"≠"可访问"（缺少 Ownership 验证）
- ❌ Platform 默认全权限（无 break-glass 区分）
- ❌ 无 Operation 级别权限控制

### 新规范（R2）

```typescript
/**
 * 授权矩阵（R2 修订版本）
 *
 * 授权决策基于 (Principal × Resource × Operation) 三元组
 */
export async function authorizeWorkspaceOperation(
  context: AuthorizationContext,
): Promise<AuthorizationDecision> {
  const { principal, resource, operation } = context;

  // Domain 1: Platform Domain
  if (principal.sessionDomain === "platform") {
    return authorizePlatformDomain(context);
  }

  // Domain 2: Enterprise Domain
  if (principal.sessionDomain === "enterprise") {
    return authorizeEnterpriseDomain(context);
  }

  // Domain 3: Employee Domain
  if (principal.sessionDomain === "employee") {
    return authorizeEmployeeDomain(context);
  }

  return { granted: false, reason: "operation_denied" };
}
```

**授权矩阵表** (11 种场景):

| Domain     | Resource Owner     | Operation                  | Decision                 | 备注                  |
| ---------- | ------------------ | -------------------------- | ------------------------ | --------------------- |
| Platform   | Any                | read/list                  | ✅ Allow                 | 只读访问所有工作区    |
| Platform   | Any                | write/execute/delete/admin | ⚠️ Require Break-Glass   | 需要 break-glass 权限 |
| Enterprise | Self (user)        | Any                        | ✅ Allow (if capability) | Owner 全权限          |
| Enterprise | Group (member)     | Any                        | ✅ Allow (if capability) | Group Member 权限     |
| Enterprise | Group (non-member) | Any                        | ❌ Deny                  | 需要组成员资格        |
| Enterprise | Other Tenant       | Any                        | ❌ Deny                  | 租户隔离              |
| Employee   | Self (user)        | Any                        | ✅ Allow (if capability) | 本人工作区            |
| Employee   | Group (member)     | Any                        | ✅ Allow (if capability) | 本租户组工作区        |
| Employee   | Group (non-member) | Any                        | ❌ Deny                  | 需要组成员资格        |
| Employee   | Local (self)       | Any                        | ✅ Allow (if capability) | 本地工作区            |
| Employee   | Local (other)      | Any                        | ❌ Deny                  | 本地工作区隔离        |
| Employee   | Other Tenant       | Any                        | ❌ Deny                  | 租户隔离              |

**新增错误码** (5 个):

- `ERR_OWNERSHIP_MISMATCH`
- `ERR_GROUP_MEMBERSHIP_REQUIRED`
- `ERR_SEAT_NOT_ASSIGNED`
- `ERR_BREAK_GLASS_REQUIRED`
- `ERR_OPERATION_DENIED`

**实现参考**: `handoff-s01-revision-r2-authorization-matrix.md` §2

---

## 补丁 4: D4 resolveAuthorizedToolCwd 接口收敛

### 目标文档

`handoff-s01-d4-resolve-authorized-tool-cwd-interface.md`

### 修订声明

D4 §5 "核心实现逻辑" 集成 R1/R2/R5 修订，消除旧的匿名访问直接放行逻辑。

### 关键修改点

#### 修改点 1: 移除 :448 处旧的匿名放行逻辑

```typescript
// [SUPERSEDED BY R1]
// 旧代码 (行 ~448):
if (!principal) {
  if (allowAnonymousLocal) {
    // 直接放行到本地路径
    return { ok: true, ... };
  }
  return { ok: false, code: "ERR_PRINCIPAL_REQUIRED" };
}
```

**新代码** (集成 R1):

```typescript
if (!principal) {
  if (!allowAnonymousLocal) {
    return buildFailureResult("ERR_PRINCIPAL_REQUIRED", "...");
  }

  // R1: 运行时检查 Anonymous Local 条件（双重校验）
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

  // 仅本地路径 + 只读
  if (isLocalPath(requestedCwd) && (operation === "read" || operation === "list")) {
    // ... (降级到本地工作区)
  } else {
    return buildFailureResult("ERR_ANONYMOUS_LOCAL_FORBIDDEN", "...");
  }
}
```

#### 修改点 2: 添加 R2 授权矩阵检查

```typescript
// 新增步骤（在生命周期状态检查之前）

// 6. 授权矩阵检查（R2）
const authorizationDecision = await authorizeWorkspaceOperation({
  principal,
  resource,
  operation: mapToolOperationToWorkspaceOperation(operation),
});

if (!authorizationDecision.granted) {
  return buildFailureResult(
    mapAuthorizationDenyReasonToErrorCode(authorizationDecision.reason),
    `Authorization denied: ${authorizationDecision.reason}`,
    { handleId: handle.id, operation },
  );
}
```

#### 修改点 3: 添加 R5 审计失败 Fail-Closed

```typescript
// 9. 记录审计日志（R5: Fail-Closed）
const auditResult = await recordToolCwdAuditFailClosed({
  principal,
  handle,
  operation,
  requestedCwd,
  resolvedPath: bestMatch.cwdPath,
  accessMode: "authorized",
  authorizationReason: authorizationDecision.reason,
  auditContext: params.auditContext,
});

// 10. 审计失败 → 拒绝授权（Fail-Closed）
if (!auditResult.ok) {
  return buildFailureResult("ERR_AUDIT_FAILURE", "Authorization denied due to audit failure", {
    auditError: auditResult.error.message,
  });
}
```

#### 修改点 4: 更新错误码清单

D4 错误码清单从 11 个增加到 24 个：

- 核心错误码: 11 个
- R1 (Anonymous Local): 5 个
- R2 (Authorization Matrix): 5 个
- R5 (Audit Failure): 3 个

**实现参考**:

- R1: `handoff-s01-revision-r1-anonymous-local-security.md` §3
- R2: `handoff-s01-revision-r2-authorization-matrix.md` §4
- R5: `handoff-s01-revision-r5-audit-failure-semantics.md` §2.2

---

## 补丁 5: D5 测试计划收敛

### 目标文档

`handoff-s01-d5-regression-prevention-test-plan.md`

### 修订声明

D5 集成 R1-R6 的测试场景，覆盖所有修订要求。

### 新增测试场景

#### §7.1 安全测试 - 新增 Anonymous Local 测试 (R1)

```typescript
describe("Anonymous Local Security (R1)", () => {
  describe("Startup Validation (Fail-Closed)", () => {
    it("should reject allowAnonymousLocal in production profile", () => {
      // 测试启动时校验拒绝生产环境匿名模式
    });

    it("should reject allowAnonymousLocal with non-loopback bind address", () => {
      // 测试启动时校验拒绝非 loopback 地址
    });

    // ... (共 6 个场景)
  });

  describe("Runtime Validation (Double Check)", () => {
    it("should reject write operation in anonymous local mode", () => {
      // 测试运行时拒绝写入操作
    });

    // ... (共 5 个场景)
  });
});
```

#### §7.2 安全测试 - 新增授权矩阵测试 (R2)

```typescript
describe("Authorization Matrix (R2)", () => {
  describe("Platform Domain", () => {
    it("should allow read operation for any workspace", () => {
      // 测试 Platform 域只读访问
    });

    it("should deny write operation without break-glass", () => {
      // 测试 Platform 域写入需要 break-glass
    });
  });

  describe("Enterprise Domain", () => {
    it("should allow owner to access their workspace", () => {
      // 测试 Ownership 验证
    });

    it("should deny cross-tenant access", () => {
      // 测试租户隔离
    });

    // ... (共 11 种场景)
  });
});
```

#### §7.1 安全测试 - 新增 Trusted Proxy 测试 (R3)

```typescript
describe("Trusted Proxy Security (R3)", () => {
  describe("Direct Connection Rejection", () => {
    it("should reject direct connection from untrusted IP", () => {
      // 测试直连拒绝
    });
  });

  describe("Signature Verification", () => {
    it("should reject request with invalid signature", () => {
      // 测试签名验证
    });

    it("should accept request with old key during overlap period", () => {
      // 测试密钥轮换重叠期
    });
  });

  describe("Replay Attack Prevention", () => {
    it("should reject replayed request (same nonce)", () => {
      // 测试重放攻击防护
    });
  });
});
```

#### §6 性能测试 - 新增性能基准测试 (R4)

```typescript
describe("Performance Benchmark (R4)", () => {
  const BENCHMARK_ENV = RECOMMENDED_BENCHMARK_ENV;

  it("should meet small-scale SLA (P99 < 20ms)", async () => {
    const benchmark = new PerformanceBenchmark(BENCHMARK_ENV);
    const result = await benchmark.run(S01_PERFORMANCE_SLA[0]);

    expect(result.passed).toBe(true);
    expect(result.metrics.latency.p99).toBeLessThan(20);
  });

  it("should meet medium-scale SLA (P99 < 50ms)", async () => {
    // 测试中规模性能
  });

  // ... (共 7 个 SLA 场景)
});
```

#### §4 集成测试 - 新增审计失败测试 (R5)

```typescript
describe("Audit Failure Semantics (R5)", () => {
  it("should deny authorization when audit write fails (fail-closed)", async () => {
    mockAuditStore.write.mockRejectedValue(new Error("Audit store unavailable"));

    const result = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/project",
      operation: "read",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ERR_AUDIT_FAILURE");
  });

  describe("Sensitive Value Redaction", () => {
    it("should redact password fields", () => {
      // 测试敏感值脱敏
    });
  });
});
```

#### §3.3 授权 CWD 查询测试 - 新增唯一 SoT 测试 (R6)

```typescript
describe("Single SoT Verification (R6)", () => {
  it("should pass static scan (no CREATE TABLE)", async () => {
    const result = await runStaticScanForSingleSoT();
    expect(result.passed).toBe(true);
  });

  it("should pass API encapsulation check", async () => {
    const result = await verifyCatalogApiEncapsulation();
    expect(result.passed).toBe(true);
  });

  it("should prevent real RDS access in test environment", async () => {
    // 测试环境禁止真实 RDS
  });
});
```

**实现参考**:

- R1-R6: 对应修订文档的测试章节

---

## 补丁 6: 评审指南 Gate 2 收敛

### 目标文档

`handoff-s01-design-review-guide.md`

### 修订位置

章节: Gate 2 - Tenant 隔离与授权  
行号: ~127-133

### 原始内容（已取代）

```markdown
[SUPERSEDED BY R2]

Gate 2 - Tenant 隔离与授权:

- Platform 域可访问所有工作区
- Employee 域可访问本人工作区 + 本租户工作区
```

### 新规范（R2）

```markdown
Gate 2 - Tenant 隔离与授权 (R2 修订版本):

**授权矩阵** (基于 Principal × Resource × Operation):

| Domain     | Resource Owner     | Operation                  | Decision                 |
| ---------- | ------------------ | -------------------------- | ------------------------ |
| Platform   | Any                | read/list                  | ✅ Allow                 |
| Platform   | Any                | write/execute/delete/admin | ⚠️ Require Break-Glass   |
| Enterprise | Self (user)        | Any                        | ✅ Allow (if capability) |
| Enterprise | Group (member)     | Any                        | ✅ Allow (if capability) |
| Enterprise | Group (non-member) | Any                        | ❌ Deny                  |
| Enterprise | Other Tenant       | Any                        | ❌ Deny                  |
| Employee   | Self (user)        | Any                        | ✅ Allow (if capability) |
| Employee   | Group (member)     | Any                        | ✅ Allow (if capability) |
| Employee   | Group (non-member) | Any                        | ❌ Deny                  |
| Employee   | Local (self)       | Any                        | ✅ Allow (if capability) |
| Employee   | Local (other)      | Any                        | ❌ Deny                  |
| Employee   | Other Tenant       | Any                        | ❌ Deny                  |

**验收标准**:

- ✅ Ownership Proof 验证必需
- ✅ 租户隔离严格执行
- ✅ Platform 域只读（写入需 break-glass）
- ✅ Group Membership 检查
- ✅ Operation 级别权限控制

**参考**: handoff-s01-revision-r2-authorization-matrix.md §2.3
```

---

## 验收标准总结

### 收敛完成标准

- ✅ D2 §3 已标记 `[SUPERSEDED BY R2]`，使用授权矩阵
- ✅ D4 §5 已移除旧的匿名放行逻辑，集成 R1/R2/R5
- ✅ D4 错误码清单更新为 24 个
- ✅ D5 新增 R1-R6 测试场景
- ✅ 评审指南 Gate 2 已标记 `[SUPERSEDED BY R2]`，使用授权矩阵

---

**补丁状态**: 规范性修订（Normative）  
**创建日期**: 2026-08-29  
**负责人**: kiro-daibai
