# Phase 2 Shadow 实施计划：Objective Resolver 只观测

> **Parent contract:** [Phase 2 增补 v0.4.6](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md)
> **Main scheme:** [openbot-task-focus-unified-execution-review-2026-09-13.md](./openbot-task-focus-unified-execution-review-2026-09-13.md) v0.4.6
> **Allowlist:** [Phase 0 交付物 §4](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md#4-objective-allowlistphase-0-定稿)
> **Status:** 实施计划 **v0.1 已签收**。[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 实现 **已批准合入，进入观测期**。观测协议见 [phase2-shadow-observation](./openbot-task-focus-unify-phase2-shadow-observation-2026-09-13.md)。**不得**进入 Phase 3a / 3b / 4 / 5
> **Branch:** `cursor/task-focus-unify-phase0`
> **Date:** 2026-09-13
> **Schema:** `objective-shadow/v1`（只读观测；不是 `objective-coordination/v1` 的持久化）

---

## 0. 文档控制

| 字段         | 内容                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **性质**     | Phase 2 shadow **实施计划**，不是合同修订，也不是运行时 PR                                                                           |
| **合同**     | v0.4.6 权威不变式仍是 I1–I25；本计划不改 I16–I25                                                                                     |
| **本修订**   | 规定 shadow 若被批准后应如何做；**本文件零运行时**                                                                                   |
| **实现门槛** | 计划已签收；实现已批准合入并进入观测期。观测证据与 3a/3b 设计仍须单独验收                                                            |
| **明确禁止** | 进入 Phase 3a / 3b；预创建 lease；写 Participation / Pointer / Contribution / Ledger；改 prompt / completion / run / 协作 round 状态 |

**最终原则：** Shadow 只回答「这次 run 会解析出什么 Objective、会拟议哪些 WorkUnitDefinition」。它 **不得**让任何协调对象变成真的。

---

## 1. 范围与非目标

### 1.1 只观测

1. `ResolvedObjective` 冻结快照：`objectiveId` + `revision` + `source`（I9）+ 可选 `conflict`。
2. **拟议** `WorkUnitDefinition`：内存推导的只读投影，**不是**持久化 Definition。

### 1.2 明确不创建（真实协调对象）

下列对象在本阶段 **不得出现任何写入、upsert、预创建或“稍后生效”行**：

| 对象                            | 禁止原因              |
| ------------------------------- | --------------------- |
| `ObjectiveParticipation`        | 协作身份是 Phase 3b   |
| `WorkUnitDefinition`（持久化）  | 拟议 ≠ 创建           |
| `WorkUnitLease`                 | 不得预创建 lease      |
| `ActiveLeasePointer`            | 方案 A 的 active 真源 |
| `ObjectiveContribution`         | 执行产物索引          |
| Progress Ledger step / evidence | I7 / I14              |

### 1.3 不改

- Phase 1b：Cron L2 prompt only、默认 OFF、零 alignment。
- Cron isolation、CommandLane、协作 round-runtime。
- Prompt、run 状态、completion 判定。
- Phase 4 alignment、Phase 5 gate。

---

## 2. 输入 / 输出 schema 与脱敏

### 2.1 输入（`ShadowObserveInput`）

Resolver **不得**读取用户原文、模型输出或 Ledger 正文作为观测输入。只接收 ingress 已分类的结构化字段。

```ts
type ObjectiveSource =
  | "cron"
  | "conversation_task"
  | "legacy_context"
  | "inbound_turn"
  | "collaboration";

type ShadowIngress =
  | "cron_isolated"
  | "chat"
  | "collaboration_turn"
  | "subagent"
  | "heartbeat"
  | "gateway_agent"
  | "acp";

type ShadowCandidate = {
  source: ObjectiveSource;
  objectiveId?: string;
  revision?: number;
};

type ShadowObserveInput = {
  schemaVersion: "objective-shadow/v1";
  tenantId: string;
  ingress: ShadowIngress;
  runId: string;
  parentRunId?: string;
  cronOccurrenceId?: string;
  groupId?: string;
  candidates: ShadowCandidate[];
  observedAtMs: number; // 服务端钟；忽略调用方时钟
};
```

| 字段           | 规则                                                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runId`        | chat = 主 run；cron = occurrence identity（不是永久 `jobId`）；subagent = 子 run，必须带真实 parent **run** identity（不是 session key）                                                                                                                              |
| `candidates`   | 本次 run 看到的全部**已分类结构化**候选，**不做全局 linear precedence**。接线点必须显式传入；**禁止**用 `runId` / 永久 `jobId` / session key 伪造 `objectiveId`。省略或 `[]`、缺 `objectiveId`、缺 `revision` → `skipped`，**不得**生成 proposed `WorkUnitDefinition` |
| `tenantId`     | `local_unscoped`（未声明租户的本机单租户）可回退到合同值 `"local"`。`identified`（enterprise / ownership / 已解析租户）缺 tenant → `invalid_input`，**不得**静默归入 `"local"`                                                                                        |
| `parentRunId`  | 仅 subagent。必须是已观测 parent run identity；`agent:` / `cron:` / `session:` session key **不是** run id，必须丢弃并记 `inherit_violation`                                                                                                                          |
| `acp`          | Phase 0–5 out of scope：输入可到达，输出必须 `skipped` / `out_of_scope`，**不拟议** Definition                                                                                                                                                                        |
| `observedAtMs` | `storeNowMs()`；禁止 agent 时钟                                                                                                                                                                                                                                       |

接线点构造候选（禁止 adapter 默认合成）：

| Ingress              | 结构化来源                                                                                                                                                                                                                                                                                                                                                                                                                                   | 缺候选时                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `chat`               | 已持久化 Active ConversationTask；查询维度是 **sessionKey**（与 activation / `dispatch-from-config` 相同），不是内部 session UUID。`taskKey` + `activationEpoch`。legacy / inbound 仅当现场已有稳定 ID                                                                                                                                                                                                                                       | `skipped`                                                       |
| `cron_isolated`      | 服务端派生：`objectiveId = cron-obj:` + 永久 job id（**不是** occurrence/runId）；`revision` = 规范化 Cron 任务契约 digest（normalized goal / intentText / acceptanceRules / compiled instruction + dataBindings / schedule / delivery / payload semantics）。正文先哈希再纳入 digest，**shadow 记录只写 objectiveId/revision/source**。**不**读取 meta 中不存在的 `objectiveId`/`revision`，不恒定写 1。缺 job id 或 revision 不合法 → skip | `skipped`                                                       |
| `collaboration_turn` | SharedTaskContext 的稳定 `conversationId` + `revision`。无稳定 ID → 明确 skip，不得伪造                                                                                                                                                                                                                                                                                                                                                      | `skipped` + `collab_deferred_phase3b`（仍不拟议）               |
| `subagent`           | 只读 parent shadow snapshot；`candidates: []`。不得自行生成 objective                                                                                                                                                                                                                                                                                                                                                                        | 无真实 `parentRunId` 或无 parent snapshot → `inherit_violation` |

### 2.2 输出（`ShadowObserveRecord`）

一条 run **至多一条** 记录（同一 `runId` 重复观测幂等：相同 payload 覆盖计数不双计）。

```ts
type ResolveStatus = "resolved" | "conflict" | "allowlist_rejected" | "skipped" | "out_of_scope";

type ProposedDisposition = "generated" | "rejected" | "discarded";

type ProposedWorkUnitDefinition = {
  workUnitId: string;
  objectiveId: string;
  objectiveRevision: number;
  coordinationPolicy: "exclusive" | "shared";
  contributionKind: "execute" | "research" | "review" | "synthesis";
  required: boolean;
  acceptanceIds: string[];
  dependsOnWorkUnitIds: string[];
  coversWorkUnitIds: string[];
  minContributors: number;
  maxContributors: number;
  createdByKind: "runtime" | "participant" | "orchestrator";
  definitionEpoch: 0; // 拟议恒为 0；持久化 epoch 不存在
};

type ShadowObserveRecord = {
  schemaVersion: "objective-shadow/v1";
  recordId: string;
  observedAtMs: number;
  correlation: {
    runId: string;
    parentRunId?: string;
    cronOccurrenceId?: string;
    ingress: ShadowIngress;
    tenantHash: string;
    groupHash?: string;
    objectiveId?: string;
    revision?: number;
    source?: ObjectiveSource;
  };
  resolveStatus: ResolveStatus;
  conflictCodes: string[];
  proposed: ProposedWorkUnitDefinition[];
  proposedDisposition: ProposedDisposition;
  rejectOrDiscardCodes: string[];
  metrics: ShadowMetrics;
};
```

`definitionEpoch: 0` 表示 **拟议草稿**。实现者 **不得**据此创建 `definitionEpoch >= 1` 的持久化行。

### 2.3 脱敏规则（强制）

写入 shadow 日志前必须经过同一脱敏函数。原始 `ShadowObserveInput.tenantId` / `groupId` **不得**落盘。

| 字段 / 内容                              | 处理                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `tenantId` / `groupId` / `participantId` | HMAC-SHA256（独立 shadow key）后取 hex 前 16 位 → `tenantHash` / `groupHash` |
| 用户消息、系统 prompt、模型输出          | **禁止**进入 input / record / 日志                                           |
| Objective 标题、验收原文、任务正文       | **禁止**；只保留 id / revision / source                                      |
| Ledger / evidence 正文                   | **禁止**                                                                     |
| 电话、邮箱、token、cookie、绝对路径      | 若误入 candidates 元数据 → 丢弃该字段并记 `redaction_dropped`                |
| `runId` / `objectiveId`                  | 保留（关联用）；不得拼接用户原文                                             |

脱敏 key：环境变量 `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY`。缺失时 **不得**写日志（fail closed），视为 flag 实际未开启。

---

## 3. Flag、默认 OFF、I14 证明

### 3.1 Flag

| 项     | 值                                                                         |
| ------ | -------------------------------------------------------------------------- |
| 名称   | `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW`                                      |
| 默认   | **OFF**（unset / `0` / `false` / 空 = OFF）                                |
| 开启   | 仅显式 `1` 或 `true`                                                       |
| 独立于 | Phase 1b Cron L2 prompt flag；既有 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW` |
| 配置面 | 仅 env；**不得**做成 UI 默认开、租户默认开或 config 缺省 true              |

开启本 flag **不等于**批准 Phase 3，也 **不得**打开任何 coordination persist flag（本阶段不允许存在此类 flag）。

### 3.2 I14 行为合同

I14：`flag OFF 不写 Ledger/不改状态`。

对本计划展开为：

| Flag | 允许                                           | 禁止                                                                      |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| OFF  | no-op；不读候选正文；不拟议；不打点落盘        | 任何 shadow JSONL、任何协调对象、任何 Ledger、任何 prompt/completion 变化 |
| ON   | 内存 resolve + 拟议 + **一条**脱敏 shadow 记录 | 仍禁止 §1.2 全部真实对象；不得改 run 结果                                 |

测试 #12（合同）在 shadow 阶段的对应：OFF 时 participation / definition / lease / contribution / Ledger **均不写**。ON 时同样不写这些对象，只写 shadow 日志。

### 3.3 I14 证明（实现 PR 必交，本计划不写代码）

实现 PR 必须包含下列证明，缺一不得合入：

1. **默认 OFF 单测：** 未设置 env 时 `isObjectiveShadowEnabled()` === false。
2. **OFF 零副作用：** hook 被调用后，禁止列表（§5）的 write spy 调用次数为 0；无 JSONL 行。
3. **ON 只写日志：** 允许的 logger / JSONL append = 1；禁止列表 write spy = 0。
4. **缺 HMAC key：** 即使 flag ON，也不得写日志；run 结果不变。
5. **import 边界：** `pnpm` / 静态检查证明 shadow 模块 **不 import** §5.2 禁入符号。
6. **运行时探测：** 在 ON 路径断言不存在对 `claimWorkUnit`、`appendContribution`、`writeLedger`、`upsertParticipation`、`upsertActiveLeasePointer` 的调用。

---

## 4. Objective source 冲突与 allowlist 指标

Allowlist 权威仍是 Phase 0 交付物 §4。Shadow **只计数、不仲裁成写入**。

### 4.1 判定顺序

1. `ingress === "acp"` → `out_of_scope`，拟议 `discarded`。
2. `candidates` 为空 → `skipped`。
3. 任一 candidate 的 `source` 不在该 ingress **允许**集合 → 记 `allowlist_rejected`（可与冲突并存）。
4. 同一 run 出现 **两个及以上** 允许 source，且 `objectiveId` 或 `revision` 不一致 → `conflict`。
5. 禁止 source 出现但同时有唯一允许 source → **不采用**禁止 source；指标 +1 `allowlist_ignored_forbidden`；若允许 source 唯一则仍可 `resolved`。
6. 子 agent：必须与 `parentRunId` 已观测 snapshot 的 `objectiveId + revision + source` 一致；自行 resolve → `conflict` + `inherit_violation`。

**禁止**用「最后一个 candidate 赢」或全局优先级表覆盖 allowlist。

### 4.2 `conflictCodes` / 指标

| code                          | 含义                                        |
| ----------------------------- | ------------------------------------------- |
| `source_conflict`             | 多个允许 source 指向不同 objective/revision |
| `allowlist_rejected`          | 唯一或主导 candidate 被该 ingress 禁止      |
| `allowlist_ignored_forbidden` | 禁止 source 被丢弃                          |
| `inherit_violation`           | 子 agent 未继承父 snapshot                  |
| `missing_id_or_revision`      | 允许 source 缺少冻结键                      |
| `redaction_dropped`           | 字段因脱敏被丢                              |
| `hmac_key_missing`            | 不能安全写日志                              |

每个 code 在 `metrics` 中有对应计数（本 record 内 0/1，聚合窗口求和）。

```ts
type ShadowMetrics = {
  candidateCount: number;
  allowedCandidateCount: number;
  forbiddenCandidateCount: number;
  sourceConflict: 0 | 1;
  allowlistRejected: 0 | 1;
  allowlistIgnoredForbidden: 0 | 1;
  inheritViolation: 0 | 1;
  proposedGenerated: number;
  proposedRejected: number;
  proposedDiscarded: number;
  forbiddenWriteAttempts: 0 | 1; // 必须恒为 0；出现则停止观测
};
```

窗口聚合看板（只读）最少输出：按 `ingress` 分组的 `sourceConflict` 率、`allowlistRejected` 率、`inheritViolation` 率。这些指标 **不得**自动打开 Phase 3。

---

## 5. 拟议 WorkUnitDefinition：生成 / 拒绝 / 丢弃

拟议对象形状对齐合同 `WorkUnitDefinition`，但 `createdBy` 只保留 `createdByKind`（脱敏，无 participant 明文）。**生成 ≠ persist。**

### 5.1 生成（`generated`）

仅当 `resolveStatus === "resolved"` 且已冻结 `objectiveId + revision + source`：

| ingress                       | 拟议规则（只读投影）                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`                        | **恰好一条**：`exclusive` + `execute` + `required: true` + `coversWorkUnitIds: []` + `min=max=1` + `createdByKind: "runtime"`；`workUnitId` 由 `hash(objectiveId, revision, runId, "execute")` 稳定派生 |
| `cron_isolated`               | **恰好一条**，同上，但绑定 `cronOccurrenceId`（= `runId`）；**不得**跨 occurrence 复用 `workUnitId`                                                                                                     |
| `subagent`                    | **零条新单元**；可回显父记录已拟议的单元 id 列表，但 `proposedDisposition` 仍为 `discarded`（`inherit_only`）。子 agent 不得自拟冲突单元                                                                |
| `collaboration_turn`          | **不得**套用单聊 exclusive 单单元模型。本阶段 **不生成** 成员级单元（缺 Participation 真源）。`proposed = []`，`discarded` + `collab_deferred_phase3b`                                                  |
| `heartbeat` / `gateway_agent` | 仅当唯一允许 source 为 `inbound_turn`（或 gateway 显式 bind 的 `legacy_context`）时，按 chat 单单元规则生成；否则丢弃                                                                                   |
| `acp`                         | 不生成                                                                                                                                                                                                  |

`review` / `synthesis` 拟议 **本阶段不生成**（需要真实 Definition 声明集与成员绑定）。若实现者自行发明覆盖集 → 必须走 §5.2 拒绝，不得 silently 写入。

### 5.2 拒绝（`rejected`）

结构校验失败则整单 `proposed = []`（不得部分落地）：

| 条件                                                             | code                           |
| ---------------------------------------------------------------- | ------------------------------ |
| execute/research 拟议带非空 `coversWorkUnitIds`                  | `i25_execute_covers_not_empty` |
| review/synthesis 拟议为空或超出声明（本阶段不应出现）            | `i25_review_covers_invalid`    |
| `createdByKind` 违反增补 §2.2.3 矩阵（如 chat 用 `participant`） | `actor_matrix_violation`       |
| `exclusive` 但 min/max ≠ 1                                       | `policy_cardinality`           |
| `shared` 但 `max < min`                                          | `policy_cardinality`           |
| `workUnitId` 不稳定或跨 occurrence 复用（cron）                  | `unstable_or_reused_id`        |

拒绝仍写一条 shadow 记录，供指标使用。

### 5.3 丢弃（`discarded`）

| 条件                  | code                      |
| --------------------- | ------------------------- |
| 未 resolved           | `no_frozen_snapshot`      |
| 冲突 / allowlist 拒绝 | 同 §4.2                   |
| 协作 ingress          | `collab_deferred_phase3b` |
| 子 agent 继承         | `inherit_only`            |
| 观测窗口已关闭        | `window_closed`           |
| HMAC 不可用           | `hmac_key_missing`        |

丢弃 **不是** 创建失败后的补偿写；没有任何补偿行。

---

## 6. 代码边界：不创建真实协调对象

### 6.1 允许的落点（签收后的实现 PR 才可新增）

建议单一入口，名称示例（实现时不得改语义）：

```text
src/objective-shadow/observe.ts          # 纯函数：input → record
src/objective-shadow/redact.ts           # 脱敏
src/objective-shadow/feature.ts          # flag + HMAC 检查
src/objective-shadow/log.ts              # append-only JSONL
```

允许 **只读** 接入的既有点（调用 `observe` 后忽略返回值对 run 的影响）：

- chat pipeline：已有 `runId` / tenant / ingress 分类之后
- `src/cron/isolated-agent/run.ts`：occurrence identity 已确定之后
- 协作 round：已知 `groupId` 之后（只为记 `collaboration_turn` 丢弃指标）
- subagent spawn：能读到 `parentRunId` 之后

**返回值不得**进入 prompt、tool 参数、completion、lease、Ledger。

### 6.2 禁止 import / 调用（静态 + 测试双门禁）

实现 PR 的 shadow 包 **不得**引用：

- 任何 `claimWorkUnit` / `releaseWorkUnit` / lease CAS
- Participation upsert / leave
- `ActiveLeasePointer` 写入
- Contribution append
- Ledger append / `completeConversationTask*` / reply→evidence
- 协作 round 的完成/关闭 API
- 未来 `objective-coordination` persist repository（若有人先合入，shadow PR 必须 rebase 并继续零引用）

### 6.3 禁止副作用

- 不得创建目录以外的「协调 store」表或文件（只允许 shadow JSONL）。
- 不得把拟议 Definition 写进 session transcript。
- 不得在 flag ON 时预热 lease 池。
- 不得把 `forbiddenWriteAttempts` 以外的失败变成用户可见错误而改变 content/delivery（I15 不被本计划打开）。

### 6.4 日志关联（runId / ingress / tenant / revision）

每条 JSONL 一行 = 一条 `ShadowObserveRecord`。关联键：

```text
correlation.runId
+ correlation.ingress
+ correlation.tenantHash
+ correlation.objectiveId? + correlation.revision?
(+ cronOccurrenceId | parentRunId | groupHash)
```

查询合同：给定 `runId` 必须能取回 0 或 1 条记录；给定 `(tenantHash, ingress, revision)` 可聚合窗口指标。缺少 `runId` 或 `ingress` 的记录 **不得**写入。

日志路径（实现时）：进程本地 append-only 文件，例如 `~/.openbot/logs/objective-shadow.jsonl`（或测试 tmp）。**不是** Ledger，**不是** coordination store。保留期 = 观测窗口 + 7 天，之后可删；删除不影响任何业务状态。

---

## 7. 观测窗口（7 天或 N 次）

| 项         | 值                                                                                  |
| ---------- | ----------------------------------------------------------------------------------- |
| 墙钟窗口   | 自 **第一次成功写入** shadow 记录起 **7 × 24h**（`storeNowMs()`）                   |
| 次数窗口   | 每个 `ingress` **N = 500** 条成功记录（rejected/discarded 也计入 N）                |
| 关闭规则   | **先到先停**：该 ingress 达到 N，或全局达到 7 天                                    |
| 关闭后     | 即使 flag 仍 ON，新 run 只记内存 `window_closed` **不得再写 JSONL**（避免无限膨胀） |
| 不自动续期 | 续期必须新的计划修订 + 签收                                                         |

窗口关闭 **不是** Phase 3 批准，也不是 I13 gate 达标。

---

## 8. Replay、回滚、停止条件

### 8.1 Replay

- **输入：** 已落盘的脱敏 `ShadowObserveRecord` 或测试 fixture（同等 schema）。
- **禁止**从共享 dirty tree replay Phase 1b 以外的 harmful WIP；禁止 replay 含 L4 alignment 的 `task-focus` / `run.ts` 补丁（Phase 0 §5）。
- Replay **只**重跑纯函数 `observe`（用 fixture 的 candidates），比对 `resolveStatus` / `proposed` / codes 的稳定哈希。
- Replay 过程 flag 视为逻辑 ON，但仍走 §5 禁写；**不得**写第二条生产 JSONL（写入 sink 必须是测试缓冲）。

### 8.2 回滚

1. 将 `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW` 置 OFF 或删除。
2. 停止 JSONL writer。
3. 可选删除 `objective-shadow.jsonl`。
4. **断言：** 协调对象表/文件行数仍为 0（本阶段本就不该有表；若有人误加，回滚必须 drop 且不得 migrate）。
5. Run 路径与 flag OFF 时 bit-identical（prompt / completion / Ledger 无 diff）。

回滚 **不需要** 补偿事务，因为没有真实协调对象。

### 8.3 停止条件（立即关闭 writer）

任一发生则 `forbiddenWriteAttempts=1` 或等价紧急 OFF：

1. 探测到 §1.2 对象的任何写。
2. HMAC key 丢失或轮换失败仍尝试明文写。
3. 单日 JSONL 超过 2×N 或出现无 `runId` 的行。
4. 窗口已关闭仍持续落盘。
5. Operator 或值周明确要求停止。

停止后保持 flag OFF，直到新计划修订。**不得**为“凑满窗口”重新打开。

---

## 9. 与 Phase 1b / 3 的隔离

| 阶段                    | 本计划                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| Phase 1b                | 继续；互不打开对方 flag                                                           |
| Phase 2 合同 v0.4.6     | 已作为父合同；本计划不改 I25                                                      |
| Phase 2 shadow **实现** | [PR #1107](https://github.com/gmood2008/openbot/pull/1107) 已批准合入，进入观测期 |
| Phase 3a / 3b           | **不批准**；协作拟议显式 `collab_deferred_phase3b`                                |

I13（shadow 达标后才 gate）属于 Phase 5，不被本计划提前满足。

---

## 10. 验收清单（计划签收，不是实现签收）

- [ ] §2 输入/输出 schema 与脱敏规则完整
- [ ] §3 flag 默认 OFF，并写明 I14 证明项
- [ ] §4 source 冲突与 allowlist 指标
- [ ] §5 拟议 Definition 的生成 / 拒绝 / 丢弃
- [ ] §6 不创建真实协调对象的代码边界与日志关联键
- [ ] §7 7 天或 N=500 窗口
- [ ] §8 replay / 回滚 / 停止条件
- [ ] 本文件无运行时代码；无 Phase 3 实现

**结论：Phase 2 shadow 实施计划 v0.1 已签收。PR #1107 已批准合入并进入观测期。下一步是观测窗口证据，不是 Phase 3。**

---

## 11. 修订历史

| 版本           | 说明                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| **0.1**        | 首份独立实施计划：schema、I14、指标、拟议规则、禁写边界、窗口、replay/回滚 |
| **0.1 签收**   | 2026-09-13 批准实现；范围冻结为纯 resolver shadow，默认 OFF                |
| **0.1 观测期** | 2026-09-13 观测协议生效；合入等待自动解除 BLOCKED；不进入 Phase 3          |
