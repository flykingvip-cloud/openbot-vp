# Scope Policy Model 设计文档

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 关联方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §8.3、§9.3

## 1. 目标与边界

### 1.1 目标

定义并服务端强制执行的数据访问范围策略（Scope Policy），回答「能看谁的数据」，而非「能访问哪个系统」。

### 1.2 边界

**在范围内：**

- `ScopePolicy` 数据模型与持久化
- Scope 求值器（服务端）
- 与 `SeatActionGrant` 绑定
- `SELF / TEAM / ALL` 三种首版范围类型（服务端强校验）
- `DEPARTMENT` 实验性支持（见 §1.3，首版 UAT 可选启用）
- 受限 `filterClauses`（非任意脚本、非 SQL）

**不在范围内：**

- 任意 SQL / 脚本执行
- 前端-only 范围过滤
- 跨租户范围
- 稳定 `departmentId` 组织模型（首版未就绪）

### 1.3 DEPARTMENT 首版口径

| 项                     | 决策                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| 是否进首版             | **实验性**：默认种子不启用；UAT 可按租户显式开启                 |
| 解析来源               | 暂用 `roleCode` + `teamLabel` 组合映射，**非长期安全边界**       |
| 缺失 department 上下文 | **fail-closed**，返回 `SCOPE_CONTEXT_MISSING`                    |
| 长期方案               | 待组织模型提供稳定 `departmentId` 后升级为正式 Scope 类型（P5+） |

## 2. 数据模型

### 2.1 ScopePolicy

```ts
type ScopeType = "SELF" | "TEAM" | "DEPARTMENT" | "ALL";

type ScopeFilterOperator = "eq" | "in" | "contains";

type ScopeFilterClause = {
  field: string; // 预注册字段，如 customer.owner_id
  operator: ScopeFilterOperator;
  valueRef: string; // 上下文引用，如 current_user.id、current_user.team
};

type ScopePolicy = {
  scopePolicyId: string;
  tenantId: string;
  displayName: string;
  scopeType: ScopeType;
  filterClauses?: ScopeFilterClause[]; // scopeType 非 ALL 时可选
  // 人类可读说明（filterExpression 的结构化等价，禁止任意脚本）
  filterDescription?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};
```

### 2.2 求值上下文（服务端注入，不信任客户端）

```ts
type ScopeEvaluationContext = {
  tenantId: string;
  seatId: string;
  employeeId: string;
  userId: string;
  teamLabel?: string; // 来自 EnterprisePositionSeat.teamLabel
  roleCode?: string; // 来自 EnterprisePositionSeat.roleCode
  departmentId?: string; // 实验性；首版由 roleCode/teamLabel 推导，可能为空
};
```

### 2.2.1 上下文必填规则（fail-closed）

| scopeType    | 必填上下文                  | 缺失时                                         |
| ------------ | --------------------------- | ---------------------------------------------- |
| `SELF`       | `employeeId`                | `SCOPE_CONTEXT_MISSING`                        |
| `TEAM`       | `teamLabel`（非空）         | `SCOPE_CONTEXT_MISSING`（**禁止**降级为 SELF） |
| `DEPARTMENT` | `departmentId` 或可推导映射 | `SCOPE_CONTEXT_MISSING`                        |
| `ALL`        | 无                          | 通过（仍受 Classification 约束）               |

### 2.3 求值结果

```ts
type ScopeEvaluationResult = {
  scopeType: ScopeType;
  appliedFilters: ScopeFilterClause[];
  resolvedValues: Record<string, string | string[]>;
  scopeAppliedLabel: string; // 用于 DataGatewayResponse，如 "本人客户"
};
```

### 2.4 预注册字段白名单

| 领域      | 允许字段                   | 说明         |
| --------- | -------------------------- | ------------ |
| CRM       | `customer.owner_id`        | 客户负责人   |
| CRM       | `customer.owner_team`      | 客户所属团队 |
| CRM       | `customer.department_id`   | 客户所属部门 |
| ERP       | `order.created_by`         | 订单创建人   |
| ERP       | `order.team_id`            | 订单团队     |
| Knowledge | `article.visibility_scope` | 文章可见范围 |

新增字段须经代码审查加入白名单，禁止运行时动态注册。

### 2.4 上下文引用白名单

| valueRef                  | 解析来源                           |
| ------------------------- | ---------------------------------- |
| `current_user.id`         | `employeeId`                       |
| `current_user.team`       | `ScopeEvaluationContext.teamLabel` |
| `current_user.department` | `departmentId` 或 `teamLabel`      |
| `current_seat.id`         | `seatId`                           |

## 3. 状态机与生命周期

Scope Policy 无复杂状态机，仅有 CRUD 生命周期：

```text
created ──update──> updated ──delete──> archived（软删除，已有 grant 引用时禁止删除）
```

### 3.1 默认 Scope 模板

| 模板 ID                   | scopeType  | 适用场景                       |
| ------------------------- | ---------- | ------------------------------ |
| `scope-self-default`      | SELF       | 销售经理看本人客户             |
| `scope-team-default`      | TEAM       | 销售总监看团队客户             |
| `scope-dept-experimental` | DEPARTMENT | 实验性；默认不种子，需显式启用 |
| `scope-all-readonly`      | ALL        | 只读聚合（需额外审批）         |

### 3.2 求值规则

