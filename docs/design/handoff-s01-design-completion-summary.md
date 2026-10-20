> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# Handoff S01 设计完成总结

> **日期**: 2026-08-29  
> **状态**: 所有 5 个设计交付物已完成  
> **下一步**: 设计评审 (by kiro-sot-reviewer / codex-architecture)

---

## 执行摘要（Executive Summary）

根据 Handoff S01 (Trusted Principal & Workspace Handle Gate Design) 的要求，已完成全部 5 个设计交付物的详细设计工作:

1. **D1**: Trusted Principal 契约 ✅
2. **D2**: Workspace Handle 模型规范 ✅
3. **D3**: Catalog 扩展设计 ✅
4. **D4**: `resolveAuthorizedToolCwd` 接口契约 ✅
5. **D5**: 防回归测试计划 ✅

所有设计文档均遵循以下核心约束:

- ✅ Data Governance Catalog (`WorkspaceResourceCatalog`) 为**唯一 SoT**
- ✅ **不新建**独立的 `workspace_handles` / `authorized_cwds` / `tenant_memberships` 表
- ✅ Handle/CWD/Membership 作为 Catalog 的**受约束扩展或读取视图**
- ✅ 测试环境**不直接操作 Aliyun RDS**，使用经数据治理批准的测试适配器

---

## 设计交付物清单（Deliverable Checklist）

### ✅ D1: Trusted Principal 契约

**文件**: `docs/design/handoff-s01-d1-trusted-principal-contract.md` (20KB)

**完成内容**:

- [x] TypeScript 类型定义 (`TrustedPrincipal`)
- [x] Zod Schema 校验
- [x] 来源链路设计 (Platform Auth Session + Trusted Proxy Header)
- [x] Fail-Closed 语义定义
- [x] 错误码体系 (10 个错误场景)
- [x] 审计日志要求
- [x] 集成点说明 (与 `scope-attribution.ts` 集成)
- [x] 单元测试计划
- [x] 集成测试计划
- [x] 性能要求 (P99 < 10ms)
- [x] 向后兼容策略

**核心设计决策**:

- Principal 作为会话级内存对象，不持久化
- 复用既有 `resolveTrustedAttribution` 查询 tenantId
- 支持 Platform Auth Session (优先级 1) + Trusted Proxy Header (优先级 2)
- Fail-Closed: 解析失败返回 `null`，调用方决定是否允许匿名降级

---

### ✅ D2: Workspace Handle 模型规范

**文件**: `docs/design/handoff-s01-d2-workspace-handle-model.md` (27KB)

**完成内容**:

- [x] 核心类型定义 (`WorkspaceHandle`, `WorkspaceOwner`, `WorkspaceCapability`)
- [x] 与 Data Governance Catalog 的映射关系
- [x] 租户绑定规则 (Group/Steward/User-Owned/Local)
- [x] 租户隔离校验 (`validateTenantIsolation`)
- [x] 能力边界检查 (`checkWorkspaceCapability`)
- [x] 生命周期状态检查 (`checkWorkspaceLifecycleState`)
- [x] 查询接口 (`queryAuthorizedWorkspaceHandles`)
- [x] 创建接口 (通过 Catalog API)
- [x] 错误码与用户提示
- [x] 单元测试计划
- [x] 集成测试计划
- [x] 性能要求 (Handle 构造 P99 < 1ms)

**核心设计决策**:

- Workspace Handle 是 `WorkspaceResourceRecord` (resourceType="workspace") 的**类型化视图**
- 不新建独立存储，所有字段从 Catalog 映射
- 能力边界从 `Binding.role` 推导 (canonical→全权限, replica→只读, ...)
- 租户隔离规则: Platform 域全访问, Enterprise 域本租户, Employee 域本人+本租户

---

### ✅ D3: Catalog 扩展设计

**文件**: `docs/design/handoff-s01-d3-catalog-extension.md` (23KB)

**完成内容**:

