# OpenBot Collaboration Production Runtime Contract v1.0

Date: 2026-08-21

Status: **P0 一等公民合同 · v1.0 基线已签 · 2026-08-22 实现未通过生产验收，禁止部署**。决定：[生产验收决定](/design/collaboration-csc-production-acceptance-2026-08-22)。

Audience: Gateway / Orchestrator 实现、测试、运维

Parent: [协作运行协议 v1.0 执行方案](/design/collaboration-runtime-protocol-v1-execution-2026-08-21)

Context: [CSC v1.1 补充](/design/context-scope-controller-v1-supplement-2026-08-21) — 上下文获取权；不改本合同的发言闸门。

Storage: 群 Round 落 C5 `runtime/rounds/`；不写 host `spaces`；不写 L3 个人热会话。见 C5 路径锁（`managed-collaboration-c5-path-lock-2026-08-20`，未进树）。

---

## 0. 合同目的

执行方案已经把「谁应该说话」变成运行时规则。本文件只补生产调度内核还缺的一层：

> Policy Snapshot · State Persistence · Event Idempotency · Dispatch Idempotency · Cancel / Recovery · Task-aware Timeout

一句话：

> Policy 管规则，Engine 管选择，State Machine 管时序，LLM 管内容，Ledger 管事实。

不新增协作产品规则。Prompt 不替代本合同。Growth 不实时改本轮调度。

三层职责锁死：

| 层                  | 决定什么                                |
| ------------------- | --------------------------------------- |
| Round State Machine | **能不能说**（dispatch 闸门）           |
| Engine              | **谁值得说**（assignment / cheap gate） |
| Bot Prompt          | **说什么、怎么说**                      |

---

## 1. 六项条款（必须全部满足才算 P0 完成）

| #   | 条款                 | 一句话                                                |
| --- | -------------------- | ----------------------------------------------------- |
| C1  | Policy Snapshot      | Round 创建时冻结 Policy；本轮禁止热切换               |
| C2  | State Persistence    | 当前状态可重启恢复，不是内存 `transition()`           |
| C3  | Event Idempotency    | 同一 `eventId` 只应用一次                             |
| C4  | Dispatch Idempotency | 同一 `roundId + dispatchId` 只产生一次有效执行        |
| C5  | Cancel / Recovery    | Stop、abort、Gateway 重启有确定语义                   |
| C6  | Task-aware Timeout   | 超时按 `taskType × inboundDepth` 取预算，不是全局 15s |

---

## 2. C1 Policy Snapshot

```text
ROUND_CREATED
  → resolve Platform + Group 白名单
  → freeze policySnapshot + policyVersion
  → 本轮只读 snapshot
```

```ts
interface PolicySnapshotMeta {
  policyVersion: "1.0";
  policyHash: string; // canonical JSON sha256
  snapshotAt: number;
  groupPolicySource: "platform_default" | "group_overlay";
}
```

规则：

1. `PersistedRound.policySnapshot` 是本轮唯一 Policy 输入。
2. 小组管理员在 Round 进行中改阈值、开关、timeout：**不影响本轮**。
3. Ledger / Event 必须带 `policyVersion` + `policyHash`，否则调度不可复现。
4. 1:1 退化 Round 同样 snapshot（合成后的助手 Policy）。

禁止：Engine 再读 `operating-state.collaborationPolicy` 的 live 对象。

---

## 3. C2 持久化模型

内存 `RoundContext` 只是工作副本。权威是 `PersistedRound`。

