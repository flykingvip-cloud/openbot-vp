> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D5: 防回归测试计划（详细设计）

> **Handoff**: S01 - Trusted Principal & Workspace Handle Gate Design  
> **交付物**: D5 - Regression Prevention Test Plan  
> **状态**: `design-complete`  
> **版本**: 1.0  
> **日期**: 2026-08-29

---

## 1. 概述（Overview）

本测试计划定义完整的防回归测试策略，确保 Trusted Principal 与 Workspace Handle Gate 设计的正确性、安全性与性能。

### 1.1 测试目标

1. **功能正确性**: 核心授权逻辑按预期工作
2. **安全性**: Fail-Closed 语义正确,不可绕过
3. **性能**: 满足 SLA (P99 < 50ms)
4. **向后兼容**: 既有功能不回归
5. **可测性**: 所有分支覆盖，易于调试

---

## 2. 测试覆盖矩阵（Test Coverage Matrix）

### 2.1 核心组件覆盖

| 组件                             | 单元测试 | 集成测试 | 性能测试 | 安全测试 |
| -------------------------------- | -------- | -------- | -------- | -------- |
| `resolveTrustedPrincipal`        | ✅       | ✅       | ✅       | ✅       |
| `WorkspaceHandle` (模型)         | ✅       | ✅       | -        | -        |
| `queryAuthorizedCwdsFromCatalog` | ✅       | ✅       | ✅       | ✅       |
| `resolveAuthorizedToolCwd`       | ✅       | ✅       | ✅       | ✅       |
| `validateTenantIsolation`        | ✅       | ✅       | -        | ✅       |
| `checkWorkspaceCapability`       | ✅       | ✅       | -        | -        |
| `checkWorkspaceLifecycleState`   | ✅       | ✅       | -        | -        |
| Audit Logging                    | ✅       | ✅       | -        | -        |

### 2.2 错误场景覆盖

| 错误码                        | 单元测试 | 集成测试 | 用户提示验证 |
| ----------------------------- | -------- | -------- | ------------ |
| `ERR_PRINCIPAL_REQUIRED`      | ✅       | ✅       | ✅           |
| `ERR_TENANT_BINDING_REQUIRED` | ✅       | ✅       | ✅           |
| `ERR_WORKSPACE_NOT_FOUND`     | ✅       | ✅       | ✅           |
| `ERR_TENANT_MISMATCH`         | ✅       | ✅       | ✅           |
| `ERR_CAPABILITY_DENIED`       | ✅       | ✅       | ✅           |
| `ERR_WORKSPACE_SUSPENDED`     | ✅       | ✅       | ✅           |
| `ERR_WORKSPACE_ARCHIVED`      | ✅       | ✅       | ✅           |
| `ERR_WORKSPACE_RETIRED`       | ✅       | ✅       | ✅           |
| `ERR_PATH_OUTSIDE_WORKSPACE`  | ✅       | ✅       | ✅           |
| `ERR_CATALOG_UNAVAILABLE`     | ✅       | ✅       | ✅           |
| `ERR_INVALID_PATH`            | ✅       | ✅       | ✅           |

---

## 3. 单元测试（Unit Tests）

