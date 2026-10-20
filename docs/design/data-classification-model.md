# Data Classification & Masking Model 设计文档

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 关联方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §8.4、§9.3

## 1. 目标与边界

### 1.1 目标

建立**动作版本级**字段分类与脱敏策略，使 `CONFIDENTIAL` 默认脱敏、`RESTRICTED` 默认阻断明细，未知字段 **fail-closed**，并参与审批决策。

### 1.2 边界

**在范围内：**

- `DataClassification` 枚举与字段级标注（绑定 `actionKey + version`）
- `MaskingPolicy` 脱敏规则引擎
- 严格模式未知字段策略（fail-closed）
- 分类 → 脱敏 → 审批联动
- 首批 CRM / ERP 字段分类样例（按版本）

**不在范围内：**

- 对象级/结果级分类（预留扩展点）
- 前端自行脱敏
- 无审批导出（首版阻断）

## 2. 数据模型

### 2.1 DataClassification

```ts
enum DataClassification {
  PUBLIC = "PUBLIC",
  INTERNAL = "INTERNAL",
  CONFIDENTIAL = "CONFIDENTIAL",
  RESTRICTED = "RESTRICTED",
}
```

### 2.2 FieldClassification（字段级标注）

**复合唯一键：`connectorId + actionKey + version + fieldPath`**

```ts
type FieldClassification = {
  classificationId: string;
  tenantId: string;
  connectorId: string;
  actionKey: string; // 必填，禁止仅连接器级模糊匹配
  version: string; // 必填；@v2 新字段须单独登记
  fieldPath: string; // JSON Path，如 customer.phone
  classification: DataClassification;
  maskingPolicyId?: string;
  blockDetail?: boolean; // RESTRICTED 默认 true
  createdAt: string;
  updatedAt: string;
};

type FieldClassificationRef = {
  connectorId: string;
  actionKey: string;
  version: string;
  fieldPath: string;
};
```

**版本隔离原则：**

- `crm.customer.read_summary@v1` 与 `@v2` 维护**独立**分类表
- `@v2` 新增字段未登记 → 走未知字段 fail-closed，不得继承 `@v1` 分类

### 2.3 UnknownFieldPolicy（未知字段策略）

```ts
type UnknownFieldPolicy = "fail_closed_redact" | "fail_closed_block";

type ClassificationRuntimeConfig = {
  tenantId: string;
  unknownFieldPolicy: UnknownFieldPolicy; // 首版默认 fail_closed_redact
  strictMode: boolean; // 首版默认 true
};
```

| 策略                         | 行为                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| `fail_closed_redact`（默认） | 未知字段替换为 `***`，列入 `maskedFields`，审计 `unknown_field_redacted` |
| `fail_closed_block`          | 未知字段移除，列入 `blockedFields`，审计 `unknown_field_blocked`         |

**禁止 fail-open**：未知字段不得默认 `INTERNAL` 原样返回。

### 2.4 MaskingPolicy

```ts
type MaskingStrategy = "redact" | "partial_phone" | "partial_email" | "hash" | "aggregate_only";

type MaskingPolicy = {
  maskingPolicyId: string;
  tenantId: string;
  displayName: string;
  strategy: MaskingStrategy;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

### 2.5 MaskingResult

```ts
type MaskingResult = {
  data: unknown;
  masked: boolean;
  maskedFields: string[];
  blockedFields: string[];
  unknownFields: string[]; // fail-closed 处理的字段
  classifications: DataClassification[];
  classificationDigest: string; // 供 ApprovalContextSnapshot 使用
};
```

## 3. 状态机与生命周期

### 3.1 处理流水线

```text
Handler 返回原始数据
  → resolveFieldClassifications(connectorId, actionKey, version)  // 精确版本
  → walk output schema fields:
      known + RESTRICTED → block/remove
      known + CONFIDENTIAL → applyMaskingPolicy
      known + PUBLIC/INTERNAL → pass through
      unknown → apply UnknownFieldPolicy (fail-closed)
  → compute classificationDigest
  → emit MaskingResult
  → attach to DataGatewayResponse
