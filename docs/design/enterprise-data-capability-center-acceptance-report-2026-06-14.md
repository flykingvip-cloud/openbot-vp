# 企业数据能力中心 — 连接器与 OAuth 阶段验收报告（2026-06-14）

> **验收状态：待专家团队验收**  
> **Spec 追踪**：`.kiro/specs/enterprise-data-capability-center/tasks.md` **Phase 6–7**（2026-06-14 增补）  
> **分支上下文**：`codex/openbot/localization-workspace`  
> **Git 归档**：**已完成** — spec Task **7.5**（3 个 stream commit，`cursor-edc-connector`）

---

## 〇、可追溯性说明（回应专家评审）

本报告早期版本使用「Phase A/B/C + Notion OAuth」分层用语，与 spec 原有 **Phase 0–5**（首页 dashboard / RPC / 图谱 / 子导航）**编号不对应**。现已对齐如下：

| 报告旧用语              | Spec 任务   | 主题                                      |
| ----------------------- | ----------- | ----------------------------------------- |
| Phase A                 | **6.1**     | 连接器目录与演示包                        |
| Phase B（凭证）         | **6.2**     | 凭证体系与 Salesforce live                |
| Phase B（投影）         | **6.3**     | 投影工作室物化 UI                         |
| Phase C（刷新/Gateway） | **6.4**     | 子导航刷新 + Async Data Gateway           |
| Phase C（按需物化）     | **6.5**     | 知识宇宙 `on_demand` 物化                 |
| Phase 6 测试            | **6.6**     | 自动化测试守护                            |
| Notion OAuth            | **7.1–7.4** | OAuth 基础设施 / Notion 适配 / RPC / 前端 |
| 未 commit               | **7.5**     | Git 归档（待办）                          |
| 已知限制                | **7.6**     | Refresh token / 跨域 / E2E（待办）        |

**验收标准来源**：下文各节 checkbox 已改写为 **spec Task 6.x / 7.x 派生**；完整任务描述与文件锚点以 `tasks.md` 为准。

**Agent 签名**：`tasks.md` → `## Agents` 表，`cursor-edc-connector` · owner · Phase 6–7。

---

## 一、执行摘要

本阶段在 spec **Phase 0–5**（企业数据能力中心首页与子导航）之上，按 **Phase 6–7** 完成**从「演示 Mock」到「可绑定凭证 + 真实探测 + OAuth 授权」**的纵向打通：

| Spec        | 主题                      | 核心交付                                                           |
| ----------- | ------------------------- | ------------------------------------------------------------------ |
| **Phase 6** | 连接器、凭证、live 运行时 | Catalog、凭证库、Salesforce、投影物化 UI、Async Gateway、on_demand |
| **Phase 7** | Notion OAuth2             | OAuth 会话、HTTP 回调、模拟/真实双模式、前端授权                   |

**自动化验证**（Task 6.6）：`enterprise-data` 相关测试 **24 个文件 / 118 条用例全部通过**。

---

## 二、Spec 任务交付对照与验收标准

> 每项 `[x]` 对应 `tasks.md` 中同名 Task 的 **验收** 子 bullet。

### 2.1 Task 6.1 — 连接器目录与演示包

#### 交付物

| 模块                | 路径                                                                            | 说明                                                                              |
| ------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 连接器目录定义      | `src/gateway/enterprise-data/connector-catalog.ts`                              | 内置 `crm-salesforce`（演示）、`erp-sap`（演示）、`notion`（生产）                |
| 演示包种子          | `src/gateway/enterprise-data/connector-demo-packages.ts`                        | CRM/ERP Mock Action + Handler                                                     |
| 连通性探测          | `src/gateway/enterprise-data/source-connection-probe.ts`                        | 统一探测入口，区分 mock / live / 缺包 / 缺凭证                                    |
| Handler 运行时      | `src/gateway/enterprise-data/connector-handler-runtime.ts`                      | 按连接器路由 live handler                                                         |
| M6 RPC              | `src/gateway/server-methods/enterprise-data-m6.ts`                              | `connectors.catalog`、`connectors.ensure-demo-package`、`sources.test-connection` |
| 前端 Gateway Client | `ui/src/ui/controllers/enterprise-data-capability/gateway-client.ts`            | 封装上述 RPC                                                                      |
| 数据源弹窗 UI       | `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts` | 连接器下拉、安装包、测试连通性                                                    |

