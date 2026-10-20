# OpenBot 自进化机制分析与总结（背景资料）

Date: 2026-09-06

Status: **背景归档。不是实施规格，不是新进化系统提案，不授权自动修改能力。**

Audience: Platform Architecture、Evolution Governance、Diagnosis、QA

Task: `openbot-self-evolution-background`

Related:

- [P8 受治理进化提案](/design/openbot-diagnosis-p8-evolution-proposal-2026-09-03)
- [P9 治理修复预览](/design/openbot-diagnosis-p9-remediation-preview-2026-09-03)
- `src/diagnosis/evolution-proposal.ts`
- `src/gateway/agent-growth/`
- `src/gateway/evolution-governance/`

硬门禁：本文件只归档判断与融合边界。禁止据此直接改 Skill、Working DNA、Capsule、Fabric policy 或 runtime action。工程链路可运行不等于进化有效性已经成立。

---

## 对话归档说明

本文件来自 2026-09-06 的 Grok 对话归档，目的是把「自进化机制分析」从聊天线程迁入 `gmood2008/openbot`，便于后续在仓库内检索和管理。

对话请求顺序：

1. 用户提供 OpenBot 自进化机制分析与总结，要求「作为背景资料记录即可」。
2. 用户要求「将这个对话移入到 openbot 项目中，便于管理」。

本文件对应第 2 步的仓库落点。Grok 聊天线程本身无法迁入 GitHub Project；以设计文档 + Issue 作为项目内管理入口。

---

## 总判断

OpenBot 已经具备一套相当完整的「受治理进化基础设施」，但还不是完整、统一、可证明有效的系统级自进化系统。

更准确地说：

- 在 Agent 学习、经验资产化、Working DNA、技能生命周期、运行时治理、审批和回滚方面，OpenBot 已明显超过「概念原型」。
- 在统一定义权威、科学实验、跨飞轮编排、长期效果归因和系统级闭环方面，仍有关键缺口。
- 因此有必要吸收这次优化改造，但不应该另造一套系统，也不应整体替换现有体系。
- 最值得融合的是：失败机制挖掘、受控实验、负向契约和 surface 风险治理。
- 最不应该融合的是：把整个 OpenBot 进化系统收缩成 diagnosis Harness 优化流程。

## 完整性判断

可以从七个环节判断：

| 环节     | 当前成熟度 | 判断                                                                    |
| -------- | ---------- | ----------------------------------------------------------------------- |
| 信号采集 | 中等       | 已有任务、技能、协作、Agent 运行指标，但信号覆盖和质量不均衡            |
| 经验提炼 | 中高       | 已有 Experience Capsule、失败/评审反馈生成和候选治理                    |
| 候选提案 | 中高       | 已有正式 Proposal、Candidate、Approval 生命周期                         |
| 行为改变 | 中高       | Working DNA 可持久化并注入 Agent 对话                                   |
| 能力进化 | 高         | Skill 从候选、审批、发布到安装和回滚的资产链较完整                      |
| 效果验证 | 中低       | 有前后分数和效果窗口，但缺少严格对照实验和可靠归因                      |
| 系统治理 | 中高       | 有 assist/auto、kill switch、幂等、恢复快照、租户授权；但缺统一总控模型 |

所以它不是「不完整的空架子」，而是：

**局部闭环已经形成，系统级闭环尚未收敛。**

尤其需要警惕现有文档中「P2 学习系统闭环完整」之类表述。工程链路接通不等于进化有效性已经成立。系统能够修改、回滚自身行为，只能证明闭环可运行；不能证明修改由正确原因触发，也不能证明长期净收益为正。

## OpenBot 现有进化系统的优势

### 1. 强治理，而不是开放式自我改写

OpenBot 的最大优势不是「自主程度最高」，而是把建议、批准、应用、验证和回滚分成独立对象：

- `src/diagnosis/evolution-proposal.ts:34`

并且候选明确：

- `requiresHumanApproval: true`
- `autoApplied: false`
- `autoExecute: false`

见 `src/diagnosis/evolution-proposal.ts:130`。

这比让 Agent 直接修改 prompt、skill 或代码可靠得多，也更适合企业场景。

### 2. 进化对象不是单一 prompt

OpenBot 已经识别了多种可进化资产：

- Skill
- Agent Working DNA
- Experience Capsule
- Fabric Feedback
- Evolution Governance

见 `src/diagnosis/evolution-proposal.ts:25`。

这是一项重要优势。真正的 Agent 系统进化通常发生在模型外围，包括记忆、技能、协作方式、路由和治理政策，而不仅是改一段提示词。

### 3. Agent 行为进化已进入真实运行路径

Working DNA 不只是数据库字段。现有实现包含：

- 运营信号驱动行为变化
- 工作风格持久化
- 系统提示词注入
- 效果复测
- 回归时恢复旧值
- 抑制重复振荡

相关实现集中在：

