# Approval Workflow Model 设计文档

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 关联方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §8.5、§9.5

## 1. 目标与边界

### 1.1 目标

为高风险企业数据动作建立审批工作流，回答三个问题：**谁批、批多久、批一次还是每次**。

### 1.2 边界

**在范围内：**

- `ApprovalPolicy` 策略模型
- `ApprovalRequest` 申请与审批记录
- `NONE / ONCE / PER_REQUEST` 三种模式
- 网关执行前审批校验
- 审批过期与重新申请
- 审批上下文快照（Scope / Grant 绑定校验）

**不在范围内：**

- 通用工作流平台重构
- 多级审批链（首版单级 approverRole）
- 无审批导出以外的写操作
- `department-head` 审批角色（首版不实现，见 §2.5）

## 2. 数据模型

### 2.1 ApprovalPolicy

```ts
type ApprovalMode = "NONE" | "ONCE" | "PER_REQUEST";

type ApprovalPolicy = {
  approvalPolicyId: string;
  tenantId: string;
  displayName: string;
  mode: ApprovalMode;
  approverRole: "enterprise-admin"; // 首版仅支持此角色
  expiryHours: number; // ONCE 模式有效
  createdAt: string;
  updatedAt: string;
};
```

### 2.2 ApprovalContextSnapshot（审批命中快照）

审批通过时必须冻结执行上下文，防止 Scope / Grant 变更后审批范围与实际执行脱钩。

```ts
type ApprovalContextSnapshot = {
  scopePolicyId: string;
  scopePolicyDigest: string; // sha256(scopePolicy 规范化 JSON)
  grantId: string;
  grantDigest: string; // sha256(SeatActionGrant 关键字段)
  classificationDigest?: string; // sha256(动作版本关联的 FieldClassification 集)
};
```

### 2.3 ApprovalRequest

```ts
type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "superseded"
  | "invalidated"; // 快照与当前 Grant/Scope 不一致

type ApprovalRequest = {
  approvalId: string;
  tenantId: string;
  seatId: string; // 服务端解析写入，非客户端传入
  employeeId: string; // 服务端解析写入
  connectorId: string;
  actionKey: string;
  version: string;
  approvalPolicyId: string;
  status: ApprovalRequestStatus;
  requestedAt: string;
  expiresAt?: string; // ONCE 批准后生效截止
  decidedAt?: string;
  decidedBy?: string; // approver employeeId
  decisionNote?: string;
  reason?: string; // 业务申请原因
  // PER_REQUEST 专用：独立于 traceId 的稳定上下文标识
  approvalContextId: string; // 首次 APPROVAL_REQUIRED 时由服务端生成
  contextSnapshot?: ApprovalContextSnapshot; // 批准时冻结
  consumedAt?: string; // PER_REQUEST 批准后已被哪次 invoke 消费
  consumedTraceId?: string; // 消费时生成的 traceId（仅审计关联，非审批前置键）
};
```

**关键设计：`approvalContextId` 与 `traceId` 分离**

| 标识                | 生成时机                        | 用途                               |
| ------------------- | ------------------------------- | ---------------------------------- |
| `approvalContextId` | 首次 `APPROVAL_REQUIRED` 拒绝时 | 审批申请绑定、重试 invoke 显式携带 |
| `traceId`           | 每次 invoke 入口                | 调用审计与数据审计关联             |

`traceId` **不得**作为审批前置键，避免「审批时尚未 invoke → 无 traceId」与「重试生成新 traceId → 审批链断裂」的矛盾。

### 2.4 默认策略（首版）

| 场景                   | mode        | approverRole     | expiryHours |
| ---------------------- | ----------- | ---------------- | ----------- |
| LOW 风险只读           | NONE        | —                | —           |
| MEDIUM 批量查询        | ONCE        | enterprise-admin | 24          |
| HIGH 风险（如 export） | PER_REQUEST | enterprise-admin | —           |
| CRITICAL               | PER_REQUEST | enterprise-admin | —           |

