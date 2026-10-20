# Design — Agent Data Planner + Context Broker（合一）

> 依赖：语义对象目录（`semantic-object-store.ts` / `semantic-object-types.ts`）、
> 数据能力目录（`data-capability-store.ts`）、授权模型（`seat-action-grant-store.ts` +
> `policy-backed-grant-resolver.ts`）、执行桥（`capability-agent-invoke-runtime.ts`）、
> 投影规格（`projection-spec-store.ts`）。

## 关键决策

- **D1（规划 ≠ 执行）**：Planner 是**纯规划层**，只决定「取什么」（元数据优先，扎根于
  语义目录 + 能力目录 + 授权）。「怎么取」仍由既有 W5 桥 `invokeDataCapabilityWithContext`
  负责（作用域/脱敏/审批/审计/配额）。Broker 的可选 executor 只委派该桥，绝不重写调用。
- **D2（确定性 + 提示驱动的相关性，无隐藏 LLM）**：`planDataAccess` 用确定性规则解析相关对象
  （显式 objectKeys/objectKinds > task 关键词匹配 > 全部 active）。Agent（LLM）通过 task 文本
  或显式提示驱动；Planner 把意图变成**具体、已授权、可执行**的计划。语义/向量相关性是后续增强层。
- **D3（能力绑定解析）**：语义对象 `sourceBindings` 每项带 `action`(ConnectorActionRef) 与可选
  `capabilityId`。解析优先用 `capabilityId`（显式治理链接），否则按 action 反查能力。无绑定/
  无能力 → 步标 `unbindable`/`no-capability`，暴露而不丢弃。
- **D4（字段选择遵守分级）**：默认取非 RESTRICTED 字段；CONFIDENTIAL 标注；`classificationCeiling`
  支持最小权限。只描述字段，不含值。
- **D5（授权单一真源）**：把 invoke-runtime 私有的 `isCapabilityGrantedForSeat` 抽到新
  `capability-grant-resolver.ts`（我拥有），invoke-runtime 改为 import 之（该文件当前 CLEAN，
  重构安全，消除重复）。resolver 接**结构化最小上下文** `CapabilityGrantContext`
  `{tenantId,seatId,departmentId?,roleCode?}`，Trusted 上下文与 ScopeEvaluationContext 均满足。
- **D6（RPC 解析本人席位）**：RPC 服务端用注入式 `resolveContext`（默认
  `resolveTrustedEnterpriseDataExecutionContext(client)`）解析**调用方本人**席位，不接受 seatId 参数，
  规避越权预览面 + 便于单测注入。

## 模块与文件

### 新增（本任务独有，零冲突）

- `src/gateway/enterprise-data/capability-grant-resolver.ts` — 抽出 `isCapabilityGrantedForSeat`
  （单一真源）+ `CapabilityGrantContext` 类型。
- `src/gateway/enterprise-data/agent-data-plan-types.ts` — Data Plan / Context Pack 全部类型。
- `src/gateway/enterprise-data/agent-data-planner.ts` — 纯规划核心 + Broker + executor + agent 包装。
- `src/gateway/enterprise-data/agent-data-planner.test.ts` — 单测。
- `src/gateway/server-methods/enterprise-data-planner.ts` — 只读 RPC handler。
- `src/gateway/server-methods/enterprise-data-planner.test.ts` — handler 单测。

### 增量编辑（共享；不整文件提交）

- `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts`（CLEAN）：删私有函数，import 新 resolver。
- `src/gateway/server-methods/enterprise-data.ts`：spread planner handlers（import + const + 展开，3 行）。
- `src/gateway/server-methods-list.ts`（含他人 WIP）：+2 方法名。
- `src/gateway/method-scopes.ts`（含他人 WIP）：READ_SCOPE +2 方法。

## 数据模型（`agent-data-plan-types.ts`）