- [x] 既有 Catalog 架构复用说明
- [x] 扩展策略 (类型化视图 + 动态查询)
- [x] 授权 CWD 查询实现 (`queryAuthorizedCwdsFromCatalog`)
- [x] CWD 解析集成 (与 `resolveAuthorizedToolCwd`)
- [x] Tenant Membership 复用 (Platform Auth)
- [x] 测试环境约束 (禁止事项 + 允许操作)
- [x] 性能分析 (查询复杂度 O(N))
- [x] 优化策略 (Snapshot 缓存 + 早期终止 + 索引)
- [x] 单元测试计划
- [x] 集成测试计划
- [x] 性能要求 (查询 P99 < 50ms)

**核心设计决策**:

- **不新建** `authorized_cwds.json` 索引文件
- 从 `catalog.snapshot().bindings` 动态遍历匹配
- 复用 `PlatformAuthStore.getMembership` 查询租户成员关系
- 测试环境使用 `InMemoryWorkspaceResourceCatalog`，不连接云端 RDS

---

### ✅ D4: resolveAuthorizedToolCwd 接口契约

**文件**: `docs/design/handoff-s01-d4-resolve-authorized-tool-cwd-interface.md` (26KB)

**完成内容**:

- [x] TypeScript 接口定义 (参数 + 返回类型)
- [x] Zod Schema 定义 (参数 + 结果校验)
- [x] 错误码体系 (11 个错误场景)
- [x] 错误码语义表 (触发条件 + 用户提示 + 可重试性)
- [x] 核心实现逻辑 (10 步流程)
- [x] 审计日志规范 (`ToolCwdAuditLog`)
- [x] 集成示例 (fs_write / execute_bash)
- [x] 单元测试计划 (成功 + 失败场景)
- [x] 性能要求 (CWD 解析 P99 < 50ms)
- [x] Fail-Closed 语义一致性

**核心设计决策**:

- Fail-Closed: `principal=null` 且 `!allowAnonymousLocal` → 拒绝
- 最长前缀匹配 (选择最精确的 workspace)
- 能力边界 + 生命周期状态 + 路径越界 三重检查
- 所有授权决策都记录审计日志 (成功 + 失败)
- 向后兼容: `allowAnonymousLocal` 降级路径

---

### ✅ D5: 防回归测试计划

**文件**: `docs/design/handoff-s01-d5-regression-prevention-test-plan.md` (36KB)

**完成内容**:

- [x] 测试覆盖矩阵 (核心组件 + 错误场景)
- [x] 单元测试 (Trusted Principal / Workspace Handle / 授权 CWD / resolveAuthorizedToolCwd)
- [x] 集成测试 (端到端授权流程 + Tool 执行集成)
- [x] 失败场景测试 (11 个错误码场景)
- [x] 性能测试 (CWD 解析 P99 / Catalog 查询性能 / 并发请求)
- [x] 安全测试 (伪造攻击 / 租户隔离 / 路径遍历)
- [x] 向后兼容测试 (既有功能不回归)
- [x] 测试辅助工具 (测试数据构造器)
- [x] 测试覆盖率目标 (> 90% 行覆盖)
- [x] CI/CD 集成 (GitHub Actions 流水线)

**核心设计决策**:

- 测试覆盖率目标: **> 90% 行覆盖**, **> 85% 分支覆盖**, **100% 函数覆盖**
- 性能测试验证 P99 < 50ms (1000 次查询 + 并发 100 请求)
- 安全测试覆盖伪造签名 / 跨租户访问 / 路径遍历攻击
- 向后兼容测试确保既有 `workspace-resolver` 不回归

---

## Implementation Gate Preconditions 验证状态

根据 Handoff S01 要求，所有 8 个实现门禁前置条件的设计已完成:

| Gate                                                | 状态        | 设计文档                          |
| --------------------------------------------------- | ----------- | --------------------------------- |
| 1. Trusted Principal 来源链路可追溯且不可伪造       | ✅ 设计完成 | D1 §3, D5 §7.1                    |
| 2. Workspace Handle 租户边界明确且不可越权          | ✅ 设计完成 | D2 §3, D5 §7.2                    |
| 3. Catalog 扩展不违反 Data Governance 唯一 SoT 原则 | ✅ 设计完成 | D3 §2.1, §5.1                     |
| 4. `resolveAuthorizedToolCwd` 错误码完备且可测      | ✅ 设计完成 | D4 §3, D5 §3.4                    |
| 5. 所有核心路径有单元测试覆盖计划                   | ✅ 设计完成 | D5 §3, §10                        |
| 6. 失败场景有明确拒绝语义                           | ✅ 设计完成 | D4 §3.2, D5 §5                    |
| 7. 性能 SLA 定义                                    | ✅ 设计完成 | D1 §8, D2 §8, D3 §6, D4 §9, D5 §6 |
| 8. 向后兼容路径                                     | ✅ 设计完成 | D1 §9, D4 §7, D5 §8               |