> **首版口径冻结**：`approverRole` 仅实现 `enterprise-admin`。`department-head` 列入 P5+ 扩展，不在首版种子策略中使用。

### 2.5 SeatActionGrant 绑定

```ts
type SeatActionGrant = {
  // ... P1 字段 ...
  approvalPolicyId?: string; // 覆盖动作默认策略
};
```

## 3. 状态机与生命周期

### 3.1 ApprovalRequest 状态机

```text
                    ┌──reject──> rejected
                    │
pending ──approve──> approved ──expire──> expired
    │                    │
    │                    ├──consume (PER_REQUEST)──> consumed (终态，记 consumedAt)
    │                    │
    │                    └──snapshot mismatch──> invalidated
    │
    └──cancel/supersede──> superseded
```

### 3.2 三种模式行为

| 模式          | 行为                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| `NONE`        | 网关跳过审批校验                                                              |
| `ONCE`        | 批准后 `expiresAt` 内，同 `seat + action + version + contextSnapshot` 免审    |
| `PER_REQUEST` | 每次 invoke 须携带 `approvalContextId` + 已 `approved` 且未 `consumed` 的请求 |

### 3.3 网关校验流程

```text
Resolve Seat + employeeId（服务端，不信任客户端 seatId）
  → Load SeatActionGrant.approvalPolicyId or ConnectorAction default
  → Build current ApprovalContextSnapshot
  → mode == NONE → pass
  → mode == ONCE
      → find approved request matching seat+action+version+snapshot, not expired
      → snapshot mismatch → APPROVAL_INVALIDATED
  → mode == PER_REQUEST
      → require params.approvalContextId
      → find approved + not consumed request for approvalContextId
      → snapshot mismatch → APPROVAL_INVALIDATED
      → missing/invalid → APPROVAL_REQUIRED (generate new approvalContextId if absent)
  → pass → execute → mark PER_REQUEST consumed → assign traceId for audit
```

### 3.4 PER_REQUEST 完整时序

```text
1. invoke(action) — 无 approvalContextId
   → DENY APPROVAL_REQUIRED
   → 响应含 approvalContextId=ctx-abc（新生成）+ pendingApprovalId

2. approval.requests.create — 携带 approvalContextId + 动作 + reason
   → seatId/employeeId 由服务端从 session 解析
   → 创建 pending 申请

3. approver decide approved
   → 冻结 contextSnapshot

4. invoke(action, approvalContextId=ctx-abc)
   → 校验 approved + snapshot match
   → 执行成功
   → 标记 consumed，写入 consumedTraceId

5. invoke(action, approvalContextId=ctx-abc) 再次
   → DENY APPROVAL_REQUIRED（须新 ctx-def）
```

## 4. API 契约

| 方法                                       | 说明          | 权限                    |
| ------------------------------------------ | ------------- | ----------------------- |
| `enterprise-data.approval.policies.list`   | 列出审批策略  | enterprise-admin        |
| `enterprise-data.approval.policies.upsert` | 创建/更新策略 | enterprise-admin        |
| `enterprise-data.approval.requests.create` | 发起审批申请  | seat-bound employee     |
| `enterprise-data.approval.requests.decide` | 批准/拒绝     | enterprise-admin        |
| `enterprise-data.approval.requests.list`   | 查询申请      | enterprise-admin / 本人 |
| `enterprise-data.approval.requests.get`    | 获取单个申请  | 相关方                  |

**发起申请（不接受客户端 seatId）：**

```json
{
  "approvalContextId": "ctx-abc",
  "connectorId": "crm-salesforce",
  "actionKey": "crm.customer.export",
  "version": "v1",
  "reason": "月度客户报表导出"
}
```

服务端行为：

1. 从 session 解析 `employeeId` → 活跃 `SeatBinding` → `seatId`
2. 校验 `approvalContextId` 存在且处于 `pending` 或可申请状态
3. 写入 `seatId` / `employeeId`（非请求体字段）

