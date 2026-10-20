# Design — 企业数据事件总线（Enterprise Data Event Bus）

> 依赖：语义对象种类（`semantic-object-types.ts`）、Agent 触发桥（`callGateway({method:"agent"})`，
> 参考 `src/organization/inter-agent-bus.ts`）、租户解析（`enterprise-data-seat-context.ts`）、
> enterprise-data 既有 store/RPC 范式。

## 关键决策

- **D1（复用触发桥，不造总线）**：仓库无通用 pub/sub。派发 = `callGateway({method:"agent", params:{...}})`，
  sessionKey 经 `buildOrganizationAgentSessionKey({agentId, organizationId: tenantId})`。完全复刻
  inter-agent-bus 的参数（deliver:false / INTERNAL_MESSAGE_CHANNEL / AGENT_LANE_NESTED /
  inputProvenance.kind="inter_session" / 必填 idempotencyKey）。
- **D2（元数据优先）**：事件只存源/对象/类型/摘要/externalId/digest，绝不存业务数据行；敏感 payload
  至多留哈希。承接第 1/2 步的 Metadata First。
- **D3（独立单 store）**：`openbot-enterprise-data-event-bus.json`（version 1）= `{version, events, subscriptions}`。
  不改 `EnterpriseDataStore`。events 按租户有界保留（cap 最近 N，追加时裁剪最旧）。
- **D4（确定性匹配）**：`matchSubscriptions(event, subs)` 纯函数；订阅每个已设规则字段与事件相等即命中
  （未设=通配），仅 enabled，按租户隔离。可扇出多订阅。
- **D5（幂等）**：dedupe 键 `(tenantId, sourceId, externalId)`；已存在则跳过派发、返回既有事件——webhook 重试安全。
- **D6（订阅 target=agentId）**：首个切片按 agentId 订阅（直接复用 inter-agent-bus）。seat→agent 解析、
  按语义对象授权可见性过滤留作后续增强（触发只是通知；被触发 Agent 取数时仍经第 2 步 Planner + W5 桥授权）。
- **D7（注入式派发）**：`dispatchEnterpriseDataEvent({event, subscriptions, triggerAgent})`，triggerAgent 默认
  callGateway 版；单测注入假实现，避免依赖真实 gateway。
- **D8（Planner 联动）**：事件带 objectKind 时，触发消息提示被触发 Agent 用 `data_capability`/Planner
  在授权范围内规划取数（不在消息里塞数据行）。

## 模块与文件

### 新增（本任务独有，零冲突）

- `src/gateway/enterprise-data/enterprise-data-event-types.ts` — 事件/订阅/store 类型 + 枚举 + 版本常量。
- `src/gateway/enterprise-data/enterprise-data-event-store.ts` — 持久化 + CRUD + 写锁 + 有界保留 + 归一。
- `src/gateway/enterprise-data/enterprise-data-event-bus.ts` — normalizeInboundSignal / matchSubscriptions /
  buildEventAgentMessage（纯） + dispatchEnterpriseDataEvent（注入 triggerAgent） +
  ingestEnterpriseDataEvent（编排） + 默认 callGateway 版 triggerAgent。
- `src/gateway/enterprise-data/enterprise-data-event-bus.test.ts` — 核心单测。
- `src/gateway/server-methods/enterprise-data-events.ts` — RPC handler（注入式工厂）。
- `src/gateway/server-methods/enterprise-data-events.test.ts` — handler 单测。

### 增量编辑（共享；不整文件提交）

- `src/gateway/server-methods/enterprise-data.ts`：import + const + 展开 planner 后（3 行）。
- `src/gateway/server-methods-list.ts`（含他人 WIP）：BASE_METHODS +5 方法名。
- `src/gateway/method-scopes.ts`（含他人 WIP）：READ_SCOPE +2（events.list/event-subscriptions.list，
  接 planner 后）、WRITE_SCOPE +3（events.ingest/event-subscriptions.upsert/.delete，接
  approval.requests.decide 后）。

## 数据模型（`enterprise-data-event-types.ts`）

```ts
export type EnterpriseDataEventType = "created" | "updated" | "deleted" | "custom";

export type EnterpriseDataEvent = {
  eventId: string;
  tenantId: string;
  sourceId: string; // 归属 DataSource（跨库存在性由 handler/后置校验）
  eventType: EnterpriseDataEventType;
  objectKind?: SemanticObjectKind; // 挂到规范对象
  objectKey?: string;
  externalId?: string; // 源侧记录/事件 id，用于幂等
  title: string;
  summary?: string; // 人读摘要（无敏感值）
  payloadDigest?: string; // 敏感 payload 的哈希留痕（可选）
  occurredAt?: string; // 源侧发生时间
  receivedAt: string; // 网关接收时间
};

export type EnterpriseDataEventSubscription = {
  subscriptionId: string;
  tenantId: string;
  targetAgentId: string;
  sourceId?: string; // 匹配规则（未设=通配）
  objectKind?: SemanticObjectKind;
  eventType?: EnterpriseDataEventType;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseDataEventStore = {
  version: number;
  events: Record<string, EnterpriseDataEvent>;
  subscriptions: Record<string, EnterpriseDataEventSubscription>;
};
export const ENTERPRISE_DATA_EVENT_STORE_VERSION = 1;
export const ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT = 200;
```

