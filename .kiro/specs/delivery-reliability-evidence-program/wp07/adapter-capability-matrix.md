# WP-07 — Adapter capability matrix (template)

- 状态：**TEMPLATE**（多数格 UNKNOWN；待适配器 owner 填实）
- 日期：2026-10-24（Asia/Shanghai）
- 说明：填实前不得宣称 G4-B。类取值：`read_only` | `idempotent_write` | `reconcilable_write` | `non_retriable_write`。

| adapter                                                                    | class                     | natural idempotency                    | lookup / reconcile             | receipt shape                                | dedupe TTL                                   | cancel / compensate  | owner / notes                         |
| -------------------------------------------------------------------------- | ------------------------- | -------------------------------------- | ------------------------------ | -------------------------------------------- | -------------------------------------------- | -------------------- | ------------------------------------- |
| orch readonly memory (`memory_search` / path-binding)                      | read_only                 | n/a（只读可重拉）                      | n/a                            | tool_result / untrustedText                  | n/a                                          | n/a                  | WP-05 pilot；无外部写                 |
| orch readonly web_read                                                     | read_only                 | n/a                                    | n/a                            | tool_result                                  | n/a                                          | n/a                  | WP-05 pilot                           |
| orch readonly skill_snapshot                                               | read_only                 | n/a                                    | n/a                            | snapshot                                     | n/a                                          | n/a                  | WP-05 pilot                           |
| outbound channel send (`src/infra/outbound/deliver.ts` + channel-adapters) | UNKNOWN                   | UNKNOWN（部分 channel 有 provider id） | UNKNOWN（需 per-channel 回查） | delivery-queue `*.delivered` + provider ack? | UNKNOWN（须 ≥ max retry+recovery+replay 窗） | UNKNOWN              | **不夺所有权**；填表须 outbound owner |
| outbound delivery-queue recovery                                           | reconcilable_write?       | 文件 id + delivered 标记               | `recoverPendingDeliveries`     | QueuedDelivery + delivered marker            | backoff/MAX_RETRIES=5                        | skipQueue on recover | 复用面候选；非业务扣费                |
| toolkit gated tool execute                                                 | UNKNOWN                   | `idempotencyKey` in context            | receipt / evidence             | `packages/toolkit/src/receipt.ts`            | UNKNOWN                                      | UNKNOWN              | Fabric/toolkit 协调                   |
| diagnosis daibai delivery queue                                            | idempotent_write?（域内） | deliveryId / signalId                  | receipt status lookup          | DiagnosisDaibaiReceipt                       | `DIAGNOSIS_DAIBAI_DELIVERY_TTL_MS`           | expired/rejected     | **域专用**；禁止泛化 orch             |
| diagnosis approval-decide                                                  | idempotent_write          | idempotencyKey ledger                  | `ports.ledger.lookup`          | approval result / conflict                   | session/process?                             | refuse on conflict   | 语义参考 only                         |
| commerce / payment webhooks                                                | UNKNOWN                   | UNKNOWN                                | UNKNOWN                        | UNKNOWN                                      | UNKNOWN                                      | UNKNOWN              | OOS until owner                       |
| email / IM provider sends                                                  | UNKNOWN                   | UNKNOWN                                | UNKNOWN                        | UNKNOWN                                      | UNKNOWN                                      | UNKNOWN              | OOS；填表前禁盲重试                   |
| custom business write adapters                                             | UNKNOWN                   | UNKNOWN                                | UNKNOWN                        | UNKNOWN                                      | UNKNOWN                                      | UNKNOWN              | 新适配器准入门槛                      |

## 填表规则

1. `non_retriable_write`：无远端幂等且无可靠回查 → 默认人工闸；禁止自动 retry。
2. `reconcilable_write`：必须写清 lookup API / 业务键 / 成功判定。
3. `idempotent_write`：必须写清天然键（provider idempotency key 或等价）与 TTL。
4. `read_only`：可重试；仍建议带 `logicalActionId` 便于观测，不计业务副作用。
5. Dedupe TTL ≥ max(重试窗, 恢复窗, 消息重投窗)。

## 状态声明

- Template only — **NOT G4-B**. Empty/UNKNOWN cells are blockers for acceptance.
