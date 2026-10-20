# OpenBot 进化路线图对齐映射（现状 ↔ 演进）

> 日期：2026-07-12 · 状态：分析 + 首批落地记录
> 方法：逐项在 `src/`、`ui/src/`、`packages/` 中**代码级核对**（读实现、grep 调用点），区分「现状（已落地）」与「面向未来演进需要做的工作」。凡标注「未核对」的均已注明，不臆测。
> 关联路线图：《OpenBot 长期演进路线规划方案 V1.0》五阶段 + 六大核心对象。

---

## 0. 一句话结论

路线图不是空想，而是对一个**已在进行中方向**的正式化与外推：`LifecycleState` 末态已叫 `evolution`，`operationalScore`/`businessImpact` 已从预留字段变为**真实计算并接线**。真正的结构性张力是：**投入顺序与路线图倒挂**——承接经验的管道（技能资产、协作组织）远比产生经验的引擎（反思/经验记忆/基因）成熟。飞轮的输入端（反馈信号）已通，中段（经验提炼）仍是空白。

---

## 1. 六大核心对象：路线图 ↔ 代码现状

| 路线图对象                  | 代码现状                                                                                     | 证据（repo 相对路径）                                                                                            | 判定                               |
| --------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `Agent` 数字员工主体        | 完整 agents 子系统                                                                           | `src/agents/*`                                                                                                   | ✅ 真实                            |
| `GrowthStatus` 生命阶段     | 生命周期/维度/评分/里程碑全模型 + RPC + 持久化                                               | `src/gateway/agent-growth/types.ts`、`readiness.ts`、`server-methods/agent-growth.ts`                            | ✅ 真实                            |
| `Capability` 技能资产       | ~1800 LOC 全生命周期，business/runtime 双层                                                  | `src/gateway/skill-lifecycle-store.ts`                                                                           | ✅ 真实（超出路线图草图）          |
| `ExperienceMemory` 经验积累 | 仅群体学习胶囊「类型 + 投影/晋升治理」，**无生成引擎**；RAG memory 与经验记忆未在运行层区分  | `packages/collaboration-core/src/types/learning.ts`、`policies/learning-projection.ts`；`src/memory/*`（纯 RAG） | ⚠️ 数据/治理有，引擎缺             |
| `AgentGenome` 人格与认知    | **不存在一等对象**；散落在 SOUL/IDENTITY、systemInstructions、growth 的 identity/habits 维度 | `src/gateway/agent-growth/types.ts`（identity/habits 维度）                                                      | ❌ 缺（本次给出立项判断 + 脚手架） |
| `EvolutionEngine` 进化机制  | 有评分/异常/预测算法，但存储为内存原型，且是「给人的治理建议」，**无自我应用闭环**           | `src/gateway/ai-workforce-governance/*`、`collaboration-learning/behavior-buffer.ts`                             | ⚠️ 算法有，闭环缺                  |

---

## 2. 五阶段映射（现状 / 缺口 / 演进工作 / 对齐度 / 风险）

### Phase 1 — Agent Activation（激活）

- 现状（已落地）：`LifecycleState`（birth→growing→mission_ready→activated→**evolution**）、四/五维 `GrowthDimension`、加权 `activationScore`、`capabilityReadiness` 硬门槛、完整 `GrowthMilestones` 漏斗、`AgentTemplate` + `generic_worker`、全套 RPC。带测试。
  - 证据：`src/gateway/agent-growth/{types,readiness,lifecycle,factory,milestones,store}.ts`、`server-methods/agent-growth.ts`、`ui/src/ui/controllers/agent-growth.ts`。
- 演进工作：P1 表现层（Prelude/Stepper/i18n）、P2 LLM Awakening、模板向导；`capabilityReadiness` 的 OAuth 真值门槛（当前 `"unknown"` 不计分，见 RISK-007）。
- 对齐度：高。风险：低。

### Phase 2 — Agent Learning（学习）★ 成败点