## Store（`enterprise-data-event-store.ts`）

- normalize/load/save + `withEnterpriseDataEventStoreWriteLock`（复用 infra/json-files + utils 路径 +
  canonicalizeTenantId + EnterpriseDataStoreError，同 semantic-object-store）。
- 事件：`appendEnterpriseDataEvent`（填 eventId/receivedAt，按租户裁剪到 RETENTION）、
  `listEnterpriseDataEvents({store,tenantId,sourceId?,objectKind?,limit?})`（按 receivedAt 倒序）、
  `findEnterpriseDataEventByExternalId(store,tenantId,sourceId,externalId)`。
- 订阅：`listEventSubscriptions`/`findEventSubscription`/`upsertEventSubscription`/`deleteEventSubscription`
  （CRUD，key 语义按 subscriptionId；upsert 校验 targetAgentId 非空）。

## 事件总线核心（`enterprise-data-event-bus.ts`）

```ts
normalizeInboundSignal(input): EnterpriseDataEvent            // 纯：补全 + 白名单校验 + 裁元数据
matchSubscriptions(event, subs): EnterpriseDataEventSubscription[]  // 纯：确定性扇出
buildEventAgentMessage(event): string                         // 纯：格式化触发消息（含 Planner 提示）

type TriggerAgentFn = (p: {
  tenantId; targetAgentId; sessionKey; message; event;
}) => Promise<{ status: "accepted"|"error"|"skipped"; runId?: string; error?: string }>;

dispatchEnterpriseDataEvent({ event, subscriptions, triggerAgent }): Promise<DispatchResult>
// 逐订阅 triggerAgent；聚合 {subscriptionId,targetAgentId,status,runId?,error?}；单个失败不影响其余。

ingestEnterpriseDataEvent({ store, tenantId, input, nowIso, triggerAgent }): Promise<{
  event; deduped: boolean; dispatch: DispatchResult;
}>
// normalize → dedupe(externalId) → append → match(enabled subs) → dispatch。
```

默认 `defaultTriggerAgent`：复刻 inter-agent-bus——`callGateway({method:"agent", params:{message, sessionKey,
idempotencyKey: randomUUID(), deliver:false, channel:INTERNAL_MESSAGE_CHANNEL, lane:AGENT_LANE_NESTED,
inputProvenance:{kind:"inter_session", sourceTool:"enterprise_data_event"}}})`，捕获异常→status:"error"。

## RPC（`enterprise-data-events.ts`）

`createEnterpriseDataEventHandlers(deps?)`，注入 `withStore`(写锁编排)/`loadStore`/`resolveTenant`/`triggerAgent`/`now`：

- 读：`enterprise-data.events.list`、`enterprise-data.event-subscriptions.list`。
- 写（admin）：`enterprise-data.events.ingest`（body: sourceId/eventType/objectKind?/objectKey?/externalId?/
  title/summary?/occurredAt? → ingest → 返回 {event, deduped, dispatch}）、
  `enterprise-data.event-subscriptions.upsert`、`enterprise-data.event-subscriptions.delete`。
- 均 `requireResolvedEnterpriseAdminTenantId`。

## 测试策略

- 核心（`enterprise-data-event-bus.test.ts`）：normalize（白名单/裁元数据/补全）、match（规则/通配/enabled/租户）、
  ingest（追加+dedupe 幂等）、dispatch（注入 triggerAgent 记录调用；扇出；单失败不阻断）、
  buildEventAgentMessage（含对象/Planner 提示、无数据行）、保留裁剪。
- Handler（`enterprise-data-events.test.ts`）：注入 store/resolveTenant/triggerAgent；events.ingest 触发派发、
  events.list、subscriptions upsert/list/delete、伪造 tenantId 拒绝、非 admin 拒绝。

## 与后续的关系

- HTTP webhook 适配器（仿 telegram/webhook.ts：createServer + 共享密钥/HMAC 校验 → 转 `events.ingest`）留作后续。
- 事件可触发第 2 步 Planner 重规划；术语对照文档（P3）：Event Bus ↔ 本模块。
