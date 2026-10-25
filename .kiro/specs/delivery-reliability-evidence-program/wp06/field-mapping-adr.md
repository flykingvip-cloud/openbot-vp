# ADR：WP-06 字段映射（既有面增量，无新编排库）

- 状态：**Accepted（设计）/ FIELD_MAPPING_ADR**
- 日期：2026-10-24（Asia/Shanghai）
- HEAD（撰写时）：`0986670a52b266f5889c825819b1b37f49dfbbb8`
- 作者：grokbot-verifiable-delivery
- 前置：
  - WP-00 `wp00/storage-reuse-adr.md`（禁止平行 orchestration DB）
  - WP-06 `wp06/orchestration-persistence-lease-design.md` §6 step 1
  - WP-01 `wp01/result-evidence-contract-draft.md`（结果信封草案）
- 代码对照（只读）：
  - `src/task-orchestration/types.ts` — `OrchestratorJob`；`ORCHESTRATION_LIVE_INVOKE = false`
  - `src/task-orchestration/lease-store.ts` — `OrchLeaseRecord` 形状
  - `src/progress-ledger/types.ts` — `ExecutionStep` / `ExecutionEvent`
  - `src/conversation-task/types.ts` — `ConversationTask.deadlineAtMs`；lifecycle `cancelled`

## 决定

1. **不新建** orchestration SQLite / Postgres / 平行事件库。
2. **生产权威**落在既有两面的**增量字段**上（字段名下表为 provisional，迁移落地前可微调）：
   - **Progress Ledger**：step / event 级执行事实（attempt、lease、fence、heartbeat、resultRef、budget 等）。
   - **ConversationTask**：任务身份级 deadline / cancel 语义（已有 `deadlineAtMs` + lifecycle `cancelled`）；**不**把 lease/fence/step 运行态塞进 ConversationTask（CT-NO-EXEC-STATE）。
3. **编排面 `lease-store` / `OrchestratorJob`**：继续作为 **形状 + 演练夹具**（可注入 `rootDir` 文件 JSON），**不是**生产跨重启权威；未来由 ledger/task 增量承载权威后，lease-store 可作适配层或测试双写，不得单独宣称 G4-A。
4. **WP-01 结果信封对齐**：编排侧 `resultRef` 与信封的 `logicalActionId` / attempt / deliverable 引用同一逻辑动作幂等键空间；禁止第二完成账本。
5. **本 ADR 不授权**打开 `ORCHESTRATION_LIVE_INVOKE`，不宣称 G4-A，不实施 runtime 迁移。

## 字段映射表

