# Requirements — 企业数据事件总线（Enterprise Data Event Bus）

> Agent OS 方案落地第 3 步（P1，pull→push）。依赖第 1 步语义对象目录、第 2 步 Agent Data Planner。
>
> **一句话定位**：企业数据源当前全是拉取/探测（`source-connection-probe.ts`）。本规格补齐
> 事件驱动一环——「数据源信号/webhook → 归一为企业数据事件 → 匹配订阅 → 触发相关 Agent」，
> 实现方案 Phase 3 的 pull→push。触发**复用**既有 Agent 调用桥（`callGateway({method:"agent"})`，
> 参考 `src/organization/inter-agent-bus.ts`），不新造总线。

## 背景与缺口

- 现状：数据面只有拉取（连通性探测、按需投影物化）。没有「新订单 → 通知销售 Agent」这类
  事件驱动链路。
- 既有可复用件：Agent 触发桥（`callGateway({method:"agent"})`）、进程内 run 事件（`agent-events.ts`，
  仅观测）、prompt 内部事件格式化（`agents/internal-events.ts`）。**无通用 pub/sub 总线**。
- 缺口：没有「把外部数据源信号归一为一等公民企业事件、按订阅路由并触发对应 Agent」的组件。

## Requirements

### R1：企业数据事件模型（元数据优先）

**User Story**：作为平台，我希望把异构数据源的变更信号归一为统一的「企业数据事件」，
以便下游按对象/类型订阅与路由，而非直接透传各源的私有 payload。

1. SHALL 定义 `EnterpriseDataEvent`：`eventId`/`tenantId`/`sourceId`/`eventType`（created/updated/
   deleted/custom）/`objectKind?`/`objectKey?`/`externalId?`/`title`/`summary?`/`payloadDigest?`/
   `occurredAt`/`receivedAt`。
2. 事件 SHALL **只携带元数据/摘要**，绝不存业务数据行（Metadata First）。原始敏感 payload
   至多以 `payloadDigest`（哈希）留痕。
3. `objectKind` SHALL 复用语义对象种类（customer/order/product/...），把事件挂到「规范对象」上。

### R2：订阅与匹配（确定性路由）

1. SHALL 定义 `EnterpriseDataEventSubscription`：`subscriptionId`/`tenantId`/`targetAgentId`/
   匹配规则（`sourceId?`/`objectKind?`/`eventType?`）/`enabled`/`note?`。
2. 匹配 SHALL 是**确定性**的纯函数：事件命中订阅 ⇔ 订阅每个已设规则字段都与事件相等（未设字段=通配）；
   仅 `enabled` 订阅参与；按租户隔离。
3. 一个事件 SHALL 可命中多个订阅（扇出）。

### R3：入站归一 + 幂等 + 租户解析

1. SHALL 提供纯函数 `normalizeInboundSignal(rawSignal) → EnterpriseDataEvent`（补全 eventId/
   receivedAt、裁剪为元数据、校验 eventType/objectKind 白名单）。
2. 入站编排 SHALL 服务端解析租户（不信任客户端伪造身份），并**幂等去重**：同一
   `(tenantId, sourceId, externalId)` 已存在则跳过重复派发，返回既有事件。
3. 事件 SHALL 追加到有界事件日志（按租户保留最近 N 条），供审计/列表读取。

### R4：派发触发 Agent（pull→push，复用既有桥）

1. 对每个命中订阅，SHALL 触发目标 Agent：复用 `callGateway({method:"agent"})` 语义
   （`sessionKey` 经 `buildOrganizationAgentSessionKey({agentId, organizationId: tenantId})`、
   `deliver:false`、`channel:INTERNAL_MESSAGE_CHANNEL`、`lane:AGENT_LANE_NESTED`、
   `inputProvenance.kind:"inter_session"`、必填 `idempotencyKey`）。不新造总线。
2. 触发消息 SHALL 描述事件（源/对象/类型/摘要），并在事件带 `objectKind` 时**提示被触发 Agent**
   用数据能力/Planner 在授权范围内取数（承接第 2 步）。绝不在消息里塞业务数据行。
3. 派发 SHALL 可注入（`triggerAgent`），默认走 `callGateway`；单测注入假实现。
4. 派发结果 SHALL 逐订阅返回 `{subscriptionId, targetAgentId, status, runId?, error?}`，不因单个失败中断其余。

### R5：RPC 暴露

1. 读 RPC（READ 作用域）：`enterprise-data.events.list`、`enterprise-data.event-subscriptions.list`。
2. 写 RPC（WRITE 作用域 + in-handler enterprise-admin 强制）：`enterprise-data.events.ingest`、
   `enterprise-data.event-subscriptions.upsert`、`enterprise-data.event-subscriptions.delete`。
3. 租户 SHALL 服务端解析（`requireResolvedEnterpriseAdminTenantId`），不接受伪造 tenantId。
4. SHALL 注册进 `server-methods-list.ts` 与 `method-scopes.ts` 对应作用域。

### R6：工程约束（多 agent 安全 + 既有范式）

1. SHALL 沿用 enterprise-data 既有范式（独立 versioned store、纯函数 CRUD、DI 工厂 handler、
   服务端租户解析、`EnterpriseDataStoreError`）。
2. 单一独立 store 文件，不改 `types.ts`/`store.ts` 的 `EnterpriseDataStore`。
3. 新增独立文件为主；共享注册表（`server-methods-list.ts`/`method-scopes.ts`）仅加法、不整文件提交。
4. 严格类型，避免 `any`；改动文件 `pnpm tsgo` 零错误；scoped 测试全绿；oxfmt/oxlint 清洁。
