# 企业数据治理与供给中心 M1 复验报告（第四轮，2026-06-05）

> 响应专家第四轮 Findings：治理接口统一 `enterprise-admin` 门槛 + 文档口径修正。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`  
> 历史：`edgsc-m1-completion-report`（首轮未通过）→ 二/三轮（租户收口、审计语义、契约）→ **本报告为第四轮复验**

## 一、第四轮阻塞项与修复对照

| #   | 专家 Finding                                        | 修复                                                                                                              | 证据                                                                             |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| G5  | 治理 RPC 仅校验租户归属，普通 member 可读写治理配置 | 新增 `requireResolvedEnterpriseAdminTenantId()`；`enterprise-data.ts` 全部治理 handler + M1 治理 handler 统一收口 | `enterprise-data-seat-context.ts`, `enterprise-data.ts`, `enterprise-data-m1.ts` |
| G6  | 首轮报告仍写 invoke 从参数注入上下文                | 修正为服务端 trusted session 解析口径                                                                             | `edgsc-m1-completion-report-2026-06-05.md` §五                                   |

## 一-b、历史轮次阻塞项（已修复，保留记录）

| #   | 专家 Finding                              | 修复                                                                                                    | 证据                                                     |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| G1  | 治理 RPC 仍信任客户端 tenantId            | `enterprise-data.ts` 全部治理 handler 改用 `requireResolvedEnterpriseTenantId()`                        | `enterprise-data-seat-context.ts` + `enterprise-data.ts` |
| G2  | `DataGatewaySuccessResponse` 缺供给链字段 | 补齐 `source/actionKey/version/generatedAt`                                                             | `types.ts`, `data-gateway.ts`                            |
| G3  | HIGH 审计失败仍可能留 SUCCESS             | fail-closed 原子 finalize：先 DataAudit → 再 SUCCESS；失败写 FAILED 并回滚 DataAudit / 删除误写 SUCCESS | `data-gateway.ts`, `audit-runtime.ts`                    |
| G4  | DataAccessPolicy 边界说明不足             | §三 强化「管理面入口 → 编译产物 Grant」表述                                                             | 本文 §三                                                 |

## 二、历史轮次阻塞项（已修复，保留记录）

| #   | 专家 Finding                                                         | 修复                                                                                                                            | 证据                                                                              |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | `invoke` / M1 RPC 信任客户端 tenantId/seatId/employeeId/teamLabel 等 | 新增 `enterprise-data-seat-context.ts`：session → membership → active seat binding → seat 记录解析；客户端身份字段 **拒绝传入** | `assertNoClientExecutionIdentity`, `resolveTrustedEnterpriseDataExecutionContext` |
| 2   | `approval.requests.create` 要求客户端 seatId/employeeId              | 改为仅接受 action + approvalContextId；seat/employee 由服务端解析                                                               | `enterprise-data-m1.ts` create handler                                            |
| 3   | HIGH 审计失败先写 SUCCESS 再 deny                                    | 改为 **先写 DataAudit，再写 Invocation SUCCESS**；fail-closed 失败时 **仅写 FAILED + AUDIT_WRITE_FAILED**                       | `data-gateway.ts` `failAuditClosed`                                               |
| 4   | 报告混淆治理视图层与执行基线                                         | 本报告 §三 明确分层；首轮报告保留历史记录                                                                                       | 本文 §三                                                                          |
| 5   | 缺少伪造上下文负例测试                                               | 新增 seat-context + gateway 负例/隔离测试                                                                                       | §四                                                                               |

## 二、信任边界（冻结，已落地）

### 2.1 执行类 RPC（`invoke`、`approval.requests.create`）

**客户端允许传入：**

- `connectorId`, `actionKey`, `version`
- `input`（业务参数）
- `approvalContextId`（PER_REQUEST 重试）
- `reason`（审批申请说明）

**客户端禁止传入（出现即 `UNTRUSTED_CLIENT_CONTEXT`）：**

- `tenantId`, `seatId`, `employeeId`, `userId`
- `teamLabel`, `roleCode`, `departmentId`

**服务端解析链：**

```text
trusted-proxy session (client.user email)
  → PlatformAuth user + membership → tenantId
  → EnterpriseSeatAssets active binding → seatId + employeeId
  → EnterprisePositionSeat → teamLabel / roleCode
  → experimental departmentId = roleCode:teamLabel
  → trustAttestation = server-session-v1
  → invokeEnterpriseDataAction