| 逻辑概念 | 现有实体 / 面 | 拟议增量字段（provisional） | 存储所有者 | 备注 |
| --- | --- | --- | --- | --- |
| job | `OrchestratorJob`（内存；`jobId`/`taskId`/`stepId`/`surface`/`nodeId?`/`status`） | （无新生产表）未来可在 ledger fold 或 task 投影用 `taskId`+`stepId` 合成 job 键 | 编排面形状 only → 权威归 Ledger/Task | P4.5 注释：live 路径不物化；禁止平行 job DB |
| step | Progress Ledger `ExecutionStep`（`id`,`status`,`evidence`,…） | （主键已有）可选 `orchJobStepId?` 若需与 `OrchLeaseRecord.jobStepId` 对齐 | Progress Ledger | orch `stepId` 已指向 ledger step |
| action（逻辑动作） | WP-01 信封 `logicalActionId`；工具名+参数摘要 | 事件 payload：`logicalActionId`；幂等键见下 | Progress Ledger event + WP-01 信封 | ≠ attempt；写路径仍依赖 WP-07 |
| attempt | Ledger **无一等 attempt**；lease `attempt?`；conversation-task 有控制面 `attemptReopen`（非 step attempt） | `ExecutionStep.attempt` **或** `ExecutionEvent.payload.attempt`（单调整数） | Progress Ledger | 禁止新 attempt 表；控制面 reopen ≠ step attempt |
| 依赖 / checkpoint | Ledger events / fold；complex-task-loop 内存 | 复用事件序 + `planVersion`；可选 event `checkpointRef?` | Progress Ledger | 跨重启以事件 fold 为准，不新建 checkpoint 库 |
| lease holder | `OrchLeaseRecord.leaseHolder`（夹具/形状） | `ExecutionStep.leaseHolder` **或** STEP_* 事件 payload `leaseHolder` | Progress Ledger（生产）；lease-store（演练） | 借鉴 memory Stage D CAS **语义**；不复用其 store 文件 |
| fencing token | `OrchLeaseRecord.fencingToken` | `ExecutionStep.fencingToken` **或** payload `fencingToken`（单调） | Progress Ledger（生产）；lease-store（演练） | 过期 worker 提交 → `stale_fencing_token` |
| heartbeat | `OrchLeaseRecord.heartbeatAt` | `ExecutionStep.heartbeatAtMs` **或** payload | Progress Ledger | heartbeat **不得**延长总 deadline |
| deadline | ConversationTask `deadlineAtMs?`；lease `deadlineAt` | Task 级：已有 `deadlineAtMs`；Step/lease 级：`deadlineAtMs` on step/event | ConversationTask（任务总限）+ Progress Ledger（step lease 限） | 任务 deadline 与 lease TTL 分层；heartbeat 封顶于 step deadline |
| cancel | ConversationTask lifecycle `cancelled`；lease `cancelRequested`；cancel-path 多文件 | Task：lifecycle / 既有 cancel 路径；Step：`cancelRequested` on step 或 GATE 事件 | ConversationTask + Progress Ledger | 取消后不得发放新 lease；沿父子 task 传播（设计，未实现） |
| budget | Fabric `costLimit`；context budgets；lease `budgetRemaining?` | `budgetRemaining` on step/job 投影字段（事件驱动更新） | Progress Ledger（step）/ 既有 fabric 面（策略） | 重启不重置已消耗；不新建 budget DB |
| result refs | lease `resultRef?`；readonly `untrustedText`；deliverable / handoff | `resultRef` → 指向 WP-01 信封或 deliverableId+contentHash / externalReceiptRef | Progress Ledger + WP-01 信封 / deliverable | 统一引用；不平行完成账本 |
| action 幂等键 | WP-01 `logicalActionId`（+ tenant/task） | 建议规范键：`idempotencyKey = hash(tenant, taskId, logicalActionId)`；事件可存明文 `logicalActionId` + 可选 `idempotencyKey` | WP-01 信封权威；Ledger 事件镜像 | 只读可重拉；写操作禁盲重试（WP-07） |
| LIVE 开关 | `ORCHESTRATION_LIVE_INVOKE === false` | **不变** | `types.ts` 常量 | 本 ADR / 本切片禁止翻转 |

## lease-store ↔ 未来 ledger/task 字段对照

| `OrchLeaseRecord`（现形状） | 未来权威面（provisional 名） | 方向 |
| --- | --- | --- |
| `jobStepId` | `ExecutionStep.id` 或显式 `orchJobStepId`；合成自 `taskId`+`stepId` | lease → ledger step 键 |
| `leaseHolder` | `ExecutionStep.leaseHolder` / event payload | 镜像 |
| `fencingToken` | `ExecutionStep.fencingToken` / event payload | 镜像（单调） |
| `heartbeatAt` | `ExecutionStep.heartbeatAtMs` | 镜像 |
| `deadlineAt` | step `deadlineAtMs`；任务总限仍用 `ConversationTask.deadlineAtMs` | 分层 |
| `cancelRequested` | step 标志或 GATE；任务终态用 lifecycle `cancelled` | 分层 |
| `attempt` | `ExecutionStep.attempt` / event `payload.attempt` | 镜像 |
| `budgetRemaining` | step/job 投影字段 | 镜像 |
| `resultRef` | step/event `resultRef` → WP-01 信封 / deliverable / receipt | 对齐信封，非第二账本 |

`OrchestratorJob`（`jobId`,`taskId`,`stepId`,`surface`,`nodeId?`,`status`）保持内存/shadow 形状；`nodeId` **永不**写入 `conversation_tasks`（A1 / CT2）。

## 与 WP-01 结果信封对齐

| WP-01 信封字段（草案） | 编排 / ledger 落点 |
| --- | --- |
| `taskId` | ConversationTask.id；Ledger `taskId`；job.taskId |
| `logicalActionId` | 事件 payload；构成 action 幂等键 |
| `runId` / `attemptId` | ↔ `attempt`（step/event）；lease `attempt` |
| `deliverableId` + `contentHash` | ↔ `resultRef`（或 resultRef 解析目标） |
| `externalReceiptRef` | ↔ `resultRef` / evidence `receiptId` |
| `terminalStatus`（含 `unknown_outcome`） | Ledger step status + 信封；kill-after-exec → unknown，不得计成功 |
| `cost` | ↔ `budgetRemaining` 消耗轨迹（事件） |
| `handoffId?` / `recoveryRolledForward?` | 交接面（WP-02）；编排恢复不创造新业务动作 |