- 现状（已落地）：
  - 反馈信号**已通**（此前误判为未通，已更正）：`recordTaskOutcome` 在每轮任务收尾被调用 → 累加器 → `recompute-growth` 读取 → `computeOperationalScore` → 写回 `GrowthStatus.operationalScore` → `detectFalseReady` 广播 `agent_growth.false_ready_detected`。
    - 证据：`src/auto-reply/reply/agent-runner-execution.ts`（record 调用点）、`src/gateway/agent-growth/operational-metrics-store.ts`、`operational-score.ts`、`server-methods/agent-growth.ts`（recompute + emitGrowthEvents）。
  - 群体经验的**数据模型与治理**：`GroupMemoryCapsule`(lesson/pattern/anti_pattern/…) + `LearningProjection` + `AgentLearningAsset` + 投影/晋升策略。
    - 证据：`packages/collaboration-core/src/types/learning.ts`、`policies/learning-projection.ts`、`packages/collaboration-runtime/src/contracts/learning-promotion.ts`、`packages/collaboration-openbot-adapter/src/storage/openbot-storage.ts`（appendCapsule）。
- 缺口（面向未来）：
  1. **反思/经验生成引擎缺失**：`reflect|reflection|principle|distill` 在 `src/` 下零命中；`GroupMemoryCapsule` 只能靠 `appendCapsule` 外部写入，没有「任务运行 → 经验胶囊」的生成器。→ 本次件事二落地最小生成器。
  2. **operationalScore 单信号**：仅 task-success 真实流动；`recordToolOutcome` 定义了却无人调用，`humanTakeover` 从不置真，`satisfaction` 无来源。→ 本次件事一补桥接 + 标注剩余插桩。
  3. **无 AgentGenome / Working DNA**：输出格式/汇报方式/决策/风险偏好无收敛载体。→ 件事三。
  4. **经验记忆未与 RAG 分层**：`src/memory/*` 是向量检索，不承载「我经历过什么 / 我学到了什么」。
- 对齐度：中（数据/治理先行，引擎滞后）。风险：**高**——「从噪声任务结果可靠提炼正确原则、且不引入行为回退」接近开放问题，非纯工程。

### Phase 3 — Capability Evolution（技能资产生态）

- 现状（已落地）：extract→save→share→submit→review→publish→install→版本/回滚→健康/依赖→deprecate→retire；admission/incubation/governance store 齐备。
  - 证据：`src/gateway/skill-lifecycle-store.ts`、`asset-admission.ts`、`capability-governance-store.ts`、`ui/src/ui/views/enterprise-asset-library/*`。
  - 对应 spec：`skill-lifecycle-asset-system`、`capability-lifecycle-closure`、`capability-governance-runtime`、`enterprise-capability-asset-library`、`enterprise-capability-usage-management`、`enterprise-data-capability-center`。
- 缺口（面向未来）：**能力缺口自动发现 → 生成**（`gap|synthesizeSkill` 零命中）；**自动化验证**（当前是评审门/admission，而非跑测试验证）。
- 对齐度：高（基础最好）。风险：中。

### Phase 4 — Agent Organization（数字组织）

- 现状（已落地）：跨会话任务/提及投递、mention 子系统、会议、任务分派、协调者；协作 spaces/charter/mission-phase；mesh 治理。
  - 证据：`src/organization/{inter-agent-bus,mention-*,meeting-*,task-assignment,coordinator-*}.ts`、`src/gateway/collaboration-learning/{space-store,group-charter,mission-*}.ts`。
  - 对应 spec：`collaboration-convergence`、`group-mention-system`、`mesh-governance-redesign`、`platform-agent-runtime-center`。
- 缺口（面向未来）：「Dynamic Team Formation」当前是**模板/协调者配置驱动**，非自主动态组队；「Organizational Memory」是 decisions/artifacts 记录（`src/organization/shared-memory.ts` 简单 CRUD），非学习基质。
- 对齐度：中高。风险：中。

### Phase 5 — Self-Evolving Platform（系统自进化）

