# WP-07 — External side-effect idempotency (DESIGN)

- 状态：**DESIGNING**（设计 + helper 骨架；**未**宣称 G4-B；**未**接线 live send）
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 前置：WP-06 FIELD_MAPPING_ADR + LEDGER_FIELD_INCREMENT；WP-01 logicalActionId 合同草案
- 硬约束：不夺 Fabric execute / outbound outbox 所有权；不翻转 `ORCHESTRATION_LIVE_INVOKE`；不把 diagnosis 队列改成通用 orch 队列。

## 目标（来自 work-packages.md WP-07）

1. 每个适配器声明能力类：`read_only | idempotent_write | reconcilable_write | non_retriable_write`。
2. 动作键绑定租户 + 任务 + 逻辑步骤；retry 沿用同一键；**同键不同参数摘要拒绝**。
3. 发送前持久记录意图（复用既有 outbox/动作事实）；回执丢失 → `unknown_outcome`，按业务键/远端回执回查后再决定。
4. 无回查/远端幂等能力时暂停人工核对；补偿是独立、经授权、带幂等键的动作。

## 代码地基（只读盘点；引用路径）

| 模式 | 路径 | 与 WP-07 关系 |
| --- | --- | --- |
| Outbound delivery queue（文件 outbox + 恢复） | `src/infra/outbound/delivery-queue.ts`（`enqueueDelivery` / `recoverPendingDeliveries`；`*.delivered` 标记；MAX_RETRIES/backoff） | **首选复用面**做消息类副作用意图落盘；本切片不改其所有权 |
| Outbound send / channel adapters | `src/infra/outbound/outbound-send-service.ts`；`src/infra/outbound/channel-adapters.ts`；`src/infra/outbound/deliver.ts` | 真实发送路径；接线须经 adapter owner 审，本切片仅矩阵模板 |
| Toolkit gated executor + receipt digest | `packages/toolkit/src/gated-executor.ts`（`digest` / `idempotencyKey`）；`packages/toolkit/src/receipt.ts` | 参数摘要与回执形状可借鉴 |
| Diagnosis Da Bai delivery queue | `src/diagnosis/daibai-delivery.ts`（`createDiagnosisDaibaiDeliveryQueue`；receipt statuses；TTL/retries） | **域专用**队列；可作幂等/回执语义参考，**禁止**泛化为 orch 通用队列（ADR 非目标） |
| Diagnosis approval idempotency ledger | `src/diagnosis/approval-decide.ts`（`lookup` / `idempotency_conflict`） | 同键冲突语义参考 |
| Orch readonly path bind（dual-exec 拒绝） | `src/task-orchestration/path-binding.ts` | 单路径绑定；写路径仍等本 WP |
| Orch lease/fence（形状） | `src/task-orchestration/lease-store.ts` | 过期 worker 不得推进；外部无 fencing 时仍依赖动作幂等 |
| Provisional ledger fields | `src/progress-ledger/orch-lease-fields.ts`（`logicalActionId` / `resultRef`） | 未来事件镜像；非生产权威 |
| **本切片 helper** | `src/task-orchestration/action-idempotency.ts` | `key=hash(tenant,taskId,logicalActionId)` + 同键异参拒绝；**未**挂 send |

## 设计决定（本切片冻结）

1. **动作幂等键规范**：`idempotencyKey = sha256(tenantId \\0 taskId \\0 logicalActionId)`（见 helper）。事件可存明文 `logicalActionId` + 可选 key。
2. **参数摘要**：`paramDigest = sha256(canonical JSON params)`；registry 对同 key 不同 digest → `param_digest_conflict`。
3. **意图落盘优先复用** `infra/outbound/delivery-queue`（消息）与既有动作事实/回执面；不新建平行 outbox DB。
4. **unknown_outcome**：发送成功但回执丢失时，不得计成功、不得盲重试；先 lookup / reconcile。
5. **能力矩阵**见 `adapter-capability-matrix.md`（模板；格多为 UNKNOWN，待适配器 owner 填）。
6. **LIVE / G4-B**：保持 false / 未宣称。G4-B 依赖矩阵填实 + 故障夹具 + 生产接线证据。

## 故障夹具清单（设计级；未实现）

| 夹具 ID（provisional） | 场景 | 期望 |
| --- | --- | --- |
| `wp07.lost_ack_after_send` | 发送一次，结果丢失 | unknown_outcome；回查后单次业务效果 |
| `wp07.charged_then_timeout` | 已扣费/提交，响应丢失 | 回查远端；禁止第二扣费 |
| `wp07.lease_expired_remote_completes` | worker 租约过期后远端才完成 | 旧 fence 拒绝推进；业务键去重 |
| `wp07.same_key_param_mismatch` | 同键不同参数 | 拒绝；保留原意图 |

## 明确非目标

- 不宣称 G4-B / ACCEPTED。
- 不翻转 `ORCHESTRATION_LIVE_INVOKE`。
- 不夺 Fabric execute；不经 loopback 再入 Fabric。
- 不把 `daibai-delivery` / handoff 目录改成通用 orch 队列。
- 不假设撤销消息或退款总能成功（补偿独立动作）。

## 状态声明

- **DESIGNING** — design + skeleton helper only; **NOT G4-B**; wiring deferred to adapter owners + human GO.
