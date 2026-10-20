# Implementation Plan — 企业数据事件总线（Enterprise Data Event Bus）

> 依赖：语义对象目录（已落地）、Agent Data Planner（已落地）、Agent 触发桥（callGateway agent）。
> 后继：HTTP webhook 适配器（仿 telegram/webhook.ts）；事件触发 Planner 重规划；术语对照文档（P3）。
>
> **状态（2026-07-12，— kiro-event-bus）**：全部任务落地并验证。
> 12 个本任务单测全绿（event-bus 核心 7 / handler 5）+ server-methods.test.ts 47 项方法注册一致性通过；
> 改动文件 `pnpm tsgo` 零错误（总数 45→36，剩 36 为他人 WIP）；oxfmt + oxlint 本任务 6 文件全清。

## Agents

- kiro-event-bus · role: owner · scope: 企业数据事件总线（事件/订阅独立 store + 归一 + 确定性匹配 + 派发触发 Agent + 只读/入站 RPC；复用 inter-agent-bus 触发桥，不造总线） · paths: `.kiro/specs/enterprise-data-event-bus/**`, `src/gateway/enterprise-data/enterprise-data-event-types.ts`, `src/gateway/enterprise-data/enterprise-data-event-store.ts`, `src/gateway/enterprise-data/enterprise-data-event-bus.ts`, `src/gateway/enterprise-data/enterprise-data-event-bus.test.ts`, `src/gateway/server-methods/enterprise-data-events.ts`, `src/gateway/server-methods/enterprise-data-events.test.ts` · since: 2026-07-12

### 定位（强约束）

- **复用触发桥，不造总线**（D1）：派发走 callGateway({method:"agent"})，sessionKey 经 buildOrganizationAgentSessionKey。
- **元数据优先**（D2）：事件只存源/对象/类型/摘要/digest，无业务数据行。
- **独立单 store**（D3）：openbot-enterprise-data-event-bus.json，不改 EnterpriseDataStore；events 有界保留。
- **幂等**（D5）：(tenantId,sourceId,externalId) 去重。
- **注入式派发**（D7）：triggerAgent 可注入，单测用假实现。

### 共享文件说明（多 agent 安全）

- **纯新增文件**（本任务独有）：event-types / event-store / event-bus / event-bus.test / server-methods/enterprise-data-events(.test)。
- **增量编辑**：`server-methods/enterprise-data.ts`（import + const + 展开 3 行，接 planner 后）。
- **含他人 WIP 的共享注册表**：`server-methods-list.ts`（BASE_METHODS +5）、`method-scopes.ts`（READ_SCOPE +2 接 planner 后、WRITE_SCOPE +3 接 approval.requests.decide 后）。**提交时不可整文件提交**。

## Tasks

- [x] 1. 调研接入点（inter-agent-bus / agent 触发 RPC / internal-events / agent-events / webhook / source-probe / 注册表 scope）——结论见 design.md。 — kiro-event-bus

- [x] 2. 创建本 spec（requirements + design + tasks），签到 `## Agents`。 — kiro-event-bus

- [x] 3. 类型定义 `enterprise-data-event-types.ts`
  - `EnterpriseDataEventType`/`EnterpriseDataEvent`/`EnterpriseDataEventSubscription`/`EnterpriseDataEventStore`
    - `ENTERPRISE_DATA_EVENT_STORE_VERSION` + `ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT`。type-only import 语义种类。
  - _Requirements: R1, R2_ — kiro-event-bus

- [x] 4. Store `enterprise-data-event-store.ts`
  - normalize/load/save + 写锁 + `appendEnterpriseDataEvent`（有界保留）/`listEnterpriseDataEvents`/
    `findEnterpriseDataEventByExternalId` + 订阅 CRUD。复用 EnterpriseDataStoreError。
  - _Requirements: R1, R2, R3_ — kiro-event-bus

- [x] 5. 事件总线核心 `enterprise-data-event-bus.ts`
  - `normalizeInboundSignal`（纯）/`matchSubscriptions`（纯）/`buildEventAgentMessage`（纯）。
  - `recordEnterpriseDataEvent`（normalize+dedupe+append）/`dispatchEnterpriseDataEvent`（注入 triggerAgent）/
    `ingestEnterpriseDataEvent`（编排）。`defaultTriggerAgent`（复刻 inter-agent-bus 的 callGateway 触发）。
  - _Requirements: R3, R4_ — kiro-event-bus

- [x]\* 6. 单测 `enterprise-data-event-bus.test.ts`（7 tests）
  - normalize / match（规则/通配/enabled/租户）/ ingest+dedupe / dispatch（扇出/单失败不阻断）/
    message（含 Planner 提示、无数据行）/ 保留裁剪。
  - _Requirements: R1, R2, R3, R4_ — kiro-event-bus

- [x] 7. 只读/入站 RPC `enterprise-data-events.ts` + 注册
  - `createEnterpriseDataEventHandlers(deps?)`：events.list / event-subscriptions.list（读）；
    events.ingest / event-subscriptions.upsert / event-subscriptions.delete（写，admin）。ingest 分两步（写锁内 record+snapshot、锁外 dispatch）。
  - 主路由 `enterprise-data.ts` 展开；`server-methods-list.ts` +5；`method-scopes.ts` READ +2 / WRITE +3。
  - 服务端 `requireResolvedEnterpriseAdminTenantId`。
  - _Requirements: R5_ — kiro-event-bus

- [x]\* 7b. handler 测试 `enterprise-data-events.test.ts`（5 tests：ingest 触发派发 / events.list / 订阅 upsert→list→delete / 缺 sourceId 拒绝 / 非 admin 拒绝；注入 store/withStore/triggerAgent）。
  - _Requirements: R5_ — kiro-event-bus

- [x] 8. 验证：`pnpm tsgo` 改动文件零错误（总 45→36，剩 36 为他人 WIP）+ 12 个 scoped 测试全绿 + oxfmt/oxlint 全清 + 清理临时文件。 — kiro-event-bus

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **多 agent 安全**：见「共享文件说明」。`server-methods-list.ts`/`method-scopes.ts` 含他人 WIP，提交按 landing-group 规则。
- 标 `*` 为测试任务。
