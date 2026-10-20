# Aegis 与 OpenBot 在任务执行逻辑、流程与大模型调用上的比对

## 1. 目的

本文基于以下材料，对 Aegis 与 OpenBot 在任务执行链路、用户需求理解、技能或能力匹配、大模型调用方式、状态机与治理机制上的差异做对比分析：

- OpenBot 分析文档：
  - `Pi-Coding-Agent-Integration-Guide.md`
  - `.kiro/specs/openclaw-task-execution-analysis/design.md`
  - `OpenBot-Dialogue-Prompt-Mechanism-Analysis.md`
- OpenBot 实现代码：
  - `src/auto-reply/reply/get-reply.ts`
  - `src/commands/agent.ts`
  - `src/agents/system-prompt.ts`
  - `src/agents/pi-embedded-runner/run/attempt.ts`
  - `src/agents/skills/workspace.ts`
- Aegis 文档与实现：
  - `Aegis_Kernel_vNext_Architecture.md`
  - `双模型智能分配方案.md`
  - `server/llm-governance/callpoint-registry.ts`
  - `server/integrations/llm-nexus/routing-rules.ts`
  - `server/aegis-core/kernel/router-workbench-v2-dialogue.impl.ts`

## 2. 总体结论

两者都不是单纯的“聊天机器人”，但体系重心明显不同。

- **OpenBot** 更像一个以多渠道消息接入和 Agent 运行时为中心的执行平台。它的主模式是：
  - 渠道路由与会话管理
  - 规则预处理
  - 构建 system prompt、技能清单、工具集和上下文
  - 把开放式任务理解与工具调用循环交给嵌入式 Agent/LLM
- **Aegis** 更像一个以 Kernel 控制平面和任务状态机为中心的任务操作系统。它的主模式是：
  - 先把任务拆成显式的生命周期阶段
  - 对每个阶段做意图、规划、能力检查、执行、验证与交付
  - 用“调用点注册表 + 路由规则 + 治理门控”对大模型调用进行治理

一句话概括：

- OpenBot 偏 **Agent Runtime / Conversation-first**
- Aegis 偏 **Kernel Orchestration / Task-first**

## 3. 核心差异总览

| 维度          | OpenBot                                                 | Aegis                                          |
| ------------- | ------------------------------------------------------- | ---------------------------------------------- |
| 系统中心      | 多渠道 Gateway + Agent Runtime                          | Kernel + Task State Machine                    |
| 用户输入入口  | 消息渠道、会话、命令、directives                        | Workbench 会话、任务内核入口                   |
| 任务理解方式  | 规则预处理后，主要由 system prompt 驱动 LLM 自主理解    | 先做显式意图解析、澄清、任务编译，再进入执行   |
| 技能/能力匹配 | 候选技能清单 + prompt 约束 + 模型选择                   | Capability/Callpoint 显式注册与路由            |
| 澄清机制      | 更多依赖对话上下文和模型行为                            | Clarification 是一等状态，显式推进             |
| 执行主循环    | `activeSession.prompt(...)` 驱动工具循环                | Kernel 状态流转驱动执行控制器                  |
| 大模型调用    | 以 Agent session 为单位，围绕单次 prompt/tool loop 展开 | 以“调用点”为单位，按策略分配模型               |
| 模型治理      | Provider/Model 选择、fallback、auth/profile、tool 适配  | Callpoint Registry + Routing Rules + Risk/Gate |
| 状态机显式性  | 会话强，任务状态弱                                      | 任务状态强，会话为状态机载体                   |
| 治理/审计     | 有运行时约束与持久化，但不是内核中心                    | 治理、证据、外部效果控制是核心模块             |
| 适合场景      | 多渠道助手、工具执行、个人数字助手                      | 高治理任务系统、流程编排、决策与任务操作系统   |

## 4. 任务执行主链路对比

### 4.1 OpenBot 的典型执行链路

OpenBot 的执行链路更像“消息驱动的 Agent 运行时”。