只读 invoke（`invokeReadonlySurface`）即使 `invokedTool: true` 也 **不得** 为「证明恢复」而写 Progress Ledger（现注释与设计 §4）。恢复演练写权威存储须另开、显式、且仍保持 LIVE=false。

## 明确非目标

- **不**翻转 `ORCHESTRATION_LIVE_INVOKE`；不武装生产调度器。
- **不**宣称 G4-A / ACCEPTED（文件背 kill harness ≠ 生产 ledger 证据包）。
- **不**把 memory Stage D persistent fencing store 文件当 orch 租约权威（可借鉴 CAS 语义）。
- **不**从 readonly invoke 路径写 Progress Ledger。
- **不**新建 orchestration DB / 第二完成账本 / 把 handoff 目录或 outbound delivery-queue 改成通用 orch 队列。
- **不**把 lease/fence/step 运行态写入 ConversationTask（违反 CT-NO-EXEC-STATE）。
- **不**在本切片实施 ledger schema 迁移或 WP-07 写适配器。

## 后果

- 短期：字段名与所有者冻结为设计合同；lease-store 与未来 ledger 列可 1:1 对照，避免平行语义漂移。
- 中期：下一刀在「只读有限步骤工作流」或「ledger 事件扩展」二选一（见下）；仍 LIVE=false。
- 风险：误把夹具 `rootDir` JSON 当生产权威 → 验收必须最终挂 ledger/task 重启证据。

## 下一切片建议（不实现）

**推荐优先（已落地选型+最小 pilot）：只读有限步骤工作流 — 见 `wp06/readonly-multistep-pilot.md`（仍不写生产 ledger）。**

1. ~~**Readonly multi-step workflow pick（推荐下一刀）**~~ → **已落地**（`READONLY_MULTISTEP_PICK+PILOT`）。  
   - 冻结：`memory → web_read → acceptance check`（名级；对齐 WP-05/§6.2）。  
   - Planner / LIVE 保持冻结；用既有 `considerReadonlyInvoke` / `invokeReadonlySurface` + path bind（经注入 mock）。  
   - 目的：在真实只读路径形状上验证 jobStep 键、attempt、resultRef、lease key 命名是否够用。

2. **备选 / 下一步延期：Ledger event extension（设计→最小类型/payload 草案）**  
   - 仅当（1）证明只读工作流需要跨重启权威且（2）人审同意增量 `ExecutionEventPayload` / `ExecutionStep` 字段时。  
   - 仍禁止 LIVE unlock；禁止从 readonly invoke 自动写 ledger。

本 ADR 正文仍不实施 runtime 迁移；只读多步 pilot 见独立切片文档与 helper。


## 用户绑定冻结（2026-10-24）：ExecutionStep canonical

**权威位置冻结为 ExecutionStep（一等字段）**；payload 仅扩展 / 脱敏诊断 / adapter 元数据。详见 `wp06/execution-step-canonical-schema.md`。

### Canonical Step 字段（first-class）

`logicalActionId`, `taskId`, `stepId`, `attemptId`, `tenantId`/`operatorId`, `executionPath`, `idempotencyKey`, `status`, `outcome`, `policyVersion`, `executorVersion`, `startedAt`/`completedAt`, `retryCount`, `evidenceRefs`, `externalReceiptRefs`, `errorCode`/`unknownReason`

### payload（non-authority）

adapter request/response、provider metadata、redacted diagnostics、non-canonical extensions。原始 payload 必须带内容哈希或版本引用。

### 规则

- 重试：同一 `logicalActionId` + `idempotencyKey`，新 `attemptId`
- 同幂等键不同参数摘要 → 拒绝
- 外部结果不明 → `status = unknown_outcome`（禁止 failed 后自动重试）
- **compat read** 允许从 payload 回填缺失 Step 字段；**新写入优先 Step**；禁止双权威

代码：`src/progress-ledger/execution-step-canonical.ts`（validators + merge/compat-read；**未**迁移 fold）。

本 ADR 原「step **或** event payload」provisional 表述，对 **身份/状态/幂等** 字段以上述冻结为准（lease/fence 等仍见 `orch-lease-fields`）。

## 状态声明

- 状态：**FIELD_MAPPING_ADR**（2026-10-24）；后续切片已落 **READONLY_MULTISTEP_PICK+PILOT**；**ExecutionStep canonical 边界已冻结**（见 `execution-step-canonical-schema.md`）。
- 文档：`wp06/field-mapping-adr.md`（本文件）；设计文与 `tasks.md` 回指。
- 本 ADR 切片无运行时迁移；`OrchLeaseRecord` 仍为形状合同。
