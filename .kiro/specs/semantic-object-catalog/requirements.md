# Requirements Document

> 中文名：语义对象目录（Semantic Object Catalog）
> Agent OS 方案 Phase 2 核心补齐 —— 让 Agent 理解「客户/订单/产品/库存」而非数据库表。
> 定位：Data Planner（P0）与 Context Broker（P2）的**数据地图地基**。

## Introduction

当前 `enterprise-data` 已有**连接器**（连接 + 动作，`connector-catalog.ts` / `connector-action-store.ts`）、**数据源**（`data-source-store.ts`）、**数据能力**（`data-capability-store.ts`）、**投影规格**（`projection-spec-store.ts`，归一/聚合/趋势）、**字段分级 + 脱敏**（`field-classification-store.ts` / `masking-engine.ts`）。但**缺少一等公民的「企业对象目录」**：把异构源表 / 连接器动作输出映射到统一的规范对象（Customer / Order / Product / Inventory …）。

方案强调的 **Metadata First**——「桥接库不存业务数据，只存数据描述；Agent 先理解数据结构，再决定是否取数」——目前只在**知识投影**侧有按需物化（`knowledge/feed/on-demand-projection-materializer.ts`），而「用统一对象语言描述企业数据」这一步没有独立组件。

本规格新增 **Semantic Object Catalog**：一个**只存元数据、不存业务数据**的规范对象目录。它是 Agent「理解客户/订单」的语言层，也是后续 Agent Data Planner「查元数据目录 → 生成取数计划」的输入。

### 与既有模块的关系（复用，不重做）

- **不替代**投影规格：投影产出的是**知识对象（feed item）**（归一/聚合/趋势的结果快照）；语义对象描述的是**企业实体的规范结构 + 到物理源的映射**。二者互补：一个语义对象可被多个投影消费。
- **不替代**数据能力：数据能力是**可执行的业务能力**（`actionRefs`）；语义对象是**数据的规范描述**，可选地绑定到某个 `capabilityId` 作为治理关联。
- **复用**连接器动作引用 `ConnectorActionRef`、数据分级 `DataClassification`（`types.ts`），保证与既有 masking / 审计口径一致。

### 架构决策（Decision，随本规格签署）

- **D1（独立 store）**：语义对象存于**独立文件** `openbot-enterprise-semantic-objects.json`（`SEMANTIC_OBJECT_STORE_VERSION=1`），**不**并入 `EnterpriseDataStore`。理由：① 零改动 `enterprise-data/types.ts` 与 `store.ts`（两处最热共享文件），规避 attribution CONFLICT 与 store 版本常量合并冲突；② 语义对象是 Data Planner / Context Broker 将依赖的**新能力**，独立版本便于独立演进与归属；③ 沿用既有「跨库数据由 handler 加载后传入 resolver」的成熟范式（对齐 `enterprise-data-m6.ts` 中 `loadEnterpriseSeatAssetsStore()` → `resolveAssetLandscapeGraph({ store, seatStore, ... })`）。
- **D2（Metadata First）**：语义对象**只存描述**（对象/字段/到源的映射），**绝不**存业务数据行；取数由既有 `capability-agent-invoke-runtime.ts` / `data-gateway.ts` 完成，本目录仅提供「取什么、从哪取、怎么映射」的元数据。
- **D3（源绑定跨库校验后置）**：`sourceId` / `ConnectorActionRef` 的存在性校验依赖 `EnterpriseDataStore`，属跨库；store 层只做**自洽校验**（objectKey 唯一、字段键唯一、绑定字段引用已声明字段），跨库存在性校验由 resolver / handler / Planner 层完成，保持 store 纯净（对齐 `projection-spec-store.ts` 仅在同库内校验的取舍）。

## Glossary

- **语义对象（SemanticObject）**：规范化的企业实体（客户 / 订单 / 产品 / 库存 / 员工 / 合同 / 发票 …）。Agent 理解的是它，而非数据库表。
- **语义字段（SemanticField）**：语义对象上的规范字段（如 `customerName`），带类型与可选数据分级。
- **源绑定（SemanticObjectSourceBinding）**：把一个语义对象绑定到某个 `DataSource` + `ConnectorActionRef`，并给出**规范字段 ← 物理字段路径**的映射。这是「理解数据而非表」的桥。
- **objectKey**：租户内稳定的对象 slug（如 `customer` / `sales-order`），唯一。
- **Metadata First / Data On Demand**：先看元数据（本目录），再按需取数（既有调用桥），不预同步、不落业务数据。

## Requirements

### Requirement 1: 规范对象目录（租户隔离，只存元数据）

**User Story:** 作为企业管理员，我希望维护一套统一的企业对象（客户/订单/产品/库存），让 Agent 用统一语言理解企业数据。

#### Acceptance Criteria

1. 系统 SHALL 提供 `SemanticObject`（`objectId` / `tenantId` / `objectKey` / `displayName` / `kind` / `description` / `fields[]` / `sourceBindings[]` / `lifecycle` / `createdAt` / `updatedAt`），并存于独立 store（D1）。
2. `objectKey` 在同一 `tenantId` 内 SHALL 唯一；重复 upsert 同 key 且不同 id SHALL 以 `SEMANTIC_OBJECT_KEY_CONFLICT` 拒绝。
3. 所有 list/find SHALL 按 `tenantId` 隔离；跨租户记录 SHALL NOT 返回。
4. store SHALL NOT 存储任何业务数据行（Metadata First，D2）：仅对象/字段/映射描述。