1. 消息进入 Gateway 或渠道入口。
2. 在 `src/auto-reply/reply/get-reply.ts:57` 开始进入主预处理：
   - 解析目标 session 和 agent
   - 合并 agent 级技能过滤
   - 做媒体理解、链接理解
   - 解析命令授权、session 初始化和 per-message directives
3. 如果是 slash command、inline action 或模型/权限指令，就先在规则层处理，见 `src/auto-reply/reply/get-reply.ts:221`。
4. 进入 agent 执行前，会对当前会话构建并持久化 `skillsSnapshot`，保证同一 session 的技能候选集稳定，见 `src/commands/agent.ts:876`。
5. 在 `src/agents/pi-embedded-runner/run/attempt.ts:791` 开始准备运行：
   - 解析 skills prompt
   - 解析 bootstrap/context files
   - 组装工具集合
   - 构建 runtime info
6. 在 `src/agents/pi-embedded-runner/run/attempt.ts:998` 构建系统提示词。
7. 在 `src/agents/pi-embedded-runner/run/attempt.ts:1179` 创建嵌入式 agent session，并在 `src/agents/pi-embedded-runner/run/attempt.ts:1192` 覆盖 system prompt。
8. 最终在 `src/agents/pi-embedded-runner/run/attempt.ts:1781` 调用 `activeSession.prompt(...)`，进入模型与工具循环。

结论：

- OpenBot 的“主发动机”是一次次 agent session prompt。
- 任务理解、技能选择、工具调用，在很大程度上是由 system prompt + 工具定义 + 会话历史共同约束下的模型行为完成。

### 4.2 Aegis 的典型执行链路

Aegis 的执行链路更像“任务状态机驱动的内核执行”。

根据 `Aegis_Kernel_vNext_Architecture.md`，它把任务生命周期显式定义为：

- `INIT`
- `INTENT_PARSED`
- `PLANNED`
- `CAPABILITY_CHECKED`
- `EXECUTING`
- `VERIFYING`
- `DELIVERED`
- 失败路径：`FAILED -> EXPLAINED_FAILURE`

在实现侧，`server/aegis-core/kernel/router-workbench-v2-dialogue.impl.ts` 体现了这种思路：

1. 先处理对话输入与澄清状态。
2. 如果在澄清阶段，先判断用户回答是不是“新意图”，见该文件约 `1490` 行附近的 `detectIntentShift(...)`。
3. 如果检测到意图偏移，会明确提示创建新会话，而不是直接把新意图继续塞进原任务。
4. 如果澄清完成，则通过 `ClarificationEngine.generateExecutionCommand(...)` 生成规范化执行命令。
5. 对外部效果型任务，会进入确认/握手分支；对普通任务，则把 session 状态改成 `running`。
6. 之后调用 `executeKernelExecutionSync(...)` 真正把任务交给执行层。

结论：

- Aegis 的“主发动机”不是一次通用 prompt，而是一个带状态流转的任务内核。
- 大模型更像 Kernel 的能力部件，而不是整个系统的唯一中心。

## 5. 用户需求理解方式对比

### 5.1 OpenBot：规则预处理 + Prompt 驱动理解

OpenBot 会先用规则层做确定性处理，但开放式需求理解主要交给模型：

- `src/auto-reply/reply/get-reply.ts:126` 会补充媒体和链接理解
- `src/auto-reply/reply/get-reply.ts:146` 会做命令授权与 session 初始化
- `src/agents/system-prompt.ts:20` 开始把 skills、memory、messaging、docs、workspace 等规则写进 system prompt

其中技能选择规则非常典型，见 `src/agents/system-prompt.ts:20`：

- 先扫描 `<available_skills>`
- 如果只有一个 skill 明显匹配，就去读它的 `SKILL.md`
- 如果多个都匹配，选最具体的
- 如果没有明显匹配，则不要读 skill

这说明 OpenBot 的需求理解机制是：

- **前置规则层负责“显式控制信息”**
- **LLM 负责“开放式任务语义理解和技能选择”**

### 5.2 Aegis：显式意图解析 + 澄清状态机

