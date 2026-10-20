# Connector Action Versioning 设计文档

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 关联方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §8.1、§9.2

## 1. 目标与边界

### 1.1 目标

将现有 `connector` 资源类型从「岗位资产绑定」升级为「版本化、可执行、可授权」的动作目录（Action Catalog），使 Agent 只能绑定并执行精确版本的企业数据动作。

### 1.2 边界

**在范围内：**

- `ConnectorAction` 数据模型与持久化
- `ConnectorRuntimeRegistry` 运行时注册中心
- 动作生命周期：新增、启用、弃用、冻结
- 动作目录只读查询 API
- CRM / ERP / Knowledge 首批动作清单（mock + 真实 handler 接口）

**不在范围内：**

- 任意 SQL 执行器
- 写操作 / 删除动作（首版全部 `readOnly: true`）
- 一级导航「数据连接中心」
- 新增 `DigitalHuman` 授权主体

### 1.3 架构约束

- 授权粒度：`connectorId + actionKey + version`
- Agent / Workflow / Automation 必须绑定精确版本，禁止静默升级到最新版
- 未注册动作不可执行
- 所有执行必须经过后续 P3 Data Gateway，本阶段只交付目录与 Registry

## 2. 数据模型

### 2.1 ConnectorAction

```ts
type ConnectorActionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type ConnectorActionLifecycle = "draft" | "active" | "deprecated" | "frozen";

type ConnectorAction = {
  actionId: string; // UUID，内部主键
  tenantId: string;
  connectorId: string;
  actionKey: string; // 如 crm.customer.read_summary
  version: string; // 如 v1、v2（不含 @ 前缀，展示时拼接为 actionKey@version）
  displayName: string;
  category: string; // crm | erp | knowledge | finance | hr
  description?: string;
  riskLevel: ConnectorActionRiskLevel;
  requiresApproval: boolean;
  readOnly: boolean; // 首版强制 true
  outputSchema: Record<string, unknown>; // JSON Schema 子集
  inputSchema?: Record<string, unknown>;
  lifecycle: ConnectorActionLifecycle;
  supersededBy?: string; // 指向新 actionId
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

// 复合业务键（唯一索引）
type ConnectorActionRef = {
  connectorId: string;
  actionKey: string;
  version: string;
};
```

### 2.2 ConnectorRuntimeRegistryEntry

```ts
type ConnectorRuntimeRegistryEntry = {
  registryId: string;
  tenantId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  handlerRef: string; // 模块路径，如 enterprise-data/handlers/crm-customer-read-summary-v1
  readOnly: boolean;
  timeoutMs: number; // 默认 30000
  registeredAt: string;
  registeredBy?: string;
};
```

### 2.3 SeatActionGrant（岗位动作授权，P1 存储，P3 校验）

```ts
type SeatActionGrant = {
  grantId: string;
  tenantId: string;
  seatId: string;
  connectorId: string;
  actionKey: string;
  version: string; // 精确版本
  scopePolicyId?: string; // 关联 ScopePolicy（P2）
  approvalPolicyId?: string; // 关联 ApprovalPolicy（P4）
  effect: "allow";
  createdAt: string;
  revokedAt?: string;
};
```

### 2.4 存储布局

扩展现有 `EnterpriseSeatAssetsStore`（`src/gateway/enterprise-seat-assets-store.ts`）：

```ts
type EnterpriseSeatAssetsStore = {
  // ... 现有字段 ...
  connectorActions: Record<string, ConnectorAction>;
  connectorRuntimeRegistry: Record<string, ConnectorRuntimeRegistryEntry>;
  seatActionGrants: Record<string, SeatActionGrant>;
};
```

存储版本：`ENTERPRISE_SEAT_ASSETS_STORE_VERSION` 从 `2` 升级到 `3`。

索引策略（内存 + SQLite 后端）：

- `connectorActions`：按 `(tenantId, connectorId, actionKey, version)` 唯一
- `connectorRuntimeRegistry`：按 `(tenantId, connectorId, actionKey, version)` 唯一
- `seatActionGrants`：按 `(tenantId, seatId, connectorId, actionKey, version)` 唯一

## 3. 状态机与生命周期

### 3.1 ConnectorAction 生命周期

```text
draft ──publish──> active ──deprecate──> deprecated ──freeze──> frozen
                     │                        │
                     └────────freeze──────────┘
```

| 状态         | 含义                 | 可授权           | 可执行                 |
| ------------ | -------------------- | ---------------- | ---------------------- |
| `draft`      | 草稿，未发布         | 否               | 否                     |
| `active`     | 正式可用             | 是               | 是（需 Registry 注册） |
| `deprecated` | 已弃用，旧绑定仍可用 | 否（新授权禁止） | 是（已有绑定）         |
| `frozen`     | 冻结，禁止一切调用   | 否               | 否                     |

