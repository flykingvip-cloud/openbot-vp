> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R7 + R8: 文档一致性修订（合并）

> **修订问题 7**: 文档自身存在范围和数字不一致  
> **修订问题 8**: "设计完成"与"评审未完成"混在一起  
> **严重性**: 🟢 低（文档一致性）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

### 问题 7: 文档数字不一致

**具体问题**:

- "5 个交付物" vs "7 个文件"（主 Handoff、D1-D5、总结）
- "设计文档 6 个"也与前文不一致
- 11 个错误码没有映射到具体测试文件、审计事件和 RPC 响应契约

### 问题 8: "设计完成"与"评审未完成"混淆

**具体问题**:

- 多处使用 ✅（例如评审说明 :499-503），但同一文件的 Gate checklist 全部未勾选
- 会让读者误以为架构约束已经被代码验证
- 应明确区分：设计意图、待验证条件、已有代码证据、实现后退出标准

---

## 2. 修订方案

### 2.1 统一文档清单

```markdown
# S01 Handoff 设计文档清单

## 核心设计文档（7 个）

1. **主 Handoff 文档**
   - 文件: `docs/design/handoff-s01-trusted-principal-handle-gate.md`
   - 用途: S01 设计总览，Design Handoff 契约
   - 状态: ✅ 已落地 (PR #807, commit 86c7454d56)

2. **D1: Trusted Principal 契约**
   - 文件: `docs/design/handoff-s01-d1-trusted-principal-contract.md`
   - 用途: Principal 定义、传播路径、向后兼容
   - 状态: 📋 设计完成，待实现验证

3. **D2: 租户绑定与隔离**
   - 文件: `docs/design/handoff-s01-d2-tenant-binding-isolation.md`
   - 用途: 租户隔离规则、跨租户防护
   - 状态: 📋 设计完成，待实现验证

4. **D3: Workspace Catalog 架构**
   - 文件: `docs/design/handoff-s01-d3-workspace-catalog-architecture.md`
   - 用途: Catalog 数据模型、唯一 SoT、性能分析
   - 状态: 📋 设计完成，待实现验证

5. **D4: Handle Gate 接口设计**
   - 文件: `docs/design/handoff-s01-d4-handle-gate-interface.md`
   - 用途: resolveAuthorizedToolCwd 接口、错误码、审计日志
   - 状态: 📋 设计完成，待实现验证

6. **D5: 测试计划**
   - 文件: `docs/design/handoff-s01-d5-test-plan.md`
   - 用途: 单元测试、集成测试、性能测试、安全测试
   - 状态: 📋 设计完成，待实现验证

7. **设计完成总结**
   - 文件: `docs/design/handoff-s01-design-completion-summary.md`
   - 用途: 交付物清单、设计决策、待实现清单
   - 状态: 📋 设计完成

## 修订文档（8 个）

8. **R1: Anonymous Local 安全封闭**
   - 文件: `docs/design/handoff-s01-revision-r1-anonymous-local-security.md`
   - 用途: 修订问题 1（P0）
   - 状态: ✅ 修订完成

9. **R2: 授权矩阵**
   - 文件: `docs/design/handoff-s01-revision-r2-authorization-matrix.md`
   - 用途: 修订问题 2（P0）
   - 状态: ✅ 修订完成

10. **R3: Trusted Proxy 威胁模型**
    - 文件: `docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md`
    - 用途: 修订问题 3（P1）
    - 状态: ✅ 修订完成

11. **R4: 性能基准**
    - 文件: `docs/design/handoff-s01-revision-r4-performance-benchmark.md`
    - 用途: 修订问题 4（P1）
    - 状态: ✅ 修订完成

12. **R5: 审计失败语义**
    - 文件: `docs/design/handoff-s01-revision-r5-audit-failure-semantics.md`
    - 用途: 修订问题 5（P1）
    - 状态: ✅ 修订完成

13. **R6: 唯一 SoT 验收脚本**
    - 文件: `docs/design/handoff-s01-revision-r6-single-sot-verification.md`
    - 用途: 修订问题 6（P2）
    - 状态: ✅ 修订完成

14. **R7+R8: 文档一致性**
    - 文件: `docs/design/handoff-s01-revision-r7-r8-documentation-consistency.md`
    - 用途: 修订问题 7、8（P2）
    - 状态: ✅ 修订完成

15. **修订计划**
    - 文件: `docs/design/handoff-s01-revision-plan.md`
    - 用途: 评审结论、修订计划、问题清单
    - 状态: ✅ 修订完成

## 评审文档（1 个）

16. **设计评审说明**
    - 文件: `docs/design/handoff-s01-design-review-guide.md`
    - 用途: 评审清单、验收标准、关键问题
    - 状态: 📋 评审完成（需要修订）

---

**总计**: 16 个文档

- 核心设计文档: 7 个
- 修订文档: 8 个
- 评审文档: 1 个
```