Aegis 更强调显式结构化理解，而不是把理解过程全部交给 prompt：

- `Aegis_Kernel_vNext_Architecture.md` 直接把 `Intent Analyzer` 作为内核首层模块
- `server/aegis-core/kernel/router-workbench-v2-dialogue.impl.ts` 中，澄清、问答、意图偏移检测都是显式分支
- `ClarificationEngine.generateQuestion(...)` 会持续生成下一轮问题，直到参数收齐

所以 Aegis 的理解方式更接近：

- 先识别任务意图
- 再澄清缺失参数
- 再编译成执行命令
- 最后才交给执行器

这是一种 **Task-first 的结构化理解路径**。

## 6. 技能匹配与能力路由对比

### 6.1 OpenBot：技能是“候选能力包”，主要靠模型选择

OpenBot 的技能快照与 prompt 生成逻辑在 `src/agents/skills/workspace.ts:603` 之后：

- 先扫描技能来源并过滤 eligibility
- 再生成 skills prompt
- 最终把技能候选列表注入 system prompt

同一 session 内的技能集合会被快照化，见 `src/commands/agent.ts:876`。  
这有两个特点：

- 技能是 **可暴露给模型的候选知识/流程包**
- 技能匹配不是一个硬编码路由器，而是 **“筛好的候选集 + prompt 规则 + 模型决策”**

### 6.2 Aegis：能力路由和调用点治理更显式

Aegis 更强调显式的能力注册和路由：

- `Aegis_Kernel_vNext_Architecture.md` 里有 `Capability Registry`、`Capability Router`
- `server/llm-governance/callpoint-registry.ts` 定义了多个 LLM 调用点，例如：
  - `intent_preclassification`
  - `intent_validation`
  - `task_compilation`
  - `decision_assistance`
  - `quest_planning`
  - `model_structured_output`
  - `model_safety_check`
  - `model_council_debate`
- 每个调用点都带：
  - `risk_level`
  - `requires_gate`
  - `routing_policy`
  - `fallback_policy`

因此 Aegis 的能力匹配不是“让模型自己先判断该用什么能力”，而是：

- 先把任务分解到明确调用点
- 再由注册表和路由规则决定使用什么模型或能力

## 7. 大模型调用方式对比

### 7.1 OpenBot：以 Agent Session 为中心的模型调用

OpenBot 的模型调用围绕单次 agent run 展开：

- 先确定 `provider/model`
- 创建 `createAgentSession(...)`
- 通过 `activeSession.prompt(...)` 开始本轮对话驱动执行

它的模型调用治理重点是：

- provider 适配
- auth/profile 选择
- tool schema 与 provider 兼容处理
- prompt 注入
- tool loop
- 会话持久化

换句话说，OpenBot 更像：

- **围绕一个会话上下文，调用一个当前模型，然后让工具循环自己发展**

### 7.2 Aegis：以 LLM Callpoint 为中心的模型调用

Aegis 则是把模型调用拆成多个独立调用点，并进行显式治理。

从 `server/llm-governance/callpoint-registry.ts` 和 `双模型智能分配方案.md` 可以看出：

- Aegis 不是只有“调用一次模型”
- 它会把不同任务阶段拆成不同调用点
- 不同调用点可以路由到不同模型

例如在 `双模型智能分配方案.md` 中：

- DeepSeek Chat 适合：
  - `intent_preclassification`
  - `intent_validation`
  - `model_text_generate`
  - `model_classify`
  - `result_enhancement`
  - `memory_compression`
  - `model_safety_check`
- Qwen 3.5 Plus 适合：
  - `task_compilation`
  - `decision_assistance`
  - `quest_planning`
  - `model_structured_output`
  - `model_council_debate`

而 `server/integrations/llm-nexus/routing-rules.ts` 进一步表明：

- 路由决策还会参考 `required_quality`
- `speed_priority`
- `cost_priority`
- `custom_attributes.aegis_task_type`

这是一种 **Callpoint-first 的多模型治理模式**。

## 8. 状态机与澄清机制对比

