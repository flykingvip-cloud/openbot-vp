# Design Document — 语义对象目录（Semantic Object Catalog）

## Overview

新增一个**独立、只存元数据**的规范对象目录，作为 Agent 理解企业数据的语言层，以及 Agent Data Planner 的「元数据地图」输入。严格沿用 `enterprise-data` 既有 store / CRUD / RPC / 图谱范式，不引入新栈、不改动 `EnterpriseDataStore`。

```
数据源(DataSource) ──┐
连接器动作(ConnectorAction) ──┼──▶  语义对象目录(SemanticObject)  ──▶  [后续] Agent Data Planner
                            │      · 规范字段 + 数据分级              （查元数据 → 生成取数计划）
                            │      · 源绑定：规范字段 ← 物理字段路径
数据能力(DataCapability) ────┘      （Metadata First，不存业务数据）
```

## 架构决策落地

- **独立 store 文件**：`~/.openbot/openbot-enterprise-semantic-objects.json`，形如 `{ version, semanticObjects: Record<objectId, SemanticObject> }`。加载/保存/归一完全对齐 `src/gateway/enterprise-data/store.ts`（`readJsonFile` / `writeJsonAtomic` / `resolveUserPath` / `CONFIG_DIR` / `canonicalizeTenantId`）。
- **不改** `enterprise-data/types.ts` 的 `EnterpriseDataStore`、不改 `store.ts`、不改 `ENTERPRISE_DATA_STORE_VERSION`。新类型放独立 `semantic-object-types.ts`，只**读取** `types.ts` 的 `ConnectorActionRef` / `DataClassification`（`import type`，无运行时循环依赖）。
- **错误类型**：复用 `EnterpriseDataStoreError`（来自 `connector-action-store.ts`），与 `projection-spec-store.ts` / `data-source-store.ts` 一致，`respondUnavailable` / `respondInvalid` 可统一处理。

## Data Models（`src/gateway/enterprise-data/semantic-object-types.ts`）

```ts
import type { ConnectorActionRef, DataClassification } from "./types.js";

export type SemanticObjectKind =
  | "customer"
  | "order"
  | "product"
  | "inventory"
  | "employee"
  | "contract"
  | "invoice"
  | "custom";

export type SemanticFieldType =
  | "id"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "money"
  | "reference";

export type SemanticField = {
  fieldKey: string; // 规范字段名，如 "customerName"
  displayName: string;
  type: SemanticFieldType;
  description?: string;
  classification?: DataClassification; // 与既有脱敏口径一致
  referenceObjectKey?: string; // type=reference 时指向另一对象 objectKey
  required?: boolean;
};

export type SemanticFieldMapping = {
  fieldKey: string; // 引用本对象已声明的 fieldKey
  sourceFieldPath: string; // 物理路径，如 "records[].Name"
};

export type SemanticObjectSourceBinding = {
  bindingId: string;
  sourceId: string; // DataSource（存在性由跨库层校验，D3）
  action: ConnectorActionRef; // 产出该对象行的动作
  fieldMappings: SemanticFieldMapping[];
  capabilityId?: string; // 可选治理关联（DataCapability）
  primary?: boolean; // 多源时首选绑定（至多一个 true）
};

export type SemanticObjectLifecycle = "draft" | "active" | "deprecated";

export type SemanticObject = {
  objectId: string;
  tenantId: string;
  objectKey: string; // 租户内唯一 slug
  displayName: string; // 如 "客户"
  kind: SemanticObjectKind;
  description: string;
  fields: SemanticField[];
  sourceBindings: SemanticObjectSourceBinding[];
  lifecycle: SemanticObjectLifecycle;
  seedOrigin?: "demo";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

export type SemanticObjectStore = {
  version: number;
  semanticObjects: Record<string, SemanticObject>;
};

export const SEMANTIC_OBJECT_STORE_VERSION = 1;
```

## Store API（`src/gateway/enterprise-data/semantic-object-store.ts`）

镜像 `data-source-store.ts` + `store.ts` + `connector-oauth-session-persistence.ts`（写锁）：

- 持久化：`resolveDefaultSemanticObjectStorePath()`、`normalizeSemanticObjectStore(parsed)`、`loadSemanticObjectStore(path?)`、`saveSemanticObjectStore(store, path?)`。
- 写锁：`withSemanticObjectStoreWriteLock(run)`（`createAsyncLock` from `infra/json-files.js`，load→run→save 串行）。
- CRUD（纯函数，作用于内存 `SemanticObjectStore`）：
  - `listSemanticObjects({ store, tenantId, kind?, lifecycle? })` — 按租户过滤，`toSorted` by `objectKey`。
  - `findSemanticObject(store, tenantId, objectId)`、`findSemanticObjectByKey(store, tenantId, objectKey)`。
  - `upsertSemanticObject({ store, tenantId, object, nowIso })` — 自洽校验（objectKey 非空/唯一、fieldKey 唯一、绑定 fieldKey 引用已声明字段、至多一个 primary），保留 `createdAt`，`randomUUID()` 生成新 id / bindingId。
  - `deleteSemanticObject({ store, tenantId, objectId })`（或 `archiveSemanticObject` 置 lifecycle=deprecated；首期提供 delete）。