### 3.2 版本规则

1. **并存**：`crm.customer.read_summary@v1` 与 `@v2` 必须可同时 `active`
2. **升级**：返回结构变化必须升版本；`supersededBy` 指向新 actionId
3. **禁止默认升级**：Agent 绑定 `@v1` 时，即使 `@v2` 存在也不得自动切换
4. **弃用策略**：`deprecated` 动作保留至少 90 天（可配置）后才可 `frozen`

### 3.3 Runtime Registry 规则

- 仅 `active` 动作可注册 handler
- 未注册 = 不可执行（返回 `CONNECTOR_ACTION_NOT_REGISTERED`）
- handler 必须声明 `readOnly: true`（首版写操作拒绝注册）

## 4. API 契约

### 4.1 Gateway RPC（`enterprise-data` 命名空间，P1 只读目录）

| 方法                              | 说明                    | 权限                                               |
| --------------------------------- | ----------------------- | -------------------------------------------------- |
| `enterprise-data.actions.list`    | 列出租户动作目录        | enterprise-admin                                   |
| `enterprise-data.actions.get`     | 按 ref 获取单个动作     | enterprise-admin                                   |
| `enterprise-data.actions.catalog` | 按 connectorId 分组目录 | enterprise-admin / seat-bound employee（只读摘要） |
| `enterprise-data.registry.list`   | 列出已注册 handler      | enterprise-admin                                   |
| `enterprise-data.grants.list`     | 列出岗位动作授权        | enterprise-admin                                   |
| `enterprise-data.grants.upsert`   | 创建/更新岗位动作授权   | enterprise-admin                                   |
| `enterprise-data.grants.revoke`   | 撤销岗位动作授权        | enterprise-admin                                   |

### 4.2 请求/响应示例

**列出动作目录：**

```json
// request
{ "tenantId": "tenant-abc", "connectorId": "crm-salesforce", "lifecycle": "active" }

// response
{
  "ok": true,
  "actions": [
    {
      "connectorId": "crm-salesforce",
      "actionKey": "crm.customer.read_summary",
      "version": "v1",
      "displayName": "客户摘要查询",
      "riskLevel": "LOW",
      "requiresApproval": false,
      "readOnly": true,
      "lifecycle": "active"
    }
  ]
}
```

**岗位授权：**

```json
// request: enterprise-data.grants.upsert
{
  "seatId": "seat-sales-mgr-east",
  "connectorId": "crm-salesforce",
  "actionKey": "crm.customer.read_summary",
  "version": "v1",
  "scopePolicyId": "scope-self-v1"
}

// response
{ "ok": true, "grant": { "grantId": "...", "effect": "allow" } }
```

### 4.3 错误码

| 代码                                | 含义               |
| ----------------------------------- | ------------------ |
| `CONNECTOR_ACTION_NOT_FOUND`        | 动作不存在         |
| `CONNECTOR_ACTION_FROZEN`           | 动作已冻结         |
| `CONNECTOR_ACTION_NOT_REGISTERED`   | 无 Runtime handler |
| `CONNECTOR_ACTION_VERSION_CONFLICT` | 同 ref 版本已存在  |
| `SEAT_ACTION_GRANT_EXISTS`          | 授权已存在         |
| `SEAT_NOT_FOUND`                    | 岗位不存在         |

## 5. 与现有代码兼容方式

### 5.1 锚点映射

| 现有模型                                               | 升级后关系                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `EnterpriseSeatAssetBinding`（`assetType: connector`） | 保留；表示岗位可访问哪些连接器实例                          |
| `EnterpriseConnectorCredentialBinding`                 | 保留；Runtime handler 通过 credential 取数                  |
| `EnterpriseAccessPolicy`（`resourceType: connector`）  | 保留粗粒度访问；`SeatActionGrant` 补充动作级授权            |
| `EnterpriseAssetAuditEvent`                            | 保留治理审计；数据调用审计由 P4 `InvocationAuditEvent` 补充 |

### 5.2 兼容原则

1. **不破坏现有 binding**：`connectorIds` 在 `ControlUiPlatformSeatSummary` 中继续有效
2. **渐进授权**：现有 `execute` 权限可映射为默认 `SeatActionGrant`（P6 迁移）
3. **Store 版本升级**：`normalizeEnterpriseSeatAssetsStore` 对缺失字段补空对象

### 5.3 新增模块建议

```
src/gateway/enterprise-data/
  connector-action-store.ts      # CRUD + 索引
  connector-runtime-registry.ts  # handler 注册与解析
  seat-action-grant-store.ts     # 岗位动作授权
  handlers/                      # P3 首批 handler
  types.ts                       # 共享类型
```

