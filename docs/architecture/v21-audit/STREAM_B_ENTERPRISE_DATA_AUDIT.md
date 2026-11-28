# Stream B：企业数据连接器 / Semantic Object / Data Capability 实码审计（INTERIM 10 字段）

- 审查起点 SHA：`f0fccbd37bb9a45545562ee668295f9153b6f6aa`（Track 2 分支 `codex/openbot/v21-wave0-audit-and-adapters`）
- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：从 package 门面穿透到 Data Gateway 执行层与凭证/审计持久化。不是 README 结论。未解锁 `knowledge-object-only`，未建议 Semantic Object 双写，未改生产路由。
- **Exit Gate 3 / Gate 4 仍为 NOT_MET。本文不是自签署。**

## 官方 10 字段模板检索结论

检索范围（本轮）：Mac 工作树 `docs/`、Mac 归档 `/Users/daniel/.codex/visualizations/2026/11/25/01a210b8-fd0f-7f33-b2ec-282081c2e643/`、Box `/workspace/kb-sdk-align/`（含 zip-a/zip-b）、本轮用户附件目录。

**未找到**《Master Architecture v2.1 — OpenBot 既有能力清单与 Knowledge SDK 边界规范》第七节原文，也未找到其中规定的 10 项标准化审计字段清单。仅在 Downloads 见到无关的 `MASTER_ARCHITECTURE_V1_SIGNOFF_REVIEW.md`（v1 签认材料，不含 v2.1 第七节）。指令本身引用该规范，但未附字段表。

因此本报告使用下方 **INTERIM_10_FIELD_TEMPLATE（过渡模板）**，由本波次指令的必答问题与 L4/L5 验收口径推导。**不得把本模板宣称为官方第七节原文。** 若后续拿到官方字段表，应用官方字段重排，而不是改写本轮实码结论。

| # | 过渡字段 | 来源 |
|---|---|---|
| 1 | 能力/接口标识（名称与稳定 ID） | 指令「冻结可直接复用的公开接口表」 |
| 2 | 源码位置（file:line，本 SHA） | 严禁只读 README |
| 3 | 公开面与调用入口（RPC / 导出函数 / 工具） | 指令公开接口表 |
| 4 | 当前鉴权与主体模型 | 指令「含当前鉴权」 |
| 5 | 默认开 / 默认关，以及是否挂入默认生产路由 | 指令「default-on or default-off」 |
| 6 | 实现性质（真实驱动 / Demo / Mock / 库函数 / 未实现） | Stream B 必答；Stream A 同类标注 |
| 7 | 持久化与最终执行层（穿透终点） | 「B/C 必须穿透至持久化与最终执行」 |
| 8 | 计费、审计、配额接入点 | 指令 models.embed「鉴权与计费接入点」 |
| 9 | 安全红线与 Fail-Closed 条件 | L4 安全红线；Mode A/B/C；knowledge-object-only |
| 10 | 复用/包装建议与明确禁止项 | 禁止双写、禁止解锁桥、禁止 SDK 内置凭证等 |


## 结论摘要

1. **逐连接器：** Postgres / MySQL / HTTP REST / Notion / 用友 T+ 在目录中为 `integrationTier: "production"`，并有真实适配器（`pg`、`mysql2/promise`、`fetch`、畅捷通 OAuth HTTP）。Salesforce 与 SAP ERP 在目录中为 **`demo`**：默认安装 Demo 包并无凭证时走 `mock-handlers.ts`；若绑定凭证，异步执行路径会进入真实 HTTP 适配器。
2. **写主：** `openbot-enterprise-semantic-objects.json`（默认路径 `CONFIG_DIR/openbot-enterprise-semantic-objects.json`，`semantic-object-store.ts:25-67`）是 Semantic Object **目录**的唯一文件写主。它只存元数据（规范对象/字段/绑定），不存业务行，也不写入 `EnterpriseDataStore`。本报告 **不建议** 任何双写或迁移写主。
3. **`data-capability-tool.ts` 的 `invoke` 仍保持 knowledge-object-only Fail-Closed**（`:99-108`）。未解锁 Mode A/B/C 受控桥。下文列出未来若要解锁必须先满足的安全门，但本波次不得解锁。

---

## 执行主路径（所有 live 连接器的终点，不只 package 门面）