- 现状（已落地）：Bot Score = 0.4 效率 + 0.3 成本 + 0.3 稳定；异常检测；auto-governance 规则；消费预测。
  - 证据：`src/gateway/ai-workforce-governance/scoring-engine/scoring.ts`、`anomaly-engine/detector.ts`、`auto-governance/engine.ts`、`consumption-forecast/*`。
- 缺口（面向未来）：评分/异常 store 为**内存原型**（持久遥测未接）；**无「学到的优化自动回写 Agent」的闭环**——输出是给人的治理动作；`behavior-buffer → growth 维度` 是唯一自动「数据→行为」微调且极粗。
- 对齐度：中。风险：高（自我应用优化带治理/安全约束，需护栏）。

---

## 3. 飞轮闭环视图：断点在哪，三件事如何接上

```
任务(有) → 反馈信号(已通:task-success) → 经验提炼(缺:件事二生成器) → 原则/资产(治理已备)
   ↑                                                                        │
   └──────────────── 行为改变(缺:件事三 Genome/Working DNA) ←───────────────┘
                              自进化(Phase5:算法有/闭环缺)
```

- 输入端已通：`operationalScore` + `false_ready` 事件（件事一：再补桥接把数据接入报告）。
- 中段已接线（本次）：**经验提炼引擎**（件事二：`deriveCandidateCapsule` 生成器）已接入 group 任务收尾（execution 记录咽喉点），失败任务自动产出 candidate → 复用现有投影/晋升治理。
- 回写端空白：**行为载体**（件事三：`AgentGenome` 立项判断 + 脚手架）。

---

## 4. 本次落地记录（三件事）

| 件事                  | 交付物                                                                                                                                                | 文件                                                                             | 性质           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- |
| 一 · 接通反馈信号     | 更正：核心已建成并接线；补纯函数桥接把累加器数据接入 Growth Report 速率字段（今天恒 null）                                                            | `src/gateway/agent-growth/operational-metrics-store.ts` + 测试                   | 补全 + 更正    |
| 二 · 经验胶囊生成器   | `deriveCandidateCapsule` / `shouldGenerateCapsule`：从一次任务运行(结果/人工修改/评审)产出 `status:"candidate"` 胶囊，复用 `learning-projection` 治理 | `packages/collaboration-core/src/policies/learning-capsule-generation.ts` + 测试 | 新增（真空白） |
| 三 · AgentGenome 立项 | 判断 + 最小收敛类型脚手架（读模型/组合器，不新增真相源、不接线）                                                                                      | `src/gateway/agent-growth/genome.ts` + 测试                                      | 脚手架 + 决策  |

> 件事二b（生成器接线到任务收尾，本次新增）：在 `appendCollaborationExecutionRecord` 咽喉点（`src/gateway/collaboration-ledger/writer.ts`，被 `chat.ts` 4 处共用）fire-and-forget 调用 `recordExecutionOutcomeCapsuleSafely`。映射 `failed`→failure(anti_pattern)、`completed`/`skipped`→跳过；复用 backflow 同款 `learningStorage.appendCapsule` 持久化；产出 `status:"candidate"` 不自动投影，等治理审批。文件：`src/gateway/collaboration-learning/execution-outcome-capsule.ts` + 测试。
>
> 件事二c（候选胶囊接入治理审批 UI，本次新增）：后端 `collaboration.capsule.transition`（approve/revoke，`src/gateway/collaboration-learning/capsule-governance.ts` + `server-methods/collaboration-learning.ts`，登记 `method-scopes.ts`/`server-methods-list.ts`）；前端 `WorkbenchGovernanceObjectKind` 加 `"capsule"`、`GroupProfileView` 加 `"capsules"`、员工工作台群组治理页新增 Capsules 审批视图（候选胶囊 + Approve/Reject，复用既有 `onTransitionGovernanceObject` 全链）。approve 可选升级 reusability，否则保持 `group_only` 仍不可投影。
>
> 件事二d（评审收尾富信号，本次新增）：在 `transitionCollaborationReview`（`state-machine.ts`）收尾 fire-and-forget 调用 `recordReviewOutcomeCapsuleSafely`。映射 verdict `reject`→failure+reviewRejected(anti_pattern)、`revise`→partial+humanEditCount(lesson，即「completed 但需修正」)、`approve`/无 verdict→跳过（不为每次通过刷 pattern）；review `comments`→lesson 文本、`suggestions`→observation，使胶囊承载可复用反馈。文件：`src/gateway/collaboration-learning/review-outcome-capsule.ts` + 测试。
>
> 件事二e（复用阈值策展 pattern + 修订数富信号，本次新增）：生成器加 `reuseCount` + `PATTERN_REUSE_THRESHOLD`（`learning-capsule-generation.ts`），`success` 且 reuseCount≥阈值 → 策展为 `pattern`（否则平凡成功仍跳过，控噪）。评审收尾据存储计算：`deliverable.version-1` 作为 `humanEditCount`（真实修订次数）、`reuseCount` 用真实**跨任务复用**（同 `sourceLineageId` 下产出过已批准/发布 deliverable 的不同 `taskId` 数，纯函数 `countCrossTaskReuse`，避免同任务多版本灌水）；`approve` 达阈值即产出 pattern 候选（仍待治理审批）。