### 2.2 错误码映射表

```typescript
/**
 * S01 错误码完整映射表
 *
 * 映射关系：错误码 → 测试文件 → 审计事件 → RPC 响应
 */
export const S01_ERROR_CODE_MAPPING: Record<
  AuthorizedToolCwdErrorCode,
  {
    code: string;
    description: string;
    testFile: string;
    testCase: string;
    auditEvent: string;
    rpcStatus: number;
    userMessage: string;
  }
> = {
  // ========================================
  // 核心错误码（基础设计）
  // ========================================
  ERR_PRINCIPAL_REQUIRED: {
    code: "ERR_PRINCIPAL_REQUIRED",
    description: "Trusted Principal 缺失",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should reject request without principal",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 401, // Unauthorized
    userMessage: "需要身份验证才能访问工作区",
  },

  ERR_TENANT_BINDING_REQUIRED: {
    code: "ERR_TENANT_BINDING_REQUIRED",
    description: "租户绑定缺失",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should reject enterprise principal without tenant binding",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "企业用户必须绑定租户",
  },

  ERR_WORKSPACE_NOT_FOUND: {
    code: "ERR_WORKSPACE_NOT_FOUND",
    description: "工作区未找到",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should return not found for non-existent workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 404, // Not Found
    userMessage: "未找到指定的工作区",
  },

  ERR_TENANT_MISMATCH: {
    code: "ERR_TENANT_MISMATCH",
    description: "租户隔离冲突",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny cross-tenant access",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "无权访问其他租户的工作区",
  },

  ERR_CAPABILITY_DENIED: {
    code: "ERR_CAPABILITY_DENIED",
    description: "能力不足",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny write operation for read-only workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "当前工作区不支持此操作",
  },

  ERR_WORKSPACE_SUSPENDED: {
    code: "ERR_WORKSPACE_SUSPENDED",
    description: "工作区已暂停",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny access to suspended workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 423, // Locked
    userMessage: "工作区已被暂停",
  },

  ERR_WORKSPACE_ARCHIVED: {
    code: "ERR_WORKSPACE_ARCHIVED",
    description: "工作区已归档",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny write to archived workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 410, // Gone
    userMessage: "工作区已归档，不支持修改",
  },

  ERR_WORKSPACE_RETIRED: {
    code: "ERR_WORKSPACE_RETIRED",
    description: "工作区已退役",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny access to retired workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 410, // Gone
    userMessage: "工作区已退役",
  },

  ERR_PATH_OUTSIDE_WORKSPACE: {
    code: "ERR_PATH_OUTSIDE_WORKSPACE",
    description: "路径越界",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should deny path traversal outside workspace",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "请求的路径超出工作区边界",
  },

  ERR_CATALOG_UNAVAILABLE: {
    code: "ERR_CATALOG_UNAVAILABLE",
    description: "Catalog 不可用",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should fail gracefully when catalog is unavailable",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 503, // Service Unavailable
    userMessage: "工作区服务暂时不可用",
  },

  ERR_INVALID_PATH: {
    code: "ERR_INVALID_PATH",
    description: "路径格式无效",
    testFile: "src/gateway/workspace-resolver/index.test.ts",
    testCase: "should reject invalid path format",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 400, // Bad Request
    userMessage: "路径格式无效",
  },

  // ========================================
  // R1: Anonymous Local（修订 1）
  // ========================================
  ERR_ANONYMOUS_LOCAL_FORBIDDEN: {
    code: "ERR_ANONYMOUS_LOCAL_FORBIDDEN",
    description: "匿名本地模式被禁止",
    testFile: "src/gateway/workspace-resolver/anonymous-local.test.ts",
    testCase: "should reject anonymous local in production profile",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "当前环境不支持匿名访问",
  },

  ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH: {
    code: "ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH",
    description: "匿名模式仅允许本地路径",
    testFile: "src/gateway/workspace-resolver/anonymous-local.test.ts",
    testCase: "should reject non-local path in anonymous mode",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "匿名模式仅允许访问本地路径",
  },

  ERR_ANONYMOUS_LOCAL_WRITE_DENIED: {
    code: "ERR_ANONYMOUS_LOCAL_WRITE_DENIED",
    description: "匿名模式禁止写入",
    testFile: "src/gateway/workspace-resolver/anonymous-local.test.ts",
    testCase: "should reject write operation in anonymous mode",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "匿名模式不支持写入操作",
  },

  ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED: {
    code: "ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED",
    description: "匿名模式禁止执行",
    testFile: "src/gateway/workspace-resolver/anonymous-local.test.ts",
    testCase: "should reject execute operation in anonymous mode",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "匿名模式不支持执行命令",
  },

  ERR_ANONYMOUS_LOCAL_TOOL_DENIED: {
    code: "ERR_ANONYMOUS_LOCAL_TOOL_DENIED",
    description: "工具在匿名模式下不可用",
    testFile: "src/gateway/workspace-resolver/anonymous-local.test.ts",
    testCase: "should reject denied tool in anonymous mode",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "当前工具在匿名模式下不可用",
  },

  // ========================================
  // R2: Authorization Matrix（修订 2）
  // ========================================
  ERR_OWNERSHIP_MISMATCH: {
    code: "ERR_OWNERSHIP_MISMATCH",
    description: "所有权不匹配",
    testFile: "src/gateway/workspace-resolver/authorization.test.ts",
    testCase: "should deny access for non-owner",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "您不是该工作区的所有者",
  },

  ERR_GROUP_MEMBERSHIP_REQUIRED: {
    code: "ERR_GROUP_MEMBERSHIP_REQUIRED",
    description: "需要组成员资格",
    testFile: "src/gateway/workspace-resolver/authorization.test.ts",
    testCase: "should deny access for non-group-member",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "您不是该工作区所属组的成员",
  },

  ERR_SEAT_NOT_ASSIGNED: {
    code: "ERR_SEAT_NOT_ASSIGNED",
    description: "Seat 未分配",
    testFile: "src/gateway/workspace-resolver/authorization.test.ts",
    testCase: "should deny access when seat not assigned",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "您未被分配该 Agent 的席位",
  },

  ERR_BREAK_GLASS_REQUIRED: {
    code: "ERR_BREAK_GLASS_REQUIRED",
    description: "需要 break-glass 权限",
    testFile: "src/gateway/workspace-resolver/authorization.test.ts",
    testCase: "should require break-glass for platform write",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "该操作需要紧急运维权限",
  },

  ERR_OPERATION_DENIED: {
    code: "ERR_OPERATION_DENIED",
    description: "操作被禁止",
    testFile: "src/gateway/workspace-resolver/authorization.test.ts",
    testCase: "should deny unauthorized operation",
    auditEvent: "tool_cwd_denied",
    rpcStatus: 403, // Forbidden
    userMessage: "当前操作被禁止",
  },

  // ========================================
  // R5: Audit Failure（修订 5）
  // ========================================
  ERR_AUDIT_FAILURE: {
    code: "ERR_AUDIT_FAILURE",
    description: "审计写入失败",
    testFile: "src/gateway/workspace-resolver/audit.test.ts",
    testCase: "should deny authorization when audit fails (fail-closed)",
    auditEvent: "audit_failure",
    rpcStatus: 503, // Service Unavailable
    userMessage: "审计服务暂时不可用，授权被拒绝",
  },

  ERR_AUDIT_STORE_UNAVAILABLE: {
    code: "ERR_AUDIT_STORE_UNAVAILABLE",
    description: "审计存储不可用",
    testFile: "src/gateway/workspace-resolver/audit.test.ts",
    testCase: "should fail when audit store is unavailable",
    auditEvent: "audit_failure",
    rpcStatus: 503, // Service Unavailable
    userMessage: "审计服务暂时不可用",
  },

  ERR_AUDIT_SIGNATURE_INVALID: {
    code: "ERR_AUDIT_SIGNATURE_INVALID",
    description: "审计日志签名无效",
    testFile: "src/gateway/workspace-resolver/audit.test.ts",
    testCase: "should reject tampered audit log",
    auditEvent: "audit_signature_invalid",
    rpcStatus: 500, // Internal Server Error
    userMessage: "审计日志校验失败",
  },
};

/**
 * 错误码总数: 24 个
 *
 * 分类:
 * - 核心错误码: 11 个
 * - R1 (Anonymous Local): 5 个
 * - R2 (Authorization Matrix): 5 个
 * - R5 (Audit Failure): 3 个
 */
export const S01_ERROR_CODE_COUNT = Object.keys(S01_ERROR_CODE_MAPPING).length;
```

