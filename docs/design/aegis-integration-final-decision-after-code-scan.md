# Aegis 整合方向的最终决策建议（基于当前代码扫描）

## 1. 为什么需要这份文档

这次整合不是一个“UI 改造”或“接一两个能力”的问题，而是一次系统级架构收敛。  
如果只凭概念和文档推进，很容易出现三类问题：

- 同一职责在多个组件里重复实现
- 组件边界越来越模糊
- 最后系统既不像 Aegis，也没真正吸收 OpenBot 的优点

因此，最终决策必须建立在**当前真实代码结构**之上，而不是抽象想象。

## 2. 本次代码扫描得到的关键事实

## 2.1 Aegis 当前不是“单一清晰主链”，而是“Workbench V2 主链 + 多套已实现但未真正接管主链的系统”

从代码和已有分析文档看，当前最真实的执行入口仍然是：

- `server/aegis-core/kernel/router-workbench-v2.ts`
- `server/aegis-core/kernel/router-workbench-v2-dialogue.impl.ts`

这说明：

- `Workbench V2` 是当前事实上的主执行链
- 用户任务在这里被创建、澄清、转入执行、写回状态

与此同时，大量更“先进”的模块虽然已存在，但并未真正成为主链控制核心，例如：

- `cognitive-quality-gate`
- `cognitive-model-fusion`
- `awe`
- 旧 `task-orchestrator`

这意味着当前最重要的架构任务不是“继续叠新层”，而是：

- **先收口主链**
- **再决定哪些模块进入主链**

## 2.2 Aegis 当前存在明显的“架构口径不一致”

### 事实一：AWE 主权文档非常强

`server/aegis-core/awe/AWE_SOVEREIGNTY.md` 明确规定：

- Aegis 是唯一 workflow execution runtime
- AI-First 不能启动 workflow
- AI-First 不能控制执行节拍
- AI-First 不能直接调用 adapter

### 事实二：AI-First Runtime 设计又很强势

`ai-first-runtime/ARCHITECTURE.md` 描述的 AI-First Runtime 已经具备：

- runtime kernel
- execution engine
- capability registry
- security middleware
- undo manager
- MCP adapter
- CLI executor

这意味着 AI-First 当前不是“纯规划器”，而是一个**很像独立能力执行平台**的系统。

### 事实三：Aegis 主链又在走 ASR-only

`server/aegis-core/kernel/execution-router.ts` 明确写着：

- 当前主链只走 `AI_FIRST_RUNTIME`
- 通过 ASR Gateway 统一路由
- 不允许本地 fallback

### 事实四：但其它代码仍保留多引擎适配痕迹

例如 `server/aegis-core/kernel/workbench-v2/execution/engine-adapter.ts` 仍显式支持：

- AI-First
- Ascend AI
- K-OS
- Builtin Retrieval

结论：

当前架构不是“已经收敛”，而是同时存在：

- 主权型架构
- AI-First 强运行时架构
- ASR-only 路由架构
- 多引擎历史兼容架构

如果此时再大规模吸收 OpenBot，而不先清边界，风险非常高。

## 2.3 K-OS 当前更像治理与司法内核，不应被误当成执行主引擎

从 `server/integrations/k-os/client.ts` 和 `server/aegis-core/constitution/compliance-engine.ts` 看：

- K-OS 的核心能力是 Constitution Check、Handshake Decision、Execution History Signals、SAFE MODE
- K-OS 是治理判断和判决契约来源

因此 K-OS 的定位应被固定为：

- **治理内核**
- **司法与合规内核**

不应继续让它在系统认知上被混成“另一个执行引擎”。

## 2.4 ASR 当前最适合被定义为“主权通信总线”，不是任务内核

从：

- `server/integrations/asr-runtime/types.ts`
- `server/integrations/asr-runtime/client.ts`
- `server/infrastructure/external/asr-client-adapter.ts`

可以看出 ASR 已经具备：

