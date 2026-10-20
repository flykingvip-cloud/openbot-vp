# 基于 Aegis + OpenBot 的融合架构方案

## 1. 文档目标

本文给出一套面向 Aegis 的融合架构方案：

- **借鉴 OpenBot 已经验证有效的能力**
- **保留 Aegis 作为任务内核与治理内核的独特定位**
- **明确 Aegis 未来要形成的产品护城河与技术护城河**

这不是“把 Aegis 做成另一个 OpenBot”，而是：

- 用 OpenBot 的优势补齐交互层、渠道层、Agent Runtime 层
- 用 Aegis 的 Kernel、治理、状态机、调用点治理构建真正的任务操作系统

## 2. 核心判断

### 2.1 应借鉴 OpenBot 的部分

OpenBot 已经证明这些能力是高价值且可落地的：

- 多渠道 Gateway 与消息路由
- 会话持久化与 session 连续性
- Agent Runtime 与工具调用循环
- workspace 上下文加载
- skills 机制
- system prompt 组装与运行时提示注入
- 前台实时交互体验

这些部分本质上属于：

- **交互外壳**
- **执行外壳**
- **Agent 基础设施**

### 2.2 必须坚持 Aegis 的部分

Aegis 不能退化成“又一个会聊天、会调工具的 Agent 平台”。  
Aegis 必须坚持的核心是：

- Task-first 的任务内核
- 显式任务状态机
- 显式澄清机制
- 显式能力规划与能力校验
- 显式外部效果控制
- 显式证据记录与治理审计
- 显式 LLM 调用点治理

这些部分决定了 Aegis 的产品定位不是“助手壳层”，而是：

- **任务操作系统**
- **企业级任务编排内核**
- **数字分身协作的执行与治理基础设施**

## 3. 融合设计原则

融合架构必须遵守以下原则：

### 原则一：交互层借鉴 OpenBot，决策层坚持 Aegis

用户如何进入系统、如何聊天、如何跨渠道接入、如何实时收发消息，可以借鉴 OpenBot。  
但任务是否执行、怎么规划、调用什么能力、需不需要确认、何时验证，不应交给通用 Agent 自由发挥，必须回到 Aegis Kernel 决策。

### 原则二：OpenBot 负责“执行容器”，Aegis 负责“执行大脑”

OpenBot 适合做：

- 会话容器
- 工具执行容器
- 渠道适配容器
- Agent 运行时容器

Aegis 适合做：

- 任务理解内核
- 编排与规划内核
- 状态机与治理内核
- 模型调用治理内核

### 原则三：所有高风险动作必须从“自由 Agent”升级到“受控任务”

凡是涉及：

- 外部消息发送
- 邮件
- 转账/付款
- 文件删除/批量修改
- 跨系统写操作
- 企业流程动作

都不应只是 OpenBot 式 tool loop 的自然结果，而要进入 Aegis 的：

- 风险判定
- 外部效果管理
- 人工确认或策略确认
- 证据记录

### 原则四：Aegis 的护城河不在“会调用模型”，而在“比别人更稳地完成任务”

单纯接更多模型、更多工具、更多渠道，并不能形成长期壁垒。  
Aegis 的护城河应该建立在：

- 更好的任务完成率
- 更好的澄清质量
- 更强的任务恢复与可审计性
- 更强的多模型治理
- 更稳的高风险任务执行

## 4. 总体融合架构

建议采用五层架构：

```text
用户与外部系统层
  └─ 人类用户 / 企业用户 / 外部数字分身 / 第三方业务系统

接入与交互层
  └─ Channel Gateway / Chat UI / Contacts / Groups / Persona UI

Agent Runtime 层
  └─ Session Runtime / Tool Runtime / Workspace Context / Skill Loader

Aegis Kernel 层
  └─ Intent / Clarification / Planning / Capability Check / Execution Control / Verification / Governance

能力与基础设施层
  └─ LLM Router / Tool Adapters / Memory / Evidence / External Effect / Audit / Policy
```

