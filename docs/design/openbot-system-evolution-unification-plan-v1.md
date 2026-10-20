# OpenBot 系统进化统一改造方案 V1.0

> 日期：2026-09-06  
> 状态：实施草案，待架构评审  
> 目标：统一现有五条进化链路，收敛为一个受治理、可验证、可回滚的完整闭环  
> 适用对象：Cursor 实施团队、架构评审、产品治理、运维与安全负责人

## 1. 决策摘要

OpenBot 不缺少进化能力，缺少的是统一控制平面。

当前 Agent 行为、经验知识、Skill、组织协作和运行时治理已经分别形成不同程度的局部闭环。此次改造不得重写这些领域系统，也不得建立第二套业务状态。改造的职责是增加统一的进化控制平面，使五条链路共享：

1. 统一的证据与机制来源。
2. 统一的提案、授权和风险模型。
3. 统一的实验合同与接受门。
4. 统一的应用、验证、晋升和回滚语义。
5. 统一的跨域谱系与审计记录。

目标闭环：

```text
Observe
  -> Mine
  -> Propose
  -> Scope and Authority Gate
  -> Experiment
  -> Approve for Application
  -> Apply through Domain Adapter
  -> Verify
      -> improved: Promote and Monitor
      -> neutral: Hold or Extend Experiment
      -> regressed: Rollback and Re-mine
```

核心原则：领域系统负责“如何改变自身”，统一控制平面负责“为什么允许改变、如何证明改变有效”。

## 2. 改造范围

### 2.1 纳入统一的五条链路

| 进化链路             | 现有领域真相源                                                          | 统一后的进化对象                       |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Agent 行为进化       | `src/gateway/agent-growth/*`                                            | Working DNA、行为参数、自治策略        |
| 知识与经验进化       | `src/gateway/collaboration-learning/*`、`packages/collaboration-core/*` | Capsule、Learning Asset、受治理 Memory |
| 能力与 Skill 进化    | `src/gateway/skill-lifecycle-store.ts` 等                               | Skill Spec、Skill Version、安装关系    |
| 组织与协作进化       | `src/organization/*`、协作运行时                                        | 角色、团队结构、任务路由、协作策略     |
| 系统与运行时治理进化 | `src/diagnosis/*`、`src/gateway/evolution-governance/*`                 | Harness 契约、运行时治理策略与动作     |

### 2.2 明确不做

- 不在线更新模型权重。
- 不允许 Diagnosis 直接调用修复、发布、安装或运行时 mutation。
- 不新建 Working DNA、Capsule、Skill、Organization 的平行存储。
- 不将现有五条链路搬进一个巨型模块。
- 不默认开启 `auto` 模式。
- 不在本改造中执行生产切换、LIVE cutover 或历史清理。
- 不以单一综合分数替代安全、成本、延迟和业务价值的独立判断。

## 3. 现状与结构性问题

### 3.1 已具备的基础

Diagnosis 已经具有受授权的进化提案状态机：

- `src/diagnosis/evolution-proposal.ts`
- `src/diagnosis/delegation.ts`

Agent Growth 已经具有 Working DNA 持久化、生效、效果评估和回滚能力：

- `src/gateway/agent-growth/genome.ts`
- `src/gateway/agent-growth/working-style-store.ts`
- `src/gateway/agent-growth/working-style-self-tuning.ts`
- `src/gateway/agent-growth/working-style-effectiveness.ts`

Collaboration Learning 已经具有经验胶囊生成、审批、投影和晋升能力：

- `src/gateway/collaboration-learning/execution-outcome-capsule.ts`
- `src/gateway/collaboration-learning/review-outcome-capsule.ts`
- `src/gateway/collaboration-learning/capsule-governance.ts`

Skill Lifecycle 已经覆盖草稿、评审、发布、安装、弃用和回滚等资产阶段。

Evolution Governance 已经具有 `off / assist / auto` 模式、kill switch、持久动作记录和 compare-and-restore：

