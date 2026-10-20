# Audit Runtime Schema 设计文档

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 关联方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §8.6、§9.5

## 1. 目标与边界

### 1.1 目标

为企业数据网关建立双层审计运行时：调用审计（Invocation）+ 数据审计（Data），通过 `traceId` 关联，支持完整回溯，并能回答「查了哪些对象」。

### 1.2 边界

**在范围内：**

- `InvocationAuditEvent` + `DataAuditEvent` 模型
- 安全化对象引用（`objectRefs`）
- 按风险等级的审计写入策略（fail-closed for HIGH/CRITICAL）
- 审计存储与查询 API

**不在范围内：**

- 替代现有岗位治理审计
- 外部 SIEM 集成（预留 export）
- 审计数据跨租户查询

## 2. 数据模型

### 2.1 InvocationAuditEvent（调用层）

```ts
type InvocationAuditStatus = "SUCCESS" | "DENIED" | "FAILED";

type InvocationDenialReason =
  | "NO_SEAT_CONTEXT"
  | "NO_ACTION_GRANT"
  | "ACTION_FROZEN"
  | "ACTION_NOT_REGISTERED"
  | "SCOPE_DENIED"
  | "SCOPE_CONTEXT_MISSING"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_INVALIDATED"
  | "CREDENTIAL_REAUTH_REQUIRED"
  | "HANDLER_TIMEOUT"
  | "HANDLER_ERROR"
  | "AUDIT_WRITE_FAILED"; // HIGH/CRITICAL 审计失败阻断时

type InvocationAuditEvent = {
  invocationAuditId: string;
  traceId: string;
  tenantId: string;
  seatId: string;
  employeeId?: string;
  agentId?: string;
  connectorId: string;
  actionKey: string;
  version: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  scopeType: string;
  scopeAppliedLabel?: string;
  approvalContextId?: string; // PER_REQUEST 审批上下文
  approvalId?: string;
  status: InvocationAuditStatus;
  denialReason?: InvocationDenialReason;
  errorMessage?: string;
  durationMs?: number;
  timestamp: string;
};
```

### 2.2 DataAuditEvent（数据层）

```ts
type DataObjectRef = {
  objectType: string; // 如 customer、order、article
  objectKeyHash: string; // sha256(租户盐 + 业务主键)，不可逆
  objectKeyHint?: string; // 可选尾号，如 customer:***1234
};

type DataAuditEvent = {
  dataAuditId: string;
  traceId: string;
  tenantId: string;
  recordCount: number;
  objectRefs: DataObjectRef[]; // 有限条数，见 §2.3
  objectRefTruncated: boolean; // 超出上限时 true
  masked: boolean;
  maskedFields: string[];
  blockedFields: string[];
  unknownFields: string[];
  classifications: string[];
  approvalId?: string;
  timestamp: string;
};
```

### 2.3 objectRefs 采集规则

1. Handler 返回时提取业务主键（如 `customer.id`），由网关统一哈希
2. 单次调用最多记录 **50** 条 `objectRefs`；超出设 `objectRefTruncated: true` 并审计告警
3. **禁止**存储明文主键或 PII；仅 `objectKeyHash` + 可选 `objectKeyHint`
4. 聚合类动作（仅 `recordCount`）可 `objectRefs: []`
5. 抽样模式：HIGH/CRITICAL 动作至少记录 10 条或全量（取小）

### 2.4 审计写入策略（按风险分级）

```ts
type AuditWritePolicy = "fail_open" | "fail_closed";

function resolveAuditWritePolicy(riskLevel: ConnectorActionRiskLevel): AuditWritePolicy {
  return riskLevel === "HIGH" || riskLevel === "CRITICAL" ? "fail_closed" : "fail_open";
}
```

| riskLevel       | 审计写入失败    | 业务响应                                           |
| --------------- | --------------- | -------------------------------------------------- |
| LOW / MEDIUM    | 记录日志 + 指标 | **允许**返回数据（fail-open）                      |
| HIGH / CRITICAL | 记录日志 + 指标 | **阻断**，返回 `AUDIT_WRITE_FAILED`（fail-closed） |