### 2.3 状态标记统一

```typescript
/**
 * S01 设计文档状态标记规范
 *
 * 明确区分：设计意图、待验证条件、已有代码证据、实现后退出标准
 */
export type DesignDocumentStatus =
  | "📋 设计意图" // 设计完成，但未实现
  | "⏳ 待验证条件" // 需要代码验证的条件
  | "✅ 已有代码证据" // 已有代码验证通过
  | "🎯 实现后退出标准"; // 实现完成后的验收标准

/**
 * 状态标记使用指南
 */
export const STATUS_MARKER_GUIDE = {
  "📋 设计意图": {
    description: "设计决策或架构约束，已完成设计文档，但未实现代码",
    example: "📋 resolveAuthorizedToolCwd 接口设计",
    when: "用于设计文档中的架构决策、接口定义、数据模型",
  },

  "⏳ 待验证条件": {
    description: "需要代码实现后才能验证的条件或约束",
    example: "⏳ P99 延迟 < 50ms（需要实测）",
    when: "用于性能目标、安全约束、测试场景",
  },

  "✅ 已有代码证据": {
    description: "已有代码实现，并通过测试或验证",
    example: "✅ Tenant 隔离测试通过（commit abc123）",
    when: "用于已实现的功能、已通过的测试、已验证的约束",
  },

  "🎯 实现后退出标准": {
    description: "实现阶段完成后的最终验收标准",
    example: "🎯 所有 24 个错误码测试通过",
    when: "用于 Gate checklist、验收标准、交付物清单",
  },
};

/**
 * 错误示例（不应使用）
 */
export const INVALID_STATUS_MARKERS = [
  {
    wrong: "✅ resolveAuthorizedToolCwd 接口设计",
    right: "📋 resolveAuthorizedToolCwd 接口设计",
    reason: "设计完成不等于代码实现，应使用 📋",
  },
  {
    wrong: "📋 P99 延迟 < 50ms",
    right: "⏳ P99 延迟 < 50ms（需要实测）",
    reason: "性能目标需要实测验证，应使用 ⏳",
  },
  {
    wrong: "⏳ Tenant 隔离测试",
    right: "✅ Tenant 隔离测试通过（commit abc123）",
    reason: "测试已通过，应使用 ✅ 并标注 commit",
  },
];
```