### Requirement 2: 语义字段与数据分级对齐

**User Story:** 作为合规负责人，我希望语义字段能标注数据分级，与既有脱敏口径一致。

#### Acceptance Criteria

1. `SemanticField` SHALL 含 `fieldKey` / `displayName` / `type`，可选 `classification`（复用 `DataClassification`：PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED）、`referenceObjectKey`（type=reference 时指向另一对象）、`required`。
2. 同一对象内 `fieldKey` SHALL 唯一；重复 SHALL 以 `SEMANTIC_FIELD_KEY_CONFLICT` 拒绝。
3. `type=reference` 的字段 SHOULD 提供 `referenceObjectKey`；缺失不阻断（草稿期可留空）。

### Requirement 3: 源绑定与字段映射（理解数据而非表）

**User Story:** 作为数据管理员，我希望把规范对象映射到真实数据源与连接器动作，说明「从哪取、字段怎么对」。

#### Acceptance Criteria

1. `SemanticObjectSourceBinding` SHALL 含 `bindingId` / `sourceId` / `action`(ConnectorActionRef) / `fieldMappings[]`（`{ fieldKey, sourceFieldPath }`），可选 `capabilityId` / `primary`。
2. 绑定的 `fieldMappings[].fieldKey` SHALL 均引用该对象已声明的 `fields[].fieldKey`；否则以 `SEMANTIC_BINDING_FIELD_UNKNOWN` 拒绝。
3. 一个对象 SHALL 允许多个源绑定；至多一个 `primary=true`（多个 primary 以 `SEMANTIC_BINDING_MULTIPLE_PRIMARY` 拒绝）。
4. `sourceId` / `action` 的**存在性**校验属跨库（D3），store 层 SHALL NOT 强制；由 resolver / handler / Planner 校验。

### Requirement 4: 只读 RPC 与会话域门禁

**User Story:** 作为平台/企业控制台，我希望只读地列出与查看语义对象目录。

#### Acceptance Criteria

1. 系统 SHALL 提供只读 RPC `enterprise-data.semantic-objects.list` 与 `enterprise-data.semantic-objects.get`。
2. RPC SHALL 经服务端 `requireResolvedEnterpriseAdminTenantId` 解析租户，SHALL NOT 信任客户端传入 `tenantId`（对齐 m6 既有 handler）。
3. RPC SHALL 注册到 `server-methods-list.ts` 与 `method-scopes.ts` 的 READ_SCOPE 组（否则未分类默认 admin-only，控制台空 scope 调用不稳）。

### Requirement 5: 接入资产全景图（新增 object 节点层）

**User Story:** 作为企业管理员，我希望在资产全景图上看到「数据源 → 语义对象 → 能力/知识」的价值链。

#### Acceptance Criteria

1. `resolveAssetLandscapeGraph` SHALL 以**增量、向后兼容**方式接受可选 `semanticObjects`，新增 `object` 节点类别与边：`source → object`（relation `model`，来自绑定的 `sourceId`）、`object → capability`（relation `serve`，来自绑定的 `capabilityId`）。
2. 未传 `semanticObjects` 时 SHALL 与现状行为完全一致（不新增节点/边）。
3. 仅当绑定的 `sourceId` 在图中存在对应 source 节点时 SHALL 连 `source → object` 边（避免悬空边）。

### Requirement 6: 演示目录（seeds，幂等）

**User Story:** 作为演示/首启，我希望有一套开箱即用的规范对象。

#### Acceptance Criteria

1. 系统 SHALL 提供 `ensureSemanticObjectDemoCatalog`，为租户幂等种入 `customer` / `sales-order` / `product` / `inventory` 四个对象（含字段与引用关系；**无源绑定**，因绑定需真实源）。
2. 种子对象 SHALL 标记 `seedOrigin="demo"`；已存在同 `objectKey` 时 SHALL 跳过（幂等），不覆盖用户改动。
3. 种子字段 SHALL 演示 `reference` 关系（`sales-order.customerId → customer`、`inventory.productId → product`）与 `classification`（如 `customer.phone=CONFIDENTIAL`）。

### Requirement 7: 版本化与向后兼容

**User Story:** 作为平台运维，我希望目录存储可平滑演进。

#### Acceptance Criteria

1. store SHALL 有 `version`（`SEMANTIC_OBJECT_STORE_VERSION`），`normalizeSemanticObjectStore` SHALL 对缺失字段返回空 map、对 `tenantId` 做 `canonicalizeTenantId` 归一（对齐 `enterprise-data/store.ts`）。
2. 读一个不含 `semanticObjects` 的旧/空文件 SHALL 返回合法空目录，不抛错。
3. 写入 SHALL 经 `writeJsonAtomic` 原子落盘，并发写 SHALL 经写锁串行化（对齐 `connector-oauth-session-persistence.ts` 的锁范式）。

## 范围边界（Non-Goals）

- **不**实现取数 / 物化（沿用既有 `capability-agent-invoke-runtime.ts` / `data-gateway.ts` / on-demand materializer）。
- **不**实现 Data Planner 本身（本目录是其输入；Planner 为后续 P0 规格）。
- **不**做前端目录管理 UI 的完整增删改（首期只读 RPC + 图谱接入；写入经 store API / seeds）。
- **不**改动 `enterprise-data/types.ts` 的 `EnterpriseDataStore` 与 `ENTERPRISE_DATA_STORE_VERSION`（D1）。