- `src/gateway/evolution-governance/mode.ts`
- `src/gateway/evolution-governance/tick-pipeline.ts`
- `src/gateway/evolution-governance/runtime-actions.ts`
- `src/gateway/evolution-governance/persistent-store.ts`

### 3.2 当前主要问题

1. 五条链路使用不同的 candidate、approval、application、verification 和 rollback 语义。
2. Proposal 与真实运行时动作之间没有统一实验对象。
3. 部分链路以“前后分数变化”代替因果验证。
4. 同一时期多个进化项可能同时改变 Agent 行为，效果无法归因。
5. 领域内有审计记录，但缺少跨域的统一谱系查询。
6. `APPROVED`、`APPLIED` 和 `VERIFIED` 在不同子系统中含义不一致。
7. Diagnosis Proposal 和 Evolution Governance 尚未形成正式的受控交接合同。

## 4. 目标架构

### 4.1 三个平面

```text
+--------------------------------------------------------------+
| Evidence Plane                                               |
| Task / Diagnosis / Feedback / Skill / Cost / Security        |
|        -> Evidence Bundle -> Pattern and Failure Mining       |
+------------------------------+-------------------------------+
                               |
                               v
+--------------------------------------------------------------+
| Evolution Control Plane                                      |
| Proposal Registry | Surface Registry | Authority Gate         |
| Experiment Manager | Decision Engine | Evolution Ledger       |
+------------------------------+-------------------------------+
                               | approved application
                               v
+--------------------------------------------------------------+
| Change Plane                                                  |
| Agent Adapter | Knowledge Adapter | Capability Adapter        |
| Organization Adapter | System and Runtime Adapter             |
+------------------------------+-------------------------------+
                               |
                               v
                 Verify -> Promote / Hold / Rollback
                               |
                               +----------> Evidence Plane
```

### 4.2 平面职责

#### Evidence Plane

- 只读获取运行证据。
- 冻结可复现的 Evidence Bundle。
- 生成 Failure Cluster、Success Pattern 和 Capability Gap。
- 不持有任何领域 mutation capability。

#### Evolution Control Plane

- 接收和管理 Evolution Proposal。
- 校验 Surface、SoT、tenant、grant 和审批权。
- 编排实验和接受门。
- 调用领域 Adapter，但不保存领域业务对象。
- 记录端到端谱系。

#### Change Plane

- 由领域 Adapter 执行实际改变。
- 生成版本、幂等键和恢复快照。
- 只允许在有效授权和已批准实验下运行。
- 对应用结果提供可重测的观察接口。

## 5. 唯一真相源

统一控制不等于统一存储。下表必须作为设计约束：

| 对象                     | 唯一真相源                   | 控制平面保存内容                  |
| ------------------------ | ---------------------------- | --------------------------------- |
| Proposal 生命周期        | Evolution Control Plane      | 完整对象                          |
| Working DNA              | Agent Growth                 | ID、版本和快照引用                |
| Capsule / Learning Asset | Collaboration Learning       | ID、版本和状态引用                |
| Skill 资产               | Skill Lifecycle              | skillId、version、installationRef |
| 组织结构与协作状态       | Organization / Collaboration | groupId、revision、changeRef      |
| Runtime action 恢复快照  | Evolution Governance         | actionRef、rollbackRef            |
| Experiment               | Experiment Store             | 完整对象与指标结果                |
| 跨域审计谱系             | Evolution Ledger             | 不可变事件和对象引用              |

禁止控制平面复制领域对象正文后成为新的业务真相源。

## 6. 统一领域模型

建议新建独立、无 Gateway 依赖的核心包：

```text
packages/evolution-core/
  src/
    types.ts
    state-machine.ts
    contracts.ts
    decisions.ts
    metrics.ts
    index.ts
```

运行时编排保留在 Gateway：

```text
src/gateway/evolution-control/
  proposal-service.ts
  authority-gate.ts
  surface-registry.ts
  experiment-manager.ts
  application-service.ts
  verification-service.ts
  evolution-ledger.ts
  adapters/
    working-dna.ts
    capsule.ts
    skill.ts
    organization.ts
    runtime-governance.ts
```