- `src/gateway/agent-growth/genome.ts`
- `src/gateway/agent-growth/working-style-store.ts`
- `src/gateway/agent-growth/working-style-self-tuning.ts`
- `src/gateway/agent-growth/working-style-effectiveness.ts`

因此 OpenBot 已经跨过「只记录经验、不改变行为」的阶段。

### 4. 有真实的运行时治理与恢复能力

Evolution governance 不只是建议系统。在 auto 模式下，它能够对 Agent 执行：

- pause/resume
- limit/clear_limit
- redirect/clear_redirect

见 `src/gateway/evolution-governance/runtime-actions.ts:21`。

同时采用 compare-and-restore，只恢复本次治理动作实际改变的绑定，避免把原有人工禁用状态错误恢复：

- `src/gateway/evolution-governance/runtime-actions.ts:144`

这说明现有体系具备较好的可逆性和副作用意识。

### 5. 企业级租户与授权边界比较扎实

进化提案已经验证：

- grant 是否有效
- evidence 是否在授权范围内
- tenant 是否匹配
- confidentiality 是否越级
- 平台级聚合是否携带原始企业证据

见：

- `src/diagnosis/evolution-proposal.ts:478`
- `src/diagnosis/evolution-proposal.ts:573`
- `src/diagnosis/evolution-proposal.ts:602`

这是 OpenBot 相比很多实验性「自进化 Agent」方案更有价值的部分。

### 6. 默认保守，但保留受控自动化

运行模式为：

- off
- assist
- auto

默认是 assist，见 `src/gateway/evolution-governance/mode.ts:12`。

这种渐进式自治比「自动或不自动」的二元开关更成熟，适合从人工治理逐步升级到有限自治。

## 当前核心缺口

### 1. 没有统一的进化系统总模型

当前至少存在几条相对独立的链路：

- Diagnosis Evolution Proposal
- Agent Growth / Working DNA
- Collaboration Capsule
- Skill Lifecycle
- Evolution Governance Runtime Actions

它们分别有自己的候选、状态、验证和回滚概念。还没有一个统一模型回答：

> 哪类信号，通过哪个实验，在谁批准后，改变哪个资产，由谁验证，何时回滚？

这是当前最大结构性缺口。

### 2. 效果归因仍然偏弱

现有系统能比较变更前后分数，但「变更后变好」不等于「因为这次变更而变好」。

缺少：

- 稳定 control cohort
- held-out 数据
- 同模型、同配置基线
- 最小样本量
- 置信区间
- 多指标约束
- 数据污染控制
- 长周期退化监控

因此当前更接近「有反馈的自适应」，还不是严格意义上的「实证进化」。

### 3. 进化信号仍不充分

任务成功、技能成功率、延迟等信号已经存在，但用户满意度、人工接管、业务价值、误操作严重度、跨渠道一致性等仍不够完整。

错误信号进入闭环，会导致系统高质量地优化错误目标。

### 4. 局部策略可能互相干扰

例如：

- Working DNA 改变行为
- Skill 更新改变能力
- Memory 更新改变上下文
- Routing/limit 改变任务分布

如果它们同时变化，单条效果评估无法知道收益或退化来自哪一项。未来需要进化变更预算、互斥窗口和因果归因。

## 是否融合本次优化改造

答案是：有必要选择性融合，而且优先级较高。

但融合目标应是补齐 OpenBot 的「实验与统一治理层」，不是重建候选、审批、日志和回滚体系。

### 建议吸收四部分

1. **φ=(c,q,m) 失败机制建模**
   将孤立失败提升为可复用机制，并允许 unknown/inconclusive。

2. **Surface Registry**
   统一描述可编辑对象、SoT、风险等级、审批人、验证集和回滚方法。

3. **Experiment Contract**
   把 held-in/held-out、A/B、样本量、基线、指标和负向门禁变成正式对象。

4. **Regression Locks**
   将「禁止 diagnosis 产生副作用」等安全约束做成依赖边界和能力门禁。

### 不建议吸收三部分

1. 不另建 Evolution Log，复用现有 Proposal 生命周期和持久化体系。
2. 不把 diagnosis 定义为整个进化系统，它只能是证据和候选来源之一。
3. 不把所有 L3 状态视为同等风险；文档、memory、prompt、skill 和 runtime policy 必须分级。

## 专业建议

OpenBot 下一阶段不应继续优先增加更多「自动修改能力」。当前最需要的是：

> 证明哪次改变为什么有效，并确保不同进化飞轮不会互相污染。

### 推荐演进顺序

1. 统一现有五条进化链路的对象和状态语义。
2. 建立 EvolutionExperiment 与机器可读 Surface Registry。
3. 先对 Working DNA 和 Skill Candidate 做真实 control/experiment 留出。
4. 将业务价值、安全、成本、延迟组成多目标接受门。
5. 最后才扩大 auto 模式适用范围。

## 最终判断

现有基础值得保留，优化机制值得融合，但应作为现有系统的「科学评估层和统一治理层」，而不是新的进化系统。