### 2.4 修订后的评审说明示例

```markdown
# S01 设计评审说明

## 设计交付物清单

### 核心设计文档（7 个）

1. 📋 主 Handoff 文档（已落地 PR #807）
2. 📋 D1: Trusted Principal 契约
3. 📋 D2: 租户绑定与隔离
4. 📋 D3: Workspace Catalog 架构
5. 📋 D4: Handle Gate 接口设计
6. 📋 D5: 测试计划
7. 📋 设计完成总结

### 修订文档（8 个）

8. ✅ R1: Anonymous Local 安全封闭
9. ✅ R2: 授权矩阵
10. ✅ R3: Trusted Proxy 威胁模型
11. ✅ R4: 性能基准
12. ✅ R5: 审计失败语义
13. ✅ R6: 唯一 SoT 验收脚本
14. ✅ R7+R8: 文档一致性
15. ✅ 修订计划

## 验收标准（Gate Checklist）

### 架构约束（已设计，待实现验证）

- ⏳ Workspace Catalog 是唯一 SoT
- ⏳ Trusted Principal 必需（except allowAnonymousLocal）
- ⏳ Tenant 隔离严格执行
- ⏳ Handle Gate 失败时 fallback 到本地路径

### 错误码（24 个，待实现验证）

- ⏳ 核心错误码: 11 个
- ⏳ R1 错误码: 5 个
- ⏳ R2 错误码: 5 个
- ⏳ R5 错误码: 3 个

### 性能目标（待实测）

- ⏳ 小规模 (10 workspaces): P99 < 20ms
- ⏳ 中规模 (100 workspaces): P99 < 50ms
- ⏳ 大规模 (1000 workspaces): P99 < 100ms

### 安全约束（待实现验证）

- ⏳ Anonymous Local 仅 personal_local + loopback
- ⏳ Platform 域只读（写入需 break-glass）
- ⏳ 审计失败阻断授权（Fail-Closed）

## 实现后退出标准（🎯 最终验收）

🎯 **代码实现完成**:

- 所有接口实现
- 所有错误码实现
- 所有测试通过

🎯 **性能验收通过**:

- 基准测试达到 SLA
- 性能报告生成
- CI 集成

🎯 **安全验收通过**:

- 所有安全测试通过
- 渗透测试通过
- 审计日志完整

🎯 **文档更新**:

- API 文档同步
- 用户文档更新
- 错误码文档更新

---

**当前状态**: 📋 设计完成，⏳ 待实现验证
```

---

## 3. 修订总结

### 修订前（存在问题）

**问题 7**:

- ❌ "5 个交付物" vs "7 个文件"
- ❌ "设计文档 6 个" vs 实际不一致
- ❌ 11 个错误码无映射

**问题 8**:

- ❌ 多处使用 ✅ 但 Gate checklist 未勾选
- ❌ 设计意图/待验证条件/代码证据混淆

### 修订后（问题解决）

**问题 7**:

- ✅ 统一文档清单：16 个文档（7 核心 + 8 修订 + 1 评审）
- ✅ 错误码映射表：24 个错误码完整映射
- ✅ 清晰的文档分类

**问题 8**:

- ✅ 4 种明确的状态标记
- ✅ 状态标记使用指南
- ✅ 错误示例说明
- ✅ 修订后的评审说明模板

### 一致性保证

- ✅ 文档数量统一
- ✅ 错误码映射完整
- ✅ 状态标记清晰
- ✅ 设计意图与验收标准区分

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