以上名称是建议落点。实施前须检查模块边界和 package exports，不得为了目录整齐迁移现有领域实现。

### 6.1 Evolution Target

```ts
export type EvolutionTarget =
  | { domain: "agent"; agentId: string }
  | { domain: "knowledge"; assetId: string }
  | { domain: "capability"; skillId: string }
  | { domain: "organization"; groupId: string }
  | { domain: "system"; componentId: string };
```

### 6.2 Evolution Proposal

复用 `src/diagnosis/evolution-proposal.ts` 已有模型并向核心包收敛，不应平行新增第二种 Proposal。

```ts
export type EvolutionProposal = {
  schemaVersion: 2;
  proposalId: string;
  sourceEvidenceRefs: string[];
  sourceMechanismRef: string;
  target: EvolutionTarget;
  candidateRef: string;
  surfaceId: string;
  expectedEffects: MetricExpectation[];
  riskLevel: "low" | "medium" | "high" | "critical";
  confidentialityScope: "personal" | "enterprise" | "platform";
  tenantScope: string | null;
  grantId: string;
  status: EvolutionProposalStatus;
  createdAt: string;
  expiresAt: string;
};
```

迁移要求：

- Schema v1 必须继续可读。
- v1 domain 映射到 v2 target，不回写或破坏历史对象。
- 保留现有 authorization、tenant 和 confidentiality 校验。
- `proposedChange` 正文仍不得携带 runtime payload。

### 6.3 Evolution Experiment

Experiment 是本次改造必须新增的一等对象：

```ts
export type EvolutionExperiment = {
  schemaVersion: 1;
  experimentId: string;
  proposalId: string;
  baselineRef: string;
  candidateRef: string;
  datasetRef?: string;
  modelRef?: string;
  configRef: string;
  assignment: {
    strategy: "offline" | "shadow" | "ab" | "canary";
    treatmentRefs: string[];
    controlRefs: string[];
  };
  primaryMetric: MetricContract;
  guardrailMetrics: MetricContract[];
  minimumSampleSize: number;
  startedAt?: string;
  expiresAt: string;
  result: "pending" | "improved" | "neutral" | "regressed" | "inconclusive";
};
```

### 6.4 Evolution Application

```ts
export type EvolutionApplication = {
  schemaVersion: 1;
  applicationId: string;
  proposalId: string;
  experimentId: string;
  adapterId: string;
  idempotencyKey: string;
  targetVersionBefore: string;
  targetVersionAfter: string;
  rollbackRef: string;
  scope: "shadow" | "canary" | "active";
  status: "pending" | "applied" | "failed" | "rolled_back";
  appliedAt?: string;
};
```

### 6.5 Evolution Verification

```ts
export type EvolutionVerification = {
  schemaVersion: 1;
  verificationId: string;
  applicationId: string;
  baselineWindowRef: string;
  evaluationWindowRef: string;
  primaryEffect: number | null;
  guardrailResults: GuardrailResult[];
  sampleSize: number;
  confidence: number | null;
  outcome: "improved" | "neutral" | "regressed" | "inconclusive";
  evidenceRefs: string[];
  verifiedAt: string;
};
```

现有 `outcome: "linked"` 只能表示验证对象已关联，不得映射为 `improved` 或 `VERIFIED`。

## 7. 统一状态机

建议状态如下：

```text
DISCOVERED
  -> SUGGESTED
  -> PENDING_AUTHORITY
  -> APPROVED_FOR_EXPERIMENT
  -> EXPERIMENTING
      -> REJECTED
      -> HELD
      -> APPROVED_FOR_APPLICATION
  -> CANARY
      -> ROLLED_BACK
      -> ACTIVE
  -> VERIFIED
  -> PROMOTED
```

终态：

- `REJECTED`
- `ROLLED_BACK`
- `EXPIRED`
- `REVOKED`
- `PROMOTED`

状态约束：

