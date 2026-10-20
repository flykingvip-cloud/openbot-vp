# OpenBot 能力升级提案实施方案

## 1. 定位

“能力升级提案”是机器人、员工和系统信号把企业问题转化为专业化能力资产的统一业务入口。它不是 Skill 本身，也不是平台治理 Proposal 的简单别名。

它回答六个问题：

1. 企业正在反复遇到什么问题？
2. 有哪些可核验的事实证明问题存在？
3. 当前 Skill、Tool、Plugin 或 Connector 为什么不足？
4. 建议建设哪类能力，预期解决什么范围？
5. 需要哪些权限、数据和风险控制？
6. 用什么验证标准证明能力确实解决了问题？

最终定位：

```text
问题与证据
  -> 能力升级提案
  -> 企业分诊和孵化
  -> Skill / Plugin / Connector / Tool / Core 项目
  -> 企业审核与授权
  -> 企业能力目录
  -> 运行反馈和再孵化
```

## 2. 与现有系统的关系

OpenBot 已有三段基础链路：

- `skill-lifecycle-store`：个人 Skill、企业审核、版本、依赖和健康度。
- `incubation.*`：从现有 capability 中计算候选、评分、晋升决策和效果追踪。
- `capability-governance-store`：平台治理 proposal、审核和 registry 注册。

现有缺口是链路起点仍以“已经存在的资产”为中心。机器人发现问题时，没有统一对象保存问题、证据、能力缺口、建议类型、权限需求和验证计划。`incubation.candidate-pool` 只能扫描 registry 中已经存在的 capability；它不能表达“我们尚缺一个 ERP Connector”。

因此新增的 `CapabilityUpgradeProposal` 应位于业务问题和孵化资产之间：

```text
CapabilityUpgradeProposal
  | accepted_for_incubation
  v
Incubation Work Item
  | materialize
  v
Enterprise Asset / Engineering Project
  | approve + authorize + publish
  v
Capability Registry And Distribution
```

不要直接把它塞进 `GovernanceProposal`。后者面向已经形成 manifest 的平台审核；能力升级提案可能还没有代码、Skill 或 manifest，只存在一个被证据支持的问题和解决方向。

## 3. 业务原则

### 3.1 创造与授权分离

机器人可以：

- 发现和描述问题。
- 收集当前权限内可见的证据。
- 创建和修订提案草稿。
- 建议目标资产类型、依赖、权限与验证计划。
- 在用户确认后提交企业分诊。
- 根据评审意见补充材料。

机器人不能：

- 自己批准提案。
- 自己授予新权限。
- 自己安装高权限 Plugin、Connector 或 Tool。
- 自己发布到企业范围。
- 修改 OpenBot 核心生产代码或策略。

### 3.2 问题与解决方案分离

Proposal 保存问题事实；Incubation 保存解决方案演进。一个问题可能关联多个候选方案，也可能通过现有能力解决。拒绝某个方案不代表问题不存在。

### 3.3 证据优先

不能仅凭机器人文字说明进入孵化。最低证据可以来自：

- 多次失败或人工接管的运行报告。
- 去标识化 transcript 片段。
- “录制工作流”的稳定重复步骤。
- Support Case 和解决方案。
- 交付物、业务指标或用户反馈。
- 已存在能力的缺口分析。

### 3.4 审批分层

提案被接受，只表示企业愿意投入孵化；不表示实现已通过安全审核、能力已获授权或已发布。

```text
Accept Proposal != Approve Asset != Grant Permission != Publish Asset
```

## 4. 参与角色

| 角色                 | 责任                                   |
| -------------------- | -------------------------------------- |
| Proposer Robot       | 发现问题、整理证据、生成草稿、补充材料 |
| Responsible Employee | 确认提案准确、允许提交企业队列         |
| Domain Reviewer      | 判断业务价值、重复性和目标范围         |
| Security Reviewer    | 评估数据、权限、供应链和副作用风险     |
| Incubation Owner     | 负责方案、里程碑、试点和验收           |
| Asset Owner          | 对形成的企业资产版本和运行质量负责     |
| Enterprise Admin     | 批准发布范围、角色和机器人授权         |
| Platform Reviewer    | 仅在企业上报平台时参与平台治理         |