1. 安装：`ensureConnectorPackage`（`connector-packages.ts:11-41`）按 `integrationTier` 分流到 Demo 包或各生产 `ensure*ConnectorPackage`，向 **EnterpriseDataStore** 登记 `ConnectorAction` 与 `handlerRef`。
2. 调用：`invokeEnterpriseDataAction`（`data-gateway.ts:236`）  
   - `assertTrustedExecutionContext`；无 `seatId`/`employeeId` 则 `NO_SEAT_CONTEXT`；  
   - 查找本租户 Action、生命周期、授权/审批/范围；  
   - `selectSourceCredential` + `loadCredentialSecret`（凭证在保险库，不在 semantic object 文件）；  
   - **`executeConnectorHandlerAsync`（`connector-handler-runtime.ts:63`，由 `data-gateway.ts:537` 调用）** —— 这是最终执行分派；  
   - `applyClassificationMasking`（`masking-engine.ts:136`）；  
   - `recordDataAudit` / `recordInvocationAudit` 写入企业 store（高风险可 `fail_closed`）。
3. 同步 `executeConnectorHandler`（`:48`）只通向 mock，且 **本仓无其它生产调用方**（仅 runtime 自身定义）。生产取数走异步路径。
4. Planner：`planDataAccess`（`agent-data-planner.ts:218`）读 Semantic Object 目录 + 能力授权，生成计划；`executeDataPlan`（`:411`）对已授予步骤调用 `invokeDataCapabilityWithContext`，最终仍回到 Data Gateway / 连接器执行。Agent 只读包装明确「no persistence」（`:479` 附近），演示目录只在内存播种。
5. 索引：`indexed-store.ts` 是企业数据分区索引（`ensure/load/save/readIndexedEnterpriseSections`），服务知识 feed 等读取，**不是** Semantic Object 写主，也不是连接器查询的主执行层。

`integrationTier === "production"` 且无法进入 live adapter 时，`assertProductionDoesNotMock`（`connector-handler-runtime.ts:35-45`）拒绝 mock 回退。`website_session` 也禁止落入 mock（`:23-31`）。Demo 层在无凭证时允许 mock。

---

## 逐连接器（过渡 10 字段压缩表）