1. `APPROVED_FOR_EXPERIMENT` 不授予真实应用权限。
2. `APPROVED_FOR_APPLICATION` 必须引用成功或被权威豁免的 Experiment。
3. `ACTIVE` 不等于 `VERIFIED`。
4. `VERIFIED` 必须引用真实 Verification 指标，而不是单纯 receipt。
5. `PROMOTED` 仍进入长期回归监测。
6. Grant 过期或撤销后禁止扩大 scope。
7. `ROLLED_BACK` 必须保存回滚结果和新的 Failure Cluster 引用。

## 8. Surface Registry

### 8.1 目的

Surface Registry 用于描述哪些对象可以被进化、谁拥有定义权、允许什么动作、如何验证和如何恢复。它是策略索引，不是领域数据仓库。

```ts
export type EvolutionSurface = {
  surfaceId: string;
  domain: EvolutionTarget["domain"];
  sourceOfTruth: string;
  authorityRole: string;
  allowedOperations: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  experimentStrategy: "offline" | "shadow" | "ab" | "canary";
  requiredApprovals: string[];
  requiredRegressionLocks: string[];
  adapterId: string;
  rollbackStrategy: string;
};
```

### 8.2 首批 Surface

| Surface ID                          | 风险     | 默认实验           | 默认自动应用 |
| ----------------------------------- | -------- | ------------------ | ------------ |
| `agent.working-dna`                 | medium   | A/B 或 canary      | 否           |
| `knowledge.experience-capsule`      | low      | offline + shadow   | 否           |
| `knowledge.managed-memory`          | high     | shadow             | 否           |
| `capability.skill-spec`             | medium   | offline + canary   | 否           |
| `capability.skill-installation`     | high     | canary             | 否           |
| `organization.task-routing`         | high     | shadow + canary    | 否           |
| `organization.team-composition`     | high     | shadow             | 否           |
| `system.diagnosis-contract`         | medium   | offline regression | 否           |
| `system.runtime-binding-governance` | critical | canary             | 否           |

模型权重、生产 cutover、核心身份、安全授权和密钥管理不得作为普通 Surface 注册。

## 9. Experiment 与接受门

### 9.1 实验冻结项

每个实验必须冻结：

- baseline 版本。
- candidate 版本。
- 代码 SHA。
- 模型和供应商版本。
- 配置快照。
- 数据集或 cohort 分配。
- tenant 和 confidentiality 范围。
- 开始、截止和最大资源预算。

### 9.2 指标合同

每个实验只能有一个 primary metric，但可以有多个 guardrail metrics。

候选主指标：

- 任务成功率。
- 首次交付通过率。
- 人工修订率。
- 问题复发率。
- Skill 成功率。
- 用户满意度。

必选保护指标：

- 权限和安全违规。
- 人工接管率。
- 错误重试率。
- P95 延迟。
- Token 与货币成本。
- 渠道投递失败率。
- 跨租户污染事件。

### 9.3 接受条件

```text
primary metric 达到预先声明的最小效应
AND critical guardrail 零退化
AND 其他 guardrail 在预算内
AND minimum sample size 达标
AND 置信度达到 surface 要求
AND 回滚演练通过
```

样本不足、基线污染或模型版本改变时，结果必须是 `inconclusive`，不得按“未发现退化”批准。

### 9.4 并发进化隔离

同一 target 同一时间默认只能有一个 active experiment。允许并发时必须满足：

- Surface 不重叠。
- 指标不存在共同强因果路径。
- 实验记录明确组合关系。
- 任一候选回滚不会破坏另一个候选的恢复快照。

## 10. Adapter 合同

统一控制平面不得直接操作领域存储。每个领域通过 Adapter 接入：

```ts
export interface EvolutionAdapter<TCandidate = unknown> {
  readonly adapterId: string;
  readonly domain: EvolutionTarget["domain"];

  inspect(target: EvolutionTarget): Promise<TargetSnapshot>;
  validate(candidate: TCandidate, context: EvolutionContext): Promise<ValidationResult>;
  apply(input: ApplyEvolutionInput<TCandidate>): Promise<EvolutionApplication>;
  observe(input: ObserveApplicationInput): Promise<MetricObservation[]>;
  rollback(application: EvolutionApplication): Promise<RollbackResult>;
}
```