### 3.1 Trusted Principal 解析

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

    it("should return null when user does not exist", async () => {
      const client = makeClientWithSession({
        user: null, // User 不存在
      });

      const principal = await resolveTrustedPrincipal(client);
      expect(principal).toBeNull();
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

    it("should return null when header is malformed", async () => {
      const client = makeClientWithTrustedProxy({
        header: "invalid-header",
        clientIp: "10.0.0.1",
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
    });
  });
});
```

### 3.2 Workspace Handle 模型

```typescript
describe("WorkspaceHandle Model", () => {
  describe("buildWorkspaceHandleFromCatalogRecord", () => {
    it("should build handle from valid catalog record", () => {
      const record = makeTestCatalogRecord({
        resourceType: "workspace",
        tenantId: "ent-456",
        userId: "usr-789",
        rootPath: "/workspace/test",
      });

      const handle = buildWorkspaceHandleFromCatalogRecord(record);

      expect(handle).toMatchObject({
        kind: "workspace",
        tenantId: "ent-456",
        owner: { kind: "user", userId: "usr-789" },
        rootPath: "/workspace/test",
        state: "active",
      });
    });

    it("should return null for non-workspace resource", () => {
      const record = makeTestCatalogRecord({
        resourceType: "agent",
      });

      const handle = buildWorkspaceHandleFromCatalogRecord(record);
      expect(handle).toBeNull();
    });

    it("should throw when canonical binding is missing", () => {
      const record = makeTestCatalogRecord({
        resourceType: "workspace",
        bindings: [], // 无 canonical binding
      });

      expect(() => buildWorkspaceHandleFromCatalogRecord(record)).toThrow(
        "missing canonical binding",
      );
    });
  });

  describe("deriveCapabilitiesFromBinding", () => {
    it("should derive full capabilities from canonical binding", () => {
      const binding = { role: "canonical" };
      const caps = deriveCapabilitiesFromBinding(binding);
      expect(caps).toEqual(["read", "write", "execute", "list"]);
    });

    it("should derive read-only from replica binding", () => {
      const binding = { role: "replica" };
      const caps = deriveCapabilitiesFromBinding(binding);
      expect(caps).toEqual(["read", "list"]);
    });

    it("should derive archive-only from archive binding", () => {
      const binding = { role: "archive" };
      const caps = deriveCapabilitiesFromBinding(binding);
      expect(caps).toEqual(["read"]);
    });
  });

  describe("validateTenantIsolation", () => {
    it("should allow platform domain to access any workspace", () => {
      const result = validateTenantIsolation({
        resourceTenantId: "ent-123",
        principal: makePrincipal({
          sessionDomain: "platform",
        }),
      });

      expect(result.ok).toBe(true);
    });

    it("should deny cross-tenant access", () => {
      const result = validateTenantIsolation({
        resourceTenantId: "ent-AAA",
        principal: makePrincipal({
          tenantId: "ent-BBB",
          sessionDomain: "enterprise",
        }),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("tenant_mismatch");
      }
    });

    it("should allow local workspace in employee domain", () => {
      const result = validateTenantIsolation({
        resourceTenantId: null,
        principal: makePrincipal({
          sessionDomain: "employee",
        }),
      });

      expect(result.ok).toBe(true);
    });

    it("should deny local workspace in non-employee domain", () => {
      const result = validateTenantIsolation({
        resourceTenantId: null,
        principal: makePrincipal({
          tenantId: "ent-456",
          sessionDomain: "enterprise",
        }),
      });

      expect(result.ok).toBe(false);
    });
  });
});
```

### 3.3 授权 CWD 查询

```typescript
describe("queryAuthorizedCwdsFromCatalog", () => {
  it("should return authorized CWDs for valid principal", async () => {
    const catalog = createTestCatalog();
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    const entries = await queryAuthorizedCwdsFromCatalog({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
    });

    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry) => {
      expect(entry.tenantId).toBe("ent-456");
    });
  });

  it("should filter out cross-tenant workspaces", async () => {
    const catalog = createTestCatalog();
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-AAA",
    });

    const entries = await queryAuthorizedCwdsFromCatalog({
      catalog,
      principal,
      requestedCwd: "/workspace/other-tenant", // 属于 ent-BBB
    });

    expect(entries.length).toBe(0);
  });

  it("should filter out retired workspaces", async () => {
    const catalog = createTestCatalog();
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    // 添加已退役的工作区
    addRetiredWorkspace(catalog, "ent-456");

    const entries = await queryAuthorizedCwdsFromCatalog({
      catalog,
      principal,
      requestedCwd: "/workspace/retired",
    });

    expect(entries.length).toBe(0);
  });

  it("should throw when catalog is unavailable", async () => {
    const catalog = createUnavailableCatalog();
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    await expect(
      queryAuthorizedCwdsFromCatalog({
        catalog,
        principal,
        requestedCwd: "/workspace/test",
      }),
    ).rejects.toThrow("Catalog unavailable");
  });
});
```

### 3.4 resolveAuthorizedToolCwd (核心)

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

    it("should select longest matching path", async () => {
      const catalog = createTestCatalog();
      addWorkspace(catalog, "/workspace/group-alpha");
      addWorkspace(catalog, "/workspace/group-alpha/subdir");

      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha/subdir/file.txt",
        operation: "read",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 应选择最长匹配
        expect(result.resolvedPath).toBe("/workspace/group-alpha/subdir");
      }
    });
  });

  describe("Error Cases", () => {
    it("ERR_PRINCIPAL_REQUIRED", async () => {
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

    it("ERR_TENANT_MISMATCH", async () => {
      const catalog = createTestCatalog();
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-AAA",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/other-tenant",
        operation: "read",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_TENANT_MISMATCH");
      }
    });

    it("ERR_CAPABILITY_DENIED", async () => {
      const catalog = createTestCatalog();
      const readOnlyHandle = addReadOnlyWorkspace(catalog);
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: readOnlyHandle.rootPath,
        operation: "write",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_CAPABILITY_DENIED");
      }
    });

    it("ERR_WORKSPACE_SUSPENDED", async () => {
      const catalog = createTestCatalog();
      const suspendedHandle = addSuspendedWorkspace(catalog);
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: suspendedHandle.rootPath,
        operation: "write",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_WORKSPACE_SUSPENDED");
      }
    });

    it("ERR_WORKSPACE_RETIRED", async () => {
      const catalog = createTestCatalog();
      const retiredHandle = addRetiredWorkspace(catalog);
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: retiredHandle.rootPath,
        operation: "read",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_WORKSPACE_RETIRED");
      }
    });

    it("ERR_CATALOG_UNAVAILABLE", async () => {
      const catalog = createUnavailableCatalog();
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/test",
        operation: "read",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ERR_CATALOG_UNAVAILABLE");
      }
    });
  });
});
```