其中：

- **接入与交互层** 主要借鉴 OpenBot
- **Agent Runtime 层** 可大量复用 OpenBot 思路
- **Aegis Kernel 层** 必须是 Aegis 自己的核心
- **能力与基础设施层** 则由 Aegis 主导治理

## 5. 建议的模块分工

### 5.1 可直接借鉴 OpenBot 的模块

#### 1. Gateway 与渠道接入

借鉴目标：

- 多渠道统一接入
- 不同渠道统一路由到内部任务/会话体系
- 支持 DM、群组、线程、账户矩阵等路由模式

建议定位：

- Aegis 不重复发明 Gateway
- 将 Gateway 作为“数字分身操作系统”的基础接入层

#### 2. Session Runtime

借鉴目标：

- 会话持久化
- session key / agent / peer / group 的统一映射
- 流式事件桥接
- 会话历史与上下文压缩

建议定位：

- Aegis 保留自己的任务状态机
- 但底层会话 runtime 可采用类似 OpenBot 的 session runtime 设计

#### 3. Workspace Context + Bootstrap Files

借鉴目标：

- 自动加载工作区规则
- 注入业务上下文
- 注入 persona、docs、memory 等运行时上下文

建议定位：

- 在 Aegis 中，这些不是最终决策依据
- 而是提供给任务编排器和执行器的上下文材料

#### 4. Tool Runtime

借鉴目标：

- 工具定义注册
- 工具调用循环
- 工具结果流式返回
- 文件系统、命令执行、消息发送等通用工具能力

建议定位：

- OpenBot 式工具运行时可作为 Aegis 的基础执行层
- 但是否允许调用、何时调用、是否要确认，应由 Aegis Kernel 决定

#### 5. Skill 机制

借鉴目标：

- 让经验与流程可以复用
- 把业务技能模块化
- 让不同 persona 或不同任务类型使用不同 skill 包

建议定位：

- 保留类似 skills 的可组合机制
- 但 skill 只是一类能力包，不应该越过 Aegis Kernel 直接主导任务

### 5.2 必须由 Aegis 自己定义的模块

#### 1. Intent Analyzer

这是 Aegis 的第一核心模块。  
它不应等价于“让模型看看用户想干嘛”，而应输出结构化任务意图：

- 任务类型
- 风险等级
- 是否需要澄清
- 是否存在意图偏移
- 是否属于新任务

#### 2. Clarification Engine

这是 Aegis 区别于通用 Agent 的关键模块。  
它要负责：

- 找出缺失参数
- 决定下一问问什么
- 判断用户当前回答是否回答了问题
- 判断是否出现意图切换
- 判断是否可以进入执行

#### 3. Capability Planner / Capability Check

这是 Aegis 的第二核心模块。  
它必须显式判断：

- 这个任务需要哪些能力
- 系统当前是否具备这些能力
- 缺的能力是 skill gap、tool gap、permission gap 还是 data gap
- 是否需要切换 persona / agent / external capability

#### 4. Execution Controller

这是整个任务执行的总控。  
它要决定：

- 是否交给通用 Agent runtime
- 是否走受控工作流
- 是否触发人工确认
- 是否需要分阶段执行
- 是否进入验证或修正循环

#### 5. Governance Guard / Evidence Recorder / External Effect Manager

这是 Aegis 最重要的护城河之一。  
这些模块必须成为第一等公民，而不是事后加的审计功能。

## 6. 推荐的任务执行流程

建议 Aegis 最终采用如下统一流程：

```text
用户输入
  ↓
渠道接入与会话归一
  ↓
Intent Analyzer
  ↓
Clarification Engine
  ↓
Task Compiler / Planner
  ↓
Capability Check
  ↓
Execution Controller
  ├─ 低风险：进入 Agent Runtime + Tool Loop
  ├─ 中风险：进入受控执行流
  └─ 高风险：进入确认/审批/外部效果控制
  ↓
Verification / Improvement
  ↓
Evidence Recording
  ↓
Delivery
```

