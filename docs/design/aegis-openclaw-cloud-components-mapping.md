# Aegis 云端基础设施与 OpenBot 可借鉴能力的分布式映射方案

## 1. 目的

在 Aegis 体系中，`Aegis Kernel`、`AI-First`、`Ascend AI`、`K-OS`、`ASR Runtime` 都属于整体系统的一部分。  
因此，借鉴 OpenBot 时不能只问“哪些能力抄过来”，而要问：

- 哪些能力应该落在 `Aegis Kernel`
- 哪些应该落在 `AI-First`
- 哪些应该落在 `ASR Runtime`
- 哪些应该落在 `K-OS`
- 哪些应该由 `Ascend AI` 承担

本文的核心目标是：

- 明确 Aegis 各组件的职责边界
- 明确 OpenBot 的可借鉴能力应该分布到哪里
- 确保借鉴 OpenBot 时，不破坏 Aegis 的主权架构与护城河

## 2. 先给出总判断

### 2.1 不能把 OpenBot 的优势简单塞进 Aegis Kernel

OpenBot 的优势横跨：

- 消息接入
- 会话系统
- Agent Runtime
- tools
- skills
- workspace context
- 控制台和前台交互

这些能力天然是分布式的。  
如果全部塞进 Aegis Kernel，会导致：

- Kernel 变成大杂烩
- 主权边界变模糊
- AI-First / ASR / K-OS / Ascend 的职责退化
- 系统无法形成真正的分层护城河

### 2.2 正确做法是“按组件职责吸收 OpenBot”

更合理的做法是：

- 把 OpenBot 的接入、会话、交互能力吸收到 **Aegis Edge / Frontstage / Session Runtime**
- 把 OpenBot 的 tool/runtime 机制吸收到 **AI-First 的 capability runtime**
- 把 OpenBot 的多通道/多 surface 路由经验吸收到 **ASR Runtime + Edge Gateway**
- 把 OpenBot 的约束和安全经验映射到 **K-OS 治理判决 + Aegis 执行前 gate**
- 把 OpenBot 的 prompt、skills、上下文装配经验吸收到 **Aegis Kernel 的认知编排层**

## 3. Aegis 各组件建议职责

## 3.1 Aegis Kernel

这是整个系统的任务大脑和主权中心。  
它应负责：

- 任务意图解析
- 澄清状态机
- 任务编译与规划
- 能力检查
- 执行控制
- 风险判定
- 调用点级大模型治理
- 验证、改进、交付
- 任务状态机
- 主权断言与 Execution Proof

Kernel 不应承担：

- 各种渠道接入细节
- 具体 capability handler 实现
- 通用消息 UI 逻辑
- 大量外部系统协议细节

Kernel 的职责是：

- **决定做什么**
- **决定能不能做**
- **决定何时做**
- **决定谁来做**
- **决定做完算不算完成**

## 3.2 AI-First

结合 Aegis 现有文档，AI-First 在最终融合架构里不应是“独立执行主脑”，而应退位为：

- Planning / Advisory / Forge / Capability Runtime

更准确地说，AI-First 适合承担：

- 标准化 capability hosting
- YAML/Spec 到可执行 handler 的运行时
- MCP / function-calling / tool schema 暴露层
- 云端通用能力库
- 受控的原子能力执行
- Shadow mode / 模拟执行 / 草案生成
- 特定认知增强能力

但 AI-First 不应承担：

- Workflow 主启动权
- 执行状态机主权
- 执行节拍控制权
- 跨 capability 编排主权
- 绕过 Aegis 的直接执行入口

这和 `AWE 主权声明` 是一致的：

- Aegis 是唯一 workflow execution runtime
- AI-First 只能做规划、建议、能力运行时和 forge

## 3.3 Ascend AI

Ascend AI 在现有实现里更像“专项高价值智能单元”，不是通用入口。

它适合承担：

- 特定高价值领域 plan 生成
- 专项 execution unit
- 垂直领域专业推理
- 需要更强专业规则和执行器配合的任务