```

### 3.2 版本升级检查清单

发布 `@v2` 动作时必须：

1. 复制 `@v1` 分类作为基线（显式操作，非自动）
2. 为新增字段补充分类
3. 通过 `classification.preview` 验证未知字段为零

## 4. API 契约

| 方法                                     | 说明          | 权限             |
| ---------------------------------------- | ------------- | ---------------- |
| `enterprise-data.classification.list`    | 列出字段分类  | enterprise-admin |
| `enterprise-data.classification.upsert`  | 创建/更新分类 | enterprise-admin |
| `enterprise-data.masking.list`           | 列出脱敏策略  | enterprise-admin |
| `enterprise-data.masking.upsert`         | 创建/更新策略 | enterprise-admin |
| `enterprise-data.classification.preview` | 预览脱敏效果  | enterprise-admin |

**预览请求（含 version）：**

```json
{
  "connectorId": "crm-salesforce",
  "actionKey": "crm.customer.read_summary",
  "version": "v2",
  "samplePayload": {
    "customer": {
      "name": "张三",
      "phone": "13812345678",
      "id_number": "110101199001011234",
      "new_field_v2": "secret"
    }
  }
}
```

**预览响应（含未知字段处理）：**

```json
{
  "ok": true,
  "result": {
    "data": {
      "customer": {
        "name": "张三",
        "phone": "138****5678",
        "new_field_v2": "***"
      }
    },
    "maskedFields": ["customer.phone", "customer.new_field_v2"],
    "blockedFields": ["customer.id_number"],
    "unknownFields": ["customer.new_field_v2"]
  }
}
```

## 5. 与现有代码兼容方式

| 现有能力                                       | 关系                               |
| ---------------------------------------------- | ---------------------------------- |
| `ConnectorAction.outputSchema`                 | 分类表须覆盖 schema 声明的敏感字段 |
| `ApprovalContextSnapshot.classificationDigest` | 审批快照绑定分类集                 |
| `DataGatewayResponse.maskedFields`             | 含 unknownFields 处理结果          |

## 6. 迁移策略

1. P2 种子写入默认 MaskingPolicy
2. CRM `read_summary@v1` 字段分类种子（按版本独立）：

| actionKey                   | version | fieldPath            | classification |
| --------------------------- | ------- | -------------------- | -------------- |
| `crm.customer.read_summary` | v1      | `customer.phone`     | CONFIDENTIAL   |
| `crm.customer.read_summary` | v1      | `customer.email`     | CONFIDENTIAL   |
| `crm.customer.read_summary` | v1      | `customer.id_number` | RESTRICTED     |
| `crm.customer.read_summary` | v1      | `customer.name`      | INTERNAL       |
| `crm.customer.read_summary` | v1      | `customer.id`        | PUBLIC         |

3. `read_summary@v2` 单独维护；不得自动继承 v1
4. `unknownFieldPolicy` 首版默认 `fail_closed_redact`，`strictMode: true`

## 7. 失败与回滚策略

| 场景                    | 处理                                                       |
| ----------------------- | ---------------------------------------------------------- |
| 未知 fieldPath          | **fail-closed**（redact 或 block），审计 `unknown_field_*` |
| `@v2` 新字段未登记      | fail-closed，阻止静默明文泄露                              |
| RESTRICTED 明细         | 移除字段；`blockedFields` 列出                             |
| 脱敏函数异常            | 降级为 `redact`（仍 fail-closed），审计 `masking_fallback` |
| 前端传入 maskedFields   | 服务端忽略，自行计算                                       |
| 生产环境关闭 strictMode | 需 enterprise-admin 二次确认；默认禁止                     |

## 8. 测试矩阵

| 场景                      | 预期                     |
| ------------------------- | ------------------------ |
| CONFIDENTIAL 手机号       | `138****5678`            |
| RESTRICTED 身份证         | 不在 `data` 中           |
| `@v2` 新字段未登记        | fail-closed redact/block |
| `@v1` 与 `@v2` 分类隔离   | v2 不继承 v1 未声明字段  |
| 已知 PUBLIC 字段          | 原样返回                 |
| 未知字段（strict）        | 不原样返回               |
| classificationDigest 稳定 | 同分类集产生相同 digest  |
| 预览 API 含 version       | 按版本解析               |

建议测试文件：

- `src/gateway/enterprise-data/masking-engine.test.ts`
- `src/gateway/enterprise-data/classification-store.test.ts`