### 6.1 低风险任务

例如：

- 查信息
- 总结文档
- 生成草稿
- 浏览器/文件读取
- 轻量脚本执行

这类任务可以更接近 OpenBot 风格：

- Kernel 判断可以执行
- 下发给 Agent Runtime
- 让 tools + skill + prompt 驱动完成

### 6.2 中风险任务

例如：

- 修改多个文件
- 运行较重脚本
- 发给指定外部联系人的草稿消息
- 批量数据操作

这类任务不能完全依赖自由 tool loop，应加入：

- 明确执行计划
- 阶段检查点
- 失败可回滚或可解释

### 6.3 高风险任务

例如：

- 发送正式外部消息
- 邮件
- 付款/转账
- 删除生产数据
- 触发外部系统写操作

必须进入 Aegis 的强治理模式：

- 明确确认对象
- 明确外部效果
- 明确证据记录
- 明确审批或策略门控

## 7. 大模型调用治理方案

这是 Aegis 相对 OpenBot 最该拉开差距的地方。

### 7.1 不建议采用纯“当前会话绑定一个主模型”的方式

OpenBot 的模型调用以 agent session 为中心，这种方式简单有效，但对 Aegis 不够。

如果 Aegis 想形成护城河，就不应该只是：

- 当前 agent 配一个默认模型
- 然后整轮任务都交给它

这样会导致：

- 成本不可控
- 高风险判断不够细
- 任务不同阶段无法用最合适模型

### 7.2 建议采用“调用点治理 + 模型路由”

保留并强化 Aegis 现有方向：

- Intent 类调用点
- Planning 类调用点
- Capability 类调用点
- Generation 类调用点
- Verification 类调用点
- Safety/Governance 类调用点
- Memory/Compression 类调用点

每个调用点都带：

- 风险等级
- 质量要求
- 时延要求
- 成本预算
- fallback 策略
- 是否允许本地模型
- 是否允许 mock
- 是否必须通过 gate

### 7.3 推荐的模型分层

#### L1：快速廉价模型

用于：

- 意图预分类
- 轻量验证
- 结构化抽取
- 记忆压缩
- 结果润色
- 安全初筛

#### L2：高质量推理模型

用于：

- 任务编译
- 复杂规划
- 决策辅助
- 多轮推理
- 高质量结构化输出

#### L3：审计/验证模型

用于：

- 风险验证
- 结果复核
- 高风险动作前的二次校验

这会让 Aegis 拥有比普通 Agent 产品更强的：

- 成本效率
- 质量稳定性
- 风险控制能力

## 8. 推荐的人机交互产品形态

建议前台和后台分层。

### 8.1 前台

前台借鉴 OpenBot 的交互壳层，但产品心智要升级成：

- 个人
- 分身
- 好友
- 群组
- 任务

这里不要让普通用户直接面对：

- 节点
- 工具 schema
- 配置文件
- 模型 provider

前台看到的应该是：

- 当前是谁在处理任务
- 任务理解到什么程度
- 当前缺什么信息
- 当前执行到哪个阶段
- 是否需要用户确认

### 8.2 后台控制中心

后台保留：

- 渠道管理
- Agent/Persona 配置
- 模型路由策略
- 审批策略
- 外部效果审计
- 工具能力与节点能力
- 日志与治理证据

这部分可以借鉴 OpenBot 的 Control UI 思路，但要围绕 Aegis 的任务治理中心重构。

## 9. Aegis 应形成的真正护城河

这是最关键部分。

### 9.1 护城河一：任务状态机与恢复能力

大多数 Agent 产品擅长“响应一次请求”，但不擅长：

- 清晰地知道任务处在哪个阶段
- 失败后恢复
- 中断后继续
- 在多人和多分身协作中保持一致性

Aegis 应把：