一个人可以承担多个角色，但每个状态转换必须记录实际 actor，不能接受客户端提供的任意 `decidedBy` 字符串作为可信身份。

## 5. 核心数据模型

```ts
type CapabilityProposalKind = "skill" | "plugin" | "connector" | "tool" | "core";

type CapabilityProposalStatus =
  | "draft"
  | "submitted"
  | "triaging"
  | "needs_evidence"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "incubating"
  | "validating"
  | "changes_requested"
  | "approved"
  | "materialized"
  | "published"
  | "failed";

type CapabilityUpgradeProposal = {
  id: string;
  schemaVersion: 1;
  version: number;
  tenantId: string;
  title: string;
  problem: {
    statement: string;
    affectedRoles: string[];
    affectedProcesses: string[];
    frequency: "one_off" | "recurring" | "systemic";
    impact: "low" | "medium" | "high" | "critical";
  };
  currentGap: {
    existingCapabilityIds: string[];
    limitations: string[];
    workarounds: string[];
  };
  proposal: {
    targetKind: CapabilityProposalKind;
    expectedOutcome: string;
    intendedScope: "personal" | "group" | "department" | "enterprise";
    requiredTools: string[];
    requiredDataScopes: string[];
    requiredPermissions: string[];
    estimatedEffort?: string;
  };
  evidence: CapabilityProposalEvidenceRef[];
  risks: CapabilityProposalRisk[];
  validationPlan: CapabilityValidationPlan;
  proposer: {
    userId: string;
    agentId?: string;
    sourceSessionId?: string;
  };
  ownership: {
    responsibleUserId: string;
    incubationOwnerId?: string;
    assetOwnerId?: string;
  };
  status: CapabilityProposalStatus;
  decision?: {
    outcome: string;
    reason: string;
    actorId: string;
    decidedAt: number;
  };
  lineage: {
    parentProposalId?: string;
    incubationId?: string;
    assetId?: string;
    assetVersion?: string;
    governanceProposalId?: string;
  };
  createdAt: number;
  updatedAt: number;
};
```

Evidence Ref 至少包含 `kind`、`sourceId`、`digest`、`summary`、`capturedAt`、`redactionStatus` 和 `accessScope`。Proposal 本身不得复制完整 transcript、截图或秘密，只保存脱敏摘要和受控引用。

## 6. 生命周期

### 6.1 创建与提交

```text
draft
  -> submitted       用户确认提交
  -> withdrawn       提案方撤回
```

机器人可以反复修改 draft。提交前系统确定性检查：问题字段完整、至少一项证据、责任人存在、建议权限非空时已显式展示、没有秘密明文。

### 6.2 企业分诊

```text
submitted -> triaging
triaging -> needs_evidence
triaging -> accepted
triaging -> rejected
triaging -> linked_existing_capability (以 decision 表达并终止)
```

分诊重点不是评审实现代码，而是决定该问题是否真实、是否值得投入、是否重复，以及应该进入哪类孵化路径。

### 6.3 孵化与验证

```text
accepted -> incubating -> validating
validating -> changes_requested -> incubating
validating -> approved
incubating | validating -> failed
```

Incubation Work Item 记录候选实现、试点范围、里程碑、风险评审和验证结果。Proposal 只保存 lineage 和状态摘要。

### 6.4 资产化与发布

```text
approved -> materialized -> published
```

- `materialized`：已经形成真实 Skill、Plugin、Connector、Tool 发布包或 Core 工程版本。
- `published`：资产审核、权限配置和分发范围全部完成。

## 7. 目标类型路由

