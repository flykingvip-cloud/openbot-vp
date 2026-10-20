# 企业数据治理与供给中心 M1 执行治理基线 — 待验收报告（2026-06-05）

> **首轮验收结论：未通过**（信任边界缺陷）。修复后复验见 `docs/design/edgsc-m1-revalidation-report-2026-06-05.md`。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §11 M1  
> 前置：`docs/design/edgsc-m1-m2-realignment-report-2026-06-05.md`（治理视图 scaffolding 已落地）

## 〇、阶段定位

**M1 = Execution Governance 基线补齐**。本阶段完成唯一执行平面 `Enterprise Data Gateway` 及其前置治理链，**不**启动 M4 供给实质（Materializer / FeedItem / Universe 对接）。

| 类别     | M1 交付                                                                                   | 明确未做（禁止抢跑）                                                                            |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 执行治理 | Action@version、Registry、Grant、Scope、Classification、Masking、Approval、Audit、Gateway | —                                                                                               |
| 治理视图 | 沿用 M1/M2 scaffolding（DataSource / Capability / Policy / ProjectionSpec）               | 无新增运行时权限链                                                                              |
| 供给消费 | —                                                                                         | ProjectionMaterializer、Feed 写入、Visibility 运行时、Feed Adapter、Universe/Agent 直连 Gateway |

## 一、硬约束自检

| #   | 约束                                           | 状态 | 证据                                                    |
| --- | ---------------------------------------------- | ---- | ------------------------------------------------------- |
| 1   | `ConnectorAction@version` 为唯一执行落点       | ✅   | `data-gateway.ts` 全链路绑定 `actionKey + version`      |
| 2   | 运行时授权链 `Seat → Grant → Action → Gateway` | ✅   | `invokeEnterpriseDataAction` 校验 `findSeatActionGrant` |
| 3   | `DataAccessPolicy` 仅编译为 `SeatActionGrant`  | ✅   | 既有 `compileDataAccessPolicy()` + 种子策略             |
| 4   | TEAM Scope 缺 `teamLabel` fail-closed          | ✅   | `scope-policy-store.ts` + 单测                          |
| 5   | 未知字段 fail-closed（strictMode）             | ✅   | `masking-engine.ts` + v2 未知字段单测                   |
| 6   | `approvalContextId` 与 `traceId` 分离          | ✅   | `approval-workflow.ts` / `audit-runtime.ts`             |
| 7   | HIGH/CRITICAL 审计 fail-closed                 | ✅   | `resolveAuditWritePolicy` + 单测 `AUDIT_WRITE_FAILED`   |
| 8   | Agent/Universe 不得直连 Gateway                | ✅   | 本阶段仅注册 `enterprise-data.invoke`；无消费层对接     |
| 9   | 治理类 RPC 须 `enterprise-admin`               | ✅   | `requireResolvedEnterpriseAdminTenantId()` 统一收口     |

## 二、交付物清单

### 2.1 数据模型（Store v3）

持久化文件：`~/.openbot/openbot-enterprise-data.json`（`ENTERPRISE_DATA_STORE_VERSION = 3`）

| 对象                                                                    | 模块                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `ScopePolicy`                                                           | `scope-policy-store.ts`                              |
| `FieldClassification` / `MaskingPolicy` / `ClassificationRuntimeConfig` | `field-classification-store.ts`, `masking-engine.ts` |
| `ApprovalPolicy` / `ApprovalRequest`                                    | `approval-policy-store.ts`, `approval-workflow.ts`   |
| `InvocationAuditEvent` / `DataAuditEvent`                               | `audit-runtime.ts`                                   |
| Gateway 管线                                                            | `data-gateway.ts`, `mock-handlers.ts`                |

### 2.2 种子数据（`seeds.ts`）

| 种子 ID                                                                       | 用途                 |
| ----------------------------------------------------------------------------- | -------------------- |
| `scope-self-default` / `scope-team-default` / `scope-all-readonly`            | 默认 Scope 模板      |
| `mask-partial-phone` / `mask-partial-email`                                   | 脱敏策略             |
| `crm.customer.read_summary@v1/v2` 字段分类                                    | 版本隔离分类表       |
| `policy-none-default` / `policy-export-per-request` / `policy-batch-once-24h` | 审批策略             |
| `seat-sales-mgr-east` → read_summary@v1（SELF + NONE）                        | 低风险管理面编译样例 |
| `seat-sales-director` → export@v1（TEAM + PER_REQUEST）                       | 高风险审批样例       |

### 2.3 Gateway RPC（M1 新增）

| 方法                                     | 说明                 |
| ---------------------------------------- | -------------------- |
| `enterprise-data.invoke`                 | **唯一执行入口**     |
| `enterprise-data.scope.*`                | Scope CRUD + preview |
| `enterprise-data.classification.*`       | 字段分类 + 脱敏预览  |
| `enterprise-data.masking.*`              | 脱敏策略             |
| `enterprise-data.approval.policies.*`    | 审批策略             |
| `enterprise-data.approval.requests.*`    | 审批申请/决定/列表   |
| `enterprise-data.audit.invocations.list` | 调用审计查询         |
| `enterprise-data.audit.trace.get`        | traceId 双层审计回溯 |

注册位置：`server-methods/enterprise-data-m1.ts` → `server-methods-list.ts` / `method-scopes.ts`

### 2.4 执行管线（`invokeEnterpriseDataAction`）