- Sovereign Envelope
- 统一 route/execution 接口
- trace_id / execution_id / audit_id 承载
- governance handshake
- memory / skill publish / evidence / metrics 等统一入口

这说明 ASR 最适合承担：

- **统一通信入口**
- **云端运行时总线**
- **标准化治理和执行协议层**

而不应承担：

- 任务理解主权
- workflow 编排主权
- 最终执行裁决主权

## 2.5 AI-First 当前最合理的代码级定位，是“Capability Runtime + Planning Adjunct”

从：

- `ai-first-runtime/ARCHITECTURE.md`
- `server/integrations/ai-first-runtime/planning-client.ts`
- `server/aegis-core/kernel/skill-evolution/runtime/aifirst-client.ts`

可以看出 AI-First 现阶段最稳定、最清晰的价值是：

- capability registry
- 原子能力执行
- skill 托管和分发
- MCP / function calling tool 暴露
- unmatched intent forwarding / plan suggestion

这意味着最终整合时，AI-First 应被**收窄**为：

- 通用能力运行时
- 规划与建议增强器
- 云端能力库

而不是：

- 任务总大脑
- 会话主系统
- workflow 主编排器

## 2.6 Ascend AI 当前更适合专项垂直场景，不适合做系统主路由

从 `server/integrations/ascend-ai/plan-executor.ts` 看：

- 它适合生成和执行领域特定 Plan
- 执行前仍经过 K-OS Constitution Check
- 更像专项 plan executor / vertical execution unit

因此它应该被固定为：

- **垂直领域智能单元**

而不是通用系统主链。

## 3. 基于代码事实，最终应先做的不是“整合”，而是“收敛”

在当前阶段，最危险的做法是：

- 一边保留 Workbench V2
- 一边想让 AWE takeover
- 一边保留 AI-First 自带 execution runtime
- 一边引入 OpenBot session/tool/skills/gateway 全套能力

这样极容易形成“四层都能做一点”的四不像：

- Kernel 也会话
- AI-First 也执行
- ASR 也路由也像编排
- Frontstage 也在偷做任务逻辑

所以，**最终决策必须先以“减法”开路**。

## 4. 最终决策一：先定义唯一主链，再谈融合

当前建议明确规定：

### 4.1 唯一任务主链

短中期唯一任务主链应是：

- `Workbench V2`
- 逐步吸收 Aegis Kernel 的能力

而不是平行保留多个主入口。

### 4.2 唯一执行主权

必须坚持：

- **任务执行主权只在 Aegis Kernel / AWE**

### 4.3 唯一云端通信前门

必须坚持：

- **所有云端子系统调用统一经 ASR**

### 4.4 唯一能力运行时定位

必须明确：

- **AI-First 是 capability runtime，不是 workflow runtime**

### 4.5 唯一治理裁决定位

必须明确：

- **K-OS 是治理裁决内核，不是任务编排器**

## 5. 最终决策二：OpenBot 只按层吸收，不按产品整体吸收

从当前代码现实看，OpenBot 不应该被整体并入 Aegis。  
它只能按层拆解后吸收。

## 5.1 可以直接吸收的层

### A. Frontstage / Edge 层

直接借鉴：

- 多渠道 Gateway
- session routing
- 群组 / 联系人 / persona 前台心智
- 流式消息和会话体验

原因：

- 这部分不会破坏 Kernel 主权
- 也最能快速提升产品体验

### B. Capability Runtime 层

吸收到 AI-First：

- tool schema 设计经验
- tool runtime 适配经验
- skill packaging / registry 思路
- workspace-like capability context

原因：

- 这与 AI-First 的能力运行时天然契合

### C. Cognitive Input Assembly 层

吸收到 Aegis Kernel：

- system prompt 组装经验
- workspace context 注入
- skills prompt 约束
- docs / memory / runtime hint 组织方式

原因：

- 这属于认知编排层，不属于执行层

## 5.2 不能直接吸收的层