| Kind      | 孵化产物                                              | 必要门禁                                     |
| --------- | ----------------------------------------------------- | -------------------------------------------- |
| Skill     | `EmployeeSkillProfile` + versioned runtime definition | 内容、工具、输入输出和回放验证               |
| Plugin    | `.codex-plugin`/OpenBot plugin package 候选           | manifest、依赖、供应链、安全扫描、管理员安装 |
| Connector | MCP/Connector 定义与认证配置                          | 数据范围、OAuth/secret、出站域名和最小权限   |
| Tool      | 工程代码、schema、测试和审计映射                      | Code review、sandbox、allowlist、部署        |
| Core      | ADR、工程项目和发布计划                               | 架构、安全、兼容性和维护 owner               |

机器人自主程度随风险递减：Skill 可以生成完整草稿；Plugin/Connector 可以生成包和配置候选；Tool 可以生成实现 PR 候选；Core 只能生成 ADR 和工程任务，不能自动落地生产变更。

## 8. API 与工具

建议 Gateway namespace：`capability-proposal.*`。

| 方法                                  | Scope | 调用者                                      |
| ------------------------------------- | ----- | ------------------------------------------- |
| `capability-proposal.create`          | write | 员工或机器人，经当前身份创建 draft          |
| `capability-proposal.get/list`        | read  | 提案方、责任人、审核者                      |
| `capability-proposal.update`          | write | draft/needs_evidence/changes_requested 阶段 |
| `capability-proposal.attach-evidence` | write | 有证据读取权限的提案参与者                  |
| `capability-proposal.submit`          | write | 责任员工确认                                |
| `capability-proposal.withdraw`        | write | 提案责任人                                  |
| `capability-proposal.triage`          | admin | 企业 reviewer                               |
| `capability-proposal.assign`          | admin | 指派 incubation/asset owner                 |
| `capability-proposal.materialize`     | admin | 绑定真实资产和版本                          |
| `capability-proposal.publish`         | admin | 验证资产状态、授权和目录发布                |
| `capability-proposal.timeline`        | read  | 返回不可变状态与决策记录                    |

Agent Tool 不应暴露 `triage/materialize/publish`。机器人只获得 draft、update、attach、submit、status 和 withdraw，并且 submit 要求关联责任员工确认。

服务端从连接上下文获取 tenant、user、agent 和 role。不得信任 payload 中的 `decidedBy`、`reviewerId` 或 `tenantId`。

## 9. 与“录制工作流”的联动

录制工作流会产生两类结果：

1. 现有工具足够，流程稳定：生成 Skill 草稿。
2. 流程依赖缺失能力：在 Skill 草稿之外生成关联能力升级提案。

示例：用户录制“从 ERP 下载报表并发到财务群”。如果浏览器可以稳定完成，则生成 Skill；如果 ERP 必须使用缺失的企业 API，系统生成 Connector Proposal，并把录制中的人工步骤作为 evidence。

Proposal 接受并最终发布 Connector 后，原 Skill 可以创建新版本，替换浏览器操作为 Connector Tool。两者通过 lineage 关联，但不能自动修改已发布 Skill。

## 10. 与现有孵化中心接线

现有 `incubation.candidate-pool` 继续处理已经注册、具有真实使用数据的 capability。新增两个来源：

- `problem proposals`：尚未形成资产的问题候选。
- `asset candidates`：已有资产，因复用数据达到孵化阈值。

两者在 UI 上属于同一“企业能力孵化中心”，但不能混用评分：

- Proposal 评分：问题影响、发生频次、证据质量、跨部门复用潜力、方案可行性、风险和成本。
- Asset 评分：真实调用、成功率、覆盖、满意度、成本和人工接管。

接受 Proposal 后创建 incubation work item；不要提前向 capability registry 写入虚假能力。只有 `materialized` 后才进入资产审核和 registry。

## 11. 治理与审计

每次状态转换记录：