```ts
type RoundOccupancy = "none" | "executing";

type RoundState =
  | "ROUND_CREATED"
  | "CLASSIFYING"
  | "MENTION_UNMATCHED"
  | "PRIMARY_ASSIGNED"
  | "PRIMARY_QUEUE"
  | "WAITING_PRIMARY"
  | "PRIMARY_RESPONDING"
  | "PRIMARY_COMPLETED"
  | "PRIMARY_TIMEOUT"
  | "FALLBACK"
  | "SUPPLEMENT_WINDOW"
  | "SUPPLEMENTING"
  | "CONVERGENCE_CHECK"
  | "OPTIONAL_CLOSE"
  | "ROUND_COMPLETE"
  | "ROUND_ABORTED";

type PrimaryMode = "single" | "explicit_multi";
type MentionMode = "none" | "single_primary" | "explicit_multi";

interface PersistedRound {
  roundId: string;
  groupId: string | null;
  sessionKey: string;
  userMessageId: string;
  tenantId?: string | null;

  collaborationMode:
    | "single_owner"
    | "lead_plus_supplement"
    | "explicit_multi"
    | "debate"
    | "brainstorm"
    | "multi_executor";

  policyVersion: string;
  policyHash: string;
  policySnapshot: CollaborationPolicyV1;

  state: RoundState;
  occupancy: RoundOccupancy;
  stateVersion: number;

  primaryMode: PrimaryMode;
  mentionMode: MentionMode;
  primaryAgentId?: string; // 当前 cursor 对应成员；队列语义以 primaryQueue 为准
  primaryQueue: string[];
  primaryCursor: number;

  createdAt: number;
  updatedAt: number;
  deadlineAt?: number;
  placeholderDeadlineAt?: number;

  currentDispatchId?: string;
  completedDispatchIds: string[];

  abortRequested: boolean;
  abortReason?: "user_stop" | "mention_unmatched_expired" | "fatal" | "superseded";

  lastEventId?: string;
  lastEventSeq: number;

  retryCount: number;
  completion?: PrimaryCompletionContract;
}

interface PrimaryCompletionContract {
  responseStatus: "streaming" | "complete" | "placeholder" | "failed" | "aborted";
  hasConclusion: boolean;
  /** P0 heuristic；P1 可改为 runner_metadata，字段不得改名 */
  source: "heuristic" | "runner_metadata";
}
```

### 3.1 磁盘位置（Managed）

```text
tenants/<tenantId>/collaboration/groups/<encodedGroupId>/runtime/rounds/
  <roundId>.json              # PersistedRound 当前快照（覆盖写 + stateVersion CAS）
  <roundId>.events.jsonl      # Runtime Event Log（只追加）
```

Personal Local：落到该组既有 collaboration workspace 的同等 `runtime/rounds/`，禁止写 L3 `state/agents/*/sessions/`。

1:1 助手 P0：可只持久化到进程内 Map **加上** abort 句柄；Gateway 重启后未完成的 1:1 round **ABORT**（用户可重发）。群 Round **必须**落盘。

### 3.2 CAS

写快照必须带 `expectedStateVersion`。冲突 → 拒绝本次 transition，读回权威再决定：重放 event（若 event 已提交）或丢弃重复命令。

`stateVersion` 每次成功 transition +1。Event `sequence` 与之对齐（`sequence === stateVersion`）。

### 3.3 与 Ledger 分离

| 存储                 | 用途                               | 形态                        |
| -------------------- | ---------------------------------- | --------------------------- |
| `PersistedRound`     | 现在处于哪一态                     | 单文件覆盖                  |
| Runtime Event Log    | 如何到达该态                       | append-only jsonl           |
| Collaboration Ledger | 业务结果（谁答了、是否重复、时延） | 现有 `collaboration-ledger` |

Ledger ≠ Event Log。禁止只用 Ledger 恢复状态。

---

## 4. C3 Runtime Event Log 与事件幂等

```ts
interface RoundRuntimeEvent {
  eventId: string; // ulid / uuid，调用方生成或 Gateway 生成后回传
  roundId: string;
  sequence: number;
  timestamp: number;
  type: RoundEventType;
  previousState: RoundState;
  nextState: RoundState;
  dispatchId?: string;
  agentId?: string;
  payload?: Record<string, unknown>;
}

type RoundEventType =
  | "ROUND_CREATED"
  | "POLICY_SNAPSHOTTED"
  | "CLASSIFIED"
  | "MENTION_UNMATCHED"
  | "MENTION_UNMATCHED_RESOLVED"
  | "PRIMARY_ASSIGNED"
  | "PRIMARY_QUEUE_ENTERED"
  | "PRIMARY_STARTED"
  | "PRIMARY_STREAMING" // 可降采样，不强制每 token
  | "PRIMARY_COMPLETED"
  | "PRIMARY_TIMEOUT"
  | "FALLBACK_STARTED"
  | "FALLBACK_COMPLETED"
  | "SUPPLEMENT_WINDOW_OPENED"
  | "CANDIDATE_DROPPED"
  | "SUPPLEMENT_DISPATCHED"
  | "SUPPLEMENT_COMPLETED"
  | "CONVERGENCE_CHECKED"
  | "CLOSE_STARTED"
  | "ROUND_COMPLETED"
  | "ROUND_ABORTED"
  | "DISPATCH_RETRY_SKIPPED"; // 幂等命中
```

