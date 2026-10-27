# ADR：存储复用（WP-00）

- 状态：Proposed（E0）
- 日期：2026-10-24（Asia/Shanghai）
- HEAD：`c0c0ba52b0b2460a1e3e2fa9bbf7b889355dd07d`
- 作者：grokbot-verifiable-delivery

## 背景

可靠性工作需要任务事实、交接事务、动作幂等、租约/fencing 与未知结果核对。计划禁止先建平行数据库。当前代码已有多套持久化面，能力不齐。

## 已观察的可复用存储面（E0）

| 面              | 位置                                                         | 已见能力                                               | 缺口                                        |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------- |
| 交接事实        | `handoffsDir` 下 `*.txn` + task log（`handoff-contract.ts`） | 事务文件、roll-forward、锁 `withRoundLock`             | `recoverPendingHandoffTxns` 未挂启动路径    |
| 外发队列        | `src/infra/outbound/delivery-queue.ts`                       | `recoverPendingDeliveries` 已在 `server.impl` 启动调用 | 与 handoff 恢复分离；不可混用语义           |
| Fabric 审计     | `createFabricAuditStore` 注入 Gateway                        | 进程内容量审计                                         | 非跨进程权威账本                            |
| completion-hold | `execution-preflight/completion-hold.ts`                     | 收据/hold                                              | 注释指向 in-memory；不可当跨重启权威        |
| 编排            | `src/task-orchestration/*` ledger/bridge                     | 观测与只读 invoke                                      | live invoke 冻结；未见生产租约/fencing 实体 |
| 进化/效果       | evolution-control / governance stores                        | 实验绑定、效果核验接口                                 | 内存 store 工厂 ≠ 生产持久化证明            |
| 正式交付目录    | formal-deliverable-root / knowledge deliverables             | 产物落盘与 settle                                      | 与任务结果信封需 WP-01 对齐                 |

## 决定

1. **优先增量复用**：交接恢复（WP-02）继续使用 `handoffsDir` txn/log + 既有 `rollForwardTask`，只补启动/维护接线，不新建 handoff 库。
2. **结果信封（WP-01）** 映射既有 turn-completion / task-surface / deliverable / handoff 事实；新增字段兼容扩展，不平行“第二完成账本”。
3. **编排持久恢复（WP-06）** 先盘点是否可挂到既有 job/task/队列实体；若缺租约/fencing 字段，在既有实体上增量，禁止平行 orchestration DB。`ORCHESTRATION_LIVE_INVOKE` 保持 false。
4. **幂等与核对（WP-07）** 优先复用 outbound 队列意图/回执模式与动作事实；无回查能力的写适配器转人工，不发明全局 exactly-once 存储。
5. **constitutional（WP-08）** 不新增任务完成状态库；约束证据包装既有凭证/回执。

## 后果

- 短期：WP-02 切片最小、可验证。
- 中期：WP-06 可能暴露实体模型不足 → 以迁移/字段增量处理，仍不平行建库。
- 风险：误把 in-memory audit/hold 当持久化 → 验收必须含重启夹具。

## 非目标

新建全局事件总线、第二策略决策库、独立 constitutional 任务账本、或为影子比较落业务写库。