```text
解析 Seat 上下文
  → 校验 ConnectorAction@version + lifecycle
  → 校验 SeatActionGrant
  → 校验 RuntimeRegistry handler
  → evaluateScopePolicy（fail-closed）
  → checkApproval（NONE / ONCE / PER_REQUEST）
  → executeMockHandler（Scope 约束查询）
  → applyClassificationMasking（未知字段 fail-closed）
  → 双层审计写入（HIGH/CRITICAL fail-closed）
  → PER_REQUEST consume
  → DataGatewayResponse
```

## 三、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
```

| 套件                                           | 结果          | 覆盖要点                                                                                 |
| ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `connector-action-store.test.ts`               | **10 passed** | Action 版本、Policy 编译、ProjectionSpec 显式 sourceActions                              |
| `data-gateway.test.ts`                         | **9 passed**  | attestation、TEAM fail-closed、脱敏、v2 未知字段、PER_REQUEST、HIGH 审计原子性、契约字段 |
| `enterprise-data-seat-context.test.ts`         | **4 passed**  | 禁止客户端身份字段、trust attestation                                                    |
| `enterprise-data-seat-context.session.test.ts` | **2 passed**  | session → binding → seat 解析                                                            |
| `enterprise-data-tenant-scope.test.ts`         | **3 passed**  | 跨租户 tenantId 拒绝                                                                     |
| `enterprise-data-admin-scope.test.ts`          | **5 passed**  | 治理 admin 门槛、member 读写拒绝                                                         |
| `audit-runtime.test.ts`                        | **3 passed**  | 成员按 employeeId 隔离、admin 按 seatId 查询                                             |

**合计：36 passed**

### 关键场景验收矩阵

| 场景                                  | 预期                                 | 实测 |
| ------------------------------------- | ------------------------------------ | ---- |
| SELF + 销售经理 read_summary@v1       | 本人客户 + 手机/邮箱脱敏             | ✅   |
| TEAM + 空 teamLabel                   | `SCOPE_CONTEXT_MISSING`              | ✅   |
| v2 未登记字段                         | fail-closed redact                   | ✅   |
| export 无审批                         | `APPROVAL_REQUIRED` + ctx            | ✅   |
| PER_REQUEST 批准后 invoke             | SUCCESS + consumed                   | ✅   |
| 同 ctx 二次 invoke                    | `APPROVAL_REQUIRED`                  | ✅   |
| HIGH + 审计写入失败                   | `AUDIT_WRITE_FAILED`                 | ✅   |
| 岗位交接后 member 查 invocation audit | 仅见本人 `employeeId` 记录，不见前任 | ✅   |
| admin 按 seatId 查 invocation audit   | 可见该 seat 全部持有人记录           | ✅   |

## 四、设计文档对齐

| 设计文档                         | 对齐状态                                 |
| -------------------------------- | ---------------------------------------- |
| `connector-action-versioning.md` | ✅（P1 已落地，M1 接入 Gateway）         |
| `scope-policy-model.md`          | ✅ 求值器 + 白名单 + fail-closed         |
| `data-classification-model.md`   | ✅ 版本级分类 + 未知字段策略             |
| `approval-workflow-model.md`     | ✅ 三模式 + 快照 + ctx/trace 分离        |
| `audit-runtime-schema.md`        | ✅ 双层审计 + objectRefs 哈希 + 风险分级 |

## 五、已知限制（M1 口径内可接受）

1. **Handler 为 mock**：`mock-handlers.ts` 模拟 CRM/ERP 响应；真实 Connector 适配器属 M2+ 集成。
2. **invoke 上下文**：已由 Gateway 服务端 trusted session 解析（`resolveTrustedEnterpriseDataExecutionContext`）；客户端 `seatId/employeeId/teamLabel` 等身份字段注入会被拒绝。
3. **审批角色**：仅 `enterprise-admin`；`department-head` 列入 P5+。
4. **DEPARTMENT Scope**：模型支持，默认种子未启用（实验性）。
5. **ONCE 模式**：逻辑已实现，UAT 样例以 PER_REQUEST export 为主；`policy-batch-once-24h` 已种子待联调。
6. **Store 迁移**：v2 → v3 新字段默认空对象；首次 seed 写入全量种子。

## 六、专家复验清单

- [ ] 确认 `enterprise-data.invoke` 为唯一执行入口，上层对象无旁路
- [ ] 抽检 TEAM Scope 无 teamLabel 时返回 `SCOPE_CONTEXT_MISSING`（非降级 SELF）
- [ ] 抽检 v1/v2 分类隔离：v2 新字段未登记走 fail-closed
- [ ] 抽检 export PER_REQUEST：批准 → 成功 → 同 ctx 拒绝
- [ ] 抽检 HIGH 动作审计失败返回 `AUDIT_WRITE_FAILED` 且无数据
- [ ] 确认未启动 Materializer / Feed / Universe 对接
- [ ] 批准进入 **M2 管理面深化** 或 **M4 供给编排**（按总计划排期）

## 七、下一阶段建议（待 M1 验收通过后）

按 `docs/design/edgsc-master-implementation-plan-2026-06-05.md`：

| 里程碑 | 内容                                                                     | 前置    |
| ------ | ------------------------------------------------------------------------ | ------- |
| **M2** | DataSource / DataAccessPolicy 管理面深化、Access Governance UI/RPC       | M1 ✅   |
| **M3** | DataCapability 编排与治理反查                                            | M2      |
| **M4** | ProjectionSpec Binding、**ProjectionMaterializer**、FeedItem、Visibility | M1 + M3 |
| **M5** | Lineage、SupplyAudit、Approval Center                                    | M4      |
| **M6** | Feed Adapter、Universe、Agent Runtime 消费                               | M4 + M5 |

---

**状态：M1 代码与测试已完成，提交专家验收。验收通过后方可进入 M2/M4 实质阶段。**