**invoke 重试（PER_REQUEST）：**

```json
{
  "connectorId": "crm-salesforce",
  "actionKey": "crm.customer.export",
  "version": "v1",
  "approvalContextId": "ctx-abc"
}
```

**网关拒绝响应：**

```json
{
  "code": "APPROVAL_REQUIRED",
  "message": "该动作需要审批后方可执行",
  "details": {
    "approvalPolicyId": "policy-export-per-request",
    "mode": "PER_REQUEST",
    "approvalContextId": "ctx-abc",
    "pendingApprovalId": "apr-002"
  }
}
```

**快照失效响应：**

```json
{
  "code": "APPROVAL_INVALIDATED",
  "message": "审批上下文已变更，需重新申请",
  "details": {
    "approvalContextId": "ctx-abc",
    "changedFields": ["scopePolicyId"]
  }
}
```

## 5. 与现有代码兼容方式

| 现有                                             | 关系                                          |
| ------------------------------------------------ | --------------------------------------------- |
| `EnterpriseHandoverStatus: pending_approval`     | 岗位交接审批；与数据动作审批独立              |
| `EnterpriseAssetRiskTag: manual_review_required` | 能力资产标记；ApprovalPolicy 是运行时强制执行 |
| `enterprise-capability.ts` 审核队列              | 能力发布审核；不替代数据动作审批              |

**approverRole 解析（首版）：**

- 仅 `enterprise-admin`：`PlatformAuthMembership.membershipRole === "enterprise-admin"`
- `department-head`：**首版不实现**；P5 扩展时增加 `roleCode` 映射与 UI 配置

## 6. 迁移策略

1. 种子策略：`policy-none-default`、`policy-export-per-request`、`policy-batch-once-24h`（均为 `enterprise-admin`）
2. `crm.customer.export@v1` 绑定 `policy-export-per-request`
3. 其他只读动作绑定 `policy-none-default`

## 7. 失败与回滚策略

| 场景                                 | 处理                                      |
| ------------------------------------ | ----------------------------------------- |
| 无 approver 在线                     | pending 保持；员工端提示「等待审批」      |
| ONCE 过期                            | 返回 `APPROVAL_EXPIRED`                   |
| Scope / Grant / Classification 变更  | 已有审批标记 `invalidated` 或快照校验失败 |
| PER_REQUEST 重试无 approvalContextId | `APPROVAL_REQUIRED`                       |
| PER_REQUEST 复用已 consumed ctx      | `APPROVAL_REQUIRED`（须新 ctx）           |
| 客户端伪造 seatId                    | 忽略；服务端 session 解析                 |
| 回滚 P4                              | 审批停校验（仅 NONE）；历史记录保留       |

## 8. 测试矩阵

| 场景                             | 预期                                           |
| -------------------------------- | ---------------------------------------------- |
| export 无审批                    | `APPROVAL_REQUIRED` + 返回 `approvalContextId` |
| PER_REQUEST 带 ctx 批准后 invoke | SUCCESS；ctx 标记 consumed                     |
| PER_REQUEST 同 ctx 二次 invoke   | `APPROVAL_REQUIRED`                            |
| PER_REQUEST 重试携带同 ctx       | 稳定成功（traceId 可不同）                     |
| ONCE 批准后 24h 内               | 同快照可执行                                   |
| ONCE 过期后                      | `APPROVAL_EXPIRED`                             |
| Scope 变更后旧 ONCE              | `APPROVAL_INVALIDATED`                         |
| Grant 变更后旧审批               | `APPROVAL_INVALIDATED`                         |
| 非 enterprise-admin 批准         | 拒绝                                           |
| 申请 API 传 seatId               | 忽略；以 session 解析为准                      |
| 批准后 invoke                    | SUCCESS + DataAudit.approvalId                 |

建议测试文件：`src/gateway/enterprise-data/approval-workflow.test.ts`