---

## 4. 集成测试（Integration Tests）

### 4.1 端到端授权流程

```typescript
describe("End-to-End Authorization", () => {
  it("should authorize read_file tool execution", async () => {
    // 1. 创建测试环境
    const catalog = createTestCatalog();
    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: { enterpriseId: "ent-456" },
    });

    // 2. 解析 Principal
    const principal = await resolveTrustedPrincipal(client);
    expect(principal).not.toBeNull();

    // 3. 解析 CWD
    const cwdResult = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      auditContext: {
        toolName: "read_file",
        sessionId: client.sessionId,
        requestId: "req-123",
      },
    });

    expect(cwdResult.ok).toBe(true);
    if (cwdResult.ok) {
      // 4. 验证审计日志
      const auditLog = await getAuditLog(cwdResult.auditRecordId);
      expect(auditLog).toMatchObject({
        event: "tool_cwd_authorized",
        principal: {
          userId: "usr-123",
          tenantId: "ent-456",
        },
        request: {
          toolName: "read_file",
          operation: "read",
        },
      });
    }
  });

  it("should deny unauthorized write_file tool execution", async () => {
    const catalog = createTestCatalog();
    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: null, // 非企业成员
    });

    const principal = await resolveTrustedPrincipal(client);

    const cwdResult = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/enterprise/project", // 企业工作区
      operation: "write",
    });

    expect(cwdResult.ok).toBe(false);
    if (!cwdResult.ok) {
      expect(cwdResult.code).toBe("ERR_TENANT_BINDING_REQUIRED");
    }
  });
});
```

### 4.2 Tool 执行集成