现有实现里已经表现出这种特征：

- 对医疗/健康类任务进行专项路由
- 生成计划
- 经过 K-OS 合规检查
- 再交由对应执行单元处理

因此 Ascend AI 更像：

- **领域专长引擎**
- **垂直智能执行单元层**

而不是系统级主路由器。

## 3.4 K-OS

K-OS 是治理、司法和合规内核。  
它应承担：

- Constitution Check
- Handshake Decision
- 风险裁决
- 执行历史 ingest 与 signals
- SAFE MODE 触发
- 审批与拒绝机制
- 审计和判决契约

K-OS 不应承担：

- 聊天入口
- 通用 task planning
- 通用 capability runtime
- 主会话管理

K-OS 的本质不是“另一个执行器”，而是：

- **治理裁决内核**
- **司法和合规内核**

## 3.5 ASR Runtime

ASR Runtime 最适合作为：

- Sovereign Envelope 通信层
- 统一入口网关
- 组件间路由与转发层
- 统一 trace / execution_id / audit_id 挂载点
- 统一执行结果回传层

ASR 的职责是：

- Aegis 向云端子系统发起标准化请求
- 带上主权信封、上下文引用和治理策略
- 把请求路由到 AI-First / Ascend / K-OS 等
- 把结果再统一返回 Aegis

ASR 不应自己成为“新的任务大脑”。  
它更像：

- **主权通信总线**
- **云端运行时入口层**

## 4. OpenBot 能力应该映射到哪些组件

下面是最关键的问题。

## 4.1 多渠道 Gateway 与消息接入

OpenBot 最成熟、最直接可借鉴的部分之一，就是多渠道接入和会话路由。

### 应映射到哪里

优先落在：

- Aegis 的 `Edge Gateway / Frontstage`
- 必要时由 ASR 暴露统一 ingress

### 不应落在

- AI-First
- K-OS
- Ascend AI

### 原因

渠道接入是用户交互层能力，不应污染认知内核和治理内核。

### 建议

- 借鉴 OpenBot 的 channel abstraction
- 借鉴 session key / peer / group / thread 路由模型
- 借鉴消息 surface capability 抽象

但最终在 Aegis 中，这应被定义为：

- **前台和边缘接入能力**

而不是 AI-First 或 K-OS 的一部分。

## 4.2 Session Runtime 与会话持久化

OpenBot 的 session runtime 很值得借鉴。

### 应映射到哪里

主落点：

- Aegis 本体的 Session Runtime

辅助落点：

- ASR 仅承载 trace / execution envelope，不作为主会话系统

### 原因

任务状态机与会话连续性必须在 Aegis 自己手里。  
如果会话主权下沉到外部组件，Aegis 的任务主权会被削弱。

### 建议

- 借鉴 OpenBot 的 session key、session history、流式桥接
- 但 Aegis 应把 session 和 task state 绑定得更强

也就是：

- **OpenBot 风格的 conversation session**
- 加上 **Aegis 风格的 task state session**

## 4.3 Tool Runtime / Capability Runtime

OpenBot 的 tool runtime 与 schema 适配经验很值得借鉴。

### 应映射到哪里

最合理的主落点是：

- `AI-First`

### 原因

AI-First 现有架构本来就在做：

- capability registry
- handler invocation
- security middleware
- permission check
- confirmation gate
- undo manager
- MCP adapter

这与 OpenBot 的 tools 机制天然相近。

### 但必须注意

这里要区分：

- **原子 capability 执行** 可以落在 AI-First
- **任务流程编排主权** 不能落在 AI-First

也就是说：

- OpenBot 的 tool runtime 可借鉴给 AI-First
- OpenBot 的 agent autonomy 不能直接复制给 AI-First

否则会违反 Aegis 的主权边界。

## 4.4 Skills 机制

OpenBot 的技能体系可以拆成两层看。

### 适合下沉到 AI-First 的部分

- skill spec
- skill packaging
- skill distribution
- skill registry
- 云端技能库
- skill handler hosting

这与 Aegis 已有的 skill-evolution、cloud publish、AI-First skill library 很契合。