### 件事三决策（AgentGenome 是否一等对象）

结论：**立项，但作为「组合读模型」而非新真相源**。理由：identity 来自 SOUL/IDENTITY 文件，habits 来自 growth 维度，learned principles 来自 `AgentLearningAsset`——若新建独立存储会与三者重复并产生一致性问题。真正新增的只有 **Working DNA**（输出格式、汇报节奏、决策/风险偏好），这是当前无载体的部分。因此 `AgentGenome` = 组合(identity 快照 + habits + workingStyle + 引用 learningAssetIds)，由 `composeAgentGenome()` 聚合；Phase 2/5 的「行为改变」写入点收敛到 `workingStyle`。

> 件事三b（workingStyle 行为改变实际写入，本次新增）：新增按 agent 持久化 `working-style.json`（`src/gateway/agent-growth/working-style-store.ts`，仿 growth-status store）。纯函数 `deriveWorkingStyleDelta(signals)`（`genome.ts`）确定性地把运营信号映射为 Working DNA 变更（高人工接管→conservative+confirm_first；低接管+高成功→autonomous；低成功→conservative）。接入 `agents.recompute-growth`：有运营信号时 fire-and-forget `applyOperationalSignalsToWorkingStyle` 落盘。这样「任务→反馈(operationalScore 信号)→行为改变(workingStyle)」闭环的行为端已真实写入。
>
> 件事三c（workingStyle 生效于对话，本次新增）：纯函数 `renderWorkingStyleInstructions(style)`（`genome.ts`）把 Working DNA 渲染为提示词指令（中性默认不产出，控噪）；`resolveWorkingStyleInstructions(cfg, agentId)`（`working-style-store.ts`）仅当已持久化 `working-style.json` 时返回文本。在系统提示词源头 `get-reply-run.ts` 计算一次并**并入两个互斥装配分支之一**（单聊 与 协作装配分支各恰好注入一次，自然流经 run params → attempt/compact，跨压缩仍在），无需改动 867 行的提示词构建器或热路径。未学习过的 agent 不注入（向后兼容）。
>
> 件事三d（workingStyle 接入协作小组会话，本次新增）：因注入点位于 `runPreparedReply` 的两个装配分支内，小组每个 bot 成员经 `dispatchInboundMessage → runPreparedReply` 时，其 workingStyle 已随协作装配一并注入，且在 else 分支中紧邻 `collaborationCapabilityPrompt`（协作能力上下文），使行为指令与协作作用域上下文位置连贯。
>
> 件事二f（基于学习资产实际应用次数的更强复用信号，本次新增）：新增 `learning-asset-application-store.ts`（组 runtime 目录、locked 原子计数）。协作提示词构建时（`collaboration-capability-context.ts` 应用该 bot 活跃 `AgentLearningAsset`）fire-and-forget 记一次应用。`resolveGroupLearningReuse(groupId)` 返回资产被应用的最大次数；评审收尾的 `reuseCount = max(跨任务复用, 资产应用强度)`——后者反映知识是否**真的被反复应用到运行时**，比"已批准计数"更强。