幂等：

1. 同一 `roundId + eventId` 第二次 `apply` → `DISPATCH_RETRY_SKIPPED` 语义，**不**再次 `transition`。
2. 非法 `previousState !== persisted.state` → 拒绝，不静默改状态。
3. `sequence` 必须是 `lastEventSeq + 1`。缺口或回退 → 拒绝。

UI 丢包：重放 **已提交** 的 `PRIMARY_COMPLETED` / `ROUND_COMPLETED` 广播，不得因此重新跑 LLM。

---

## 5. C4 Dispatch 幂等

```ts
interface RoundDispatch {
  dispatchId: string;
  roundId: string;
  agentId: string;
  role: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
  attempt: number; // 同一语义任务从 0 起；重试沿用同一 dispatchId
  status: "accepted" | "running" | "completed" | "failed" | "cancelled" | "skipped_duplicate";
  createdAt: number;
}
```

不变量：

```text
UNIQUE (roundId, dispatchId)
→ 至多一次有效 LLM 执行
```

规则：

1. 创建子 run 前必须先 `acceptDispatch(dispatchId)`。
2. 已 `running` / `completed` 的同一 `dispatchId`：禁止再 `runGroupBotDiscussionTurn`。
3. Gateway 重启后若 dispatch `running` 且进程已死：标 `failed`，由 Recovery 决定是否 **新** `dispatchId`（fallback）还是 abort。**禁止**用旧 dispatchId 再拉起第二次模型调用，除非能证明第一次从未开始（无 token、无 transcript 行）。
4. Cheap Gate `DROP` 不创建 dispatch；只写 `CANDIDATE_DROPPED`。

---

## 6. C5 Cancel / Recovery

### 6.1 用户 Stop

1. 设 `abortRequested=true`，`abortReason=user_stop`。
2. abort 当前 `currentDispatchId` 的 `AbortController`（已有 `chat.send` abort 路径）。
3. 状态 → `ROUND_ABORTED`。
4. 不得再打开 SUPPLEMENT_WINDOW。
5. Event `ROUND_ABORTED` + Ledger `finalState=aborted`。

### 6.2 MENTION_UNMATCHED：阻塞态，不是执行态

此时 **没有 Bot 在工作**。它是等待用户纠正的阻塞记录，不是挂起的执行任务。

| 行为           | 要求                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| occupancy      | `none`                                                                                                        |
| Agent Run      | 禁止创建                                                                                                      |
| Bot 并发槽     | 不占用                                                                                                        |
| 自动主答       | 禁止                                                                                                          |
| UI             | 立即 `mention_unmatched` 告警                                                                                 |
| Gateway 进程   | **不得**为等待 60s 而占用 in-flight execution；只写 PersistedRound + TTL，由下一条用户消息或后台 sweeper 收口 |
| 用户下一条消息 | 本 Round `abortReason=superseded`，**新 Round** 重新 CLASSIFYING                                              |
| TTL            | `deadlineAt = createdAt + 60s`；到期 `ROUND_ABORTED`，不静默改派协调者                                        |

60 秒只是 TTL，**不**等于 Gateway 一直跑着一个执行任务。

### 6.3 Gateway 重启恢复表

| 重启时状态                                                 | 动作                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ROUND_CREATED` / `CLASSIFYING`                            | `ROUND_ABORTED`（信息不完整）                                                               |
| `MENTION_UNMATCHED`                                        | occupancy=none；未过 TTL 则保持磁盘记录；过期 abort；**不**恢复执行槽                       |
| `PRIMARY_QUEUE` / `WAITING_PRIMARY` / `PRIMARY_RESPONDING` | 若 `abortRequested` → abort；若过 `deadlineAt` → `PRIMARY_TIMEOUT`；否则 **不自动重跑 LLM** |
| `PRIMARY_TIMEOUT` / `FALLBACK`                             | 继续 fallback（新 dispatchId）或 abort                                                      |
| `PRIMARY_COMPLETED` / `SUPPLEMENT_WINDOW`                  | 从 snapshot 重跑 Cheap Gate（无 LLM）后按结果 dispatch **未完成** 的 supplement             |
| `SUPPLEMENTING`                                            | 当前 dispatch 视为 failed；不重复同一 dispatchId                                            |
| `CONVERGENCE_CHECK` / `OPTIONAL_CLOSE`                     | 可跳过 close 直接 `ROUND_COMPLETE`（P0 保守）                                               |
| `ROUND_COMPLETE` / `ROUND_ABORTED`                         | 只补发 UI 事件                                                                              |

P0 明确选择：**重启不以「猜用户还等着」为由自动再烧一次主答 LLM。** 超时预算内未完成 → Fallback 或 abort，并通知用户。

---

## 7. C6 Task-aware Timeout

禁止单一 `primaryTimeoutMs: 15000` 覆盖所有任务。

```ts
interface TimeoutPolicy {
  placeholderMs: number; // 「我看看」占位
  byTaskType: {
    chitchat: number;
    chat: number;
    knowledge: number;
    analysis: number;
    research: number;
    data: number;
    decision: number;
    execution: number;
    unknown: number;
  };
}