### A. 不能把 OpenBot 的 Agent Autonomy 直接搬进 AI-First

原因：

- 会让 AI-First 拿回过多执行自由度
- 会破坏 Aegis 的主权边界

### B. 不能把 OpenBot 的 session-driven execution 直接替代 Aegis task state

原因：

- OpenBot 强于 conversation continuity
- Aegis 必须强于 task state continuity

### C. 不能让 Frontstage 偷做 Kernel 的判断

前台可以：

- 展示任务状态
- 帮助收集信息
- 提升体验

但不能：

- 自己决定风险等级
- 自己决定是否允许执行
- 自己决定是否完成

## 6. 最终决策三：先完成四个收敛动作，再启动 OpenBot 融合

这四步是前置条件，不完成就不建议大规模整合。

## 6.1 收敛动作一：统一“执行主权 vs 能力执行权”

必须在工程上固定：

- Aegis/AWE：任务执行主权
- AI-First：原子能力执行权

这一步是整个系统最重要的边界。

## 6.2 收敛动作二：统一主执行链

必须明确：

- Workbench V2 是当前主链
- AWE takeover、Cognitive Front-Gate、Quality Gate 是否进入主链，需要制定迁移路线

在此之前，不应再叠加新的大规模交互与 runtime 复杂度。

## 6.3 收敛动作三：清理多引擎历史兼容幻觉

当前很多代码还保留：

- K-OS 执行
- Ascend 执行
- AI-First 直连桥

但主链又在 ASR-only。  
这会让系统认知长期混乱。

因此应明确：

- 哪些是主链可用路径
- 哪些只是历史兼容或测试适配
- 哪些必须被冻结或退役

## 6.4 收敛动作四：决定 OpenBot 借鉴优先级

优先级建议如下：

1. 前台/边缘接入能力
2. session/runtime 体验层
3. capability runtime 工程化经验
4. prompt/context 装配经验
5. skills 体系映射

不要一开始就整套引入。

## 7. 最终整合方向

基于当前代码扫描，我建议的最终整合方向是：

### 7.1 Aegis 的主系统目标

把 Aegis 明确收敛为：

- **任务操作系统**
- **任务主权内核**
- **治理与证据驱动的执行平台**

### 7.2 OpenBot 的角色

OpenBot 在 Aegis 中应被定义为：

- **交互层参考实现**
- **会话与 Agent Runtime 参考实现**
- **能力包装与工具层参考实现**

而不是：

- 整体替换 Aegis 的执行主链

### 7.3 云端组件的最终职责

- `Aegis Kernel`：任务理解、澄清、规划、执行控制、验证、模型治理
- `Frontstage / Edge`：多渠道接入、会话外壳、用户体验
- `AI-First`：通用 capability runtime、skill hosting、planning adjunct
- `Ascend AI`：垂直专项智能单元
- `K-OS`：治理、司法、审批、SAFE MODE、审计
- `ASR`：主权通信总线和统一前门

## 8. 最终结论

### 不建议的路线

不建议直接做：

- “把 OpenBot 整体融进 Aegis”
- “把 AI-First 做成 OpenBot 那样的通用 Agent Runtime”
- “让多个组件都具备会话、执行、编排和治理的部分权力”

这样最后一定会变成：

- 复杂
- 冗余
- 边界不清
- 调试困难
- 主权体系失真

### 建议的路线

建议的路线是：

1. 先承认当前真实主链是 `Workbench V2`
2. 先固定主权边界与组件职责
3. 先清理历史兼容和多口径架构
4. 再按层吸收 OpenBot 的能力
5. 最后把前台、会话、能力运行时和治理体系接成一套清晰的系统

一句话总结：

> 这次整合不应追求“功能更多”，而应追求“主链更唯一、边界更清晰、职责更稳定、决策流程更可解释”。只有先让 Aegis 收敛，再吸收 OpenBot，系统才不会变成四不像。