---

> 件事三e（Working DNA 二阶反馈，本次新增）：纯函数 `evaluateWorkingStyleEffect(baseline, current)`（`genome.ts`，|Δ|<5 视为 inconclusive 滤噪）。`applyOperationalSignalsToWorkingStyle` 写变更时落一条 `working-style-change.json`（记变更时基线实战分）；`assessAndMarkWorkingStyleEffect` 在后续 recompute 对比"基线 vs 当前 operationalScore"，得出结论(improved/regressed)即标记已评估并广播 `agent_growth.working_style_effect`。接入 `agents.recompute-growth`：**先评估上次变更、再应用本次并记新基线**（避免竞争）。至此形成"行为改变是否真的提升实战表现"的二阶闭环（度量已就位；据此自动回滚/强化为下一步）。
>
> 件事二g（复用信号细化到 pattern 具体来源，本次新增）：纯函数 `selectAssetIdsForDeliverables(capsules, assets, deliverableIds)`（链路 capsule.sourceIds∩deliverableIds→capsuleId，asset.sourceCapsuleId∈capsuleId→assetId）+ `maxApplicationCountFor`。`resolveLearningReuseForDeliverables(groupId, lineageDeliverableIds)` 只统计**该 lineage 派生资产**的应用强度；评审收尾据此把 approve→pattern 的 reuseCount 归因到具体来源，替代原先的全组最大值。
>
> 件事三f（据二阶结论自动回滚/强化，本次新增）：`assessAndMarkWorkingStyleEffect` 判定 `regressed` 时**自动回滚**——用变更记录里的 `previousValues` 恢复变更前的值，并写 `working-style-suppression.json` 抑制重复应用同一 delta（纯函数 `sameWorkingStyleDelta` 判等；信号产出不同 delta 时自动解除，防"应用→回归→回滚→再应用"振荡）；`improved` → 保留变更（即"强化"，无需额外动作）。回滚不写新变更记录（不触发再评估循环）。变更记录扩展 `previousValues`/`rolledBack`，广播 payload 增加 `rolledBack`。
>
> 件事三g（working_style_effect 接入企业治理 UI，本次新增）：新增只读 RPC `agents.list-working-style-effects`（跨 agent 汇总最近一次变更的效果，`server-methods/agent-growth.ts`，登记 READ scope + BASE_METHODS）。UI 在自包含能力模块 `ui/src/ui/capability/ai-workforce-governance/` 新增 `<working-style-effects-panel>`（`fetchWorkingStyleEffects` + 状态徽章 improved/regressed/inconclusive/pending/rolled-back），嵌入企业员工治理面 `enterprise-workforce-governance-surface.ts`（17 行 wrapper，避开 identity WIP 破损文件）。
>
> 件事三h（deltaScore 反哺 operationalScore 做三阶自调，本次新增）：`assessAndMarkWorkingStyleEffect` 累计有效性统计 `working-style-effect-stats.json`；纯函数 `computeAdaptivityAdjustment(stats)`（`operational-score.ts`）把净有效性映射为**有界调整量 [-6,+6]**（非归一化权重，避免把高分往 50 拉；样本<3 不调整）。recompute 把调整量加到**存储/展示**的 operationalScore，而二阶 delta 仍用**原始分**（不含调整）计算——避免自指污染与失控放大。`recomputeRobot` 改为接收预算好的分。
>
> 件事二h（跨 agent 行为改变有效性聚合 + A/B，本次新增）：纯模块 `working-style-effectiveness.ts`——`workingStyleDeltaSignature`（规范签名）、`aggregateWorkingStyleEffectiveness`（overall + 按签名 netEffectiveness 排序 + 按 cohort 拆分）、`resolveWorkingStyleCohort`（FNV-1a 稳定分组，A/B 留出原语）。RPC `agents.working-style-effectiveness`（READ + BASE_METHODS）。UI 面板加聚合摘要（overall improvedRate + 最有效签名）。真正的随机留出（control 组跳过自适应）属产品/安全决策，默认不启用，cohort 分组为其骨架。