Adapter 硬约束：

- 所有 apply 必须幂等。
- apply 前再次验证 grant、tenant、surface 和 candidate version。
- 所有可变更操作必须生成 before snapshot 或等价恢复引用。
- rollback 只恢复本次 application 改变的字段。
- Adapter 不得自行把 Proposal 标记为 VERIFIED。
- Adapter 不得扩大 application scope。

## 11. 五条链路的接入方式

### 11.1 Working DNA Adapter

保留 Agent Growth 为 Working DNA SoT。

改造：

- 将 `deriveWorkingStyleDelta` 输出包装为标准 Candidate。
- 现有效果统计作为 Experiment observation 来源之一。
- 现有 suppression 和 rollback 作为领域恢复实现。
- 在统一实验启用后，禁止领域层自行完成跨 Agent 推广。

### 11.2 Capsule Adapter

保留 Collaboration Learning 为 Capsule SoT。

改造：

- execution/review 继续生成 candidate capsule。
- Capsule approve 只代表内容治理通过，不代表效果 VERIFIED。
- projection/promotion 前增加统一 application approval。
- 通过实际应用次数和下游任务效果完成验证。

### 11.3 Skill Adapter

保留 Skill Lifecycle 的版本与安装状态。

改造：

- Candidate 指向既有 Skill draft/version。
- offline validation 执行静态检查和测试。
- canary 只对指定 Agent 或 tenant 安装。
- Skill publish、install 和 promote 分别产生独立 application event。
- 回滚复用既有版本和安装关系，不复制 Skill 内容。

### 11.4 Organization Adapter

保留 Organization / Collaboration 的成员、角色和任务状态。

改造：

- 首期只支持 task routing 和 team composition candidate。
- 必须使用 shadow plan 展示预期分配，不直接改变真实任务。
- canary 仅作用于新任务，不迁移执行中的任务。
- rollback 恢复路由策略，不倒放已完成的组织行为。

### 11.5 Runtime Governance Adapter

复用 `runtime-actions.ts` 的 pause、limit、redirect 和 compare-and-restore。

改造：

- `auto` 模式不再等于所有规则可直接 mutation。
- 每种自动动作必须由 Surface Policy 显式授权。
- 已有 tick anomaly 转为 Proposal 或预授权低风险 Action。
- 高风险动作必须引用 approval 和 experiment/application。
- kill switch 保持最高优先级，并且不能被进化系统关闭。

## 12. 权限、安全与隐私

必须继承现有 Diagnosis Proposal 的权限模型：

- principal 来自可信上下文。
- tenant scope 不接受会话文本或模型输出作为权威来源。
- evidence 不得超过 grant 的 `allowedEvidence`。
- action 不得超过 grant 的 `allowedActions`。
- platform 聚合不得携带企业原始 Evidence。
- authorization 过期、撤销、消费或暂停后 fail closed。

新增要求：

- Evidence Bundle 记录数据保留期和删除策略。
- 指标聚合默认使用脱敏 ID。
- 训练用途与运行时验证用途必须分开授权。
- 用户对 Memory 的删除必须使对应实验失去原始证据引用，而不是保留隐形副本。
- 跨租户实验禁止共享原始任务、prompt、tool output 或 transcript。

## 13. Evolution Ledger

Ledger 记录跨域事实，不覆盖领域审计日志。

建议事件：

```text
proposal.created
proposal.authorized
experiment.started
experiment.completed
application.approved
application.applied
verification.completed
promotion.completed
rollback.started
rollback.completed
proposal.rejected
proposal.revoked
```

每条事件至少包含：

- eventId、schemaVersion、timestamp。
- proposalId、target、surfaceId。
- tenantScope、principalRef、grantId。
- evidenceRefs、experimentId、applicationId。
- previousEventHash 或等价防篡改关联。
- 领域 receipt 引用。