#### 验收标准（已达成）

- [x] 企业管理员可通过 RPC `enterprise-data.connectors.catalog` 获取连接器列表，含 `registeredActionCount`、`runtimeHandlerCount`、`ready` 状态。
- [x] 演示连接器（`integrationTier: "demo"`）支持一键 `ensure-demo-package`，安装后 `ready === true`。
- [x] `sources.test-connection` 对未安装包的连接器返回 `actions_missing`；安装演示包后返回 `mock_smoke_ok`。
- [x] UI 数据源新增/编辑弹窗可选择连接器、安装演示包、测试连通性并保存数据源。
- [x] 非管理员租户伪造 / 越权调用被拒绝（M6 测试覆盖）。

---

### 2.2 Task 6.2 — 凭证体系与 Salesforce live adapter

#### 交付物

| 模块                | 路径                                                        | 说明                                                        |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| 凭证类型与 Store v5 | `src/gateway/enterprise-data/types.ts`、`store.ts`          | `DataConnectorCredential`，`dataConnectorCredentials` 映射  |
| 凭证 CRUD           | `src/gateway/enterprise-data/connector-credential-store.ts` | list / upsert / revoke                                      |
| 密钥保险库          | `src/gateway/enterprise-data/connector-credential-vault.ts` | 密钥存 `openbot-enterprise-data-secrets.json`，与元数据分离 |
| Salesforce Adapter  | `src/gateway/enterprise-data/adapters/salesforce.ts`        | live probe + handler                                        |
| 数据源绑定凭证      | `src/gateway/enterprise-data/data-source-store.ts`          | `DataSource.credentialId`                                   |
| M6 RPC              | `enterprise-data.connector-credentials.list/upsert/revoke`  | 管理员凭证管理                                              |

#### 验收标准（Task 6.2，已达成）

- [x] 凭证元数据写入 Enterprise Data Store，密钥写入独立 secrets 文件，列表仅返回 `secretHint`。
- [x] `crm-salesforce` 绑定 API Key 后 `test-connection` → `live_probe_ok` / `live_probe_failed`。
- [x] OAuth2 连接器不支持 inline `apiKey` 探测。
- [x] `connector-credential-store.test.ts`、`adapters/salesforce.test.ts`、M6 凭证 RPC 测试通过。

---

### 2.3 Task 6.3 — 投影工作室物化 UI

#### 交付物

| 模块           | 路径                                           | 说明                                                                         |
| -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| 投影工作室子段 | `enterprise-data-governance-center-surface.ts` | specs / bindings 列表 + 立即物化                                             |
| Gateway Client | `gateway-client.ts`                            | `listProjectionSpecs`、`listProjectionBindings`、`runProjectionMaterializer` |

#### 验收标准（Task 6.3，已达成）

- [x] 「投影工作室」Tab 可列出 spec/binding 并触发 `projection-materializer.run`。
- [x] `projection-materializer.test.ts` 通过。

---

### 2.4 Task 6.4 — 刷新保持子导航 + Async Data Gateway

#### 交付物

| 模块               | 路径                                           | 说明                                             |
| ------------------ | ---------------------------------------------- | ------------------------------------------------ |
| 刷新保持分区       | `enterprise-data-governance-center-surface.ts` | 保留 `activeSection` + `ensureSectionDataLoaded` |
| Async Data Gateway | `src/gateway/enterprise-data/data-gateway.ts`  | 有凭证时路由 live adapter                        |

#### 验收标准（Task 6.4，已达成）

- [x] 子页刷新不跳回首页。
- [x] 带凭证 invoke 走 Salesforce/Notion live handler。
- [x] `data-gateway.test.ts` 通过。

---

### 2.5 Task 6.5 — 知识宇宙 on_demand 按需物化

#### 交付物