const DEFAULT_TIMEOUT_POLICY: TimeoutPolicy = {
  placeholderMs: 5_000,
  byTaskType: {
    chitchat: 8_000,
    chat: 8_000,
    knowledge: 15_000,
    analysis: 30_000,
    research: 60_000,
    data: 60_000,
    decision: 30_000,
    execution: 120_000,
    unknown: 30_000,
  },
};
```

解析顺序：

```text
base = byTaskType[taskType]
if inboundDepth === "act" → max(base, byTaskType.execution)
if inboundDepth === "retrieve" → max(base, byTaskType.knowledge)
deadlineAt = primaryStartedAt + base
placeholderDeadlineAt = firstTokenAt + placeholderMs
  （无 token 则 primaryStartedAt + placeholderMs）
```

Group 白名单可覆盖 `byTaskType.*` 的数值，但：

- 下限：`chat/chitchat ≥ 5s`，`research/data ≥ 30s`，`execution ≥ 60s`
- 不得把 `placeholderMs` 当成主答完成

`PRIMARY_RESPONDING` 期间允许流式。**开始输出 ≠ PRIMARY_COMPLETED。** 只有 `completion.responseStatus === "complete" && hasConclusion` 才转换。

P0 `source: "heuristic"`：lifecycle end + 可见文本长度 + 非占位句式。接口必须从第一天带上 `PrimaryCompletionContract`，禁止 P1 改字段名。

---

## 8. Cheap Contribution Gate（P0 必做）

LLM 是最后一级价值验证，不是第一道过滤器。

```text
PRIMARY_COMPLETED
  → Candidate Generation（角色 / 能力 / 非 Primary）
  → Cheap Gate（无 LLM）
       DROP → CANDIDATE_DROPPED
       KEEP / REVIEW → 创建 dispatch → Supplement LLM
  → 后置 overlap 仍可作为发出前保险
```

Cheap Gate 输入（禁止等补充 Bot 先生成长文）：

- `taskType` / `inboundDepth`
- `collaborationRole` / `requiredCapabilities`
- group mission / operating phase
- 主答已覆盖的粗 topic（关键词 / 标题句，P0 不用 embedding 也可）
- 本轮已发言 agent
- policy 阈值与 `maxSupplementBots`

```ts
type SuppressionReason =
  | "low_relevance"
  | "duplicate"
  | "low_increment"
  | "role_mismatch"
  | "budget_limit"
  | "visible_limit"
  | "policy_disabled";

type CheapGateResult =
  | { decision: "DROP"; reason: SuppressionReason }
  | { decision: "KEEP"; reason: string }
  | { decision: "REVIEW"; reason: string };
```

P0：`REVIEW` 按 `KEEP` 创建 Run（不确定时不误杀），Ledger 记 reason。禁止用假精度分数当主闸。`DROP` 不创建 dispatch。

`explicit_multi`：**跳过** Cheap Gate（用户已指定必答），走 `PRIMARY_QUEUE` 串行、每人一次。

单 @ → Round `mentionMode = single_primary`，`primaryMode = single`。  
多 @ 且全部命中 → `mentionMode = explicit_multi`，`primaryMode = explicit_multi`。  
多 @ 且部分未命中 → `MENTION_UNMATCHED`（occupancy=none）。

以上字段写在 Round / MentionResolution，**不写 Policy**。

---

## 9. 协作模式（架构预留，P0 只实现子集）

```ts
type CollaborationMode =
  | "single_owner"
  | "lead_plus_supplement"
  | "explicit_multi"
  | "debate"
  | "brainstorm"
  | "multi_executor";