Ledger 不保存 transcript、完整 prompt、tool output 或 Skill 正文。

## 14. Gateway 与 RPC 边界

建议新增独立 method pack，避免继续扩大基础 Gateway 热文件：

```text
src/gateway/server-methods/evolution-control.ts
```

首期 RPC：

- `evolution.proposals.list`
- `evolution.proposals.get`
- `evolution.proposals.transition`
- `evolution.experiments.create`
- `evolution.experiments.get`
- `evolution.experiments.evaluate`
- `evolution.applications.apply`
- `evolution.applications.rollback`
- `evolution.verifications.get`
- `evolution.surfaces.list`
- `evolution.ledger.query`

写 RPC 必须：

- 使用可信 tenant 上下文。
- 有明确 scope 登记。
- 支持幂等 command ID。
- 返回领域 receipt，不返回静默成功。
- 不允许客户端提交 `verified=true` 或直接指定效果结论。

## 15. 迁移策略

### 15.1 兼容优先

- 现有 v1 Proposal 保持可读。
- 现有 Working DNA、Capsule、Skill 和 governance state 不搬迁。
- 新控制平面先建立引用，不接管现有写入。
- 首期所有新功能均为 `assist`。

### 15.2 双读单写

迁移期间允许控制平面读取旧状态和新索引，但领域业务对象只能由原 SoT 写入。禁止双写同一业务对象。

### 15.3 事件回填

历史对象可生成 `legacy.imported` Ledger 事件，但必须：

- 标记来源为 legacy。
- 不伪造缺失的 approval、experiment 或 verification。
- 不把历史 `APPLIED` 自动认定为 `VERIFIED`。

### 15.4 切换条件

只有满足以下条件后，某条链路才可切到统一状态机：

1. 状态映射覆盖所有旧状态。
2. 回放测试没有状态丢失。
3. Adapter 幂等和 rollback 测试通过。
4. 旧 RPC 和 UI 兼容测试通过。
5. Ledger 可从 proposal 追溯到领域 receipt。

## 16. 分阶段实施计划

### Phase 0：现状冻结与统一语义

目标：不改变任何运行行为，先解决定义权威。

任务：

- 建立五条链路对象、状态、存储、RPC 和 UI 的现状矩阵。
- 确认 Proposal v2、Experiment、Application、Verification 的字段。
- 建立 Surface Registry 初稿。
- 定义状态映射和禁止转换。
- 增加架构测试，禁止新增平行 Proposal 类型。

交付：

- `packages/evolution-core` 类型和纯状态机。
- Surface Registry 只读实现。
- 状态映射文档与测试。

验收：

- 无现有运行行为变化。
- 无领域数据迁移。
- Schema v1 测试继续通过。

### Phase 1：统一 Proposal 与 Ledger

目标：所有链路产生的候选都可由同一 Proposal 查询和审计。

任务：

- 将 Diagnosis Proposal 类型抽到核心包或通过兼容层复用。
- 实现 Proposal v1 -> v2 读映射。
- 接入 Working DNA、Capsule、Skill、Organization 和 Runtime candidate ref。
- 建立 append-only Evolution Ledger。
- 增加 tenant、grant 和 confidentiality 合同测试。

验收：

- 任一 Proposal 可追溯到来源 Evidence、目标、Surface 和 Candidate。
- Candidate 仍保存在原领域系统。
- 无 Proposal 可绕过 approval 进入 apply。

### Phase 2：Experiment Manager

目标：把“感觉有效”升级为可重复的验证合同。

任务：

- 实现 Experiment Store 和状态机。
- 实现 offline、shadow、A/B、canary 四种策略接口。
- 冻结 baseline、model、config、dataset/cohort。
- 实现 primary metric、guardrail 和 `inconclusive` 判定。
- 先接入 Working DNA 和 Skill 两条链路。

验收：

- 同一实验可重放并得到相同输入集合。
- 样本不足不能通过。
- control 与 treatment 不得交叉污染。
- 至少完成 Working DNA 和 Skill 的固定 fixture 实验。