### 8.1 OpenBot：会话强，任务状态弱

OpenBot 很擅长：

- 多渠道消息收发
- session 连续性
- session 内工具执行与流式返回

但它的“任务状态机”没有 Aegis 那么显式。  
OpenBot 更强的是：

- conversation continuity
- session history
- skills snapshot
- tool execution context

它能完成复杂任务，但更像“对话驱动的连续执行”，而不是一个强约束的任务生命周期引擎。

### 8.2 Aegis：任务状态强，澄清是显式一等对象

Aegis 在任务状态和澄清上更强：

- `clarifying`
- `running`
- `paused`
- `need_confirm`
- `completed`
- `failed`

这些状态和 session 数据直接在 workbench 表结构里持久化。  
而且 `router-workbench-v2-dialogue.impl.ts` 中：

- 会判断当前是否处于澄清阶段
- 会生成下一问题
- 会在参数收齐后切换状态
- 会在外部效果型任务上插入人工确认/握手
- 会在意图偏移时建议开新会话

Aegis 的状态与澄清机制明显更适合：

- 长周期任务
- 明确审批/确认
- 有恢复、重试、审计要求的流程

## 9. 治理、安全与外部效果控制对比

### 9.1 OpenBot

OpenBot 也有安全与控制能力，例如：

- sandbox
- tool allowlist / policy
- session transcript
- owner/authorized sender
- channel capability constraints

但这些能力更多是 **Agent Runtime 的约束层**。

### 9.2 Aegis

Aegis 从架构定义上就把治理放在核心位置：

- `Governance Guard`
- `Evidence Recorder`
- `External Effect Manager`

这意味着 Aegis 默认更强调：

- 可审计
- 可追责
- 可验证
- 外部效果受控

在任务涉及邮件、支付、执行确认等场景时，这种架构天然比通用对话式 Agent 更稳。

## 10. 适用场景判断

### 10.1 更适合 OpenBot 的场景

- 多消息渠道统一接入
- 个人数字助手
- 以聊天为主入口的任务执行
- 工具调用、文件处理、workspace 编码代理
- 需要快速把不同技能、工具、渠道接起来

### 10.2 更适合 Aegis 的场景

- 任务中心型产品
- 强治理、强审计、强状态机
- 明确需要“先理解 -> 再规划 -> 再校验 -> 再执行 -> 再验证”的业务
- 对大模型调用成本、风险、质量需要精细治理
- 多模型按调用点精细分配

## 11. 对你的体系设计的启发

如果你的目标是做一个真正面向企业或复杂数字分身协作的系统，最值得借鉴的不是二选一，而是组合两者优势：

### 11.1 应优先借鉴 OpenBot 的部分

- 多渠道 Gateway
- 会话路由与会话持久化
- Agent Runtime + 工具循环
- skills prompt / workspace context / bootstrap files
- 面向用户的实时交互体验

### 11.2 应优先借鉴 Aegis 的部分

- 任务状态机
- 澄清状态显式化
- 大模型调用点注册表
- 按调用点做模型路由与 fallback
- 外部效果确认、治理和证据记录

### 11.3 更合理的融合方向

比较合理的融合方案应是：

- 前台交互层采用 OpenBot 的对话与渠道能力
- 内核编排层采用 Aegis 的任务状态机与调用点治理

也就是：

- **OpenBot 负责“怎么和用户持续交互、怎么把工具和渠道接起来”**
- **Aegis 负责“任务该如何被结构化理解、规划、执行、验证和治理”**

## 12. 最终判断

如果只看“任务执行效率和多渠道助手体验”，OpenBot 更成熟直接。  
如果只看“任务内核、治理、状态机和多模型精细调度”，Aegis 的方向更先进。

从系统演进角度看：

- OpenBot 更像一个已经可用的 Agent 平台
- Aegis 更像一个在打造任务操作系统内核

因此，两者不是简单替代关系，而是可以分层组合：

- **OpenBot 适合作为交互与执行外壳**
- **Aegis 适合作为任务编排与治理内核**