- 状态机
- 检查点
- 恢复
- 重试
- 任务拆分

做到产品级能力。

### 9.2 护城河二：高质量澄清系统

很多 Agent 会问问题，但问得不稳。  
Aegis 应把“澄清”做成独立能力：

- 知道何时该问
- 知道问哪个最关键的问题
- 知道用户是否真正回答了问题
- 知道何时出现新意图
- 知道何时可以安全进入执行

这会直接提升任务完成率。

### 9.3 护城河三：调用点级别的大模型治理

多数系统只会“换个模型”。  
Aegis 要做到的是：

- 不同任务阶段调用不同模型
- 不同风险等级调用不同模型
- 明确 fallback 和 gate
- 明确质量/成本/延迟的平衡

这会让 Aegis 在企业环境中更有说服力。

### 9.4 护城河四：外部效果控制与证据链

凡是会产生真实外部影响的动作，Aegis 都应做到：

- 能解释为什么执行
- 能追踪谁确认了
- 能保留证据
- 能回看执行前后的状态

这是 Aegis 进入企业和高风险场景的核心能力。

### 9.5 护城河五：数字分身协作内核

如果未来前台真要做“个人 / 分身 / 好友 / 群组”，Aegis 的真正差异化不应只是会聊天，而应是：

- 多分身如何协作
- 不同分身如何分工
- 群组内哪个分身负责什么
- 跨分身任务如何流转
- 哪些任务可以自动转交

这会使 Aegis 从“单 Agent 产品”升级为“数字分身协作系统”。

## 10. 建议的实施路线

### 阶段一：借鉴 OpenBot 的外壳能力

目标：

- 建立多渠道 Gateway
- 建立统一 Session Runtime
- 建立 Tool Runtime
- 建立 Workspace Context / Skill 机制

这一阶段解决的是：

- 能接入
- 能聊天
- 能执行
- 能持久化

### 阶段二：落地 Aegis Kernel

目标：

- Intent Analyzer
- Clarification Engine
- Task Planner
- Capability Check
- Execution Controller
- Task State Machine

这一阶段解决的是：

- 能真正理解任务
- 能稳定推进任务
- 能把自由对话升级为结构化执行

### 阶段三：落地 LLM 治理与外部效果治理

目标：

- Callpoint Registry
- Routing Rules
- Risk Gate
- External Effect Manager
- Evidence Recorder

这一阶段解决的是：

- 模型成本和质量可控
- 高风险动作可控
- 审计与复盘可控

### 阶段四：形成数字分身协作体系

目标：

- Persona / Agent / Contact / Group 统一模型
- 分身协作与任务转交
- 群组中的任务角色分工
- 企业内外数字分身协作

这一阶段解决的是：

- 从“一个助手”升级为“一个数字分身网络”

## 11. 最终架构主张

最终建议不是：

- Aegis 模仿 OpenBot

而是：

- **在交互层借鉴 OpenBot**
- **在执行基础设施层吸收 OpenBot**
- **在任务内核、治理内核与协作内核上坚定走 Aegis 自己的路线**

一句话总结：

> OpenBot 提供可复用的 Agent 外壳与执行外壳，Aegis 负责把它升级为一个可治理、可恢复、可审计、可协作的任务操作系统。

## 12. 结语

如果只追求“会聊天、会调工具、会接渠道”，借鉴 OpenBot 就够了。  
但如果要做出 Aegis 的独特价值，就必须坚持：

- 不把任务执行完全交给自由 Agent
- 不把模型调用简化为单轮 prompt
- 不把高风险动作当成普通工具调用
- 不把多分身协作简化为多个聊天窗口

真正的 Aegis 护城河，应是：

- **任务状态机**
- **高质量澄清**
- **调用点级模型治理**
- **外部效果与证据链**
- **数字分身协作内核**

这五件事如果做深，Aegis 就不是 OpenBot 的变体，而会成为更高一层的系统。