### Phase 3：统一 Apply、Verify 与 Rollback

目标：五个领域均通过 Adapter 完成受控改变。

任务：

- 实现五个领域 Adapter。
- 所有 apply 生成 application、idempotency key 和 rollbackRef。
- 实现统一 Verification 结论。
- 回归自动生成 rollback recommendation；仅预授权 Surface 可自动回滚。
- 将回滚结果回流 Failure Cluster。

验收：

- 每个 Adapter 都有 apply twice、partial failure 和 rollback 测试。
- 回滚只恢复本次改变。
- `APPLIED` 不会被误报为 `VERIFIED`。

### Phase 4：有限自治

目标：仅对低风险、可逆、证据充分的 Surface 开启受限自动化。

任务：

- 将现有 `off / assist / auto` 扩展为 Surface 级策略。
- 建立自动化预算、TTL、最大影响范围和停止条件。
- 对长期回归启动监测。
- 在治理 UI 展示 proposal -> experiment -> application -> verification 全链。

验收：

- 默认仍为 `assist`。
- `critical` Surface 永不自动应用。
- kill switch 能立即停止新 application。
- 自动化不会扩大 tenant、principal 或 capability 权限。

## 17. Cursor 团队任务拆分

建议按所有权边界拆成以下任务，不建议多人同时修改同一热文件。

### T1：核心模型与状态机

范围：`packages/evolution-core/**`

- 定义 Proposal v2、Experiment、Application、Verification、Surface。
- 实现纯状态机和禁止转换。
- 提供 Schema v1 兼容类型。

完成标准：纯单元测试全绿，无 Gateway 依赖。

### T2：Surface Registry 与 Authority Gate

范围：`src/gateway/evolution-control/surface-registry*`、`authority-gate*`

- 注册首批九个 Surface。
- 复用现有 tenant、grant 和 confidentiality 规则。
- 所有未知 Surface fail closed。

完成标准：越权、过期、跨租户和 scope 扩大测试全绿。

### T3：Proposal 兼容与 Ledger

范围：Diagnosis Proposal 兼容层、Evolution Ledger 新模块。

- 不改变现有 Proposal v1 对外行为。
- 实现 v2 投影和 append-only 事件。
- 禁止伪造历史 verification。

完成标准：现有 `evolution-proposal.test.ts` 全绿，新增回放测试通过。

### T4：Experiment Manager

范围：Experiment Store、分组、指标、决策纯函数。

- 实现 baseline 和 cohort 冻结。
- 支持 `inconclusive`。
- 防止实验并发污染。

完成标准：固定 seed 重放一致，样本和保护指标门禁全绿。

### T5：Working DNA 与 Capsule Adapter

范围：两个 Adapter 及其领域接线。

- 复用既有 store、effectiveness 和 rollback。
- Capsule approval 与效果验证分离。

完成标准：领域旧测试全绿，统一闭环集成测试通过。

### T6：Skill 与 Organization Adapter

范围：两个 Adapter 及 shadow/canary 接线。

- Skill 使用既有版本和安装关系。
- Organization canary 仅作用于新任务。

完成标准：失败补偿、幂等和恢复测试通过。

### T7：Runtime Governance Adapter

范围：`src/gateway/evolution-governance/*` 与新 Adapter 边界。

- 保留 compare-and-restore 和 kill switch。
- 将 mutation 权限调整为 Surface 级授权。
- 不允许普通 Proposal 直接调用 runtime action。

完成标准：assist 零 mutation；auto 仅执行显式预授权 Surface。

### T8：RPC、UI 与端到端验收

范围：独立 Gateway method pack、控制器和治理 UI。

- 展示完整谱系，不把 receipt 当效果证明。
- 所有写操作有 command ID 和权限范围。
- 建立五领域端到端 fixture。

完成标准：桌面和移动端无溢出，跨租户测试、RPC scope 测试和五链闭环测试通过。

## 18. 测试策略

### 18.1 单元测试

