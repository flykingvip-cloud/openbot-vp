# WP-06 编排持久恢复与租约 — 设计（现有存储增量）

- 状态：**DESIGN**（**不解除** `ORCHESTRATION_LIVE_INVOKE`；本轮无 runtime 代码）
- 日期：2026-10-24（Asia/Shanghai）
- HEAD（撰写时）：`2df36a55748f891d6eb05ad067318bc8783fd794`
- 作者：grokbot-verifiable-delivery
- 前置：阅读 WP-00 `wp00/storage-reuse-adr.md`（禁止平行 orchestration DB）。

## 1. 冻结事实

| 项 | 代码 | 含义 |
| --- | --- | --- |
| `ORCHESTRATION_LIVE_INVOKE` | `src/task-orchestration/types.ts` L22：`false` | 不可在本设计轮翻转为 true |
| Live dispatch | `considerDispatch`（`dispatch.ts`）：若 LIVE 为 true 反而 fail-closed；常态 `invokedTool: false` | 生产不经此路径 invoke |
| Readonly invoke | `invokeReadonlySurface` / `isReadonlyInvokeEnabled`（默认 ON，`feature.ts`） | 可调 memory/web/skill；**不写** Progress Ledger |
| `OrchestratorJob` | `types.ts` L94–102 | **内存形状**；注释写明 P4.5 never materializes on live path；status∈shadow|queued|dormant |
| Feature flags | `ORCHESTRATION_ENV` 默认 off（shadow/dispatch/node/browser） | 与 LIVE 常量正交 |

## 2. 逻辑模型需求 vs 现有实体映射

WP 要求至少：job / step / action / attempt、依赖、checkpoint、lease holder、fencing token、heartbeat、deadline、cancel、budget、result refs。

| 逻辑概念 | 现有实体 / 面 | 缺口 |
| --- | --- | --- |
| job | `OrchestratorJob`（内存，未持久化） | 无跨进程存储 |
| step | Progress Ledger `ExecutionStep`（`src/progress-ledger/types.ts`）；orch `stepId` 字段 | Ledger 写桥在 live 路径刻意关闭（`ledger-bridge.ts` 校验/意图，非生产 writer 宣称） |
| action | WP-01 结果信封逻辑动作（草案）；工具名+参数摘要 | 需与 action 幂等键对齐（WP-07） |
| attempt | **编排面未见一等 attempt 实体**；conversation-task 有 `attemptReopen`（控制面重开，非 step attempt） | 需在既有 step/事件上增量 attempt 序号，禁止新 DB |
| 依赖 / checkpoint | Ledger events / fold；complex-task-loop 内存步骤 | 跨重启 checkpoint **UNKNOWN/弱** |
| lease holder | **编排面无**；可类比 `withRoundLock`（handoff `round-store-io`）、delivery-queue 文件认领、memory Stage D fencing（`item7-stage-d-*`，**另一子系统**） | 不可把 memory fencing 直接当 orch 租约；可 **借鉴 CAS 语义** 增量到选中存储 |
| fencing token | 同上；memory handle `fencingToken` | orch 无 |
| heartbeat / deadline | ConversationTask 类型含 `deadlineAtMs` 等（`conversation-task/types.ts`）；orch job 无 heartbeat | 需映射到 task/job 持久字段 |
| cancel | conversation-task cancel 路径存在（多文件）；orch dispatch 无取消传播实现宣称 | 设计：沿父子 task 传取消，重启不丢 |
| budget | Fabric `costLimit`；context budgets；orch 无统一 remaining budget 实体 | 增量字段挂 job/task；重启不重置 |
| result refs | readonly `untrustedText`；deliverable / handoff 事实；WP-01 信封 | 统一引用，不平行完成账本 |

## 3. 存储复用决定（设计）

延续 WP-00 ADR：

1. **不新建** orchestration SQLite/Postgres。
2. **优先增量字段**到：
   - 若只读试点继续走 conversation-task + progress-ledger 事件：在 **既有 ledger event / step 记录** 上增加 `attempt`, `leaseHolder`, `fence`, `heartbeatAt`, `deadlineAt`, `cancelRequested`, `budgetRemaining`, `resultRef`（字段名最终以迁移 ADR 为准）。
   - 文件型协作锁：handoff `withRoundLock` 仅作「单任务互斥」参考，**不**把 handoff 目录改成通用 orch 队列。
   - outbound `delivery-queue`：仅外发意图；不混用为 orch step 队列。
3. memory Stage D persistent fencing：**参考实现**，不跨域复用其 store 文件为 orch 权威租约（避免记忆同步与编排耦死）。
4. Fabric `createFabricAuditStore`：进程内容量环形缓冲 → **不可**当跨重启租约权威。

## 4. 租约 / fencing 行为提案（仍冻结 live invoke）

在 **未来** 允许受限调度之前（非本轮），语义应为：

1. 调度/提交 step 必须持有未过期 lease + 匹配 fencing token。
2. 过期 worker 的结果提交 → 拒绝推进（可记 `stale_fencing_token` 类原因码；类比 memory Stage D）。
3. heartbeat 刷新不得延长超过总 deadline；取消请求置位后新 lease 不得发放。
4. **在 `ORCHESTRATION_LIVE_INVOKE===false` 期间：** 只实现「持久化形状 + 只读恢复演练夹具」，调度器仍 fail-closed；避免「半开写入」。

Readonly invoke 行为保持：可执行 memory/web/skill 适配；`invokedTool` 真时仍 **不** 写 Progress Ledger（现注释）；设计不得偷偷打开 ledger 写来「证明恢复」。

## 5. Kill / restart 夹具计划（命名级）

对齐 G4-A，本轮只定场景名与期望，不造假指标：

| 夹具 ID | 杀点 | 期望（设计） |
| --- | --- | --- |
| `orch.kill.before-schedule` | job 已持久、尚未选 worker | 重启后可被新 holder 租约调度；无双 holder |
| `orch.kill.after-schedule` | lease 已授，exec 未开始 | 租约超时后 fencing 递增；旧 holder 提交被拒 |
| `orch.kill.before-exec` | 即将调用 readonly/tool 前 | 恢复后同一 action 幂等键不双执行（写操作还必须 WP-07） |
| `orch.kill.after-exec` | 工具已返回，结果未持久 | 结果进 `unknown_outcome` 或重查；只读可重拉；写操作禁盲重试 |
| `orch.kill.before-result-persist` | 持久化中崩溃 | 重启收敛到单一终态；无永久悬挂 step |
| `orch.kill.after-result-persist` | 已落库未投影 | 投影/只读恢复收敛；重复 recover 无二次业务效果 |

夹具存储必须用真实持久面（ledger 文件/既有 task store），禁止只测 in-memory `OrchestratorJob`。

## 6. 增量落地顺序（后续轮，非本轮）

1. 文档化字段映射表 + 与 WP-01 信封对齐。
2. 选一个 **只读** 有限步骤工作流（例如 memory→web_read→acceptance check 名），planner 行为保持冻结。
3. 持久化 job/step/attempt 最小字段 + lease/fence（仍 LIVE=false，调度器不武装）。
4. 跑 kill/restart 夹具证据包。
5. **禁止**本设计直接授权打开 `ORCHESTRATION_LIVE_INVOKE`。

## 7. 状态声明

- 状态：**DESIGN**。
- 无 runtime 代码；live invoke 仍 false；无 G4-A。
- 关键结论：编排面今日 **无** 生产租约/fencing 实体；`OrchestratorJob` 仅为未来形状；恢复能力需挂既有 ledger/task 存储增量，并借鉴（而非挪用）handoff lock / memory fencing 语义。