**结论**: 所有 8 个 Gate Preconditions 已在设计层面满足，具体实现验证需在 P0/P1 实施后进行。

---

## 关键技术决策总结（Key Technical Decisions）

### 1. 唯一 SoT 架构

**决策**: 以 `WorkspaceResourceCatalog` (Data Governance v2) 为**唯一持久化数据源**

**实现方式**:

- Workspace Handle = `WorkspaceResourceRecord` 的类型化视图
- 授权 CWD = 从 `WorkspaceBindingRecord.locator` 动态查询
- Tenant Membership = 复用 `PlatformAuthStore.getMembership`

**优势**:

- ✅ 避免数据重复存储
- ✅ 遵循 Data Governance 规范
- ✅ 简化数据一致性维护
- ✅ 降低测试复杂度 (内存 Catalog)

### 2. Fail-Closed 安全模型

**决策**: 所有授权决策失败时**默认拒绝访问**

**实现方式**:

- `resolveTrustedPrincipal` 失败 → 返回 `null`
- `resolveAuthorizedToolCwd` principal=null → `ERR_PRINCIPAL_REQUIRED`
- 租户隔离冲突 → `ERR_TENANT_MISMATCH`
- 能力不足 → `ERR_CAPABILITY_DENIED`
- Catalog 不可用 → `ERR_CATALOG_UNAVAILABLE`

**例外**: `allowAnonymousLocal=true` 降级路径（向后兼容 local operator mode）

### 3. 能力边界从 Binding Role 推导

**决策**: 不新增 `capabilities` 字段，从 `Binding.role` 动态推导

**映射规则**:

- `canonical` → `["read", "write", "execute", "list"]` (全权限)
- `replica` → `["read", "list"]` (只读)
- `archive` → `["read"]` (只读，不列举)
- `cache` → `["read", "list"]` (缓存)

**优势**:

- ✅ 复用既有 Catalog 字段
- ✅ 减少字段冗余
- ✅ 能力边界与 Binding 角色语义一致

### 4. 动态查询 vs 持久化索引

**决策**: 授权 CWD 从 Catalog Snapshot **动态查询**，不新建持久化索引

**实现方式**:

- 遍历 `catalog.snapshot().bindings`
- 按 `locator` 前缀匹配
- 应用租户隔离 / Owner 检查 / 生命周期过滤
- 复杂度: O(N) (N = Bindings 数量)

**优化策略**:

- Snapshot 缓存 (请求级)
- 早期终止 (租户隔离检查)
- 内存索引 (P2, 可选)

**优势**:

- ✅ 不新建持久化存储
- ✅ 数据始终最新 (无缓存一致性问题)
- ✅ 测试简单 (内存 Catalog)

**劣势**:

- ⚠️ 性能随 Catalog 规模增长 (O(N))
- ⚠️ 需优化策略以满足 P99 < 50ms

### 5. 审计日志全覆盖

**决策**: 所有授权决策（成功 + 失败）都记录审计日志

**日志内容**:

- Principal 信息 (userId, tenantId, source)
- Workspace 信息 (handleId, rootPath)
- 请求信息 (requestedCwd, operation, toolName)
- 授权结果 (accessMode / denyReason)

**优势**:

- ✅ 可追溯性（追责）
- ✅ 安全审计（检测攻击）
- ✅ 故障排查（快速定位）

---

## 性能指标总结（Performance Metrics Summary）

