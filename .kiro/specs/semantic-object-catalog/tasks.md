# Implementation Plan — 语义对象目录（Semantic Object Catalog）

> 依赖：`enterprise-data` 既有 store/CRUD/RPC/图谱范式（复用，不重做）。
> 后继：`agent-data-planner`（P0）与 `context-broker`（P2）将以本目录为「数据地图」输入。
>
> **状态（2026-07-12，— kiro-semantic-catalog）**：全部任务落地并验证。
> 22 个单测全绿（store 13 / handler 6 / asset-landscape 3）；改动文件 `pnpm tsgo` 零错误
> （工作树另有 34 个他人 WIP 既有错误，非本任务，按多 agent 约定不触碰）；oxfmt 已格式化本任务文件。

## Agents

- kiro-semantic-catalog · role: owner · scope: 语义对象目录（独立 store + 只读 RPC + 资产全景图接入） · paths: `.kiro/specs/semantic-object-catalog/**`, `src/gateway/enterprise-data/semantic-object-types.ts`, `src/gateway/enterprise-data/semantic-object-store.ts`, `src/gateway/enterprise-data/semantic-object-store.test.ts`, `src/gateway/enterprise-data/asset-landscape-store.test.ts`, `src/gateway/server-methods/enterprise-data-semantic.ts`, `src/gateway/server-methods/enterprise-data-semantic.test.ts` · since: 2026-07-12

### 定位（强约束）

- **只存元数据，不存业务数据**（Metadata First，D2）。
- **独立 store**，不改 `enterprise-data/types.ts` 的 `EnterpriseDataStore` 与 `store.ts`（D1）。
- 跨库存在性校验（sourceId/action）后置到 resolver/handler/Planner（D3）。
- 沿用既有范式：`data-source-store.ts`（CRUD）、`store.ts`（normalize）、`connector-oauth-session-persistence.ts`（写锁）、`enterprise-data-m6.ts`（handler + 服务端租户解析）、`asset-landscape-store.ts`（图谱、跨库数据传入 resolver）。

### 共享文件说明（多 agent 安全）

- **纯新增文件**（本任务独有）：`semantic-object-types.ts`、`semantic-object-store.ts`、`semantic-object-store.test.ts`、`asset-landscape-store.test.ts`、`enterprise-data-semantic.ts`、`enterprise-data-semantic.test.ts`。
- **增量编辑**：`asset-landscape-store.ts`（加 object 节点 + model/serve 边 + 可选 `semanticObjects` 参数，向后兼容）、`server-methods/enterprise-data.ts`（仅本任务 3 行）、`server-methods/enterprise-data-m6.ts`（干净基线 + 本任务 3 行接线；文件归属 cursor-edc-connector，提交前需协调）。
- **含他人 WIP 的共享注册表**：`server-methods-list.ts`、`method-scopes.ts`（各 +2 行语义方法，与他人新增并存互不冲突；**提交时不可整文件提交**，须按 landing-group 规则仅拣本任务 2 行或由 owner 协调）。

## Tasks

- [x] 1. 调研 enterprise-data 现状与规范（types/store/asset-landscape/projection-spec/data-source/m6 handler）——结论见 design.md 决策。 — kiro-semantic-catalog

- [x] 2. 类型定义 `semantic-object-types.ts`
  - `SemanticObjectKind` / `SemanticFieldType` / `SemanticField` / `SemanticFieldMapping` / `SemanticObjectSourceBinding` / `SemanticObjectLifecycle` / `SemanticObject` / `SemanticObjectStore` / `SEMANTIC_OBJECT_STORE_VERSION`。
  - `import type { ConnectorActionRef, DataClassification } from "./types.js"`（type-only，无循环运行时依赖）。
  - _Requirements: 1, 2, 3, 7_ — kiro-semantic-catalog

- [x] 3. 持久化 + CRUD + 写锁 `semantic-object-store.ts`
  - `resolveDefaultSemanticObjectStorePath` / `normalizeSemanticObjectStore` / `loadSemanticObjectStore` / `saveSemanticObjectStore` / `withSemanticObjectStoreWriteLock`。
  - `listSemanticObjects` / `findSemanticObject` / `findSemanticObjectByKey` / `upsertSemanticObject`（自洽校验）/ `deleteSemanticObject`。
  - 复用 `EnterpriseDataStoreError`（connector-action-store.ts）。
  - _Requirements: 1, 2, 3, 7_ — kiro-semantic-catalog

- [x] 4. 演示目录 `ensureSemanticObjectDemoCatalog`（幂等，4 对象 customer/sales-order/product/inventory，含 reference + classification，无源绑定）。
  - _Requirements: 6_ — kiro-semantic-catalog

- [x]\* 5. 单测 `semantic-object-store.test.ts`（13 tests：CRUD 往返 / 冲突 / 绑定校验 / 租户隔离 / normalize / seeds 精确断言）。
  - _Requirements: 1, 2, 3, 6, 7_ — kiro-semantic-catalog

- [x] 6. 只读 RPC `enterprise-data-semantic.ts` + 注册
  - `createEnterpriseDataSemanticHandlers({ loadStore? })`：`enterprise-data.semantic-objects.list` / `.get`（kind/lifecycle 过滤，白名单校验）。
  - 主路由 `enterprise-data.ts` 展开（3 行增量）；`server-methods-list.ts` + `method-scopes.ts` READ_SCOPE（各 +2 行）。
  - 服务端 `requireResolvedEnterpriseAdminTenantId`，不信任客户端 tenantId。
  - _Requirements: 4_ — kiro-semantic-catalog

- [x]\* 6b. handler 测试 `enterprise-data-semantic.test.ts`（6 tests：list / kind 过滤 / get by key / 缺参拒绝 / 伪造 tenantId 拒绝 / 非 admin 拒绝）。
  - _Requirements: 4_ — kiro-semantic-catalog

- [x] 7. 资产全景图接入（增量）`asset-landscape-store.ts`
  - node kind 增 `object`；edge relation 增 `model`（source→object）/`serve`（object→capability）；`resolveAssetLandscapeGraph` 加可选 `semanticObjects`；不传则行为不变。
  - m6 `asset-landscape.graph` handler 加载语义 store 后 `listSemanticObjects` 传入（3 行增量；m6 归属 cursor-edc-connector）。
  - _Requirements: 5_ — kiro-semantic-catalog

- [x]\* 7b. asset-landscape 增量测试 `asset-landscape-store.test.ts`（3 tests：传入 → object 节点 + model/serve 边；不传 → 现状一致；悬空绑定不连 model 边）。
  - _Requirements: 5_ — kiro-semantic-catalog

- [x] 8. 验证：`pnpm tsgo` 改动文件零错误（总 35→34，移除本任务唯一错误；剩 34 为他人 WIP）+ 22 个 scoped 测试全绿 + oxfmt 格式化 + 清理临时文件。 — kiro-semantic-catalog

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **多 agent 安全**：见上「共享文件说明」。`server-methods-list.ts` / `method-scopes.ts` 当前含他人未提交 WIP，提交时须按 landing-group 规则处理。
- 标 `*` 为测试任务。
- **后续（本规格外）**：Agent Data Planner（P0）以本目录为输入，产出授权范围内 Data Plan，交既有 `capability-agent-invoke-runtime.ts` 执行；Context Broker（P2）与 Planner 合一。