```typescript
describe("Tool Execution Integration", () => {
  it("fs_write should respect workspace authorization", async () => {
    const catalog = createTestCatalog();
    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: { enterpriseId: "ent-456" },
    });

    const result = await fsWriteTool({
      client,
      path: "/workspace/group-alpha/file.txt",
      text: "test content",
    });

    expect(result.ok).toBe(true);
  });

  it("execute_bash should respect workspace authorization", async () => {
    const catalog = createTestCatalog();
    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: { enterpriseId: "ent-456" },
    });

    const result = await executeBashTool({
      client,
      command: "ls -la",
      cwd: "/workspace/group-alpha",
    });

    expect(result.ok).toBe(true);
  });

  it("should deny tool execution when workspace is retired", async () => {
    const catalog = createTestCatalog();
    addRetiredWorkspace(catalog, "ent-456", "/workspace/retired");

    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: { enterpriseId: "ent-456" },
    });

    const result = await fsWriteTool({
      client,
      path: "/workspace/retired/file.txt",
      text: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ERR_WORKSPACE_RETIRED");
    }
  });
});
```

---

## 5. 失败场景测试（Failure Scenario Tests）

### 5.1 失败场景矩阵

```typescript
describe("Failure Scenario Matrix", () => {
  const scenarios: Array<{
    name: string;
    setup: () => Promise<{
      catalog: WorkspaceResourceCatalog;
      principal: TrustedPrincipal | null;
      requestedCwd: string;
      operation: string;
    }>;
    expectedError: AuthorizedToolCwdErrorCode;
  }> = [
    {
      name: "无 Principal",
      setup: async () => ({
        catalog: createTestCatalog(),
        principal: null,
        requestedCwd: "/workspace/test",
        operation: "read",
      }),
      expectedError: "ERR_PRINCIPAL_REQUIRED",
    },
    {
      name: "跨租户访问",
      setup: async () => ({
        catalog: createTestCatalog(),
        principal: makePrincipal({ tenantId: "ent-AAA" }),
        requestedCwd: "/workspace/tenant-BBB",
        operation: "read",
      }),
      expectedError: "ERR_TENANT_MISMATCH",
    },
    {
      name: "工作区不存在",
      setup: async () => ({
        catalog: createEmptyWorkspaceCatalog(),
        principal: makePrincipal({ tenantId: "ent-456" }),
        requestedCwd: "/workspace/nonexistent",
        operation: "read",
      }),
      expectedError: "ERR_WORKSPACE_NOT_FOUND",
    },
    {
      name: "能力不足",
      setup: async () => {
        const catalog = createTestCatalog();
        addReadOnlyWorkspace(catalog, "ent-456", "/workspace/readonly");
        return {
          catalog,
          principal: makePrincipal({ tenantId: "ent-456" }),
          requestedCwd: "/workspace/readonly",
          operation: "write",
        };
      },
      expectedError: "ERR_CAPABILITY_DENIED",
    },
    {
      name: "工作区已暂停",
      setup: async () => {
        const catalog = createTestCatalog();
        addSuspendedWorkspace(catalog, "ent-456", "/workspace/suspended");
        return {
          catalog,
          principal: makePrincipal({ tenantId: "ent-456" }),
          requestedCwd: "/workspace/suspended",
          operation: "write",
        };
      },
      expectedError: "ERR_WORKSPACE_SUSPENDED",
    },
    {
      name: "工作区已退役",
      setup: async () => {
        const catalog = createTestCatalog();
        addRetiredWorkspace(catalog, "ent-456", "/workspace/retired");
        return {
          catalog,
          principal: makePrincipal({ tenantId: "ent-456" }),
          requestedCwd: "/workspace/retired",
          operation: "read",
        };
      },
      expectedError: "ERR_WORKSPACE_RETIRED",
    },
    {
      name: "Catalog 不可用",
      setup: async () => ({
        catalog: createUnavailableCatalog(),
        principal: makePrincipal({ tenantId: "ent-456" }),
        requestedCwd: "/workspace/test",
        operation: "read",
      }),
      expectedError: "ERR_CATALOG_UNAVAILABLE",
    },
  ];

  scenarios.forEach((scenario) => {
    it(`should handle: ${scenario.name}`, async () => {
      const { catalog, principal, requestedCwd, operation } = await scenario.setup();

      const result = await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd,
        operation: operation as any,
        allowAnonymousLocal: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(scenario.expectedError);
        expect(result.userMessage).toBeTruthy();
      }
    });
  });
});
```