| 模块     | 路径                                                              | 说明                                         |
| -------- | ----------------------------------------------------------------- | -------------------------------------------- |
| 按需物化 | `src/gateway/knowledge/feed/on-demand-projection-materializer.ts` | bundle 加载时物化 `on_demand` binding        |
| 接入点   | `src/gateway/knowledge/source-bundle.ts`                          | 调用 `ensureOnDemandProjectionsMaterialized` |

#### 验收标准（Task 6.5，已达成）

- [x] enabled `on_demand` binding + 可见性满足时自动产生 feed（单次最多 3，best-effort）。
- [x] `on-demand-projection-materializer.test.ts` 通过。

---

### 2.6 Task 6.6 — 自动化测试守护

- [x] `enterprise-data/` + M6 + on-demand：**24 文件 / 118 用例**全部通过（见第四节）。

---

### 2.7 Task 7.1–7.4 — Notion OAuth2 生产连接器

#### 交付物

| 模块        | 路径                                                                | 说明                                                 |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| OAuth 会话  | `connector-oauth*.ts`                                               | 独立 `openbot-enterprise-data-oauth-sessions.json`   |
| Notion 适配 | `adapters/notion-oauth.ts`、`adapters/notion.ts`                    | authorize / exchange / live search                   |
| 连接器包    | `connector-notion-package.ts`、`connector-packages.ts`              | `oa.kb.search@v1`                                    |
| HTTP 回调   | `connector-oauth-http.ts`                                           | `/__openbot/enterprise-data/oauth/callback`          |
| M6 RPC      | `enterprise-data-m6.ts`                                             | oauth.start/status/simulate-complete、ensure-package |
| 前端        | `gateway-client.ts`、`enterprise-data-governance-center-surface.ts` | OAuth 授权 + URL 回调恢复                            |

#### 架构约定

- 运营身份 OAuth 与数据连接器 OAuth **完全分离**。
- 未配置 Client ID/Secret 时降级 **`simulated`** 模式。

#### 环境变量

| 变量                                                                                  | 说明          |
| ------------------------------------------------------------------------------------- | ------------- |
| `OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_ID` / `OPENBOT_NOTION_OAUTH_CLIENT_ID`         | Client ID     |
| `OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_SECRET` / `OPENBOT_NOTION_OAUTH_CLIENT_SECRET` | Client Secret |
| `OPENBOT_ENTERPRISE_DATA_NOTION_REDIRECT_URI`                                         | 可选          |

#### OAuth 回调 URL 参数

| 参数                          | 含义                 |
| ----------------------------- | -------------------- |
| `dataConnectorOAuth`          | `success` \| `error` |
| `dataConnectorOAuthSessionId` | 会话 ID              |
| `dataConnectorOAuthMessage`   | 可选错误信息         |

#### 验收标准（Task 7.1–7.4，已达成）

- [x] `ensure-package` 安装 Notion Action + Handler，`catalog.ready === true`。
- [x] `oauth.start` 无 Client 配置时 `simulateAllowed: true`。
- [x] `oauth.simulate-complete` 创建 `oauth2` 凭证；模拟探测 `live_probe_ok`。
- [x] HTTP 回调已注册；UI OAuth 授权 + 轮询 + URL 恢复。
- [x] `connector-oauth.test.ts`、`connector-catalog.test.ts`、M6 OAuth 用例通过。

---

### 2.8 Task 7.5–7.6 — 待办（阻断/后续）

| Task             | 状态    | 说明                                          |
| ---------------- | ------- | --------------------------------------------- |
| **7.5 Git 归档** | ✅ 完成 | 3 个 stream commit 已落地（见 spec Task 7.5） |
| **7.6 已知限制** | ⏳ 待办 | Refresh token、跨域回调、Playwright OAuth E2E |

---

## 三、新增 / 扩展 RPC 清单