| 组件                              | 指标     | 目标    | 设计依据                                      |
| --------------------------------- | -------- | ------- | --------------------------------------------- |
| `resolveTrustedPrincipal`         | P99 延迟 | < 10ms  | 复用既有 HMAC 校验 + Membership 查询          |
| `buildWorkspaceHandleFromCatalog` | P99 延迟 | < 1ms   | 纯内存映射，无 I/O                            |
| `queryAuthorizedCwdsFromCatalog`  | P99 延迟 | < 20ms  | Snapshot 查询 (内存) + 早期终止               |
| `resolveAuthorizedToolCwd`        | P99 延迟 | < 50ms  | 包含 Principal 解析 + Catalog 查询 + 审计日志 |
| 并发请求 (100 个)                 | 平均延迟 | < 100ms | 无锁竞争 (只读 Snapshot)                      |

**性能验证**: 通过 D5 性能测试计划验证 (1000 次查询 + 并发 100 请求)

---

## 安全性分析（Security Analysis）

### 威胁模型

| 威胁                          | 防御机制                               | 验证方式         |
| ----------------------------- | -------------------------------------- | ---------------- |
| **伪造 Session Cookie**       | HMAC 签名校验 (既有)                   | D5 §7.1 安全测试 |
| **伪造 Trusted Proxy Header** | IP 白名单 + 完整性检查                 | D5 §7.1 安全测试 |
| **跨租户访问**                | `validateTenantIsolation` 强制检查     | D5 §7.2 安全测试 |
| **路径遍历攻击**              | `normalizePath` + `isPathUnder` 检查   | D5 §7.3 安全测试 |
| **权限提升**                  | Fail-Closed + 能力边界检查             | D5 §7.2 安全测试 |
| **数据泄露**                  | 审计日志全覆盖 (Principal + Workspace) | D4 §6 审计规范   |

### 安全保证

- ✅ **不信任客户端输入**: 所有身份字段由服务端解析
- ✅ **Fail-Closed 语义**: 任何失败都拒绝访问
- ✅ **租户隔离强制**: Platform 域可全访问, Enterprise/Employee 域严格隔离
- ✅ **审计可追溯**: 所有授权决策都记录审计日志

---

## 向后兼容性分析（Backward Compatibility Analysis）

### 兼容策略

| 场景                                 | 兼容机制                            | 说明                                   |
| ------------------------------------ | ----------------------------------- | -------------------------------------- |
| **既有 `workspace-resolver` 调用**   | 保留既有 API 不变                   | `resolveWorkspaceResource` 继续工作    |
| **Local operator mode**              | `allowAnonymousLocal=true` 降级路径 | Principal=null 时允许本地访问          |
| **Group/Steward/Local 工作区**       | 从 Catalog 统一解析                 | 所有类型的工作区都通过 Handle 视图访问 |
| **既有 `resolveTrustedAttribution`** | `resolveTrustedPrincipal` 作为增量  | 两者并存，逐步迁移                     |

### 迁移路径

**Phase 1: 新增 TrustedPrincipal，不破坏既有调用** (P0)

```typescript
// 既有代码（保持不变）
const attribution = await resolveTrustedAttribution(client);

// 新代码（增量）
const principal = await resolveTrustedPrincipal(client);
```

**Phase 2: 逐步迁移 Tool CWD 解析到 Principal** (P1)

```typescript
// 迁移前
const actor = { tenantId: ..., userId: ... };

// 迁移后
const principal = await resolveTrustedPrincipal(client);
const actor = principal
  ? { tenantId: principal.tenantId ?? "none", userId: principal.userId }
  : null;
```

**Phase 3: 全面使用 Workspace Handle 视图** (P2)

- 所有 Tool 执行都通过 `resolveAuthorizedToolCwd`
- 弃用直接路径访问

---

## 测试覆盖率总结（Test Coverage Summary）

| 组件                             | 行覆盖目标 | 分支覆盖目标 | 函数覆盖目标 |
| -------------------------------- | ---------- | ------------ | ------------ |
| `resolveTrustedPrincipal`        | > 90%      | > 85%        | 100%         |
| `WorkspaceHandle` (builders)     | > 90%      | > 85%        | 100%         |
| `queryAuthorizedCwdsFromCatalog` | > 90%      | > 85%        | 100%         |
| `resolveAuthorizedToolCwd`       | > 95%      | > 90%        | 100%         |
| `validateTenantIsolation`        | 100%       | 100%         | 100%         |
| `checkWorkspaceCapability`       | 100%       | 100%         | 100%         |
| **Overall**                      | **> 90%**  | **> 85%**    | **100%**     |

