# Stream B：Enterprise Data Boundary（官方第 7 节 10 字段重出）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：**官方字段重出**，不是 Wave-V21-0 正式验收，也不是 v2.1 基线签认。
- 字段来源：`MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE.md`（SHA-256 `c5196ff1d050ac6477cc064390a708a4d10121cf7fe300bb24764a87a2a5b1c2`）第七节官方 10 项中文字段（只用这些中文名）。外加项：逐连接器区分生产可用真实驱动 vs Demo/Mock；锁定 Semantic Object 唯一写主；维持 `data-capability-tool.ts` `knowledge-object-only` Fail-Closed；列出未来解锁 Mode A/B/C 的安全门禁。本波次 **不解锁** Mode A/B/C，**不双写** Semantic Object。
- 技术事实复用自过渡报告 `STREAM_B_ENTERPRISE_DATA_AUDIT.md`（SHA-256 `39a4188bd787dc60ca81706122c5c54e4fd8521ae08fa0ddbbe6a3429ebaafe3`），并在 `f0fccbd3` 产品树上复核。`knowledge-object-only` 仍位于 `action === "invoke"`（`data-capability-tool.ts:99`），`reason: "knowledge-object-only"` 在 `:105`。目录分档仍在 `connector-catalog.ts`：Salesforce/SAP `integrationTier: "demo"`（`:35` / `:46`），Postgres/MySQL/HTTP REST/Notion/用友 T+ 为 `"production"`。写主文件名常量仍为 `semantic-object-store.ts:25`。过渡报告原文保留。

官方 10 项字段（原文）：1. 文件路径与代码入口 2. 核心对象与数据表/存储文件 3. API / RPC / Event 契约 4. 当前权威写主 5. 已实现且稳定功能 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 7. 已完成的测试证据 8. 未覆盖的测试场景 9. 与另一仓库的重复点 10. 保留/扩展/迁移/废弃裁定

## 结论摘要

1. 生产可用真实驱动（沿真实调用链，需凭证）：PostgreSQL、MySQL、HTTP REST、Notion、用友 T+。目录均为 `integrationTier: "production"`，适配器动态加载真实驱动或对外 HTTP，而不是失败即 mock。
2. Demo/Mock 默认路径：Salesforce、SAP ERP 目录为 `"demo"`；无凭证时走 mock-handlers；**若绑定真实凭证，适配器可对真实租户 HTTP/OData 调用**（不得把默认 Demo 说成已是生产驱动）。
3. Semantic Object 目录唯一写主仍是 `openbot-enterprise-semantic-objects.json`。禁止双写。
4. `data-capability-tool` 的 `invoke` 保持 knowledge-object-only Fail-Closed，本波次不修改。
5. Mode A/B/C 解锁所需安全门仅列举，不构成授权。

## 执行主路径（所有 live 连接器终点）

过渡报告已穿透：目录 → connector package / demo package → runtime registry → `executeConnectorHandlerAsync` → 适配器（`pg` / `mysql2` / `fetch` / 畅捷通 HTTP）。凭证只在 connector credential vault，不在 Semantic Object catalog。本轮复核目录分档与 tool invoke 关闭点，未重跑连接器集成测试。

## 逐连接器（官方 10 字段）

