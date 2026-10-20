# Phase 2 合同增补：Shared Objective / Participation / Work Unit / Contribution

> **Parent:** [openbot-task-focus-unified-execution-review-2026-09-13.md](./openbot-task-focus-unified-execution-review-2026-09-13.md) v0.4.6
> **Status:** 设计增补 **v0.4.6**；[shadow 计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) **已签收**；[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 实现 **已批准合入，进入观测期**（不是 Phase 3）
> **Branch:** `cursor/task-focus-unify-phase0`
> **Date:** 2026-09-13
> **Schema:** `objective-coordination/v1`（v0.4 / v0.4.1 均未落地；本修订为未发布合同的破坏性更正）

---

## 0. 文档控制

| 字段         | 内容                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **性质**     | Phase 2 及后续阶段的 **合同增补**，不是 Phase 1b 范围变更                                                                                                                                                       |
| **Phase 0**  | **最终通过**                                                                                                                                                                                                    |
| **Phase 1a** | **N/A**                                                                                                                                                                                                         |
| **Phase 1b** | **已批准、继续执行、范围冻结**：Cron L2 prompt only、默认 OFF、零 alignment；**无** Objective Lease / 协作调度 / Ledger 改造                                                                                    |
| **本修订**   | v0.4.6：将 I25 纳入本增补权威不变式表（I16–I25），与主方案 §9 **逐字一致**；#32–#34 证明 I25                                                                                                                    |
| **实现门槛** | [计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) 已签收；[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 已批准合入并进入观测期。3a / 3b / 4 / 5 **仍不批准** |
| **非目标**   | 不新增第二套 Progress Ledger；不改 Cron isolation / CommandLane / 协作 round-runtime 既有边界                                                                                                                   |

**最终原则：** 防止的是两个 agent **无意识地**重复执行同一个排他 Work Unit，而不是阻止多个 agent 围绕同一个共享 Objective 进行分工、互补、复核和综合。

---

## 1. 为何修正

v0.3.1 若被读成「对整个 `objectiveId` 做单执行者 exclusive claim」，会把合法协作误判为冲突。v0.4 方向正确，但类型仍不足以防止 **重复领取** 和 **stale writer**：

| v0.4 缺口                                  | 后果                                                              |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `coordinationMode` 挂在 Lease 上           | 并发领取者可分别声明 exclusive / shared，系统无法判定谁有权定策略 |
| 只有 Lease、没有 Work Unit 本体            | Phase 5 无法判断 required / acceptance / dependency / 覆盖关系    |
| Lease 无 fencing token                     | A 过期 → B reclaim → A 写回；I20 因同 revision 无法拒绝           |
| parallel / review / synthesis 混在同一枚举 | 并发关系与贡献类型不可组合（例如两个 reviewer 并行）              |
| `evidenceRefs: string[]`                   | 无法校验归属、幂等、append-only                                   |
| 协作 `groupId` 可选                        | 非成员可参与；role 字符串可被模型自报                             |

v0.4.1 已补 Definition / policy 归属 / 维度拆分，但 fencing 仍有 4 个可实现性缺口：全局 `leaseEpoch` 误杀 shared 同伴；Lease/Contribution 缺 `definitionEpoch`；缺 `participationEpoch`；`createdByParticipantId` 与单聊/Cron 无 Participation 矛盾。

---

## 2. 核心模型

正确切分：

| 层                                             | 是否可共享                   | 排他是否允许                                                                                   |
| ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared Objective（`objectiveId` + `revision`） | **必须可共享**               | **禁止** 全局 exclusive claim                                                                  |
| Participation                                  | 每成员一条（协作必含 group） | 否（声明范围；授权不靠自报 role）                                                              |
| **WorkUnitDefinition**                         | 同 revision 下的分工合同     | 策略由定义上的 `coordinationPolicy` 决定，**Lease 不得覆盖**                                   |
| WorkUnitLease                                  | 遵循定义                     | 仅执行领取；fencing 为 **slot 级** `leaseId` + `leaseGeneration`（不得用全局 work-unit epoch） |
| Contribution                                   | append-only                  | 单条 **不得** 关闭整个 Objective                                                               |

**WorkUnitDefinition 不是 Ledger step。** 它描述分工合同（谁做什么、是否 required、验收哪些、依赖什么）。执行事实仍由 Progress Ledger 保存。Contribution 只索引已解析的 evidence。

### 2.1 Shared Objective

协作组所有成员共同绑定同一个 `objectiveId` + `revision`，共享目标、验收规则和上下文边界。单聊可由主 agent 负责同一 snapshot；子 agent **必须继承**父级 snapshot，**不得**自行解析或修改 Objective。

### 2.2 Participation

```ts
type ObjectiveParticipation = {
  schemaVersion: "objective-coordination/v1";
  objectiveId: string;
  objectiveRevision: number;
  groupId: string;
  participantId: string;
  role: string;
  scope: string;
  joinedAtMs: number;
  leftAtMs?: number;
  participationEpoch: number;
};
```

#### 2.2.1 协作身份（强制）

1. **协作 ingress 下 `groupId` 必填**，不得 optional。单聊 / Cron isolated **不建立**本结构（无 group Participation）。
2. `participantId` **必须**是该 `groupId` 的在籍成员；非成员建立 Participation → 拒绝（测试 #18）。
3. **唯一键：** `(objectiveId, objectiveRevision, groupId, participantId)`。
4. `role` / `scope` **不得原地改写**。变更必须递增 `participationEpoch` 或追加 event；旧 epoch 不得再作为授权依据。
5. **离组后**（`leftAtMs` 已写，或 group membership 已失效）：**不得新写** Contribution；历史 Participation / Contribution **保留**。
6. **synthesis / review 授权不得只依赖模型自报的 `role` 字符串。** 必须同时满足：
   - 有效 group membership；
   - 存在指向该 participant 的 `WorkUnitDefinition`（`contributionKind` 为 `review` 或 `synthesis`）；
   - 运行时 capability / 协作 round policy 授予（既有 round-runtime 边界，不另建授权引擎）。
7. **离组后再加入** 必须使用新的 `participationEpoch`（不得复用离组前 epoch）。旧 lease / Contribution 上的旧 epoch **不得**因重新加入而恢复写权限（测试 #23）。

### 2.2.2 CoordinationActor（统一 provenance）

单聊 / Cron **不建立** Participation，因此创建者与执行者不能强制 `participantId`。

```ts
type CoordinationActor =
  | { kind: "participant"; participantId: string; participationEpoch: number }
  | { kind: "runtime"; runId: string }
  | {
      kind: "orchestrator";
      orchestratorId: string;
      actingForGroupId: string;
      policyDecisionRef: string;
    };
```

`orchestratorId` / `actingForGroupId` / `policyDecisionRef` **必须由服务端派生**，不得由模型自报。

#### 2.2.3 Definition 创建授权矩阵（v0.4.3 冻结）

谁可以 `create` / `revise` `WorkUnitDefinition`，按 **ingress × actor** 判定。下表是唯一权威；§2.2.2 与 Phase 8 不得另写相反规则。

| createdBy.kind | 单聊                           | Cron isolated                             | Subagent                           | 协作 ingress                                                                                                                                                                                                         |
| -------------- | ------------------------------ | ----------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `participant`  | **禁止**                       | **禁止**                                  | **禁止**                           | **允许**：必须是该 `groupId` 当前有效 Participation（未离组，epoch 匹配）                                                                                                                                            |
| `orchestrator` | **禁止**                       | **禁止**                                  | **禁止**                           | **允许**：server-derived `orchestratorId` + `actingForGroupId`（必须等于该协作 `groupId`）+ `policyDecisionRef`。**仅证明分工来源**，不授予该 orchestrator 任何 participant lease 或 Contribution 写权限（测试 #25） |
| `runtime`      | **允许**（`runId` = chat run） | **允许**（`runId` = occurrence identity） | **允许**（继承父 run，不得换目标） | **禁止**                                                                                                                                                                                                             |

**禁止：**

- runtime / orchestrator 伪装成 `participant`。
- 协作 ingress 用 `runtime` 创建 Definition。
- 把 `createdBy: orchestrator` 当成 claim / 写 Contribution 的授权。
- participant 创建时缺少有效 group membership。

### 2.3 Work Unit 定义（本体）与策略拆分

并发策略与贡献类型 **不是** 互斥维度。一个 `review` Work Unit 也可以 `shared`（两名 reviewer 并行或交叉验证）。

```ts
type CoordinationPolicy = "exclusive" | "shared";

type ContributionKind = "execute" | "research" | "review" | "synthesis";

type WorkUnitDefinition = {
  schemaVersion: "objective-coordination/v1";
  workUnitId: string;
  objectiveId: string;
  objectiveRevision: number;
  coordinationPolicy: CoordinationPolicy;
  contributionKind: ContributionKind;
  required: boolean;
  acceptanceIds: string[];
  dependsOnWorkUnitIds: string[];
  coversWorkUnitIds: string[];
  minContributors: number;
  maxContributors: number;
  createdBy: CoordinationActor;
  definitionEpoch: number;
};
```

| 字段                                  | 合同                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coordinationPolicy`                  | **不可变**（同一 `workUnitId` + `objectiveRevision` + `definitionEpoch` 内）。`exclusive` = 同时仅一个有效 lease；`shared` = 允许多 lease，受 min/max 约束。领取者 **不得**用 claim 参数覆盖（测试 #13）                                           |
| `contributionKind`                    | 本单元产出的 Contribution 类型。`review` / `synthesis` 只追加派生记录，不改写被覆盖单元的原 Contribution                                                                                                                                           |
| `required`                            | Phase 5「required work units satisfied」的唯一来源                                                                                                                                                                                                 |
| `acceptanceIds`                       | 本单元须满足的验收项（指向 Objective 冻结 snapshot 内的 acceptance，不指向 Ledger step）                                                                                                                                                           |
| `dependsOnWorkUnitIds`                | 依赖；未满足则本单元不得完成                                                                                                                                                                                                                       |
| `coversWorkUnitIds`                   | Definition **声明**本单元允许/必须覆盖的源 Work Unit 集合。一次 review/synthesis **实际覆盖了哪些**记在 `ObjectiveContribution.coversWorkUnitIds`（§2.5.2）。completion **只认 Contribution 实际覆盖的并集**，不把 Definition 声明当成已覆盖       |
| `minContributors` / `maxContributors` | `maxContributors` 限制 **同时 active slot / pointer 数**。`minContributors` 比较的是 **distinct writer identity**（§2.5.1 / I24），**不是** Contribution 行数、lease 数或 slot 数。`exclusive` 时 max=1、min=1。`shared` 时 `min ≥ 1`、`max ≥ min` |
| `createdBy` / `definitionEpoch`       | 可验证 actor provenance，授权以 **§2.2.3 矩阵** 为准。修订 Definition = 新 `definitionEpoch`（append-only）。claim 绑定当时的 `definitionEpoch`；旧 epoch 不得写入（测试 #21）                                                                     |

**禁止：** 把 `coordinationPolicy` 或 `contributionKind` 写进 Lease 并当作权威。

### 2.4 WorkUnitLease（只遵循定义 + **slot 级** fencing）

```ts
type WorkUnitLease = {
  schemaVersion: "objective-coordination/v1";
  leaseId: string;
  leaseGeneration: number;
  slotId: string;
  workUnitId: string;
  objectiveId: string;
  objectiveRevision: number;
  definitionEpoch: number;
  executor: CoordinationActor;
  claimedAtMs: number;
  expiresAtMs: number;
};
```

1. Lease **没有** `coordinationPolicy` / `contributionKind`。领取时读取当前有效 `WorkUnitDefinition`；claim 若与 `coordinationPolicy` 或 min/max 冲突 → 拒绝。claim **绑定**当时的 `definitionEpoch`。
2. `claimedAtMs` / `expiresAtMs` **由协调存储在 claim 提交时用 authoritative clock 盖章**，忽略 agent 提交的时间。过期当且仅当 `storeNowMs() >= expiresAtMs`。**禁止**用 agent 本地时钟或请求体时间判断过期。
3. **Slot：** `exclusive` 仅一个 `slotId`。`shared` 同时最多 `maxContributors` 个不同 `slotId`。回收 / 接替只针对 **被回收的 slot**。
4. **`leaseGeneration` 属于 `(workUnitId, slotId)`，不是整个 Work Unit。** 接替 A 的 slot：新 `leaseId`，该 slot 的 `leaseGeneration + 1`。**禁止**因此递增其他 slot 的 generation。A 过期、C 接替 A 时，B 的 lease 必须仍 active（测试 #20）。
5. **禁止全局 work-unit epoch。** v0.4.1 的 `leaseEpoch` 对整个 `workUnitId` 单调递增，会在 shared 下误杀合法同伴，**已否决**。
6. 协作 `executor` 必须是 `kind: "participant"`，并携带领取时的 `participationEpoch`。单聊 / Cron 必须是 `kind: "runtime"`（`runId` = chat run 或 cron occurrence），**不得**带 `participantId`。
7. **写 Contribution 的 CAS（同时全部满足，否则拒绝或隔离）：**
   - 该 slot 的 `ActiveLeasePointer` 指向本 `(leaseId, leaseGeneration)`，且 `storeNowMs() < expiresAtMs`；
   - `objectiveRevision` 等于冻结 snapshot（I20）；
   - `definitionEpoch` 等于当前有效 `WorkUnitDefinition.definitionEpoch`（测试 #21）；
   - 若 `executor.kind === "participant"`：`participationEpoch` 等于该成员 **当前** Participation epoch，且未离组（测试 #22/#23）。
8. 过期后旧 executor 写回 → 拒绝（测试 #14）。同 slot 被接替后旧 `leaseGeneration` 写回 → 拒绝（测试 #15）。**不得**因 `objectiveRevision` 相同而放行。
9. **同一 executor 在同一 Work Unit 上最多占用一个 active slot。** `exclusive` 与 `shared` 均适用。已持有则幂等返回原 token，不得新开 slot。**禁止**一个 participant/runtime 占满 `maxContributors`。此条不得留给实现偶然行为（测试 #29）。
10. `orchestrator` **不得**作为 `executor` claim lease。

### 2.4.1 原子 claim + ActiveLeasePointer（v0.4.4 冻结：**方案 A**）

v0.4.3 的 `UNIQUE (workUnitId, objectiveRevision, definitionEpoch, slotId, leaseGeneration)` **只能**防止同一 generation 重复插入；generation 递增后新旧 Lease 行可同时存在，**不能**保证每 slot 只有一个 active。方案 B（PARTIAL UNIQUE WHERE active）与方案 C（单行 slot 原地 CAS + LeaseEvent）**不采用**。

**冻结方案 A：** 历史 `WorkUnitLease` append-only 可保留多 generation；**当前 active 只由 pointer 决定。**

```ts
type ActiveLeasePointer = {
  schemaVersion: "objective-coordination/v1";
  workUnitId: string;
  objectiveId: string;
  objectiveRevision: number;
  definitionEpoch: number;
  slotId: string;
  leaseId: string;
  leaseGeneration: number;
};
```

```text
UNIQUE (workUnitId, objectiveRevision, definitionEpoch, slotId)
```

该唯一键保证每个 slot **恰好一行 pointer**。pointer 指向当前 `leaseId` + `leaseGeneration`。历史 Lease 行可保留，**不得**另有第二行 pointer，也不得把未指向的 Lease 当作 active。

**一条 lease 为 current active，当且仅当：**

1. 存在 pointer 指向其 `(leaseId, leaseGeneration)`；且
2. `storeNowMs() < expiresAtMs`（`expiresAtMs` 为服务端盖章）。

`claimWorkUnit` **必须**在 **一个事务或等价 CAS** 中完成（中途失败整笔回滚）：

1. **锁定**当前 `WorkUnitDefinition` 及其 `definitionEpoch`。
2. **校验**冻结 `objectiveRevision`、policy、依赖；协作还须校验有效 Participation。`definitionEpoch` 在锁内已变化 → **失败**，可重试（测试 #28）。
3. **选择或回收 slot：**
   - 若该 executor 已有 **pointer 指向且未过期** 的 slot → 幂等返回该 token，不新开 slot。
   - 若某 slot 的 pointer 存在但 `storeNowMs() >= expiresAtMs`，且接替不违反「每 executor 一 slot」→ 回收该 `slotId`。
   - 否则分配一个尚无 pointer、或 pointer 已过期的 `slotId`（不得占用其他未过期 pointer）。
4. **校验 cardinality：** pointer 中 **未过期** 的条数（计入本事务将写入/更新的这条）**不得超过** `maxContributors`。
5. **仅对该 slot** 递增 `leaseGeneration`；append 一条历史 `WorkUnitLease`。
6. **CAS 更新/插入 `ActiveLeasePointer`：** 条件为「无 pointer」或「现 pointer 已过期」或「现 pointer 的 generation 等于预期旧值」。两个事务同时接替同一过期 slot → **只能产生一个 current pointer**（测试 #30）。失败方不得留下第二个 active pointer。
7. **提交后**返回 fencing token：`{ leaseId, leaseGeneration, slotId, definitionEpoch, objectiveRevision }`。

**禁止：** 用 generation UNIQUE 冒充 active 唯一；事务外先读再写；agent 时钟判断过期；把未指向的历史 Lease 当 active。

### 2.5 Contribution

```ts
type EvidenceRef = {
  store: "ledger" | "evidence-store";
  refId: string;
};

type ObjectiveContribution = {
  schemaVersion: "objective-coordination/v1";
  contributionId: string;
  objectiveId: string;
  objectiveRevision: number;
  definitionEpoch: number;
  workUnitId: string;
  writer: CoordinationActor;
  contributionKind: ContributionKind;
  coversWorkUnitIds: string[];
  evidenceRefs: EvidenceRef[];
  leaseId: string;
  leaseGeneration: number;
  slotId: string;
  createdAtMs: number;
};
```

**Contribution 是执行产物索引，不是另一套进度状态机。**

写入约束（全部强制）：

1. **Append-only。** 已存在的 `contributionId` 不得改字段。重复提交同一 `contributionId` + 相同 payload → 幂等成功；payload 冲突 → 拒绝。
2. **`evidenceRefs` 必须由 Ledger / evidence store 解析成功。** 未解析、或 `store` 不支持 → 拒绝。
3. **归属匹配：** 解析后的 evidence 的 tenant、`objectiveId`、`objectiveRevision`、`workUnitId` 必须与 Contribution 一致；跨 tenant / revision / work unit → 拒绝（测试 #16）。
4. **assistant reply 不得**进入 `evidenceRefs` 或 Ledger evidence（I7 + 测试 #11）。
5. **`review` / `synthesis` 只能追加派生 Contribution**，不得修改源 Contribution（测试 #17）。覆盖关系见 **§2.5.2**。派生 evidence 不得冒充源 Work Unit 的 execute/research evidence。
6. **`execute` / `research` 写入必须通过 §2.4 CAS**（active pointer + matching epochs）。无有效 fence 不得写。`review` / `synthesis` 必须持有 **本** review/synthesis Work Unit 的有效 lease。
7. 协作 Contribution 的 `writer` 必须是 `participant` 且 `participationEpoch` 与 Lease、当前 Participation 三者一致。单聊 / Cron 的 `writer` 必须是 `runtime`。

单个 Contribution **不得**直接关闭整个 Objective。

### 2.5.2 Contribution.coversWorkUnitIds（v0.4.5 冻结）

Definition 上的 `coversWorkUnitIds` 是 **允许/必须覆盖的声明**。一次写入实际覆盖了哪些源单元，必须记在 **该条** Contribution 上，不得靠实现者外推。

| `contributionKind`     | `coversWorkUnitIds`                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `execute` / `research` | **必须为空**（测试 #32）                                                                  |
| `review` / `synthesis` | **必须非空**，且为所属 `WorkUnitDefinition.coversWorkUnitIds` 的 **子集**（测试 #32/#33） |

附加校验（任一失败 → 拒绝写入）：

1. 每个被覆盖的 `workUnitId` 必须属于 **同一** `objectiveId` + `objectiveRevision`，且其 Definition 的 `definitionEpoch` 在写入时有效（测试 #34）。
2. **禁止**覆盖其他 Objective、其他 revision、或已 stale 的 definition epoch。
3. **禁止**写入 Definition 声明集合之外的 id（超出范围 → 拒绝，测试 #33）。
4. 覆盖关系 **只能追加**（新 Contribution 行）；**不得**改源 Contribution，也不得事后改本行的 `coversWorkUnitIds`（append-only + #17）。

**Phase 5 实际覆盖：**

```text
actualCoverage(reviewOrSynthesisUnit) =
  UNION coversWorkUnitIds
  from valid Contributions of that unit
  (current revision + definitionEpoch + matching kind)

unitCoverageSatisfied ⇔
  Definition.coversWorkUnitIds ⊆ actualCoverage
```

只看 Definition 声明、没有对应 Contribution 覆盖行 → **未覆盖**，Objective 不得完成（测试 #5）。

### 2.5.1 eligibleContributorCount（v0.4.4 冻结）

`minContributors` **不得**按 Contribution 行数、lease 数或 slot 数计算。同一 executor 可在一个 lease 下写多条、过期后重领、跨 generation 累积记录——按行数会计成「多个贡献者」。

```text
contributorIdentity =
  participant  → participantId          （不含 participationEpoch）
  runtime      → 该 ingress 的可信 runtime identity（chat: 主 run 的稳定 agent/run principal；cron: occurrence identity）

eligibleContributorCount(workUnit) =
  COUNT DISTINCT contributorIdentity
  WHERE 至少一条 valid Contribution
    AND contribution.objectiveRevision == frozen snapshot
    AND contribution.definitionEpoch == current WorkUnitDefinition.definitionEpoch
    AND contribution.contributionKind == workUnit.contributionKind
    AND evidence 已解析且归属匹配
```

| 规则                  | 合同                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 离组再加入            | 同一 `participantId` **仍计 1**，不得因 `participationEpoch` 变化重复计数（测试 #31）                                              |
| 跨 lease generation   | 同一 identity 多 generation / 多条 Contribution **仍计 1**（测试 #31）                                                             |
| 跨 `contributionKind` | **默认不得混算**。`review` / `synthesis` 单元只统计本单元 kind；不得把 execute/research 的 writer 算进 review 的 `minContributors` |
| stale                 | 其他 Objective revision 或旧 `definitionEpoch` 的 Contribution **不计数**                                                          |
| orchestrator          | 不是 writer identity，不得计入                                                                                                     |

`satisfied`（required Work Unit）= `eligibleContributorCount >= minContributors` 且该 identity 集合上的 acceptanceIds 证据通过。

---

## 3. Ingress 执行语义

### 3.1 单聊任务

- 一个用户任务可以由主 agent 负责。
- 默认 **一条** `WorkUnitDefinition`：`coordinationPolicy: "exclusive"`，`contributionKind: "execute"`，`required: true`，`createdBy: { kind: "runtime", runId }`。
- 不建立 Participation；Lease / Contribution 的 actor 均为 `runtime`。
- 子 agent 必须继承父级 Objective snapshot（同一 `objectiveId` + `revision`）。
- 子 agent **不得**自行解析或修改 Objective，**不得**自建冲突的 WorkUnitDefinition，**不得**把 runtime actor 改写成 participant。

### 3.2 Cron isolated

- 同一 **scheduled occurrence** 对应一条 exclusive Work Unit；`createdBy` / executor 为 `{ kind: "runtime", runId: occurrenceId }`。
- **不得**把不同执行周期当成同一个永久 lease 或同一个 `workUnitId`。
- runtime **可以**合法创建该 Work Unit；**不得**伪装成 `participant`（测试 #24）。
- completion 继续遵守 **content / validation / delivery** 分离合同（I15）。

### 3.3 协作小组

- 多个成员可以同时绑定同一 Objective revision（各有 Participation）。
- **禁止**对 Objective 做全局 exclusive claim。
- 每个执行者必须绑定明确的 `WorkUnitDefinition`（`workUnitId` + `contributionKind` + policy），而不是自报 role。
- 有意交叉验证：`coordinationPolicy: "shared"` 且 `minContributors ≥ 2`。
- review / synthesis 只追加派生 Contribution，不覆盖源记录。
- **单一成员不得**把共享 Objective 标记为 `completed`。
- 最终完成由 **协作 round policy** 按 `WorkUnitDefinition` + Contribution + Ledger evidence 聚合判定。

**禁止：** 把单聊的 exclusive 单单元模型复用到协作组（Phase 3a ≠ Phase 3b）。

---

## 4. 强制不变式（I16–I25）

本表是本增补的 **权威 invariant 集合**（与主方案 §9 的 I16–I25 **同行对齐**）。实施与 PR 门禁必须按本表，不得只实现 §2 叙述而跳过表内 ID。

| ID  | 摘要                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I16 | 协作 Objective 允许多 participant 共同绑定；禁止对共享 Objective 全局 exclusive claim                                                                                                            |
| I17 | 排他只作用于 `workUnitId`；`coordinationPolicy` 属于不可变 WorkUnitDefinition（exclusive \| shared）；ContributionKind 正交。Lease 不得覆盖 policy                                               |
| I18 | Contribution 必须携带 objectiveId、revision、definitionEpoch、workUnitId、writer、contributionKind、coversWorkUnitIds、可解析 evidenceRefs、leaseId、leaseGeneration、slotId；append-only + 幂等 |
| I19 | 协作 Objective 只能由 round completion policy 按 required WorkUnitDefinition 聚合后完成；单个成员不得直接 closed                                                                                 |
| I20 | 所有 participant / definition / lease / contribution 必须使用同一冻结 Objective revision；旧 revision 不得写入新 revision                                                                        |
| I21 | Orchestrator 只分解、分配、协调；不得生成 Ledger evidence、替代 validator、或直接判定 acceptance met                                                                                             |
| I22 | 写 Contribution 必须 CAS：该 **slot** 的 `(leaseId, leaseGeneration)` 仍 active，且 definitionEpoch /（协作）participationEpoch 匹配。回收一个 slot **不得**使其他有效 lease 失效                |
| I23 | `claimWorkUnit` 必须在单一事务/CAS 内完成。每 slot 的 current active 只由 `ActiveLeasePointer` 表示。过期用 `storeNowMs()`。同一 executor 每 Work Unit 最多一个 active slot                      |
| I24 | `minContributors` 比较 distinct writer identity（当前 revision + definitionEpoch + 同 contributionKind）。同一 participant 多条/跨 generation/离组重入仍计 1                                     |
| I25 | execute/research 的 coversWorkUnitIds 必须为空；review/synthesis 必须非空且为 Definition 子集。completion 使用 Contribution 实际覆盖并集                                                         |

**I25 完整定义（与主方案 §9 逐字一致）：** execute/research 的 coversWorkUnitIds 必须为空；review/synthesis 必须非空且为 Definition 子集。completion 使用 Contribution 实际覆盖并集。

「Definition 子集」强制含义：覆盖目标属于同一 Objective revision，且其 WorkUnitDefinition 的 definitionEpoch 在写入时有效；不得超出该 review/synthesis 单元 Definition 声明的 `coversWorkUnitIds`。细则与例子见 §2.5.2。**测试 #32–#34 证明 I25。**

---

## 5. Phase 2 设计交付与 shadow 边界

[Phase 2 shadow 实施计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) **已签收**。[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 实现 **已批准合入，进入观测期**。Shadow **只观测**：

- `ResolvedObjective` 冻结快照（Phase 0 allowlist + `objectiveId` / `revision` / `source`）；
- **拟议** `WorkUnitDefinition`（推导或计划中的分工，只读投影）。

Shadow **禁止**：

- 创建真实 Participation、`WorkUnitLease`、`ActiveLeasePointer` 或 `ObjectiveContribution`；
- 写 Ledger；
- 改 prompt、运行状态或 completion。

默认 OFF（I14）。**不得**把 shadow 做成「预创建 lease」。

Phase 3a / 3b **不**随本合同或 shadow 批准自动放行。

---

## 6. Revision、epoch 与 stale 规则

1. Definition / lease / contribution **必须**携带冻结的 `objectiveRevision`。
2. Objective revision 递增后：旧 definition / lease / contribution 全部 stale；可供审计，**不得**计入新 revision 的 completion / alignment；旧 lease **不得**写入新 revision（I20）。
3. `definitionEpoch` 递增后：旧 `definitionEpoch` 的 lease / Contribution 不得写入新定义（测试 #21）。
4. 某 **slot** 的 `leaseGeneration` 递增后：仅该 slot 的旧 generation 写入拒绝；**其他 slot 不受影响**（I22，测试 #20）。
5. 协作 `participationEpoch` 递增或离组后再加入：旧 epoch 的 lease 不得写入（测试 #22/#23）。
6. 子 agent 只能继承父 snapshot 的 revision，不得换目标（测试 #8）。
7. Cron：Work Unit / lease 绑定 **occurrence identity**（`runtime.runId`），不是永久 `jobId`（测试 #9/#24）。

---

## 7. Schema 版本与兼容

| 规则     | 要求                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 版本字段 | 新增类型一律带 `schemaVersion: "objective-coordination/v1"`                                          |
| 未知字段 | 读者忽略；写者不得丢已知必填字段                                                                     |
| Flag OFF | 不持久化 participation / definition / lease / contribution，不写 Ledger（测试 #12）                  |
| 存储     | **不**新增第二套 Progress Ledger；WorkUnitDefinition 不是 Ledger step；Contribution 只索引已解析证据 |
| 演进     | 破坏性变更必须升 major（`v2`）；不得 silently coerce 旧 revision / 旧 epoch 写入                     |

---

## 8. 后续 Phase（合同调整，非本修订实现）

### Phase 1b（进行中，范围冻结）

仅 Cron L2 task-focus prompt；默认 OFF；无 alignment；无 Objective Lease；无协作改造。**本修订不得夹带。**

### Phase 2 shadow（[计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) 已签收；[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 已批准合入，进入观测期）

只观测 ResolvedObjective + 拟议 WorkUnitDefinition；**不创建** Participation / 持久化 WorkUnitDefinition / Lease / ActiveLeasePointer / Contribution / Ledger；不改变运行结果。见 §5。不是 Phase 3。观测期仍须单独验收窗口运行、冲突/allowlist/inherit 指标、forbidden-write=0、窗口关闭证据。

### Phase 3 — Ingress 接入（3a / 3b 分别验收）

| 批次   | 范围                                                           | 禁止                                                 |
| ------ | -------------------------------------------------------------- | ---------------------------------------------------- |
| **3a** | 单聊、Cron、Subagent 接入 Objective snapshot                   | 不把协作组当成单执行者；不自动创建协作 Participation |
| **3b** | 协作组接入 Shared Objective、Participation、WorkUnitDefinition | 不得复用单聊 exclusive 单单元模型                    |

### Phase 4 — Alignment Shadow

分别评估：(1) Contribution ↔ 自己的 Work Unit；(2) Work Unit 仍属于冻结 revision 且 definitionEpoch 有效；(3) synthesis/review 的 **Contribution.coversWorkUnitIds** 忠实覆盖声明集合。**不得**用成员局部分工对完整 Objective 做关键词重叠。

### Phase 5 — Completion Gate

协作完成条件 **至少**包括：

```text
every WorkUnitDefinition where required=true is satisfied
AND each required unit's acceptanceIds have valid, resolved evidence
AND review/synthesis 的 Contribution 实际覆盖并集包含 Definition 声明
AND no unresolved blocking dependency or review unit
AND contribution.objectiveRevision == frozen snapshot
AND no stale/rejected fence writes counted as evidence
```

「satisfied」= 该单元按 **§2.5.1** 的 `eligibleContributorCount >= minContributors`，且这些 contributor 的 acceptanceIds 证据通过。review/synthesis 另须满足 **I25**：Contribution 实际覆盖并集包含 Definition 声明；不得只看 Definition 声明（测试 #5）。单个 agent 只能完成其 Work Unit。**required Work Unit 未满足 → Objective 不完成**（测试 #19）。

### Phase 8 — Orchestrator

**只允许：** 按 **§2.2.3** 创建/修订 `WorkUnitDefinition`（协作下 `createdBy` 为 server-derived `orchestrator` **或** 有效 `participant`）；指定 `coordinationPolicy` 与 `contributionKind`（写在定义上）；建议分配（真正 claim 仍走 §2.4.1，orchestrator **不**持有 lease）；检测重复领取、policy 覆盖、stale revision / definitionEpoch / slot generation；触发 review/synthesis 单元；聚合状态。

**禁止：** 生成 evidence；把 assistant 自述写成 Ledger 事实；直接设置 acceptance met；绕过协作 round completion policy；用 orchestrator 身份 claim lease 或写 Contribution（测试 #25）。

每个 Phase：**独立 PR、独立 flag、独立回滚。**

---

## 9. 测试矩阵（实现前必交；本修订冻结）

| #   | 用例                                                                  | 期望                                                                                                                             |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 两个 agent 领取同一 `exclusive` `workUnitId`                          | 后者拒绝或排队；不得双活 lease                                                                                                   |
| 2   | 两个 agent 领取同一 Objective 下 **不同** Work Unit                   | 允许（跨单元并发，与 policy 无关）                                                                                               |
| 3   | `shared` 且 `minContributors ≥ 2`                                     | 允许有意多执行者领取同一 Work Unit；超过 `maxContributors` 拒绝                                                                  |
| 4   | reviewer 读取源 Contribution                                          | 可读；**不得修改**原始记录；只可追加派生 Contribution                                                                            |
| 5   | synthesis 的 Contribution 实际覆盖并集未包含 Definition 声明          | **不得**完成 Objective（不认只看 Definition）                                                                                    |
| 6   | 单成员完成自己的 Work Unit                                            | 共享 Objective **仍 active**                                                                                                     |
| 7   | Objective revision 变化后旧 lease 写入                                | **拒绝或隔离**                                                                                                                   |
| 8   | Subagent 与父 Objective                                               | 继承同一 revision；**不得**自行换目标                                                                                            |
| 9   | Cron occurrence                                                       | 重复 tick 去重；不同 occurrence 可正常执行                                                                                       |
| 10  | 成员只完成局部分工                                                    | alignment **不得**误报整个 Objective 漂移                                                                                        |
| 11  | assistant reply                                                       | **不得**成为 Contribution evidence 或 Ledger evidence                                                                            |
| 12  | feature flag OFF                                                      | 不写 participation、definition、lease、contribution 或 Ledger                                                                    |
| 13  | 领取者声明与 `WorkUnitDefinition.coordinationPolicy` 冲突的 claim     | **拒绝**；Lease 不得覆盖定义上的 policy                                                                                          |
| 14  | lease 过期后原 executor 写 Contribution                               | **拒绝**                                                                                                                         |
| 15  | 同 slot 被接替后 A 用旧 `leaseGeneration` 写回                        | **拒绝**（即使 objectiveRevision 相同）                                                                                          |
| 16  | evidence 跨 tenant / Objective revision / work unit                   | **拒绝**                                                                                                                         |
| 17  | reviewer / synthesis 修改已存在的源 Contribution 或其覆盖关系         | **拒绝**；只允许追加新行                                                                                                         |
| 18  | 非 group member 建立 Participation                                    | **拒绝**                                                                                                                         |
| 19  | `required: true` 的 Work Unit 未满足                                  | Objective **不完成**                                                                                                             |
| 20  | shared：A、B 持有不同 slot；A 过期由 C 接替                           | **B 的 lease 仍 active**；仅 A 的 slot generation +1                                                                             |
| 21  | 旧 `definitionEpoch` 的 lease 写入                                    | **拒绝**                                                                                                                         |
| 22  | role/scope 变更导致 `participationEpoch` 更新后，旧 lease 写入        | **拒绝**                                                                                                                         |
| 23  | 离组后再加入（新 participationEpoch）                                 | **不得**复活旧 lease / 旧 epoch 写权限                                                                                           |
| 24  | Cron / runtime 创建 Work Unit                                         | **合法**；`createdBy.kind` 必须是 `runtime`；写成 `participant` → **拒绝**                                                       |
| 25  | 协作 Orchestrator 创建 Definition                                     | **允许**（server-derived + `actingForGroupId` + `policyDecisionRef`）；**不得**因此取得 participant lease 或 Contribution 写权限 |
| 26  | 两个并发 `claimWorkUnit` 同一 exclusive Work Unit                     | **严格只有一个成功**；另一个失败或看到已占用                                                                                     |
| 27  | `shared` 且 active = `maxContributors - 1` 时两个并发 claim           | 最终 active **不得超过** `maxContributors`                                                                                       |
| 28  | claim 过程中 `definitionEpoch` 同时变化                               | claim **失败**；允许按新 epoch 重试                                                                                              |
| 29  | 同一 executor 对同一 Work Unit 再 claim 第二个 shared slot            | **拒绝**新 slot；若已持有则幂等返回原 token                                                                                      |
| 30  | 两个事务同时接替同一过期 slot                                         | **只能**产生一个 current `ActiveLeasePointer`；历史 Lease 可保留，不得同时 active                                                |
| 31  | 同一 participant 写多条、跨 lease generation 重写、或离组再加入       | `eligibleContributorCount` **只计 1**；不得用行数凑满 `minContributors`                                                          |
| 32  | execute/research 带非空 `coversWorkUnitIds`；或 review/synthesis 为空 | **拒绝**                                                                                                                         |
| 33  | review/synthesis 的覆盖超出所属 Definition.coversWorkUnitIds          | **拒绝**                                                                                                                         |
| 34  | 覆盖目标属于其他 Objective、其他 revision、或 stale definitionEpoch   | **拒绝**                                                                                                                         |

本修订 **只冻结矩阵**，不提交实现或测试代码。

---

## 10. 明确不改

- Phase 1b 运行时范围与默认 OFF。
- Cron isolation、CommandLane、协作 round-runtime 既有边界。
- Progress Ledger 真源与 I7。
- 生产行为：本修订 **零运行时变更**。
- Phase 2 shadow / Phase 3a / Phase 3b：本修订通过后仍须 **分别批准**。

---

## 11. 验收清单（v0.4.6）

- [ ] 本增补 §4 标题为 **I16–I25**；表内 I16…I25 按序完整，无插队
- [ ] **I25 与主方案 §9 逐字一致**
- [ ] 测试 #32–#34 证明 I25
- [ ] Phase 5 completion 条件与主方案一致：实际覆盖并集包含 Definition 声明；不得只看声明
- [ ] Phase 2 shadow 仍只观测 Objective + 拟议 Definition，不创建真实协调对象
- [ ] Phase 1b 范围未扩大；无运行时代码
- [x] 独立 shadow 实施计划已提交（不得直接进 Phase 3）

**Phase 2 合同 v0.4.6 + shadow 计划 v0.1 已签收。PR #1107 已批准合入并进入观测期。仍不批准 3a / 3b / 4 / 5。**

---

## 12. 修订历史

| 版本                | 说明                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| 0.4                 | 初版增补：Shared Objective 四层；Lease 自带 coordinationMode（**已否决**）                     |
| **0.4.1**           | WorkUnitDefinition + 全局 leaseEpoch（**shared 误杀已否决**）                                  |
| **0.4.2**           | slot 级 fencing + actor provenance。专家：创建者规则自相矛盾；claim 非原子                     |
| **0.4.3**           | 授权矩阵 + 原子 claim。专家：generation UNIQUE 不能保证单 active；minContributors 按行数会虚增 |
| **0.4.4**           | 方案 A + distinct contributors。专家：Contribution 无法表达实际覆盖范围                        |
| **0.4.5**           | 增加 coversWorkUnitIds 规则，但 I25 未按序进入本增补权威表                                     |
| **0.4.6**           | §4 权威表 I16–I25；I25 与主方案逐字一致；#32–#34 证明 I25；Phase 5 措辞对齐                    |
| **shadow 计划 0.1** | 指向独立实施计划；不改 I16–I25；实现仍不批准                                                   |