| RPC 方法                                                        | 权限 | 用途                           |
| --------------------------------------------------------------- | ---- | ------------------------------ |
| `enterprise-data.connectors.catalog`                            | 读   | 连接器目录与就绪状态           |
| `enterprise-data.connectors.ensure-demo-package`                | 写   | 安装演示连接器包               |
| `enterprise-data.connectors.ensure-package`                     | 写   | 统一安装（演示 + Notion 生产） |
| `enterprise-data.sources.test-connection`                       | 读   | 连通性探测                     |
| `enterprise-data.connector-credentials.list`                    | 读   | 列出凭证                       |
| `enterprise-data.connector-credentials.upsert`                  | 写   | 创建/更新 API Key 凭证         |
| `enterprise-data.connector-credentials.revoke`                  | 写   | 吊销凭证                       |
| `enterprise-data.connector-credentials.oauth.start`             | 写   | 启动 OAuth 会话                |
| `enterprise-data.connector-credentials.oauth.status`            | 读   | 查询 OAuth 会话状态            |
| `enterprise-data.connector-credentials.oauth.simulate-complete` | 写   | 模拟完成 OAuth（开发模式）     |

---

## 四、自动化测试证据

### 4.1 执行命令

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/enterprise-data/ \
  src/gateway/server-methods/enterprise-data-m6.test.ts \
  src/gateway/knowledge/feed/on-demand-projection-materializer.test.ts