| 连接器 | 1. 文件路径与代码入口 | 2. 核心对象与数据表/存储文件 | 3. API / RPC / Event 契约 | 4. 当前权威写主 | 5. 已实现且稳定功能 | 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 | 7. 已完成的测试证据 | 8. 未覆盖的测试场景 | 9. 与另一仓库的重复点 | 10. 保留/扩展/迁移/废弃裁定 |
|---|---|---|---|---|---|---|---|---|---|---|
| PostgreSQL `db-postgres` | `connector-catalog.ts:75-78` `production`；`connector-postgres-package.ts`；`adapters/postgres.ts`（动态 `import("pg")`） | 外部 Postgres；本仓不持有业务行副本 | Action `db.query.read@v1`；只读 SQL | 业务数据写主在客户库；OpenBot 只持凭证与审计 | 生产级只读 SQL 取数（建议只读角色） | 无凭证则不可冒充成功；生产禁 mock 回退 | 过渡报告记载适配器级测试存在；本轮未重跑 | 行级谓词（Mode B）尚未作为解锁证据 | 禁止 SDK 另建一套 Postgres 连接器 | **保留** 为生产驱动；不迁移写主到 SDK |
| MySQL `db-mysql` | 目录 `:86-89` `production`；`connector-mysql-package.ts`；`adapters/mysql.ts`（动态 `import("mysql2/promise")`） | 外部 MySQL | Action `db.query.read@v1` | 同 Postgres | 生产级只读 SQL | 同 Postgres | 本轮未重跑 | 同 Postgres | 同左 | **保留** |
| HTTP REST `http-rest` | 目录 `:64-67` `production`；`connector-http-rest-package.ts`；`adapters/http-rest.ts` | 外部 HTTP 资源；本仓不存业务行 | Action `external.resource.read@v1`；Bearer/Basic/header/query/none | 外部系统为数据写主 | 生产级只读取数与可选健康检查 | 无凭证/非法方法失败关闭 | 本轮未重跑 | 出站脱敏回执未作为本专项新鲜证据 | 禁止 SDK 隐式直连 | **保留** |
| Notion `notion` | 目录 `:54-57` `production`；`connector-notion-package.ts`；`adapters/notion.ts` `fetch("https://api.notion.com/v1/search")` | Notion 云端页面/数据库 | 包内注册的 search 类 Action；需 `oauthAccessToken` | Notion 为内容写主 | 生产 OAuth + 真实 HTTP search | 无 OAuth 不得伪造成功 | 本轮未重跑 | 撤权后 token 失效链路未在本专项重跑 | 不在 SDK 再实现 Notion 连接器 | **保留** |
| 用友 T+ `erp-yonyou-tplus` | 目录 `:97-100` `production`；`connector-yonyou-tplus-package.ts`；`adapters/yonyou-tplus.ts`（畅捷通 HTTP，可 refresh 并写回保险库） | 畅捷通云端业务对象 | 仓库/存货/往来/销售订单等 handlerRef | 用友/畅捷通为 ERP 写主；refresh token 只写回 OpenBot 保险库 | 生产 OAuth + 真实 API 读取 | 无凭证失败关闭；禁止失败转 mock | 本轮未重跑 | 令牌轮换失败注入未作为本专项新鲜证据 | 禁止 SDK 复制 ERP 适配器 | **保留** |
| Salesforce `crm-salesforce` | 目录 `:32-35` **`demo`**；`ensureConnectorDemoPackage` / `connector-demo-packages.ts`；`adapters/salesforce.ts` | Demo 种子或 Salesforce 云端（仅当有 OAuth） | Demo 包动作；适配器可走 REST limits/查询 | 无凭证时为 Demo 数据；有凭证时 Salesforce 为 CRM 写主 | 默认 Demo/Mock；可选真实 HTTP | **不得**把默认 Demo 标成生产驱动 | 本轮未重跑 | 生产切档所需安全验收未做 | 禁止当作已生产就绪连接器对外承诺 | **保留 Demo 分档**；未授权不得升为 production |
| SAP ERP `erp-sap` | 目录 `:43-46` **`demo`**；demo 播种；`adapters/erp-sap.ts`（OData 风格，文件头说明可对真实租户调用） | Demo 或外部 SAP | Demo 包订单状态动作 | 无凭证=mock；有凭证=SAP 为写主 | 默认 Demo/Mock；可选真实 OData | 同 Salesforce | 本轮未重跑 | 同 Salesforce | 同左 | **保留 Demo 分档** |

## Semantic Object 唯一写主

- 文件名（锁定）：`openbot-enterprise-semantic-objects.json`
- 默认路径：`path.join(CONFIG_DIR, "openbot-enterprise-semantic-objects.json")`（`semantic-object-store.ts:25-67`）
- 写 API：`saveSemanticObjectStore` / `upsertSemanticObject` / `deleteSemanticObject`。只存目录元数据，不存业务行，不写入 `EnterpriseDataStore`。
- **禁止双写。** 本波次 VB-3 只允许默认关闭的只读适配器。

## `data-capability-tool.ts` knowledge-object-only（保持关闭）

`createDataCapabilityTool`（`:54`）在 `action === "invoke"`（`:99-108` 区间，`reason` 在 `:105`）固定返回 `ok: false`、`reason: "knowledge-object-only"`，说明 Agent Runtime 只消费 Knowledge Objects，不请求 ConnectorAction。`list` 仍可列出能力。本波次 **不修改** 这段 Fail-Closed。

### 未来若解锁 Mode A/B/C 必须先满足的安全门（仅列举，不解锁）

1. 书面安全审批，明确解除范围（仍禁止 MVP 自由 Text-to-SQL）。
2. 团队 A 契约已互认（Mode A/B/C、`policy_generation`、`masking_receipt`、`freshness_ts`、`tombstone`）；缺 Mode 或无效 `policy_generation` 必须 100% 拒绝。本轮契约清单哈希已独立复算为 `6da567e0…`，但 Mode 解锁仍未授权。
3. Mode A 仅用户委派透传；Mode B 租户受控凭证 **加强制行级谓词**（现有 `sql-read-guard` 只限语句类型，不够）；Mode C 仅离线受控快照，带 freshness 与 tombstone。
4. 可信执行上下文不得削弱；跨租户失败关闭。
5. 出站必须分类脱敏并保留 masking receipt；高风险审计失败 fail-closed。
6. `invoke` 在上述门未全部落地并测试证明前，必须保持 knowledge-object-only。
7. 不得为解锁而双写 Semantic Object 或把凭证写入 catalog。
8. 生产连接器不得重新打开「失败则 mock」回退。

## 本专项字段 7–8 总述

本重出不附新鲜集成通过数，不宣称 Mode A/B/C 已可开。未覆盖：强制行级谓词、解锁后的桥接负面用例、把 Demo 连接器误标生产的验收门。