### 必须留在 Aegis Kernel 的部分

- 何时选择这个 skill
- 为什么选择它
- 当前任务是否允许它
- 它是否满足风险策略
- 它是不是当前最优 capability

也就是：

- Skill 本体可以云端化
- Skill 选择权必须留在 Aegis

## 4.5 Prompt 组装与上下文装配

OpenBot 在 system prompt、workspace context、skills prompt、bootstrap files 这方面很成熟。

### 应映射到哪里

主落点：

- `Aegis Kernel` 的认知编排层

### 不建议主落点

- AI-First
- ASR
- K-OS

### 原因

Prompt 装配属于“认知输入编排”，它直接影响：

- 任务理解
- 澄清
- 规划
- 结果质量

因此它应成为 Aegis Kernel 的能力，而不是外部云组件的能力。

### 建议

借鉴 OpenBot 的：

- workspace bootstrap 注入
- docs / memory / skills section 组装
- channel-aware runtime hints

但 Aegis 要升级成：

- 按调用点装配上下文
- 按任务阶段装配上下文
- 按风险级别装配上下文

而不是只有“一份通用 system prompt”。

## 4.6 多模型调用与 Provider 适配

OpenBot 的 provider/model runtime 很成熟，但 Aegis 的目标不能只是做一个 provider 容器。

### 应映射到哪里

主落点：

- `Aegis Kernel` 的 callpoint registry + routing policy

辅助落点：

- `AI-First` 或其它云组件只作为具体模型或能力提供方

### 原因

模型调用的治理权必须留在 Aegis，不能外包。

### 建议

借鉴 OpenBot 的：

- provider abstraction
- auth/profile 管理
- tool compatibility 适配
- fallback 机制

但升级为：

- 调用点级模型路由
- 跨组件模型调用策略
- 质量/成本/时延/风险联动

## 4.7 治理约束与高风险动作控制

OpenBot 有 sandbox、tool allowlist、authorized sender 等约束经验。

### 应映射到哪里

主落点：

- `K-OS`
- `Aegis Kernel`

### 原因

这些能力在 Aegis 里不能只是运行时开关，而必须升级成制度化治理。

### 建议

- OpenBot 的运行时 guard 经验，可借鉴到 Aegis 的预检查和执行上下文控制
- 但最终裁决权和证据链应交给 K-OS + Aegis

## 4.8 控制台与前台用户体验

OpenBot 的前台/控制台改造经验，对 Aegis 很有参考价值。

### 应映射到哪里

主落点：

- `Aegis Frontstage`
- `Aegis Control Center`

### 不应落在

- AI-First
- K-OS
- Ascend AI

### 原因

这是用户产品层，不是云端基础设施层。

### 建议

- 前台面向：个人 / 分身 / 好友 / 群组 / 任务
- 后台面向：渠道 / 模型 / 技能 / 节点 / 审批 / 审计

## 5. 一个必须正视的架构张力

当前 Aegis 文档里存在一个必须澄清的张力：

### 张力一：AWE 主权声明

主权声明明确说：

- Aegis 是唯一 workflow execution runtime
- AI-First 不能启动 workflow
- AI-First 不能控制执行节拍
- AI-First 不能直接调用 adapter

### 张力二：AI-First Runtime 架构文档

AI-First Runtime 架构文档又描述了较完整的：

- runtime kernel
- execution engine
- action handlers
- security middleware
- undo manager
- MCP adapter
- CLI executor

这说明当前 AI-First 在设计上仍带有“独立工具运行时/执行引擎”倾向。

### 推荐的统一解释

这两者不能简单并存，必须统一口径：

- **Aegis/AWE 拥有任务执行主权**
- **AI-First 拥有原子 capability runtime 主权**

也就是说：

- AI-First 可以执行“单个能力”
- AI-First 不能主导“整个任务流程”
- AI-First 可以暴露 capability
- AI-First 不能成为 Workflow Orchestrator

如果这样定义，矛盾就被消解了。

## 6. 推荐的最终角色分工