```text
Resolve SeatActionGrant.scopePolicyId
  → Load ScopePolicy
  → Build ScopeEvaluationContext（服务端）
  → Resolve valueRef → concrete values
  → Emit ScopeEvaluationResult
  → Pass to Connector Runtime as query constraints（非 SQL）
```

**SELF 示例：**

```json
{
  "scopeType": "SELF",
  "filterClauses": [
    { "field": "customer.owner_id", "operator": "eq", "valueRef": "current_user.id" }
  ]
}
```

**TEAM 示例：**

```json
{
  "scopeType": "TEAM",
  "filterClauses": [
    { "field": "customer.owner_team", "operator": "eq", "valueRef": "current_user.team" }
  ]
}
```

## 4. API 契约

| 方法                            | 说明                        | 权限             |
| ------------------------------- | --------------------------- | ---------------- |
| `enterprise-data.scope.list`    | 列出 Scope 策略             | enterprise-admin |
| `enterprise-data.scope.get`     | 获取单个策略                | enterprise-admin |
| `enterprise-data.scope.upsert`  | 创建/更新策略               | enterprise-admin |
| `enterprise-data.scope.delete`  | 归档策略                    | enterprise-admin |
| `enterprise-data.scope.preview` | 预览求值结果（给定 seatId） | enterprise-admin |

**预览请求：**

```json
{
  "scopePolicyId": "scope-team-default",
  "seatId": "seat-sales-director",
  "employeeId": "emp-001"
}
```

**预览响应：**

```json
{
  "ok": true,
  "result": {
    "scopeType": "TEAM",
    "scopeAppliedLabel": "团队客户（华东销售）",
    "resolvedValues": { "customer.owner_team": "华东销售" }
  }
}
```

### 4.1 网关集成（P3）

`enterprise-data.invoke` 流程中：

1. 解析 `SeatActionGrant.scopePolicyId`
2. 调用 `evaluateScopePolicy(context, policy)`
3. 将 `ScopeEvaluationResult` 传给 handler
4. handler 必须用 resolved filters 约束查询，不得忽略
5. 响应 `scopeApplied` 字段来自 `scopeAppliedLabel`

## 5. 与现有代码兼容方式

| 现有能力                           | 关系                                 |
| ---------------------------------- | ------------------------------------ |
| `EnterprisePositionSeat.teamLabel` | Scope TEAM/DEPARTMENT 解析来源       |
| `EnterprisePositionSeat.roleCode`  | 辅助角色级默认 Scope 模板选择        |
| `EnterpriseAccessPolicy`           | 粗粒度资源访问；Scope 是数据行级过滤 |
| `SeatActionGrant.scopePolicyId`    | 动作级绑定 Scope                     |

**不修改：**

- `EnterpriseSeatBinding` 结构
- 员工端 `employee-capability.ts` 现有能力列表（P5 扩展）

## 6. 迁移策略

1. P2 种子写入三个默认 Scope 模板：`scope-self-default`、`scope-team-default`、`scope-all-readonly`
2. `scope-dept-experimental` **不默认种子**；UAT 租户按需显式启用
3. 现有 connector grant（P6 映射）默认绑定 `scope-self-default`
4. 销售总监岗位模板手动绑定 `scope-team-default`（UAT 配置）

## 7. 失败与回滚策略

| 场景                                       | 处理                                          |
| ------------------------------------------ | --------------------------------------------- |
| 未知 `filterClauses.field`                 | 拒绝求值，返回 `SCOPE_FIELD_NOT_ALLOWED`      |
| 未知 `valueRef`                            | 返回 `SCOPE_CONTEXT_MISSING`                  |
| `teamLabel` 为空但 Scope=TEAM              | **fail-closed**，返回 `SCOPE_CONTEXT_MISSING` |
| `departmentId` 不可推导且 Scope=DEPARTMENT | **fail-closed**，返回 `SCOPE_CONTEXT_MISSING` |
| Scope 求值通过但 handler 忽略 filters      | 网关后置校验 recordCount + 抽样审计（P4）     |
| 删除被引用的 Scope                         | 返回 `SCOPE_IN_USE`，禁止删除                 |

回滚：Scope 数据独立存储，回滚 P2 代码不影响 Seat/Binding。

## 8. 测试矩阵

| 场景                              | 预期                                     |
| --------------------------------- | ---------------------------------------- |
| SELF + 销售经理                   | 仅返回 `owner_id = 当前员工` 的数据      |
| TEAM + 销售总监                   | 返回 `owner_team = 当前团队` 的数据      |
| DEPARTMENT + 实验租户 + 有效映射  | 返回部门级数据                           |
| DEPARTMENT + 无 department 上下文 | `SCOPE_CONTEXT_MISSING`                  |
| TEAM + 空 teamLabel               | `SCOPE_CONTEXT_MISSING`（非降级 SELF）   |
| ALL                               | 返回租户内全量（受 Classification 约束） |
| 越权：TEAM scope 请求 SELF 外数据 | handler 约束后 recordCount=0             |
| 非法 field                        | `SCOPE_FIELD_NOT_ALLOWED`                |
| 非法 valueRef                     | `SCOPE_CONTEXT_MISSING`                  |
| 前端传入伪造 scopeApplied         | 服务端忽略，自行计算                     |
| Scope 预览 API                    | 管理员可验证求值结果                     |

建议测试文件：`src/gateway/enterprise-data/scope-policy.test.ts`
