# OpenBot 统一进化系统改造方案 v1

Date: 2026-09-06

Status: **架构方案草稿。不是实施规格，不开启新的自动 Apply，不替换现有五条领域链路。**

Audience: Platform Architecture、Evolution Governance、Diagnosis、QA、Security

Task: `openbot-unified-evolution-control-plane`

Related:

- [自进化机制分析与总结（背景资料）](/design/openbot-self-evolution-background-2026-09-06)
- [P8 受治理进化提案](/design/openbot-diagnosis-p8-evolution-proposal-2026-09-03)
- [P9 治理修复预览](/design/openbot-diagnosis-p9-remediation-preview-2026-09-03)
- Issue [#995](https://github.com/gmood2008/openbot/issues/995)

硬门禁：

- 本方案是现有系统的「科学评估层 + 统一治理层」，不是新的进化系统。
- Diagnosis 只能生成证据、机制和候选；只有 Change Plane 可以应用改变。
- Proposal、Approval、Application、Verification 必须是不同对象。
- 没有实验基线、回滚能力或授权，不得 Apply。
- PR 合并、候选应用、效果验证、进化完成是四个不同事件。
- Evolution Ledger 是跨域谱系索引，不是第二套 Evolution Log；复用现有 Proposal 生命周期和持久化。
- 文档、memory、prompt、skill、runtime policy 必须分级，不得把所有 L3 surface 视为同等风险。
- Phase 0 只统一语义，不改变运行行为，不扩大 auto 范围。

---

## 对话归档说明

本文件来自 2026-09-06 的 Grok 对话续篇。上一篇归档了现状判断与融合边界；本篇归档基于该判断的统一改造方案 v1。

---

## 一、目标定义

OpenBot 系统进化应定义为：

从运行证据中发现可复用机制，生成受治理候选，通过隔离实验验证，在授权范围内应用到指定进化对象，并持续监测效果；收益不足或发生回归时自动或人工回滚。

完整闭环：

```
Observe
  ↓
Mine
  ↓
EvolutionProposal
  ↓
Authority + Surface Gate
  ↓
EvolutionExperiment
  ↓
Approve
  ↓
Apply
  ↓
Verify
  ├─ improved  → Promote → 持续监测
  ├─ neutral   → Hold / 扩大实验
  └─ regressed → Rollback → FailureCluster
                                  ↓
                              下一轮进化
```

硬边界：

- Diagnosis 只能生成证据、机制和候选。
- 只有 Change Plane 可以应用改变。
- Proposal、Approval、Application、Verification 必须是不同对象。
- 没有实验基线、回滚能力或授权，不得 Apply。
- PR 合并、候选应用、效果验证、进化完成是四个不同事件。

## 二、需要统一的五条现有链路

### 1. Agent 行为进化

现有锚点：

- `src/gateway/agent-growth/genome.ts`
- `src/gateway/agent-growth/working-style-store.ts`
- `src/gateway/agent-growth/working-style-self-tuning.ts`
- `src/gateway/agent-growth/working-style-effectiveness.ts`

现状能力：

- 运营信号生成 Working DNA 变化
- 注入真实对话
- 前后效果比较
- 回归自动恢复
- 振荡抑制

改造方向：

将 Working DNA delta 转换为标准 EvolutionCandidate，不再由 Agent Growth 独立决定完整生命周期。

### 2. 知识与经验进化

现有锚点：

- `src/gateway/agent-growth/experience-capsule.ts`
- `src/gateway/collaboration-learning/execution-outcome-capsule.ts`
- `src/gateway/collaboration-learning/review-outcome-capsule.ts`
- `src/gateway/collaboration-learning/capsule-governance.ts`
- `packages/collaboration-core/src/policies/learning-projection.ts`

现状能力：

- 从失败、拒绝、修订中生成经验胶囊
- 候选审批
- 复用计数
- 投影与晋升

改造方向：

把 Capsule 的 candidate/approve/promote 映射到统一生命周期，并补充「应用后是否提升任务表现」的验证环节。

### 3. 能力与 Skill 进化

现有锚点：

- `src/gateway/skill-lifecycle-store.ts`
- `src/gateway/agent-growth/skill-draft-curation.ts`
- `src/gateway/evolution-governance/persistent-store.ts`

现状能力：

- Skill 草稿、评审、发布、安装、弃用和回滚
- 自动安装任务
- 使用次数、成功率和延迟指标

改造方向：

保留 Skill Lifecycle 作为能力资产 SoT；统一系统只管理「为什么生成、如何实验、是否批准、应用结果如何」，不复制 Skill 状态。

### 4. 组织与协作进化

现有锚点：

- `src/organization/*`
- `src/gateway/collaboration-learning/*`
- `src/gateway/agent-growth/mesh-growth-aggregate.ts`
- `src/gateway/agent-growth/mesh-group-growth-aggregate.ts`

现状能力：

- 小组、角色、任务、评审、协作记忆
- 群体学习和聚合评分
- 部分组织状态调节

改造方向：

将角色调整、团队编排、任务路由和协作政策作为独立进化对象，禁止混入 Agent Working DNA 或普通 Capsule。

### 5. 系统与运行时治理进化

现有锚点：

- `src/diagnosis/evolution-proposal.ts`
- `src/gateway/evolution-governance/mode.ts`
- `src/gateway/evolution-governance/tick-pipeline.ts`
- `src/gateway/evolution-governance/runtime-actions.ts`
- `src/gateway/evolution-governance/persistent-store.ts`

现状能力：

- 受授权的 Evolution Proposal
- off / assist / auto
- pause、limit、redirect、恢复
- kill switch
- compare-and-restore
- 效果窗口

改造方向：

以这里作为统一控制平面的主要基础，但必须把 Proposal 与运行时动作之间补上正式 Experiment、Approval Policy 和 Applicator Registry。

## 三、目标架构

```
┌─────────────────── Evidence Plane ────────────────────┐
│ Task / Diagnosis / Feedback / Skill / Cost / Security │
│                         ↓                              │
│ Evidence Bundle → Pattern Miner → FailureCluster      │
└─────────────────────────┴──────────────────────────────┘
                          ↓
┌───────────────── Evolution Control Plane ─────────────┐
│ Proposal Registry                                      │
│ Surface Registry                                       │
│ Authority & Tenant Gate                                │
│ Experiment Manager                                     │
│ Decision Engine                                        │
│ Evolution Ledger                                       │
└────────────────────────┴─────────────────────────────┘
                          ↓ approved
┌───────────────────── Change Plane ────────────────────┐
│ AgentAdapter       → Working DNA                       │
│ KnowledgeAdapter   → Memory / Capsule                  │
│ CapabilityAdapter  → Skill                             │
│ OrganizationAdapter→ Team / Role / Route               │
│ SystemAdapter      → Harness / Runtime Governance      │
└────────────────────────┴─────────────────────────────┘
                          ↓
                   Effect Verification
                    ↙       ↓       ↘
               Promote     Hold    Rollback
```

### 权威划分

| 对象                | 唯一真相源                   |
| ------------------- | ---------------------------- |
| Proposal 生命周期   | 统一 Evolution Control Plane |
| Working DNA 内容    | Agent Growth                 |
| Capsule 和学习资产  | Collaboration Learning       |
| Skill 资产状态      | Skill Lifecycle              |
| 组织结构和协作状态  | Organization / Collaboration |
| Runtime action 快照 | Evolution Governance         |
| 实验和效果结果      | Evolution Experiment Store   |
| 跨链审计谱系        | Evolution Ledger             |

统一不等于集中存储。控制平面保存引用和状态，领域系统继续保存自身业务对象。

## 四、统一核心对象

### EvolutionProposal

复用并扩展 `src/diagnosis/evolution-proposal.ts`：

```ts
type EvolutionProposal = {
  proposalId: string;
  sourceEvidenceRefs: string[];
  mechanismRef: string;
  target: EvolutionTarget;
  candidateRef: string;
  surfaceId: string;
  expectedEffect: MetricExpectation[];
  riskLevel: "low" | "medium" | "high" | "critical";
  tenantScope: string | null;
  status: EvolutionProposalStatus;
};
```

### EvolutionTarget

```ts
type EvolutionTarget =
  | { domain: "agent"; agentId: string }
  | { domain: "knowledge"; assetId: string }
  | { domain: "capability"; skillId: string }
  | { domain: "organization"; groupId: string }
  | { domain: "system"; componentId: string };
```

### EvolutionExperiment

这是当前最需要补充的一等对象：

```ts
type EvolutionExperiment = {
  experimentId: string;
  proposalId: string;
  baselineRef: string;
  candidateRef: string;
  datasetRef?: string;
  treatmentCohort: string[];
  controlCohort: string[];
  primaryMetric: MetricContract;
  guardrailMetrics: MetricContract[];
  minimumSampleSize: number;
  startedAt: string;
  expiresAt: string;
  result: "pending" | "improved" | "neutral" | "regressed" | "inconclusive";
};
```

### EvolutionApplication

```ts
type EvolutionApplication = {
  applicationId: string;
  proposalId: string;
  experimentId: string;
  adapterId: string;
  targetVersionBefore: string;
  targetVersionAfter: string;
  rollbackRef: string;
  idempotencyKey: string;
  scope: ApplicationScope;
  status: "shadow" | "canary" | "active" | "rolled_back";
};
```

### EvolutionVerification

将当前 outcome: `"linked"` 扩展为真实效果结论：

```ts
type EvolutionVerification = {
  verificationId: string;
  applicationId: string;
  baselineWindow: MetricWindow;
  evaluationWindow: MetricWindow;
  primaryEffect: number | null;
  guardrailResults: GuardrailResult[];
  confidence: number | null;
  outcome: "improved" | "neutral" | "regressed" | "inconclusive";
  evidenceRefs: string[];
};
```

## 五、统一状态机

```
DISCOVERED
   ↓
SUGGESTED
   ↓
PENDING_AUTHORITY
   ↓
APPROVED_FOR_EXPERIMENT
   ↓
EXPERIMENTING
   ├─ failed ───────────────→ REJECTED
   ├─ inconclusive ─────────→ HELD
   └─ passed
        ↓
APPROVED_FOR_APPLICATION
        ↓
CANARY
   ├─ regressed ────────────→ ROLLED_BACK
   └─ improved
        ↓
ACTIVE
        ↓
VERIFIED
        ↓
PROMOTED
```

重要约束：

- `APPROVED` 必须拆成实验批准与应用批准。
- `APPLIED` 不得直接进入 `VERIFIED`。
- `ROLLED_BACK`、`REJECTED`、`REVOKED` 都必须保留失败机制。
- 任何授权过期都阻止后续扩大范围。
- `PROMOTED` 仍接受长期回归监测。

## 六、Surface Registry

每个可进化面必须登记：

```ts
type EvolutionSurface = {
  surfaceId: string;
  domain: EvolutionTarget["domain"];
  authority: string;
  sourceOfTruth: string;
  allowedOperations: string[];
  riskLevel: string;
  experimentStrategy: "offline" | "shadow" | "ab" | "canary";
  requiredApprovals: string[];
  requiredRegressionLocks: string[];
  applicatorId: string;
  rollbackStrategy: string;
};
```

首批 Surface：

- `agent.working-dna`
- `knowledge.experience-capsule`
- `knowledge.managed-memory`
- `capability.skill-spec`
- `capability.skill-installation`
- `organization.task-routing`
- `organization.team-composition`
- `system.diagnosis-contract`
- `system.runtime-binding-governance`

生产、模型权重、核心身份、安全策略默认不注册为普通可编辑面。

## 七、统一验收策略

不能再只使用一个总分。每个实验包含：

### 主收益指标

例如：

- 任务成功率
- 人工修订率
- 问题复发率
- Skill 成功率
- 协作交付通过率
- 用户满意度

### 保护指标

必须同时检查：

- 安全违规数
- 越权调用
- 人工接管率
- 延迟
- Token 成本
- 错误重试
- 跨租户污染
- 渠道投递失败

### 接受条件

```
primary metric 达到最小效应
AND 所有 critical guardrail 不退化
AND 非关键 guardrail 在预算内
AND 样本量与置信度达标
AND 回滚演练成功
```

如果样本不足，结果只能是 `inconclusive`，不能按「没有发现退化」批准。

## 八、适配器架构

统一控制平面不直接修改领域对象，而是调用注册适配器：

```ts
interface EvolutionAdapter {
  domain: EvolutionTarget["domain"];

  inspect(target: EvolutionTarget): TargetSnapshot;
  validate(candidate: EvolutionCandidate): ValidationResult;
  apply(input: ApplyEvolutionInput): EvolutionApplication;
  verify(input: VerifyEvolutionInput): EvolutionVerification;
  rollback(application: EvolutionApplication): RollbackResult;
}
```

首批适配器：

- `WorkingDnaEvolutionAdapter`
- `CapsuleEvolutionAdapter`
- `SkillEvolutionAdapter`
- `OrganizationEvolutionAdapter`
- `RuntimeGovernanceEvolutionAdapter`

这样可以保留现有实现，同时统一控制和审计。

## 九、实施阶段

### Phase 0：统一语义，不改变运行行为

- 盘点五条链路的对象、状态和 SoT。
- 发布统一术语表和 Surface Registry。
- 让现有对象输出标准引用。
- 不开启新的自动 Apply。

验收：没有第二份业务状态，没有现有行为回归。

### Phase 1：统一 Proposal 与 Ledger

- 以 `src/diagnosis/evolution-proposal.ts` 为起点建立通用 Proposal。
- 将 Working DNA、Capsule、Skill 和治理候选接入。
- 建立跨域 Evolution Ledger。
- 保持领域存储不变。

验收：任一候选均可追溯至信号、证据、授权、目标和责任人。

说明：Ledger 只存引用、状态转换和谱系边，不复制 Working DNA / Capsule / Skill 正文。

### Phase 2：建立 Experiment Manager

- 引入 `EvolutionExperiment`。
- 支持 offline、shadow、A/B 和 canary。
- 冻结 baseline、cohort、模型和配置版本。
- 建立指标与保护指标合同。

验收：Working DNA 和 Skill 至少各完成一次可重复实验。

### Phase 3：统一 Apply、Verify、Rollback

- 注册五类 Adapter。
- 所有 Apply 需要幂等键和 `rollbackRef`。
- 统一效果窗口。
- 将长期退化重新生成 FailureCluster。

验收：五类对象均能完成一次完整演练闭环。

### Phase 4：有限自治

- 默认仍为 assist。
- 低风险、可逆、证据充分的 Surface 可进入 auto。
- 中高风险保持双审批。
- critical Surface 永不自动应用。

验收：自动化只扩大效率，不扩大权限边界。

## 十、最终闭环定义

完成改造后，OpenBot 的系统进化不再是五套并行功能，而是：

```
统一证据
  → 统一机制识别
  → 统一提案
  → 统一授权
  → 统一实验
  → 领域适配应用
  → 统一效果验证
  → 晋升或回滚
  → 结果再次进入证据系统
```

其中：

- 五个领域负责「如何改变自身」。
- Evolution Control Plane 负责「为什么允许改变」。
- Experiment Manager 负责「如何证明改变有效」。
- Truename 和权限系统负责「谁有权决定」。
- Evolution Ledger 负责「全过程是否可追溯」。

这套方案应作为原草案的上位架构；原草案中的 diagnosis Harness 机制降为 Evidence Plane 下的一个子机制，而不是整个 OpenBot 进化系统。