- 状态机合法与非法转换。
- Metric Contract 和接受决策。
- Surface 风险和审批规则。
- Adapter 幂等与 compare-and-restore。
- v1/v2 Schema 映射。

### 18.2 合同测试

- Diagnosis 不依赖 mutation adapter。
- 未注册 Surface 不可执行。
- Approval 不可跨 tenant、scope 或过期 grant 使用。
- Client 不可自行提交 Verification outcome。
- Application 必须关联 Experiment 和 rollbackRef。

不要使用简单源码字符串缺失作为主要安全证明；应验证模块依赖、能力接口和运行副作用。

### 18.3 集成测试

每个领域至少覆盖：

```text
Evidence
  -> Proposal
  -> Experiment
  -> Approval
  -> Apply
  -> Verify
  -> Promote or Rollback
  -> Ledger replay
```

### 18.4 回归门

- `pnpm check`
- `pnpm tsgo`
- `pnpm build`
- 相关 Vitest 聚焦测试。
- Diagnosis 负向契约测试。
- Gateway method scope 测试。
- Tenant isolation 测试。
- Dynamic import 改动需检查 `[INEFFECTIVE_DYNAMIC_IMPORT]`。

## 19. 运行与发布约束

- 新模块默认 `assist`。
- 任一阶段不得从开发分支直接部署生产。
- 推送前必须以新鲜 `origin/main` 为基线并通过 ancestry gate。
- 生产候选必须满足 forward-only 和 delivery alignment。
- 控制平面上线不等于自动化授权上线。
- Surface 自动权限必须作为单独发布决策。
- 回滚应用不得回滚整个 OpenBot 发布版本，除非生产发布本身出现问题。

## 20. 完成定义

只有全部满足以下条件，才可宣布“五条进化链路完成统一”：

1. 五条链路均能生成统一 Proposal 引用。
2. 五种目标均有正式 Surface 和 Adapter。
3. Apply 前都能追溯到授权和实验。
4. Verification 基于指标结果，而不是对象已关联。
5. 每个 Application 都有可执行或明确受限的 rollback 策略。
6. 统一 Ledger 能重放完整谱系。
7. Diagnosis 无实际 mutation capability。
8. 领域系统仍是自身业务对象的唯一真相源。
9. 并发进化不会造成无法归因的指标污染。
10. 默认 assist，自动化权限按 Surface 单独授予。

## 21. 首个实施切片

建议第一条纵向切片选择 Working DNA，不要同时铺开五条链路：

```text
Operational Signal
  -> WorkingDnaCandidate
  -> Proposal v2
  -> Surface and Authority Gate
  -> Stable A/B Experiment
  -> Approved Application
  -> Existing Working Style Store
  -> Effectiveness Observation
  -> Unified Verification
  -> Promote or Existing Rollback
  -> Evolution Ledger
```

选择原因：

- 现有实现和测试基础最完整。
- 已有生效路径、效果统计、恢复和振荡抑制。
- 不涉及外部系统副作用。
- 最适合验证统一模型是否增加了真实治理价值。

Working DNA 纵向切片通过后，再按 Capsule、Skill、Organization、Runtime Governance 顺序接入。不要从 critical runtime mutation 开始验证新控制平面。

## 22. 架构评审决策项

- [ ] A1：确认统一控制平面而非重建领域系统。
- [ ] A2：确认 `packages/evolution-core` 为跨域模型唯一来源。
- [ ] A3：确认 Diagnosis 永远停在 Evidence/Candidate 边界。
- [ ] A4：确认 Experiment 为应用前的一等对象。
- [ ] A5：确认领域 Adapter 是唯一实际改变入口。
- [ ] A6：确认 Surface 级自治替代全局 `auto` 的粗粒度授权。
- [ ] A7：确认 `APPLIED`、`VERIFIED`、`PROMOTED` 严格分离。
- [ ] A8：确认 Working DNA 为第一条纵向切片。
- [ ] A9：确认历史记录不得补造 approval 或 verification。
- [ ] A10：确认 Phase 0 和 Phase 1 不改变现有运行行为。