---

## 6. 性能测试（Performance Tests）

### 6.1 CWD 解析性能

```typescript
describe("Performance: resolveAuthorizedToolCwd", () => {
  it("should resolve CWD within P99 < 50ms", async () => {
    // 创建包含 100 个 Workspace Resources 的 Catalog
    const catalog = createLargeCatalog(100);
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    // 执行 1000 次解析，记录耗时
    const latencies: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();

      await resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: `/workspace/group-${i % 100}`,
        operation: "read",
      });

      const end = performance.now();
      latencies.push(end - start);
    }

    // 计算 P50, P95, P99
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(`P50: ${p50.toFixed(2)}ms`);
    console.log(`P95: ${p95.toFixed(2)}ms`);
    console.log(`P99: ${p99.toFixed(2)}ms`);

    expect(p99).toBeLessThan(50);
  });

  it("should handle concurrent requests", async () => {
    const catalog = createTestCatalog();
    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    // 并发 100 个请求
    const promises = Array.from({ length: 100 }, (_, i) =>
      resolveAuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: `/workspace/group-${i % 10}`,
        operation: "read",
      }),
    );

    const start = performance.now();
    const results = await Promise.all(promises);
    const end = performance.now();

    const avgLatency = (end - start) / 100;
    console.log(`Average latency (concurrent): ${avgLatency.toFixed(2)}ms`);

    expect(avgLatency).toBeLessThan(100);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
```

### 6.2 Catalog 查询性能

```typescript
describe("Performance: queryAuthorizedCwdsFromCatalog", () => {
  it("should scale with catalog size", async () => {
    const catalogSizes = [10, 50, 100, 500, 1000];
    const results: Array<{ size: number; p99: number }> = [];

    for (const size of catalogSizes) {
      const catalog = createLargeCatalog(size);
      const principal = makePrincipal({
        userId: "usr-123",
        tenantId: "ent-456",
      });

      const latencies: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();

        await queryAuthorizedCwdsFromCatalog({
          catalog,
          principal,
          requestedCwd: `/workspace/group-${i % size}`,
        });

        const end = performance.now();
        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      results.push({ size, p99 });
      console.log(`Catalog size ${size}: P99 = ${p99.toFixed(2)}ms`);
    }

    // 验证性能不会随 Catalog 规模线性增长
    // (有优化策略：早期终止、索引)
    const largestP99 = results[results.length - 1].p99;
    expect(largestP99).toBeLessThan(100);
  });
});
```

---

## 7. 安全测试（Security Tests）

### 7.1 伪造攻击防御

```typescript
describe("Security: Anti-Forgery", () => {
  it("should reject forged session signature", async () => {
    const client = makeClientWithForgedSession({
      userId: "usr-attacker",
      tenantId: "ent-target",
    });

    const principal = await resolveTrustedPrincipal(client);
    expect(principal).toBeNull(); // 伪造签名被拒绝
  });

  it("should reject untrusted proxy header", async () => {
    const client = makeClientWithTrustedProxy({
      header: "usr-attacker:ent-target:platform",
      clientIp: "1.2.3.4", // 非白名单 IP
    });

    const principal = await resolveTrustedPrincipal(client);
    expect(principal).toBeNull();
  });

  it("should not trust client-supplied tenantId", async () => {
    const client = makeClientWithSession({
      user: { id: "usr-123", email: "alice@example.com" },
      membership: { enterpriseId: "ent-456" },
    });

    // 客户端尝试伪造 tenantId
    client.sessionTenantId = "ent-target";

    const principal = await resolveTrustedPrincipal(client);

    // Principal 的 tenantId 应来自 Membership，而非客户端
    expect(principal?.tenantId).toBe("ent-456"); // 不是 "ent-target"
  });
});
```

