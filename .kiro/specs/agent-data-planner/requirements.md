# Requirements — Agent Data Planner + Context Broker（合一）

> Agent OS 方案落地第 2 步（P0，最大能力缺口）。依赖第 1 步 **语义对象目录**
> （`.kiro/specs/semantic-object-catalog/`）。
>
> **一句话定位**：把 OpenBot 从「能点名调用某个数据能力」抬升到「给定任务 →
> 查元数据目录 → 生成授权范围内的取数计划（Data Plan）→ 交既有执行桥按需取数」。
> 方案的 "Metadata First / Data On Demand" 目前只实现了后半段（知识投影的
> `on-demand-projection-materializer`），本规格补齐**「规划取哪些数据」**这一独立组件，
> 并把方案 Phase 4 的 **Context Broker** 与之**合一**。

## 背景与缺口

当前 Agent 取数路径（`capability-agent-invoke-runtime.ts`，W5 sanctioned bridge）：
Agent 直接点名 `capabilityId` → 授权校验 → 执行。缺的是**规划层**：没有组件把
「任务意图」映射为「该取哪些规范对象 / 走哪个能力 / 选哪些字段」，且**在席位授权范围内**。

`fabric` 提供 context/trace，但没有「给定任务+Agent+租户，组装授权范围内的上下文包
（身份+能力+数据计划+知识）」的组件。它与 Data Planner 高度重叠，故**合并为一个组件**。

## Requirements

### R1：Data Plan 生成（纯规划，不执行）

**User Story**：作为一个企业数字员工（Agent），我希望给定一个任务意图后，系统能基于
语义对象目录 + 数据能力目录，产出「要取哪些规范对象、经哪个能力、选哪些字段」的取数计划，
以便我据此按需、合规地取数，而不是凭空猜测或硬编码。

#### Acceptance Criteria

1. WHEN 给定 `{任务意图/对象提示}` 与**已解析的席位上下文** THEN Planner SHALL 产出一个
   `DataPlan`，包含若干 `DataPlanStep`（每步对应一个语义对象）。
2. 相关性解析 SHALL 是**确定性**的（可单测、无隐藏 LLM）：显式 `objectKeys`/`objectKinds`
   提示优先；否则按 `task` 文本对 objectKey/displayName/kind/字段名做大小写不敏感关键词匹配；
   都没有则返回全部 `active` 对象（授权「菜单」）。
3. Planner SHALL **只产出计划，不执行取数**（执行由既有 W5 桥负责）。
4. Planner SHALL 只读取**元数据**（对象/字段/绑定/能力描述），绝不读取或产出业务数据行。

### R2：授权对齐（复用既有 grant 模型）

1. 每个可解析的 `DataPlanStep` SHALL 标注 `accessState`：`granted`（席位已授权）或
   `requestable`（需申请）。
2. 授权判定 SHALL **复用**既有逻辑：能力 granted ⇔ 其 **每个** actionRef 命中
   `findSeatActionGrant` 或 `resolvePolicyBackedSeatActionGrant`（department/role 策略）。
   不得另造一套授权规则。
3. Planner SHALL NOT 因未授权而隐藏对象；未授权对象照常出现在计划里并标 `requestable`，
   以便引导用户去申请（与 `capability-agent-invoke-runtime` 的 requestable 语义一致）。

### R3：能力绑定解析（语义对象 → 能力）

1. 对每个相关语义对象，Planner SHALL 通过其 `sourceBindings` 解析候选能力：
   (a) `binding.capabilityId` 命中且能力启用 → 用之；
   (b) 否则找 actionRefs 含 `binding.action` 的启用能力 → 用之。
2. WHEN 对象无 sourceBindings 或无可解析能力 THEN 该步 SHALL 标记为**未解析**
   （`status: unbindable | no-capability`）并给出原因，而非静默丢弃（诚实暴露「该规范对象
   尚未接入数据源」这一治理信号）。

### R4：字段选择遵守分级

1. 每个已解析步 SHALL 列出该对象要取的**规范字段**（含 `type`/`classification`/引用关系）。
2. 默认 SHALL 选择所有非 `RESTRICTED` 字段；CONFIDENTIAL 字段 SHALL 被标注（提示下游脱敏适用）。
3. 可选 `classificationCeiling` SHALL 支持最小权限规划（如排除 CONFIDENTIAL）。
4. 字段选择 SHALL 只描述「取哪些字段」，绝不含字段值。

### R5：Context Broker（合一）

**User Story**：作为运行时，我希望在 Agent 一轮对话前，能一次性拿到「该席位在此任务下的
授权上下文包」——身份、授权能力清单、取数计划、相关知识投影引用——以便组织提示与工具调用。

1. Broker SHALL 产出 `AgentContextPack`：`identity`（来自受信上下文）+ `dataPlan`（来自 R1）
   - `authorizedCapabilities`（计划触及的已授权能力，精简）+ `knowledgeProjections`（与计划
     对象种类/类目匹配的投影规格**元数据引用**，轻量桥接知识面，不导入知识面运行时）。
2. Broker SHALL 提供**可选**执行入口 `executeDataPlan`：把已授权步逐一交给既有
   `invokeDataCapabilityWithContext` 执行并汇总结果；默认路径只产计划，不执行。
3. 执行 SHALL 完全复用 W5 桥（作用域/脱敏/审批/审计/配额均由桥负责），Broker 不得旁路。

### R6：只读 RPC 暴露

1. SHALL 新增只读 RPC：`enterprise-data.planner.plan`（返回 DataPlan）与
   `enterprise-data.planner.context`（返回 AgentContextPack）。
2. 席位上下文 SHALL 服务端解析**调用方本人席位**（不接受客户端伪造的身份/席位字段）。
3. RPC SHALL 注册进 `server-methods-list.ts` 与 `method-scopes.ts` 的读作用域。

### R7：工程约束（多 agent 安全 + 既有范式）

1. SHALL 沿用 enterprise-data 既有范式（纯函数 store 访问、DI 工厂、handler + 服务端租户解析）。
2. 新增独立文件为主；对含他人 WIP 的共享注册表（`server-methods-list.ts`/`method-scopes.ts`）
   仅做加法编辑，且**不整文件提交**。
3. 授权判定逻辑 SHALL 抽为单一真源（`capability-grant-resolver.ts`），消除与 invoke-runtime 的重复。
4. TypeScript 严格类型，避免 `any`；改动文件 `pnpm tsgo` 零错误；scoped 测试全绿。
