# uiStatusProjection（只读 UI 状态投影）

**版本**：2026-09-15 rev2  
**状态**：P0 规范 — **无运行时依赖**  
**关联**：[Completion Contract](/design/completion-contract)、[Bridge MVP](/design/bridge-mvp)

**命名**：使用 **uiStatusProjection** / **readModel**；**勿**与 ConversationTask **projection phase**（生产 flag `projection=OFF`）混淆。

---

## 1. 数据边界

| 规则                   | 说明                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| **UI 只读 read model** | Workbench / Progress strip **不得**直接写 Ledger、Flow、Contract                                        |
| **read model 来源**    | 服务端组装的 `UiStatusReadModel`；**不**暴露 Ledger 原始事件流给 UI                                     |
| **Flow 本地缓存**      | UI 可缓存 Flow 展示态用于离线渲染；**必须**标注 `source: "cached_flow"`，且不得显示 CT 级「任务已完成」 |
| **Contract 优先**      | 终端标签以 Contract verdict 为准；Flow/Ledger 仅为进度细节                                              |

---

## 2. ReadModel 结构

```typescript
type UiStatusReadModel = {
  contractVersion: "2026-09-15.rev2";
  primaryId: string;
  tenantId: string;
  /** 聚合态 — UI 主标签 */
  aggregateStatus: AggregateStatus;
  /** Contract 裁定（可为 null） */
  contract: {
    verdict: ContractVerdict | null;
    reasonCode: ReasonCode | null;
    evaluatedAt: string | null;
  };
  /** 只读进度摘要（非原始事件） */
  progress: {
    ledgerSummary: LedgerProgressSummary | null;
    flowSummary: FlowProgressSummary | null;
    roundSummary: RoundProgressSummary | null;
  };
  /** 冲突与降级标记 */
  flags: UiStatusFlags;
  fetchedAt: string;
};

type AggregateStatus =
  | "running"
  | "waiting"
  | "pending_evidence"
  | "needs_human"
  | "step_done" // Flow step 完成，非 CT 完成
  | "task_completed" // 仅 contract.verdict === accepted
  | "failed"
  | "cancelled"
  | "stale"
  | "blocked"
  | "unknown";
```

---

## 3. 多源冲突时的显示规则

评估顺序（**高优先级覆盖低优先级标签**）：

| 优先级 | 条件                                       | aggregateStatus      | 用户可见文案（示例）         |
| ------ | ------------------------------------------ | -------------------- | ---------------------------- |
| 1      | read model 获取失败                        | `unknown`            | 「状态暂不可用」             |
| 2      | ACL 拒绝                                   | `blocked`            | 「无权查看此任务进度」       |
| 3      | `contract.verdict === accepted`            | `task_completed`     | 「任务已完成（已验证）」     |
| 4      | `contract.verdict === cancelled`           | `cancelled`          | 「任务已取消」               |
| 5      | `contract.verdict === stale`               | `stale`              | 「进度已过期，请刷新或重试」 |
| 6      | `contract.verdict === needs_human`         | `needs_human`        | 「等待人工确认」             |
| 7      | `contract.verdict === pending`             | `pending_evidence`   | 「等待验证结果」             |
| 8      | Ledger step `failed` / `blocked`           | `failed` / `blocked` | 「执行受阻」                 |
| 9      | Flow step `done` 且 Contract 非 accepted   | `step_done`          | 「本步骤已完成」             |
| 10     | Flow `in_progress` 或 Ledger `in_progress` | `running`            | 「进行中」                   |
| 11     | 无 signal                                  | `waiting`            | 「等待中」                   |

**不变量**：Flow `done` + Ledger `in_progress` → **`step_done`**，**不得**显示「任务已完成」。

---

## 4. 特殊 verdict 展示

| ContractVerdict | UI 行为                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `pending`       | 显示 spinner + `pending_evidence`；**隐藏** success 勾                        |
| `rejected`      | 若仍有进行中的 Ledger/Flow → `failed` 或 `running`；**不**显示 task_completed |
| `stale`         | 显示 `stale` + 刷新 CTA；cached Flow 须标注过期                               |
| `cancelled`     | 冻结进度条；后台迟到事件不改变 UI（服务端 discard）                           |
| `needs_human`   | 显示决策入口（若 policy 允许）                                                |

---

## 5. 读取失败与降级

| 场景                                 | aggregateStatus       | UI                                          |
| ------------------------------------ | --------------------- | ------------------------------------------- |
| read model API 5xx / 超时            | `unknown`             | 非 success；提供重试                        |
| 仅 Flow 可读、Ledger/Contract 不可读 | `running` 或 cached   | 标签加「部分状态」；**禁止** task_completed |
| 仅 Ledger 可读                       | `running` / `blocked` | 无 Flow 细节时仍可用 strip                  |
| 全部不可读                           | `unknown`             | 隐藏百分比；保留会话                        |

**禁止**：读取失败时**猜测** completed；**禁止**用 LLM 最后一条 message 推断 success。

---

## 6. uiStatusFlags

```typescript
type UiStatusFlags = {
  partialData: boolean; // 部分源失败
  cachedFlow: boolean; // Flow 来自本地缓存
  contractLedgerConflict: boolean; // Contract 与 Ledger 摘要冲突（audit）
  staleBinding: boolean;
};
```

`contractLedgerConflict=true` 时：显示 `running` 或 `pending_evidence`，**不**显示 task_completed；上报 audit。

---

## 7. 与双轨进度的关系

| 源              | UI 角色                            |
| --------------- | ---------------------------------- |
| Progress Ledger | 执行事实摘要（步骤、blocked）      |
| CO Flow         | 协作步骤与 sub-step 可视化         |
| Contract        | **唯一** task_completed 标签来源   |
| Gateway round   | 可选角标（超时/补充），P3 前非必需 |

---

## 8. P0 完成标准（本 spec）

- [x] 冲突优先级表
- [x] 失败/降级规则
- [ ] 与 UI 实现方评审签字（纳入独立运行时 reviewer）

---

## 9. 变更记录

| 日期            | 变更                   |
| --------------- | ---------------------- |
| 2026-09-15 rev2 | 初稿（第三轮专家整改） |