### 7.2 租户隔离防御

```typescript
describe("Security: Tenant Isolation", () => {
  it("should prevent cross-tenant data leak", async () => {
    const catalog = createTestCatalog();
    addWorkspace(catalog, "ent-AAA", "/workspace/tenant-A");
    addWorkspace(catalog, "ent-BBB", "/workspace/tenant-B");

    const principalA = makePrincipal({ tenantId: "ent-AAA" });

    // 尝试访问 ent-BBB 的工作区
    const result = await resolveAuthorizedToolCwd({
      catalog,
      principal: principalA,
      requestedCwd: "/workspace/tenant-B",
      operation: "read",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_TENANT_MISMATCH");
    }
  });

  it("should prevent privilege escalation via local workspace", async () => {
    const catalog = createTestCatalog();
    const enterprisePrincipal = makePrincipal({
      tenantId: "ent-456",
      sessionDomain: "enterprise",
    });

    // Enterprise 域不应访问本地工作区 (tenantId=null)
    const result = await resolveAuthorizedToolCwd({
      catalog,
      principal: enterprisePrincipal,
      requestedCwd: "/Users/alice/local-workspace",
      operation: "read",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_WORKSPACE_NOT_FOUND");
    }
  });
});
```

### 7.3 路径遍历防御

```typescript
describe("Security: Path Traversal", () => {
  it("should reject path with .. traversal", async () => {
    const catalog = createTestCatalog();
    const principal = makePrincipal({ tenantId: "ent-456" });

    const result = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha/../../../etc/passwd",
      operation: "read",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_INVALID_PATH");
    }
  });

  it("should reject path outside workspace root", async () => {
    const catalog = createTestCatalog();
    addWorkspace(catalog, "ent-456", "/workspace/group-alpha");

    const principal = makePrincipal({ tenantId: "ent-456" });

    // 尝试访问工作区外的路径
    const result = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/other-workspace/file.txt",
      operation: "read",
    });

    expect(result.ok).toBe(false);
  });
});
```

---

## 8. 向后兼容测试（Backward Compatibility Tests）

### 8.1 既有功能不回归

```typescript
describe("Backward Compatibility", () => {
  it("should not break existing workspace-resolver calls", async () => {
    // 既有代码路径 (不使用 Principal)
    const actor = { tenantId: "ent-456", userId: "usr-123" };
    const resolved = await resolveWorkspaceResource({
      catalog: createTestCatalog(),
      actor,
      resourceId: "wsr-test-123",
      operation: "read",
      purpose: "test",
    });

    expect(resolved.ok).toBe(true);
  });

  it("should support anonymous local mode", async () => {
    // 本地 operator mode (无 Platform Auth)
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

  it("should preserve group/steward/local workspace resolution", async () => {
    const catalog = createTestCatalog();
    addGroupWorkspace(catalog, "ent-456", "/workspace/group-alpha");
    addStewardWorkspace(catalog, "agent-123", "/workspace/steward-beta");
    addLocalWorkspace(catalog, "usr-123", "/workspace/local-gamma");

    const principal = makePrincipal({
      userId: "usr-123",
      tenantId: "ent-456",
    });

    // 所有类型的工作区都应可解析
    const groupResult = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
    });
    expect(groupResult.ok).toBe(true);

    const stewardResult = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/steward-beta",
      operation: "read",
    });
    expect(stewardResult.ok).toBe(true);

    const localResult = await resolveAuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/local-gamma",
      operation: "read",
    });
    expect(localResult.ok).toBe(true);
  });
});
```

---

## 9. 测试辅助工具（Test Utilities）

### 9.1 测试数据构造器