## 5. 后续集成清单（本次未做，明确标注，避免热路径高风险改动）

1. ~~**胶囊生成器接线 + 富信号 + 审批 UI + 复用阈值 + 行为改变写入**~~ **已完成（件事二b/二c/二d/二e/三b）**：execution `failed`、评审 `reject`/`revise`、`approve` 达复用阈值 → 产出 candidate（lesson/anti_pattern/pattern）；候选经员工工作台 Capsules 视图审批（二c）；`deliverable.version` 驱动 humanEditCount/reuseCount（二e）；运营信号确定性写入 `workingStyle`（三b）并注入系统提示词生效于对话（三c）；`reuseCount` 用真实跨任务复用（distinct taskId）计数（二e 已细化）。workingStyle 亦接入协作小组会话（三d）；`reuseCount` 增加"学习资产实际应用强度"信号并与跨任务复用取较大者（二f）。P2 学习闭环（生成→审批→投影/晋升 + 运营信号→行为改变→对话生效，单聊与协作小组均生效）已端到端打通。二阶反馈度量行为改变的实战效果（三e）；复用信号已按资产来源细化（二g）；据二阶结论**自动回滚**回归变更并抑制振荡（三f）；`working_style_effect` 已接入企业治理 UI 可视化（三g）。至此 P2 学习系统闭环完整：知识资产端（生成→审批→投影/晋升）+ 行为端（运营信号→行为改变→对话生效→二阶评估→自动回滚/强化→三阶 adaptivity 反哺分数），并在企业治理 UI 可观测（含跨 agent 有效性聚合 + A/B 骨架）。三阶自调（三h）与跨 agent 聚合/AB（二h）已落地。剩余可选扩展：启用随机留出使 cohort 成为真正 A/B（需产品决策）；把有效性聚合结论用于跨 agent 的行为改变推荐（把某组验证有效的 delta 建议给相似 agent）。
2. **operationalScore 第二/第三信号**：`recordToolOutcome`（工具成功率）、`humanTakeover`、`satisfaction` 需在 Pi agent 工具循环或渠道层插桩——当前无干净低风险接点。
3. **operationalScore 自动重算触发**：目前仅 RPC/UI 触发 `recompute-growth`，累加器填充后分数不自动刷新。
4. **Phase 5 持久化**：`ai-workforce-governance` 内存 store → 持久遥测，才能驱动自进化。

---

## 附：spec → 阶段归属（据名称 + 已核对代码的最佳分类，非逐份通读）

- P1 激活：`agent-growth-lifecycle`
- P2 学习：（无专属 spec；`packages/collaboration-core` 学习胶囊类型 + `behavior-buffer`）← **空白信号**
- P3 能力：`skill-lifecycle-asset-system`、`capability-lifecycle-closure`、`capability-governance-runtime`、`enterprise-capability-asset-library`、`enterprise-capability-usage-management`、`enterprise-data-capability-center`、`resource-catalog`、`semantic-object-catalog`
- P4 组织：`collaboration-convergence`、`group-mention-system`、`mesh-governance-redesign`、`platform-agent-runtime-center`、`daibai-super-steward`
- P5 自进化：`ai-workforce-governance`（代码）、`cost-economics`、`policy-engine`
- 商业/权益（横切）：`cost-budget-billing`、`enterprise-budget`、`entitlement-v2`、`package-entitlement-v2`、`model-entitlement-chain`、`subscription-commerce`、`operational-identity-governance`、`enterprise-ui-baseline`、`enterprise-overview-redesign`、`platform-admin-login-isolation`
- 研发工具链（agent 造产品，非产品运行时）：`loom-provisioning`、`loom-workspace-orchestrator`、`openbot-fabric`、`development-supervisor(-chat-bridge)`、`gateway-plugins-monolith-decomposition`、`gateway-method-pack`、`builder-decommission`、`ops-decommission`、`cli-backend-onboarding`、`chat-checkpoint-rollback`、`openclaw-task-execution-analysis`、`platform-pricing-gateway-instability`