```ts
export type DataPlanAccessState = "granted" | "requestable";
export type DataPlanStepStatus = "resolved" | "unbindable" | "no-capability";
export type DataPlanUnresolvedReason = "no-binding" | "no-capability" | "capability-disabled";

export type DataPlanFieldSelection = {
  fieldKey: string;
  displayName: string;
  type: SemanticFieldType;
  classification?: DataClassification; // 标注；CONFIDENTIAL → 下游脱敏
  referenceObjectKey?: string; // type=reference 时
};

export type DataPlanStep = {
  objectKey: string;
  objectKind: SemanticObjectKind;
  displayName: string;
  status: DataPlanStepStatus;
  fields: DataPlanFieldSelection[];
  // status === "resolved" 时：
  capabilityId?: string;
  capabilityKey?: string;
  capabilityTitle?: string;
  accessState?: DataPlanAccessState;
  bindingId?: string;
  sourceIds?: string[];
  actionRefs?: ConnectorActionRef[];
  // 未解析时：
  reason?: DataPlanUnresolvedReason;
  note?: string;
};

export type DataPlanSummary = {
  totalObjects: number;
  resolved: number;
  granted: number;
  requestable: number;
  unresolved: number;
};

export type DataPlan = {
  tenantId: string;
  seatId: string;
  taskHint?: string;
  createdAt: string;
  steps: DataPlanStep[];
  summary: DataPlanSummary;
};

export type AgentContextIdentity = {
  tenantId: string;
  seatId: string;
  employeeId: string;
  roleCode?: string;
  departmentId?: string;
  teamLabel?: string;
  agentId?: string;
};
export type AgentContextCapabilityRef = {
  capabilityId: string;
  capabilityKey: string;
  title: string;
  accessState: DataPlanAccessState;
  sourceSystems: string[];
};
export type AgentKnowledgeProjectionRef = {
  projectionId: string;
  projectionKey: string;
  displayName: string;
  category: EnterpriseKnowledgeProjectionCategory;
  objectKind: EnterpriseKnowledgeObjectKind;
  lifecycle: EnterpriseKnowledgeProjectionLifecycle;
};
export type AgentContextPack = {
  identity: AgentContextIdentity;
  dataPlan: DataPlan;
  authorizedCapabilities: AgentContextCapabilityRef[];
  knowledgeProjections: AgentKnowledgeProjectionRef[];
};

export type PlannerSeatContext = {
  // Trusted / ScopeEvaluation 上下文的结构化子集
  tenantId: string;
  seatId: string;
  employeeId?: string;
  teamLabel?: string;
  roleCode?: string;
  departmentId?: string;
  agentId?: string;
};
export type DataPlanRequest = {
  task?: string;
  objectKeys?: string[];
  objectKinds?: SemanticObjectKind[];
  classificationCeiling?: DataClassification;
  includeInactive?: boolean;
  maxObjects?: number;
};
```

## 核心函数（`agent-data-planner.ts`，纯 + context-injectable）

- `planDataAccess({ enterpriseStore, semanticStore, context, request, nowIso }): DataPlan`
  1. 相关性解析（D2）→ 候选语义对象；
  2. 每对象解析能力（D3）；已解析步用 grant-resolver（D5）判 granted/requestable；
  3. 字段选择（D4）；
  4. 汇总 summary。
- `buildAgentContextPack({ enterpriseStore, semanticStore, context, request, nowIso }): AgentContextPack`
  组装 identity + dataPlan + authorizedCapabilities + knowledgeProjections（按计划对象种类
  映射投影 category：customer↔customer、order↔sales、product/inventory↔inventory…）。
- `executeDataPlan({ store, context: Trusted, plan, nowIso, quotaLimit? }): Promise<{ steps: {...}[] }>`
  仅对 `granted` 步调用 `invokeDataCapabilityWithContext`；汇总 outcome（含 traceId/auditId）。

### Agent 包装（解析会话 + 读 store，只读不落盘）

- `planDataAccessForAgent({ client, request, agentId? })`
- `buildAgentContextPackForAgent({ client, request, agentId? })`
  （解析受信上下文 → 读企业 store（in-memory seed，同 invoke-runtime read 路径）+ 语义 store → 调纯核心。）

## RPC（`enterprise-data-planner.ts`，只读）

`createEnterpriseDataPlannerHandlers(deps?)`，deps 可注入 `loadEnterpriseStore`/`loadSemanticStore`/
`resolveContext`（默认 `resolveTrustedEnterpriseDataExecutionContext`）以便单测：

- `enterprise-data.planner.plan`：params `{task?,objectKeys?,objectKinds?,classificationCeiling?}` → DataPlan。
- `enterprise-data.planner.context`：同参 → AgentContextPack。

解析失败（无席位）→ `respondInvalid`。

## 测试策略

- 纯核心（`agent-data-planner.test.ts`）：seed 企业目录 + 造语义对象绑定到 `customer.profile`；
  - granted seat（seat-sales-mgr-east）→ customer 步 granted；
  - 绑 order.status 的对象 → 该 seat requestable；
  - ungranted seat（seat-unknown）→ requestable；
  - 无绑定对象 → unbindable/no-capability；
  - task 关键词匹配 / objectKeys 过滤 / classificationCeiling 过滤；
  - buildAgentContextPack：identity + authorizedCapabilities + knowledgeProjections；
  - executeDataPlan：granted 步委派桥并返回 traceId（复用 seed 的 mock handler）。
- Handler（`enterprise-data-planner.test.ts`）：注入 resolveContext/stores，mock resolveBillingScope；
  验证 plan/context 返回 + 无席位拒绝。

## 与后续阶段的关系

- 本组件是 P0 的**规划+编排内核**；相关性解析后续可叠加语义/向量层（Agent 已可用 task/提示驱动）。
- 企业数据事件总线（P1）可在「新订单」等事件到达时触发 `planDataAccess` 重规划。
- 术语对照（P3）：Data Planner + Context Broker ↔ 本模块。