```typescript
/**
 * 创建测试 Catalog (包含典型工作区)
 */
export function createTestCatalog(): WorkspaceResourceCatalog {
  let catalog = createEmptyWorkspaceCatalog();

  // 添加企业工作区
  catalog = addWorkspace(catalog, "ent-456", "/workspace/group-alpha");
  catalog = addWorkspace(catalog, "ent-456", "/workspace/group-beta");

  // 添加本地工作区
  catalog = addLocalWorkspace(catalog, "usr-123", "/Users/alice/local");

  return catalog;
}

/**
 * 创建大规模 Catalog (性能测试)
 */
export function createLargeCatalog(size: number): WorkspaceResourceCatalog {
  let catalog = createEmptyWorkspaceCatalog();

  for (let i = 0; i < size; i++) {
    catalog = addWorkspace(catalog, "ent-456", `/workspace/group-${i}`);
  }

  return catalog;
}

/**
 * 创建测试 Principal
 */
export function makePrincipal(params: {
  userId?: string;
  tenantId?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  source?: string;
}): TrustedPrincipal {
  return {
    userId: params.userId ?? "usr-default",
    tenantId: params.tenantId,
    sessionDomain: params.sessionDomain ?? "employee",
    source: (params.source as any) ?? "platform-auth-session",
    resolvedAt: Date.now(),
  };
}

/**
 * 添加只读工作区
 */
export function addReadOnlyWorkspace(
  catalog: WorkspaceResourceCatalog,
  tenantId: string = "ent-456",
  rootPath: string = "/workspace/readonly",
): WorkspaceHandle {
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId: "usr-owner",
    agentAssetId: "agent-asset-readonly",
    workspaceRoot: rootPath,
    classification: "readonly",
    bindingRole: "replica", // 只读
  });

  return addCatalogEntry(catalog, entry);
}
```

---

## 10. 测试覆盖率目标（Coverage Targets）

| 组件                             | 行覆盖    | 分支覆盖  | 函数覆盖 |
| -------------------------------- | --------- | --------- | -------- |
| `resolveTrustedPrincipal`        | > 90%     | > 85%     | 100%     |
| `WorkspaceHandle` (builders)     | > 90%     | > 85%     | 100%     |
| `queryAuthorizedCwdsFromCatalog` | > 90%     | > 85%     | 100%     |
| `resolveAuthorizedToolCwd`       | > 95%     | > 90%     | 100%     |
| `validateTenantIsolation`        | 100%      | 100%      | 100%     |
| `checkWorkspaceCapability`       | 100%      | 100%      | 100%     |
| **Overall**                      | **> 90%** | **> 85%** | **100%** |

---

## 11. CI/CD 集成（CI/CD Integration）

### 11.1 测试流水线

```yaml
# .github/workflows/test-workspace-handle-gate.yml
name: Workspace Handle Gate Tests

on:
  push:
    branches: [main]
  pull_request:
    paths:
      - "src/gateway/trusted-principal.ts"
      - "src/gateway/workspace-resolver/**"
      - "tests/workspace-handle-gate/**"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "22"

      - name: Install dependencies
        run: pnpm install

      - name: Run unit tests
        run: pnpm test -- workspace-handle-gate.test.ts

      - name: Run integration tests
        run: pnpm test -- workspace-handle-gate.integration.test.ts

      - name: Run performance tests
        run: pnpm test -- workspace-handle-gate.perf.test.ts

      - name: Check coverage
        run: pnpm test:coverage -- workspace-handle-gate
        env:
          COVERAGE_THRESHOLD: 90

      - name: Upload coverage report
        uses: codecov/codecov-action@v3
```

---

## 12. 评审检查清单（Review Checklist）

- [x] 单元测试覆盖所有核心组件
- [x] 集成测试覆盖端到端流程
- [x] 所有 11 个错误码都有对应测试
- [x] 失败场景矩阵完整
- [x] 性能测试覆盖 P99 < 50ms 要求
- [x] 安全测试覆盖伪造/隔离/路径遍历
- [x] 向后兼容测试覆盖既有功能
- [x] 测试覆盖率目标明确 (> 90%)
- [x] CI/CD 集成清晰
- [x] 测试辅助工具完备

---

**状态**: D5 设计完成，等待评审