```

### 2.2 治理类 RPC（`enterprise-data.ts` + M1 管理接口）

- **全部** `sources.*` / `capabilities.*` / `access-policies.*` / `projection-*` / `actions.*` / `registry.*` / `grants.*` 及 M1 治理 handler（`scope.*` / `classification.*` / `masking.*` / `approval.policies.*` / `audit.trace.get`）经 `requireResolvedEnterpriseAdminTenantId()` 收口：**租户匹配 + enterprise-admin**。
- `tenantId` 由 session 解析；客户端传 `tenantId` 必须与 session 企业一致，否则拒绝（跨租户越权测试见 `enterprise-data-tenant-scope.test.ts`）。
- **员工平面例外**（仅 `requireResolvedEnterpriseTenantId`）：`approval.requests.list`（member 仅看本人）、`audit.invocations.list`（member 按 `employeeId` 过滤，避免岗位交接泄露前任记录；admin 可按 `seatId` 查询）、`approval.requests.create` / `invoke`（seat-bound 执行，无 tenant helper）。

### 2.3 管理类 RPC（M1 扩展）

- `scope.preview`：仅 admin 可用；`seatId` 由管理员指定，**employeeId/teamLabel/roleCode/departmentId 从该 seat 的 active binding + seat 记录解析**，不接受客户端覆盖。
- `approval.requests.decide`：`decidedBy` 来自 session，须 `enterprise-admin`。
- `approval.requests.list`：非 admin 仅能看到本人 `employeeId` 申请。

### 2.4 Gateway 内核

- `invokeEnterpriseDataAction` 强制 `trustAttestation === server-session-v1`，否则 `UNTRUSTED_EXECUTION_CONTEXT`。
- 单元测试通过 `createTrustedExecutionContextForTest()` 模拟服务端 attestation，**不代表 RPC 可绕过**。

### 2.5 生产前置条件

- `enterprise-data.invoke` 要求 **trusted-proxy 平台鉴权已启用** 且用户有 **active seat binding**。
- 无平台 session 时执行入口返回 `NO_SEAT_CONTEXT`（非 fail-open 到客户端参数）。

## 三、治理视图层 vs 执行治理基线（边界澄清）

| 层级                     | 对象                                                                                                                                  | M1 状态                                            | 是否运行时权限            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------- |
| **执行治理基线**         | `ConnectorAction@version`, `SeatActionGrant`, `ScopePolicy`, `FieldClassification`, `ApprovalPolicy`, `Enterprise Data Gateway`, 审计 | ✅ 本阶段交付                                      | **是**（Grant → Gateway） |
| **治理视图 scaffolding** | `DataSource`, `DataCapability`, `DataAccessPolicy`, `EnterpriseKnowledgeProjectionSpec`, `EnterpriseKnowledgeProjectionBinding`       | 仅 store + 只读/编译 RPC；**不进入 invoke 主路径** | **否**                    |

**关键边界（防误用）：**

- `DataAccessPolicy` = **管理面入口**（人类可读的访问策略编辑对象）
- `compileDataAccessPolicy()` = **编译器**（有副作用：产出/撤销 `SeatActionGrant`）
- `SeatActionGrant` = **唯一运行时执行权限对象**（Gateway 只认 Grant，不认 Policy/Capability/DataSource）

`DataCapability` / `DataSource` / `ProjectionBinding` 仅供治理视图与供给编排声明，**不得**替代 Grant 参与 invoke 授权。

**未启动：** ProjectionMaterializer、FeedItem 写入、Knowledge Universe / Agent 直连 Gateway。

## 四、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
```