## 6. 迁移策略

### 6.1 Store 版本 2 → 3

1. `normalizeEnterpriseSeatAssetsStore` 初始化三个新 Record 为空
2. 种子数据：为已绑定 connector 的 tenant 写入首批动作目录（只读）
3. 不回写、不删除现有 `assetBindings` / `accessPolicies`

### 6.2 旧 connector execute 映射（P6 执行，P1 预留）

**禁止**统一映射到 `*.read_summary@v1`。采用**逐连接器显式映射表**：

```ts
type ConnectorExecuteMigrationEntry = {
  connectorId: string;
  targetActionKey: string;
  targetVersion: string;
  status: "confirmed" | "pending_review" | "blocked";
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
};

// 示例（须人工确认后方可 status=confirmed）
const CONNECTOR_EXECUTE_MIGRATION_TABLE: ConnectorExecuteMigrationEntry[] = [
  {
    connectorId: "crm-salesforce",
    targetActionKey: "crm.customer.read_summary",
    targetVersion: "v1",
    status: "confirmed",
  },
  {
    connectorId: "erp-sap",
    targetActionKey: "erp.order.read_status",
    targetVersion: "v1",
    status: "confirmed",
  },
  // 无确定语义的连接器不得凭空发明动作
];
```

| 旧模式                             | 新模式                                       |
| ---------------------------------- | -------------------------------------------- |
| `AccessPolicy` connector + execute | 查映射表 → 生成 `SeatActionGrant`            |
| 映射表 `pending_review`            | **不迁移**；保持旧 execute 权限 + 管理面告警 |
| 映射表无条目                       | **不迁移**；进入「待人工确认」队列           |
| 无版本概念                         | 仅使用映射表指定的 `targetVersion`           |

迁移脚本 `scripts/migrate-connector-execute-grants.ts` 必须输出：

- `confirmed` / `pending_review` / `blocked` 计数
- 未映射 connector 清单（须人工处理）

### 6.3 回滚

- Store 版本保持向后兼容：v3 字段在 v2 代码中忽略
- 回滚到 v2 时，新字段数据保留但不读取
- 动作目录种子可通过 `scripts/seed-connector-actions.ts` 重放

## 7. 失败与回滚策略

| 失败场景                  | 处理                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| 动作发布但 handler 未注册 | 目录可见但执行返回 `NOT_REGISTERED`；管理面提示                          |
| 版本并存导致授权混乱      | UI 强制显示精确版本；禁止「最新版」选项                                  |
| Store 迁移失败            | 保留 v2 备份；`migrate-enterprise-seat-assets-to-sqlite.ts` 增加 v3 步骤 |
| Registry handler 加载失败 | 超时返回 `HANDLER_LOAD_FAILED`；不暴露内部路径                           |

## 8. 测试矩阵

| 场景                            | 预期                                   | 阶段 |
| ------------------------------- | -------------------------------------- | ---- |
| `@v1` 与 `@v2` 并存             | 两版本均可 `active`，索引不冲突        | P1   |
| 旧 Agent 绑定 `@v1`，发布 `@v2` | `@v1` 调用不受影响                     | P1   |
| 未注册动作调用                  | 返回 `CONNECTOR_ACTION_NOT_REGISTERED` | P1   |
| `frozen` 动作授权               | `grants.upsert` 拒绝                   | P1   |
| `deprecated` 新授权             | 拒绝；已有 grant 仍有效                | P1   |
| Store v2 → v3 迁移              | 现有 seat/binding 不变                 | P1   |
| 动作目录 list API               | enterprise-admin 可列出                | P1   |
| 员工只读 catalog                | 仅返回已授权动作摘要                   | P1   |

建议测试文件：

- `src/gateway/enterprise-data/connector-action-store.test.ts`
- `src/gateway/enterprise-data/connector-runtime-registry.test.ts`
- `src/gateway/enterprise-data/seat-action-grant-store.test.ts`

## 9. 首批动作清单（种子）

| connectorId      | actionKey                   | version | riskLevel | requiresApproval |
| ---------------- | --------------------------- | ------- | --------- | ---------------- |
| `crm-salesforce` | `crm.customer.read_summary` | v1      | LOW       | false            |
| `crm-salesforce` | `crm.customer.read_summary` | v2      | LOW       | false            |
| `crm-salesforce` | `crm.customer.export`       | v1      | HIGH      | true             |
| `erp-sap`        | `erp.order.read_status`     | v1      | LOW       | false            |
| `knowledge-wiki` | `knowledge.article.search`  | v1      | LOW       | false            |