建议采用如下角色分工。

### 6.1 Aegis Kernel：任务内核

负责：

- Intent
- Clarification
- Planning
- Capability Check
- Execution Control
- Verification
- Delivery
- Callpoint LLM Governance

### 6.2 Aegis Frontstage / Edge：交互与会话外壳

负责：

- 多渠道 Gateway
- Chat UI
- 联系人 / 群组 / 分身前台
- session runtime
- streaming bridge

这一层是 OpenBot 最值得直接借鉴的部分。

### 6.3 AI-First：通用能力运行时

负责：

- capability registry
- skill hosting
- tool / function / MCP runtime
- 低中风险原子能力执行
- shadow mode / forge / advisory

这一层最适合吸收 OpenBot 的：

- tool runtime
- skill packaging
- capability schema
- runtime adapter

### 6.4 Ascend AI：垂直专项智能引擎

负责：

- 特定领域 plan
- 特殊 execution unit
- 高价值复杂专业场景

### 6.5 K-OS：治理与司法内核

负责：

- constitution
- handshake
- approval
- audit
- safe mode
- execution history signals

### 6.6 ASR Runtime：主权通信总线

负责：

- sovereign envelope
- routing
- trace
- 统一 ingress / egress
- 组件间标准化通信

## 7. OpenBot 借鉴内容的最终落点矩阵

| OpenBot 可借鉴能力     | Aegis Kernel | Frontstage / Edge | AI-First | Ascend AI | K-OS | ASR       |
| ---------------------- | ------------ | ----------------- | -------- | --------- | ---- | --------- |
| 多渠道 Gateway         | 否           | 是                | 否       | 否        | 否   | 可辅助    |
| Chat / Session Runtime | 部分         | 是                | 否       | 否        | 否   | 否        |
| Tool Runtime           | 决策层       | 否                | 是       | 部分      | 否   | 否        |
| Skills 机制            | 选择权       | 部分              | 是       | 部分      | 审核 | 发布/传输 |
| Workspace Context      | 是           | 否                | 部分     | 否        | 否   | 否        |
| System Prompt 组装     | 是           | 否                | 否       | 否        | 否   | 否        |
| Provider 适配经验      | 是           | 否                | 部分     | 部分      | 否   | 否        |
| 风险/权限 guard        | 是           | 否                | 部分     | 部分      | 是   | 部分      |
| 控制台交互             | 否           | 是                | 否       | 否        | 否   | 否        |
| 流式事件桥接           | 部分         | 是                | 部分     | 部分      | 否   | 是        |

## 8. Aegis 真正应该优化的不是“复制 OpenBot”，而是“让分层更清晰”

如果系统继续演进，最大的风险不是“没借够 OpenBot”，而是：

- Aegis Kernel 和 AI-First 角色重叠
- ASR 与执行主权混淆
- K-OS 被误当作另一个执行器
- 前台/会话层与云端能力层耦合过重

因此，真正要优化的是：

- 让交互层更像 OpenBot
- 让能力运行时更像工程化的 AI-First
- 让治理层更像严格的 K-OS
- 让通信层更像 Sovereign Bus
- 让 Kernel 更像唯一的任务大脑

## 9. 最终主张

最终架构应明确如下原则：

1. **借鉴 OpenBot，不复制 OpenBot**
2. **交互与会话能力主要落在 Frontstage / Edge**
3. **通用能力运行时主要落在 AI-First**
4. **治理与合规裁决主要落在 K-OS**
5. **专项智能执行单元落在 Ascend AI**
6. **跨组件通信和统一路由落在 ASR**
7. **任务理解、编排、执行主权、模型治理主权必须留在 Aegis Kernel**

一句话总结：

> OpenBot 的最佳借鉴方式，不是把它并入 Aegis，而是把它拆解成“接入层能力、会话层能力、工具层能力、交互层能力”，再分别注入 Aegis 的 Frontstage、AI-First 和 ASR，同时让 Aegis Kernel 与 K-OS 牢牢守住任务主权与治理主权。