```

### 4.2 结果（2026-06-14 本地执行）

```
Test Files  24 passed (24)
Tests       118 passed (118)
```

### 4.3 与本阶段直接相关的关键用例

| 测试文件                                    | 覆盖点                                      |
| ------------------------------------------- | ------------------------------------------- |
| `connector-catalog.test.ts`                 | 目录、演示包、Notion 装包 + 模拟 OAuth 探测 |
| `connector-oauth.test.ts`                   | OAuth 会话启动、模拟完成、凭证落库          |
| `connector-credential-store.test.ts`        | 凭证 CRUD                                   |
| `adapters/salesforce.test.ts`               | Salesforce live 探测                        |
| `data-gateway.test.ts`                      | Async invoke + 凭证路由                     |
| `projection-materializer.test.ts`           | 投影物化                                    |
| `on-demand-projection-materializer.test.ts` | 知识宇宙按需物化                            |
| `enterprise-data-m6.test.ts`                | Dashboard RPC、凭证、OAuth、ensure-package  |

---

## 五、专家验收 — 建议手动场景

### 场景 1：演示 CRM 端到端（无需外部 API）

1. 以企业管理员登录 → 企业数据能力中心 → **数据源管理** → 新增数据源。
2. 选择 **Salesforce CRM（演示）** → **安装连接器包** → **测试连通性**（预期成功，`mock_smoke_ok`）。
3. 保存数据源，列表中可见新记录。

### 场景 2：Salesforce 生产凭证（需有效 Instance URL + Token）

1. 新建凭证：填写名称、Instance URL、Access Token。
2. 测试连通性（预期 `live_probe_ok` 或明确的 `live_probe_failed` 错误信息）。
3. 保存数据源并绑定凭证。

### 场景 3：Notion OAuth（模拟模式，无需 Notion 应用）

1. 选择 **Notion** → **安装连接器包**（预期 1 个 Action）。
2. 数据连接器凭证 →「+ 新建凭证」→ 填写名称 → **OAuth 授权**。
3. 未配置环境变量时自动模拟完成；测试连通性预期 `live_probe_ok`。
4. 保存数据源。

### 场景 4：Notion OAuth（真实模式，需 Notion Integration）

1. 配置 `OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_ID/SECRET`，重启 Gateway。
2. OAuth 授权应打开 Notion 授权页；回调后 URL 带 `dataConnectorOAuth=success`。
3. 编辑器自动选中新建凭证，测试连通性应对真实 API。

### 场景 5：投影工作室与按需物化

1. **投影工作室** Tab：查看 Spec / Binding，对 Binding 执行「立即物化」。
2. 配置 `on_demand` binding 后，在知识宇宙中加载 bundle，验证 feed 自动出现（最多 3 条/次）。

### 场景 6：分区刷新

1. 进入「投影工作室」或「数据源管理」→ 点击顶部 **刷新**。
2. 预期：停留在当前子导航，数据重载，不跳回首页。

---

## 六、已知限制与待办（Spec Task 7.5–7.6）

| Task             | 项                   | 说明                        |
| ---------------- | -------------------- | --------------------------- |
| **7.5 Git 归档** | ✅ 已完成            | 3 stream commits on branch  |
| **7.6**          | Notion Refresh Token | 仅持久化 `oauthAccessToken` |
| **7.6**          | 跨域 OAuth 回调      | 需显式 `REDIRECT_URI`       |
| **7.6**          | Playwright E2E       | OAuth 弹窗流程未覆盖        |
| **7.6**          | 多生产连接器         | 除 Notion 外需按同模式扩展  |

---

## 七、主要变更文件清单（本执行范围）

### 后端（Gateway / Enterprise Data）

```
src/gateway/control-ui-contract.ts
src/gateway/control-ui.ts
src/gateway/enterprise-data/connector-oauth-http.ts
src/gateway/server-methods/enterprise-data-m6.ts
src/gateway/server-methods-list.ts
src/gateway/method-scopes.ts
src/gateway/enterprise-data/connector-catalog.ts
src/gateway/enterprise-data/connector-demo-packages.ts
src/gateway/enterprise-data/connector-packages.ts
src/gateway/enterprise-data/connector-notion-package.ts
src/gateway/enterprise-data/connector-oauth.ts
src/gateway/enterprise-data/connector-oauth-types.ts
src/gateway/enterprise-data/connector-oauth-session-persistence.ts
src/gateway/enterprise-data/connector-credential-store.ts
src/gateway/enterprise-data/connector-credential-vault.ts
src/gateway/enterprise-data/connector-handler-runtime.ts
src/gateway/enterprise-data/source-connection-probe.ts
src/gateway/enterprise-data/data-gateway.ts
src/gateway/enterprise-data/data-source-store.ts
src/gateway/enterprise-data/store.ts
src/gateway/enterprise-data/types.ts
src/gateway/enterprise-data/mock-handlers.ts
src/gateway/enterprise-data/adapters/salesforce.ts
src/gateway/enterprise-data/adapters/notion.ts
src/gateway/enterprise-data/adapters/notion-oauth.ts
src/gateway/knowledge/feed/on-demand-projection-materializer.ts
src/gateway/knowledge/source-bundle.ts
```

### 前端（UI）

```
ui/src/ui/controllers/enterprise-data-capability/gateway-client.ts
ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts
```

### 测试

```
src/gateway/enterprise-data/connector-catalog.test.ts
src/gateway/enterprise-data/connector-oauth.test.ts
src/gateway/enterprise-data/connector-credential-store.test.ts
src/gateway/enterprise-data/adapters/salesforce.test.ts
src/gateway/enterprise-data/data-gateway.test.ts
src/gateway/enterprise-data/projection-materializer.test.ts
src/gateway/knowledge/feed/on-demand-projection-materializer.test.ts
src/gateway/server-methods/enterprise-data-m6.test.ts
（及 enterprise-data 目录下其余既有测试，共 118 条）
```

---

## 八、验收结论（执行方自评）

| 维度              | 结论                                                        |
| ----------------- | ----------------------------------------------------------- |
| **Spec 可追溯性** | Phase 6–7 已写入 `tasks.md`；本报告与 Task 6.x/7.x 一一对应 |
| **功能完整性**    | Task 6.1–6.5、7.1–7.4、7.5 已达成；7.6 为后续迭代           |
| **安全性**        | 凭证密钥与元数据分离；OAuth 会话独立；管理员 scope 校验     |
| **可测试性**      | 118 条自动化测试通过；模拟 OAuth 支持无外部依赖验收         |
| **待专家确认**    | 真实 Notion OAuth E2E、Task 7.5 commit 归档                 |

---

**报告版本**：v2（2026-06-14，补齐 spec Phase 6–7 可追溯性）  
**执行角色**：`cursor-edc-connector`（见 `tasks.md` Agents 表）  
**提交验收**：本文件 + `tasks.md` Phase 6–7 + `pnpm test` 输出