> 修订说明：企业数据平面中，高风险动作不允许「无审计执行」。

### 2.5 存储扩展

```ts
type EnterpriseSeatAssetsStore = {
  // ... 现有 + P1/P2 字段 ...
  invocationAuditEvents: Record<string, InvocationAuditEvent>;
  dataAuditEvents: Record<string, DataAuditEvent>;
};
```

## 3. 状态机与生命周期

```text
gateway.invoke()
  → generate traceId
  → auth checks (may DENY → write Invocation only)
  → execute handler
  → masking + extract objectRefs
  → write InvocationAudit (SUCCESS)
  → write DataAudit
  → if audit write fails:
       LOW/MEDIUM → return data + alert
       HIGH/CRITICAL → DENY AUDIT_WRITE_FAILED
```

### 3.1 traceId 与 approvalContextId

| 标识                | 用途                                      |
| ------------------- | ----------------------------------------- |
| `traceId`           | 单次 invoke 审计关联                      |
| `approvalContextId` | 审批链路透传，写入 InvocationAudit 供回溯 |

二者独立；PER_REQUEST 重试可产生不同 `traceId`，共享同一 `approvalContextId`。

## 4. API 契约

**trace 回溯响应（含 objectRefs）：**

```json
{
  "ok": true,
  "trace": {
    "traceId": "abc-123",
    "invocation": {
      "status": "SUCCESS",
      "actionKey": "crm.customer.read_summary",
      "version": "v1",
      "approvalContextId": "ctx-abc"
    },
    "data": {
      "recordCount": 12,
      "objectRefs": [
        {
          "objectType": "customer",
          "objectKeyHash": "sha256:...",
          "objectKeyHint": "customer:***4521"
        }
      ],
      "objectRefTruncated": false,
      "masked": true,
      "maskedFields": ["customer.phone"]
    }
  }
}
```

### 4.1 写入伪代码

```ts
async function invokeEnterpriseData(params): Promise<DataGatewayResponse> {
  const traceId = randomUUID();
  const riskLevel = action.riskLevel;
  const auditPolicy = resolveAuditWritePolicy(riskLevel);
  try {
    // ... execute pipeline ...
    const invOk = await recordInvocation({ traceId, approvalContextId: params.approvalContextId, ... });
    const dataOk = await recordDataAudit({ traceId, objectRefs, ... });
    if (!invOk || !dataOk) {
      if (auditPolicy === "fail_closed") {
        throw errorShape("AUDIT_WRITE_FAILED");
      }
      incrementAuditWriteFailure();
    }
    return response;
  } catch (err) { /* ... */ }
}
```

## 5. 与现有代码兼容方式

| 现有                                | 关系                 |
| ----------------------------------- | -------------------- |
| `recordEnterpriseAssetAuditEvent`   | 保留；治理审计独立   |
| `ApprovalRequest.approvalContextId` | 写入 InvocationAudit |

## 6. 迁移策略

1. 新字段初始化为空
2. `objectRefs` 从首版上线起采集；历史无追溯
3. HIGH/CRITICAL 种子动作默认 `fail_closed`

## 7. 失败与回滚策略

| 场景              | 处理                                      |
| ----------------- | ----------------------------------------- |
| 审计存储满        | 清理 + 告警；HIGH/CRITICAL 仍 fail-closed |
| 双写不一致        | 查询标注 `dataAuditMissing: true`         |
| objectRefs 超上限 | `objectRefTruncated: true`                |
| 回滚 P4           | 停写；历史只读                            |

## 8. 测试矩阵

| 场景              | 预期                             |
| ----------------- | -------------------------------- |
| 成功调用          | 双写 + objectRefs                |
| LOW 审计失败      | 数据仍返回 + 指标                |
| HIGH 审计失败     | `AUDIT_WRITE_FAILED`，无数据返回 |
| traceId 回溯      | Invocation + Data 关联           |
| objectRefs 哈希   | 无明文主键                       |
| >50 条结果        | truncated 标记                   |
| PER_REQUEST       | invocation 含 approvalContextId  |
| 不同 traceId 重试 | 均可回溯                         |

建议测试文件：`src/gateway/enterprise-data/audit-runtime.test.ts`