| 套件                                           | 结果      | 新增/关键覆盖                                         |
| ---------------------------------------------- | --------- | ----------------------------------------------------- |
| `enterprise-data-seat-context.test.ts`         | 4 passed  | 禁止客户端身份字段、trust attestation                 |
| `enterprise-data-seat-context.session.test.ts` | 2 passed  | session → binding → seat 解析                         |
| `enterprise-data-tenant-scope.test.ts`         | 3 passed  | 跨租户 tenantId 拒绝                                  |
| `enterprise-data-admin-scope.test.ts`          | 5 passed  | member 读写治理拒绝、admin 通过、租户匹配角色不足拒绝 |
| `audit-runtime.test.ts`                        | 3 passed  | 成员按 employeeId 隔离、admin 按 seatId 查询          |
| `data-gateway.test.ts`                         | 9 passed  | 契约字段、审计 FAILED 一致性、TEAM/SELF 隔离          |
| `connector-action-store.test.ts`               | 10 passed | 治理视图 scaffolding 回归                             |

**合计：36 passed**

### 负例与一致性矩阵

| 场景                                      | 预期                                | 实测 |
| ----------------------------------------- | ----------------------------------- | ---- |
| 客户端传 seatId/employeeId 到 invoke 参数 | RPC 层拒绝（seat-context 单测）     | ✅   |
| 无 trustAttestation 调 gateway            | `UNTRUSTED_EXECUTION_CONTEXT`       | ✅   |
| HIGH 审计 forceFailure 且已审批           | 仅 `FAILED` 审计，无 `SUCCESS`      | ✅   |
| TEAM scope 华东 vs 华北 teamLabel         | 返回不同团队客户                    | ✅   |
| SELF + 非 owner employeeId                | `customer: null`                    | ✅   |
| TEAM 缺 teamLabel                         | `SCOPE_CONTEXT_MISSING`             | ✅   |
| member + operator scope 访问治理读/写 RPC | `GOVERNANCE_ADMIN_REQUIRED_MESSAGE` | ✅   |
| enterprise-admin 访问治理 RPC             | 租户解析通过                        | ✅   |
| 岗位交接后 member 查 invocation audit     | 仅本人 `employeeId` 记录            | ✅   |
| admin 按 seatId 查 invocation audit       | 该 seat 全部持有人记录              | ✅   |

## 五、代码变更摘要

| 模块                              | 变更                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| `enterprise-data-seat-context.ts` | 信任解析、客户端字段拒绝、`requireResolvedEnterpriseAdminTenantId` |
| `enterprise-data-m1.ts`           | 全部 M1 handler 改用 session 解析                                  |
| `data-gateway.ts`                 | attestation 强制 + 审计两阶段语义                                  |
| `masking-engine.ts`               | 跳过 `null` 容器路径，避免空结果误脱敏                             |
| `seeds.ts`                        | 总监 seat 增加 read_summary TEAM grant（测试用）                   |

## 六、已知限制（复验后仍适用）

1. Handler 仍为 mock，真实 Connector 适配器属后续里程碑。
2. `knowledge.ts` mock 路由与 Feed 边界未在本阶段改动；Universe 仍须待 M6 Feed Adapter。
3. `departmentId` 为实验性 `roleCode:teamLabel` 合成键，非稳定组织模型。
4. 本地无 trusted-proxy 时 **无法** 通过 RPC 调用 `invoke`（设计如此）。

## 七、专家复验清单

- [ ] 确认 `invoke` / `approval.requests.create` 拒绝客户端 seatId/employeeId/teamLabel 等
- [ ] 确认 session → binding → seat 解析链在代码中无客户端 fallback
- [ ] 确认治理类 RPC 统一要求 `enterprise-admin`（member + operator scope 仍拒绝）
- [ ] 抽检 HIGH `AUDIT_WRITE_FAILED` trace：仅 `FAILED`，无 `SUCCESS` 双写
- [ ] 确认报告与实现均将 DataAccessPolicy 等标注为治理视图 scaffolding
- [ ] 确认未启动 Materializer / Feed / Universe 对接

---

**状态：第四轮阻塞项（治理 admin 门槛 + 文档口径）已修复，提交专家复验。**