- proposalId、from、to、version。
- actor 的服务端身份和角色。
- reason、evidence refs 和时间。
- request correlation 和 tenant。
- 对权限、发布或资产绑定产生的结果。

关键不变量：

- proposer 不能 approve 自己的提案进入发布。
- accepted 不能直接 published。
- 没有真实 assetId/version 不能 materialized。
- 没有验证结果、安全结论和 owner 不能 approved。
- 发布不继承录制或试点期间的临时权限。
- 跨租户 evidence ref 不可解析。

## 12. UI 业务流程

### 员工/机器人侧

- Chat 中展示“发现可沉淀的企业问题”，而不是静默提交。
- 提案预览展示问题、证据、现有替代方案、目标类型、权限和验证方式。
- 用户确认后进入企业队列。
- 后续显示需要补充、已接受、孵化中、试点、已发布或被拒绝。

### 企业侧

- “问题提案”与“资产候选”分栏。
- 支持合并重复问题、关联现有能力、请求证据、接受孵化和拒绝。
- 接受后展示 owner、目标类型、里程碑、试点范围和风险清单。
- 发布前展示资产版本、验证结果、权限范围和影响分析。

## 13. 指标

### 流程指标

- 草稿到提交转化率。
- 提交到首次分诊时间。
- needs_evidence 比例。
- 接受率、拒绝率和重复关联率。
- 接受到 materialized/published 的周期。

### 价值指标

- 问题发生频次降低。
- 人工接管时间降低。
- 新资产的真实采用、成功率和部门覆盖。
- 资产产生的成本变化。
- 提案来源机器人推荐的准确率。

禁止以“创建了多少 Proposal”作为主要成功指标，否则会激励机器人制造低质量提案。

## 14. 分阶段实施

### Phase 0：契约和状态机，1 周

完成 types、schema、状态机、角色矩阵、证据引用和威胁模型。

### Phase 1：机器人草稿与企业分诊，2 周

完成 Store、Agent Tool、用户确认、企业队列、triage 和 timeline。暂不自动创建资产。

### Phase 2：接入孵化和 Skill 资产化，2 周

接受 Proposal 后创建 incubation work item，先打通 Skill 路径和“录制工作流”联动。

### Phase 3：Plugin、Connector、Tool 路径，3 周

建立分类型模板、安全门禁、工程任务和 lineage；至少各选一个真实案例试点。

### Phase 4：企业目录和反馈回路，2 周

接入授权发布、通知、真实使用指标、再孵化和弃用影响分析。

## 15. 验收场景

1. 机器人发现一个重复人工流程，生成草稿，员工确认后提交，企业接受并形成 Skill，发布给目标部门。
2. 机器人发现缺少 ERP API，生成 Connector Proposal；管理员审核数据范围和 OAuth，试点后形成 Connector 资产。
3. 机器人建议新增高权限 Tool；系统允许生成实现候选，但阻止机器人安装、授权或发布。
4. 提案被判定已有能力可解决，关联能力并通知来源人，不创建重复资产。
5. 跨租户用户无法读取 Proposal 或 evidence。
6. 机器人尝试把风险标为低或把自己设为 reviewer，服务端拒绝或覆盖为可信身份。
7. 已发布能力效果下降，系统生成 revision 建议并重新进入孵化，不直接修改生产版本。

## 16. Gork 团队启动要求

1. 先与 `capability-lifecycle-closure` 当前 owner 完成路径和 lander 协调。
2. 冻结 Proposal 与现有 GovernanceProposal、Skill Asset、Incubation Record 的边界。
3. 先交付一条只到企业 triage 的纵向链，验证身份、证据和状态机。
4. 第二条纵向链只实现 Skill materialization，不同时铺开所有类型。
5. Skill 闭环稳定后，再并行 Connector 和 Tool 试点。
6. 每个状态转换必须从第一天开始具备审计，不留后补。

任务拆解和发布门禁见 `.kiro/specs/capability-upgrade-proposal/tasks.md`。