| 连接器 | 1 标识 | 2 关键位置 | 3 公开面 | 4 鉴权 | 5 默认 | 6 真实 vs Demo/Mock | 7 执行与持久化终点 | 8 审计/计费 | 9 Fail-Closed | 10 建议与禁止 |
|---|---|---|---|---|---|---|---|---|---|---|
| PostgreSQL | `db-postgres` | 目录 `connector-catalog.ts:75-78` `production`；包 `connector-postgres-package.ts`；适配器 `adapters/postgres.ts`（`POSTGRES_READ_HANDLER_REF` `:11`，`loadDefaultPostgresFactory` `:47` 动态 `import("pg")`） | Action `db.query.read@v1` | Data Gateway：可信 seat 上下文 + 凭证保险库（连接串在 `instanceUrl`，用户/密码在 vault）。SQL 再经 `sql-read-guard.ts:8` 只允许单条 `SELECT/WITH` | 生产层；包按需安装，不在无凭证时自动连库 | **真实驱动（可选依赖 `pg`）**。缺驱动抛「PostgreSQL 驱动（pg）加载失败」 | `executeConnectorHandlerAsync` `:86-89` → `executePostgresHandler` → `pg.Client.query`；结果经脱敏与调用审计写入 EnterpriseDataStore | 调用审计 + 数据审计；非 LLM 计费 | 生产层无 live adapter/无凭证：**禁止 mock**。多语句/非 SELECT 拒绝 | 可作 Mode B 数据源候选人，但当前 SQL 守卫 **不是** 行级谓词，不得当成已满足 Mode B。禁止自由 Text-to-SQL 对 Agent 开放 |
| MySQL | `db-mysql` | 目录 `:86-89` `production`；包 `connector-mysql-package.ts`（引入 `MYSQL_READ_HANDLER_REF`）；适配器 `adapters/mysql.ts`（`:13-55` 动态 `import("mysql2/promise")`） | Action `db.query.read@v1` | 同 Postgres；只读 SQL 守卫共用 | 生产层，按需安装 | **真实驱动（可选依赖 `mysql2`）** | `:90-93` → `executeMysqlHandler` → mysql2 查询；审计同上 | 同上 | 同生产 fail-closed + SQL 守卫 | 同 Postgres |
| HTTP REST | `http-rest` | 目录 `:64-67` `production`；包 `connector-http-rest-package.ts`；适配器 `adapters/http-rest.ts`（`buildHttpRestRequest`，Bearer/Basic/header/query/none） | Action `external.resource.read@v1` | 凭证在 secret；出站 `fetch` | 生产层，按需安装 | **真实 HTTP 客户端** | `:82-84` → `executeHttpRestHandler` | 审计同上 | 生产层禁止 mock 回退；缺必要认证字段抛错 | 可复用为受控出站读取；须继续限制到只读端点，禁止把调用方任意 URL/凭证透传到 RPC |
| Notion | `notion` | 目录 `:54-57` `production`；包 `connector-notion-package.ts`（`handlerRef` `notion-kb-search-v1`）；适配器 `adapters/notion.ts` `fetch("https://api.notion.com/v1/search")`，需 `oauthAccessToken` | Action 包内注册的 KB search | OAuth access token（`notion-oauth.ts` 配套） | 生产层；无 token 不得 live | **真实 Notion API**。`mock-handlers.ts:120` 仍有同名 mock case，但生产层 **不得** 回退 mock（`:35-45`） | `:78-80` 仅当 `secret.oauthAccessToken` 存在 | 审计同上 | 无 OAuth token 时不走 live，生产层拒绝 mock | 保持 OAuth；禁止把 mock 页面（`notion-page-demo-1`）当作生产知识 |
| 用友 T+ | `erp-yonyou-tplus` | 目录 `:97-100` `production`；包 `connector-yonyou-tplus-package.ts`（多个 `yonyou-tplus-*-v1` handlerRef）；适配器 `adapters/yonyou-tplus.ts`（约 690 行，真实畅捷通 HTTP，可 refresh token 并写回保险库） | 仓库/存货/往来/销售订单/销货/凭证等只读动作 | OAuth（appKey/appSecret/openToken；refresh 或永久授权码） | 生产层，安装包后探测 | **真实 ERP HTTP 适配器** | `:99-102` → `executeYonyouTplusHandler`；续期可写回凭证库（适配器内注释/实现约 `:373+`） | 审计 + 凭证轮换持久化（保险库，不是 semantic-objects.json） | 生产层禁止 mock；不支持的 handlerRef 抛错 | 保持为生产连接器；禁止把 token 写入 Semantic Object 字段 |
| Salesforce | `crm-salesforce` | 目录 `:32-35` **`demo`**；安装走 `ensureConnectorDemoPackage` → `seedCrmSalesforceDemoPackage`（`connector-demo-packages.ts:39+`）；适配器 `adapters/salesforce.ts`（REST `/services/data/.../limits` 与 query） | Demo 包动作（customer summary/export 等） | 无凭证：mock。有 secret：live OAuth/实例 URL（`:21-32`） | 目录默认 Demo；live 为可选 | **默认 Demo/Mock，附加可选真实 REST 适配器**。`mock-handlers.ts:76-103` 实现 demo 负载 | 有 secret：runtime `:74-77` `executeSalesforceHandler`；否则 `:107` `executeMockHandler`（demo 层允许） | 审计仍走 Gateway；mock 数据不得当作生产事实 | Demo 层允许 mock；不得把 mock 标成 production 成功（目录描述亦区分） | 在升为 production 并关闭默认可 mock 之前，不得当作已锁定的生产 CRM 驱动 |
| SAP ERP | `erp-sap` | 目录 `:43-46` **`demo`**；`connector-demo-packages.ts` SAP 播种（`:134+`）；适配器 `adapters/erp-sap.ts`（实例 URL + token/basic，`fetch` OData 风格探活/订单查询；文件头注释说明可对真实 SAP 租户调用） | Demo 包订单状态动作 | 无凭证：mock（`mock-handlers.ts:109`）。有 secret：live | 目录默认 Demo | **默认 Demo/Mock，附加可选真实 HTTP 适配器** | 有 secret：runtime `:95-97` `executeErpSapHandler`；否则 mock | 同 Salesforce | 同 Salesforce | 同 Salesforce：先完成生产化与禁默認 mock，再视为生产 ERP 驱动 |

补充：目录中还有 `site-session`（`production`，`accessMethod: "website_session"`），本表六项之外；其路径明确禁止 mock 回退。

---

## Semantic Object 唯一写主与字段契约

**写主文件名（锁定）：** `openbot-enterprise-semantic-objects.json`  
**默认路径：** `path.join(CONFIG_DIR, "openbot-enterprise-semantic-objects.json")`（`semantic-object-store.ts:25-67`）。  
**版本常量：** `SEMANTIC_OBJECT_STORE_VERSION = 1`（`semantic-object-types.ts:107`）。  
**设计约束（types 文件头）：** 独立 store，不写入 `EnterpriseDataStore`；只描述规范对象，**不存储业务行**；取数仍走既有 invoke / Data Gateway。

写 API（唯一程序写路径）：

- `saveSemanticObjectStore` / `withSemanticObjectStoreWriteLock`（`semantic-object-store.ts:78-105`）
- `upsertSemanticObject`（`:207`）按 `tenantId` + `objectKey` 防冲突
- `deleteSemanticObject`（`:259`）
- `ensureSemanticObjectDemoCatalog`（`:361`）只播种目录样例，且 demo 无 source bindings