**测试类型覆盖**:

- ✅ 单元测试: 所有核心组件
- ✅ 集成测试: 端到端授权流程
- ✅ 失败场景测试: 11 个错误码场景
- ✅ 性能测试: P99 < 50ms 验证
- ✅ 安全测试: 伪造/隔离/路径遍历
- ✅ 向后兼容测试: 既有功能不回归

---

## 下一步行动（Next Steps）

### 1. 设计评审 (P0, 必需)

**评审者**: kiro-sot-reviewer / codex-architecture

**评审内容**:

- [ ] D1: Trusted Principal 契约明确，来源链路可追溯
- [ ] D2: Workspace Handle 模型完整，作为 Catalog Resource 视图
- [ ] D3: Catalog 扩展设计符合唯一 SoT 原则，不新建独立表
- [ ] D4: `resolveAuthorizedToolCwd` 接口契约完备，错误码语义明确
- [ ] D5: 测试计划覆盖单元/集成/失败场景/性能 SLA
- [ ] 安全性: Fail-Closed 语义正确，不可伪造性证明充分
- [ ] 性能: P99 < 50ms SLA 合理且可达成
- [ ] 兼容性: 向后兼容路径明确，不破坏既有功能
- [ ] 可测性: 所有核心路径有对应测试计划
- [ ] 可维护性: 复用 Catalog 机制，审计链路完整
- [ ] 测试环境约束: 不直接操作 Aliyun RDS，经数据治理 owner 批准测试环境

**评审通过标准**: 所有 5 个交付物完成，8 个 Gate Preconditions 全部满足。

### 2. 实现阶段建议 (评审通过后启动)

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

### 3. 文档整理

- [ ] 将 D1-D5 设计文档链接添加到主 Handoff 文档
- [ ] 更新主 Handoff 文档状态为 `design-complete-pending-review`
- [ ] 准备设计评审会议材料

---

## 附录：设计文档清单

| 交付物                       | 文件路径                                                              | 大小   | 状态                |
| ---------------------------- | --------------------------------------------------------------------- | ------ | ------------------- |
| 主 Handoff                   | `docs/design/handoff-s01-trusted-principal-handle-gate.md`            | 29KB   | ✅ 已落地 (PR #807) |
| D1: Trusted Principal 契约   | `docs/design/handoff-s01-d1-trusted-principal-contract.md`            | 20KB   | ✅ 设计完成         |
| D2: Workspace Handle 模型    | `docs/design/handoff-s01-d2-workspace-handle-model.md`                | 27KB   | ✅ 设计完成         |
| D3: Catalog 扩展             | `docs/design/handoff-s01-d3-catalog-extension.md`                     | 23KB   | ✅ 设计完成         |
| D4: resolveAuthorizedToolCwd | `docs/design/handoff-s01-d4-resolve-authorized-tool-cwd-interface.md` | 26KB   | ✅ 设计完成         |
| D5: 测试计划                 | `docs/design/handoff-s01-d5-regression-prevention-test-plan.md`       | 36KB   | ✅ 设计完成         |
| 完成总结                     | `docs/design/handoff-s01-design-completion-summary.md`                | 本文件 | ✅ 已创建           |

**总计**: 6 个文档, ~161KB, 所有设计工作已完成

---

## 结论（Conclusion）

Handoff S01 的全部 5 个设计交付物已完成详细设计，包括:

- ✅ 完整的类型定义与接口契约
- ✅ 详尽的错误码体系与用户提示
- ✅ 清晰的集成点与实现路径
- ✅ 完备的测试计划 (单元/集成/性能/安全)
- ✅ 明确的性能目标与安全保证
- ✅ 向后兼容策略

**所有设计均符合核心约束**:

1. Data Governance Catalog 为唯一 SoT
2. 不新建独立表或索引文件
3. 测试环境不操作云端 RDS
4. Fail-Closed 安全模型
5. 租户隔离严格执行

**下一步**: 提交设计评审 (kiro-sot-reviewer / codex-architecture)

---

**文档状态**: 设计完成总结  
**日期**: 2026-08-29  
**作者**: kiro-daibai