- 种子：`ensureSemanticObjectDemoCatalog({ store, tenantId, nowIso })` — 幂等种入 4 对象（见下），已存在同 key 跳过。

自洽校验错误码（`EnterpriseDataStoreError`）：`SEMANTIC_OBJECT_KEY_REQUIRED` / `SEMANTIC_OBJECT_KEY_CONFLICT` / `SEMANTIC_FIELD_KEY_CONFLICT` / `SEMANTIC_BINDING_FIELD_UNKNOWN` / `SEMANTIC_BINDING_MULTIPLE_PRIMARY` / `SEMANTIC_OBJECT_NOT_FOUND`。

## Seeds（演示目录）

| objectKey     | kind      | displayName | 关键字段（演示）                                                                                                |
| ------------- | --------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `customer`    | customer  | 客户        | customerId(id) · name(string) · phone(string,**CONFIDENTIAL**) · email(string,CONFIDENTIAL) · industry(string)  |
| `sales-order` | order     | 订单        | orderId(id) · customerId(**reference→customer**) · amount(money) · status(enum) · orderedAt(datetime)           |
| `product`     | product   | 产品        | productId(id) · name(string) · sku(string) · price(money) · category(string)                                    |
| `inventory`   | inventory | 库存        | inventoryId(id) · productId(**reference→product**) · quantity(number) · warehouse(string) · updatedAt(datetime) |

种子**无源绑定**（绑定需真实 `sourceId`）；演示 `reference` 关系与 `classification`。

## RPC（`src/gateway/server-methods/`）

为规避与 `enterprise-data-m6.ts`（cursor-edc-connector 归属）的 attribution CONFLICT，新增独立 handler 文件 `enterprise-data-semantic.ts`，导出 `createEnterpriseDataSemanticHandlers(loadStore)`，由主路由 `enterprise-data.ts` 展开（一行增量）：

- `enterprise-data.semantic-objects.list` → `{ tenantId, objects }`（可选 `kind` / `lifecycle` 过滤）。
- `enterprise-data.semantic-objects.get` → `{ tenantId, object }`（`objectId` 或 `objectKey`）。

两者均 `requireResolvedEnterpriseAdminTenantId`（服务端解析，不信任客户端 tenantId），注册进 `server-methods-list.ts` + `method-scopes.ts` READ_SCOPE。首期只读；写入经 store API / seeds（写 RPC 留后续）。

## 资产全景图接入（增量）

`asset-landscape-store.ts`：

- `AssetLandscapeNodeKind` 增 `"object"`；`AssetLandscapeEdgeRelation` 增 `"model"`（source→object）与 `"serve"`（object→capability）。
- `resolveAssetLandscapeGraph` 增可选入参 `semanticObjects?: SemanticObject[]`（默认 undefined → 行为不变，R5.2）。
- 对每个语义对象：加 `object:<objectId>` 节点；对每个绑定，若 `sourceId` 已有 source 节点 → 连 `source → object`(model)；若 `capabilityId` 命中 included capability → 连 `object → capability`(serve)。
- handler（m6 的 `asset-landscape.graph`）后续加载语义 store 后传入；本规格先在 resolver 加参 + 单测，handler 接线作为收尾（避免与 m6 归属冲突时可延后）。

## Testing

- `semantic-object-store.test.ts`：CRUD 往返；objectKey/fieldKey 冲突；绑定字段未知 / 多 primary 拒绝；租户隔离；normalize 旧/空文件；seeds 幂等 + 精确断言（reference 关系、classification）。
- `asset-landscape-store.test.ts`（增量）：传 `semanticObjects` → 出现 object 节点 + model/serve 边；不传 → 与现状一致；悬空绑定不连边。
- handler 测试：list/get 经解析租户返回、伪造 tenantId 被拒。

## 与后续步骤的衔接

- **Agent Data Planner（P0，下一步）**：输入 = 任务意图 + 本目录（对象/字段/绑定）+ 授权范围；输出 = Data Plan（取哪些对象/字段、经哪个绑定/能力）；执行交既有 `capability-agent-invoke-runtime.ts`。
- **Context Broker（P2，与 Planner 合一）**：给定任务+Agent+租户，组装授权范围内的上下文包（身份 + 能力 + Data Plan + 知识）。本目录提供其中「数据地图」部分。