```

| Mode                                       | P0         | 行为                                                                                           |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `single_owner`                             | 做         | 一个 Primary，无补充                                                                           |
| `lead_plus_supplement`                     | 做         | 默认；Cheap Gate 后 0–2 补充                                                                   |
| `explicit_multi`                           | 做         | ≥2 个有效 @；按点名顺序串行；每人一次；可选收口                                                |
| `debate` / `brainstorm` / `multi_executor` | **不实现** | 枚举与 snapshot 必须能存；命中则 **降级** 为 `lead_plus_supplement` 并记 Event `mode_degraded` |

多人 @ 不得解释成「第一人 Primary、其余 Supplement」。走同一套 `PRIMARY_QUEUE`：

- 无 @ / 单 @ → `primaryMode=single`，`primaryQueue=[A]`
- ≥2 有效 @ → `primaryMode=explicit_multi`，`primaryQueue=[A,B,…]`
- 未命中 → `MENTION_UNMATCHED` occupancy=none

---

## 10. Ledger 最小字段（业务结果）

现有 `kind: dispatch | execution` 上扩展，不换目录。P0 每轮至少能重建：

```text
roundId
policyVersion / policyHash
collaborationMode
primaryAgentId
assignmentReason
dispatches[]          // dispatchId, agentId, role, status
suppressions[]        // agentId, suppressionReason
responses[]           // latencyMs, duplicate, offTopic, incrementType?
fallback?
finalState
completion.source
```

Suppression Quality（只观察，P0/P1 **不扣 Growth 分**）：

```ts
interface SuppressionRecord {
  agentId: string;
  suppressionReason: SuppressionReason;
  falseSuppression?: boolean; // 人工/复盘回填，P0 可缺省
}
```

调度器指标优先于「Bot 说话次数」：`eligible → dispatched|suppressed → response → quality`。

---

## 11. 与现有代码的接入点

| 合同点                  | 落点                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 快照 / CAS 写           | 新 `collaboration-dispatch/round-store.ts`，路径经 `resolveTrustedGroupLocator` + C5 `runtime/rounds` |
| Event jsonl             | 同目录 append；与 `group-public-transcript` 分离                                                      |
| `runCollaborationRound` | 替换 `chat.ts` 内 lead/supplement/wrap 三重循环                                                       |
| abort                   | 复用 `parentAbortController` + `abortRequested`                                                       |
| 流式                    | 保持 `addChatRun`；完成只看 Completion Contract                                                       |
| Ledger                  | `collaboration-ledger/writer.ts` 扩展字段，不新建 SoT                                                 |

---

## 12. P0 合同验收测试（必须自动化）

在方案原有场景之外，**合同专属**用例：

| ID  | 用例                                   | 期望                                                        |
| --- | -------------------------------------- | ----------------------------------------------------------- |
| R1  | Gateway restart @ `PRIMARY_RESPONDING` | 不二次主答 LLM；timeout 或 abort 有 Event                   |
| R2  | 重复投递同一 `eventId`                 | 状态不变，`stateVersion` 不变                               |
| R3  | 同一 `roundId+dispatchId` 两次 accept  | 第二次 `skipped_duplicate`，无第二子 run                    |
| R4  | 用户 Stop                              | `ROUND_ABORTED`，无后续 supplement                          |
| R5  | Round 中途改 Group Policy              | 本轮仍用 snapshot 阈值                                      |
| R6  | `research` 任务                        | `deadlineAt` ≥ 60s，不得 15s 接管                           |
| R7  | 主答只说「我先看看」                   | 不进入 `PRIMARY_COMPLETED`                                  |
| R8  | Cheap Gate DROP                        | 无 LLM dispatch，有 `CANDIDATE_DROPPED`                     |
| R9  | `@A @B` 均命中                         | `PRIMARY_QUEUE` 先 A 后 B，均可见回复                       |
| R10 | `@不存在`                              | occupancy=none；无 coordinator 长文；无 in-flight execution |

缺 R1–R4 不得宣称 P0 完成。R9–R10 缺则 `explicit_multi` / @ 承诺未兑现。

---

## 13. 非目标

- 不在本轮扩展更多协作话术规则
- 不把 debate 做进 P0
- Growth 不因 `CANDIDATE_DROPPED` 扣机器人分
- 不 overlay LIVE、不改 C5 权威根
- 不把 Round 状态机并入 Task/Deliverable SM