**字段契约（`semantic-object-types.ts`）：**

- Store：`version` + `semanticObjects` 映射。
- `SemanticObject`：`objectId`、`tenantId`、`objectKey`（租户内稳定 slug）、`displayName`、`kind`（customer/order/product/inventory/employee/contract/invoice/custom）、`description`、`fields[]`、`sourceBindings[]`、`lifecycle`（draft/active/deprecated）、可选 `seedOrigin: "demo"`、`createdAt`/`updatedAt`/`createdBy`。
- `SemanticField`：`fieldKey`、`displayName`、`type`、可选 `description`、`classification`（对接脱敏）、`referenceObjectKey`、`required`。
- `SemanticObjectSourceBinding`：`bindingId`、`sourceId`、`action`（ConnectorActionRef）、`fieldMappings`（`fieldKey` ← `sourceFieldPath`）、可选 `capabilityId`、`primary`。

绑定里的 `sourceId`/`action` 指向企业 store 中的数据源与动作，**不得**在此文件存放连接串、OAuth token 或 apiKey。凭证只在 connector credential vault。

**禁止双写：** 不建议 Knowledge SDK、第二份 JSON、或 EnterpriseDataStore 再写一份 Semantic Object 权威副本。本波次若做 VB-3，只允许只读脱敏导出适配器（读上述 store，不写回）。

---

## `data-capability-tool.ts` knowledge-object-only（保持关闭）

`createDataCapabilityTool`（`src/agents/tools/data-capability-tool.ts:54`）在 `action === "invoke"` 时（`:99-108`）固定返回：

- `ok: false`
- `reason: "knowledge-object-only"`
- 说明：Agent Runtime 只消费 Knowledge Objects，不请求 `ConnectorAction`；应使用 knowledge search / `knowledge.cognitive.bundle`；员工执行仍走 `enterprise-data.invoke`。

`action === "list"` 仍可列出能力与 access state，不执行连接器。本波次 **不修改** 这段 Fail-Closed。

### 未来若解锁 Mode A/B/C 受控桥，必须先满足的安全门（仅列举，不解锁）

这些是请求安全/契约对齐的前置条件，不是本包授权：

1. 书面安全审批，明确解除范围（仍禁止 MVP 自由 Text-to-SQL）。
2. 团队 A VA-1 契约已发布且 SHA-256 互认（Mode A/B/C、`policy_generation`、`masking_receipt`、`freshness_ts`、`tombstone`）。未声明 Mode 或缺失有效 `policy_generation` 必须 100% 拒绝。
3. Mode A：仅用户委派透传，不得改用租户共享秘钥冒充用户。Mode B：租户受控服务凭证 **加上强制行级谓词**（现有 `sql-read-guard` 只限制语句类型，**不够**）。Mode C：仅离线受控物化快照，带 freshness 与 tombstone。
4. 可信执行上下文（已有 `assertTrustedExecutionContext` + seat/employee）不得削弱；跨租户必须失败关闭。
5. 出站结果必须走分类脱敏（已有 `applyClassificationMasking`），并保留 masking receipt；高风险审计失败要 fail-closed（已有部分实现）。
6. `data-capability-tool` 的 `invoke` 在上述门未全部落地并测试证明之前，必须保持 knowledge-object-only；即使将来开桥，也不得变成自由 Text-to-SQL。
7. 不得为解锁而把 Semantic Object 与连接器配置双写，或把凭证写入 catalog 字段。
8. 生产连接器不得重新打开「失败则 mock」的回退。

---

## 过渡 10 字段总览（本专项）

| # | 字段 | 本报告落点 |
|---|---|---|
| 1 | 标识 | 上表各 `connectorId`；写主文件名；工具 `knowledge-object-only` |
| 2 | 源码位置 | 已列 file:line |
| 3 | 公开面 | ConnectorAction + Data Gateway + Agent list 工具 |
| 4 | 鉴权 | 可信 seat 上下文、凭证保险库、Demo 与生产分流 |
| 5 | 默认开/关 | 生产连接器按需安装；tool invoke 默认关；Salesforce/SAP 默认 demo |
| 6 | 真实 vs mock | 上表 |
| 7 | 执行/持久化 | `executeConnectorHandlerAsync` → 驱动/HTTP；审计与凭证库；SO 目录单独 JSON |
| 8 | 计费/审计 | 调用/数据审计；非 LLM 主计费；凭证轮换仅保险库 |
| 9 | Fail-Closed | 生产禁 mock；无 seat 拒绝；SQL 只读守卫；tool invoke 关闭 |
| 10 | 建议与禁止 | 不双写；不解锁 tool invoke；不把 Demo 标成生产驱动 |
