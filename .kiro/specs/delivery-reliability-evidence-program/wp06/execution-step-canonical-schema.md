# WP-06 — ExecutionStep canonical schema (frozen boundary)

- 状态：**SCHEMA_FROZEN**（文档 + validators；**非** fold 迁移；**非** G4-A；**LIVE=false**）
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 用户绑定决定：ledger 一等字段放在 **ExecutionStep**；payload 只放扩展与证据引用。
- 代码：
  - `src/progress-ledger/execution-step-canonical.ts` — `CanonicalExecutionStepFields` + assert/merge helpers
  - `src/progress-ledger/orch-lease-fields.ts` — provisional lease/fence bag（仍 additive；与 canonical 对齐）
  - 对照：`src/progress-ledger/types.ts`（既有 `ExecutionStep` **未做破坏性迁移**）

## 冻结边界

### ExecutionStep（canonical / first-class）

下列字段参与幂等、恢复、查询、统计和验收，必须是稳定的一等字段（或经 compat-read 映射到一等字段）。**不得**把它们藏在 payload 里当第二权威：

| 字段                          | 含义                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `logicalActionId`             | 业务动作身份（≠ attempt）                                |
| `taskId`                      | 任务身份                                                 |
| `stepId`                      | 步骤身份（常与 `ExecutionStep.id` 对齐）                 |
| `attemptId`                   | 一次执行尝试                                             |
| `tenantId` / `operatorId`     | 租户 / 操作者                                            |
| `executionPath`               | 执行路径（如 legacy / fabric）                           |
| `idempotencyKey`              | 动作幂等键（通常 hash(tenant, taskId, logicalActionId)） |
| `status`                      | 步骤状态（含 `unknown_outcome`，见下）                   |
| `outcome`                     | 结果摘要（非 adapter 原始响应）                          |
| `policyVersion`               | 策略版本                                                 |
| `executorVersion`             | 执行器版本                                               |
| `startedAt` / `completedAt`   | 起止时间（ms epoch 对齐既有 `*AtMs` 命名时可映射）       |
| `retryCount`                  | 重试次数（同 logicalAction 下 attempt 计数语义）         |
| `evidenceRefs`                | 证据引用列表                                             |
| `externalReceiptRefs`         | 外部回执引用列表                                         |
| `errorCode` / `unknownReason` | 失败码 / 未知结果原因                                    |

### payload（non-authority extensions only）

| 允许                              | 禁止                                 |
| --------------------------------- | ------------------------------------ |
| adapter-specific request/response | 逻辑动作身份 / 幂等键 / 权威 status  |
| provider metadata                 | 把 attemptId 只放 payload 当唯一来源 |
| redacted diagnostics              | 敏感原文（只保留脱敏引用）           |
| non-canonical extension fields    | 与 Step 字段双写双权威               |

原始 payload **必须**带内容哈希或版本引用；敏感内容只保留脱敏引用。

## 特别规定（与 WP-07 对齐）

1. **logicalActionId** = 业务动作；**attemptId** = 一次执行尝试。
2. **重试**：保持同一 `logicalActionId` + `idempotencyKey`，生成**新** `attemptId`（`retryCount` 递增）。
3. **相同幂等键 + 不同参数摘要** → **拒绝**（`action-idempotency` helper 已实现 `param_digest_conflict`）。
4. **外部结果不明确** → `status = unknown_outcome`；**不得**写成 `failed` 后自动重试。
5. **权威位置**：新增写入优先填充 ExecutionStep（canonical fields）；若现有 ledger 合同暂时只能接受 payload → **compat read** 允许从 payload 读取并映射到 canonical；**禁止**两处同时成为权威来源。

## Compat read / write-prefer-step 策略

```
read:  prefer ExecutionStep canonical fields;
       if missing, compat-read from payload (documented mapping) → treat as Step view;
       never invent a second authority.
write: new writers MUST populate CanonicalExecutionStepFields on the Step (or merge helper);
       payload may mirror redacted/adapter data only;
       do not dual-author status / idempotencyKey / logicalActionId / attemptId.
```

本切片：**不**迁移生产 fold writers（风险）；落地 schema 文档 + validators + merge helper 即足够。既有 `orch-lease-fields` 继续作为 lease/fence provisional bag；canonical 模块定义动作/尝试/幂等一等字段集。

## 与既有 `ExecutionStep`（types.ts）关系

- 既有 fold 合同字段（`id`,`planVersion`,`title`,`status`,`executed`,`verified`,…）保持不变。
- Canonical 字段以 **additive** `CanonicalExecutionStepFields` 挂载；可选未来在人审后将安全 optional 字段并入 `ExecutionStep` 类型。
- 既有 `StepStatus` 尚无 `unknown_outcome`；canonical 模块导出 `CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME = "unknown_outcome"` 与指导常量，**不**强行扩展 fold 枚举（避免破坏性迁移）。fold 接纳该 status 属后续人审切片。

## 明确非目标

- 不翻转 `ORCHESTRATION_LIVE_INVOKE`。
- 不宣称 G3-B / G4-A / G4-B。
- 不迁移 fold / writer 生产路径。
- 不让 payload 成为第二隐式数据库。

## 状态声明

- **SCHEMA_FROZEN** at ExecutionStep; payload = extensions only.
- LIVE remains **false**; no G-gate claims.
