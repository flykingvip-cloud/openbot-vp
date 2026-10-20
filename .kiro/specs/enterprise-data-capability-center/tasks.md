# Implementation Plan: 企业数据能力中心（Enterprise Data Capability Center）

> **v2（已纳入专家评审反馈）**：本版相对 v1 的核心调整——
>
> 1. **前端状态改走 module-local surface controller**（对齐 `enterprise-capability-center-surface.ts`），
>    不再膨胀 `EnterprisePortReadModel`。
> 2. **首期收缩为「真首页 MVP」**：仅落 `dashboard.summary` + 审批面板 + 数据源健康面板 + 重命名 + IA 替换；
>    DataAuthorizationOverview / CapabilityUsageBoard / 图谱推迟到**契约补齐**后。
> 3. **后端新增 RPC 从 2 个增加到 3~4 个**（授权卡聚合、能力行聚合、图谱聚合），消除前端 N+1 拼装与语义缺口。
> 4. **图谱不复用知识宇宙 layout/model**（节点种类与中心辐射布局不匹配），改为 enterprise-data 专用
>    view model + 列式四层布局，仅复用 SVG 渲染。
> 5. **KPI「知识供给」重新定标**（feedItemCount=产出对象数，非通道数）；**授权/图谱不只按 department 建模**
>    （纳入 seat/role，seat 才是唯一可编译执行粒度）；**「查看全部能力」不再跳企业能力中心**（语义断层）。

## 决策结论（P1 已签署，作为 P2/P3 设计基线）

- **决策 1（岗位）**：暂取 `role`（P2 授权卡同时展示 seat 与 role）；如团队改判 `seat` 在 Task 1.8 前提出。
- **决策 2（数据能力 vs 能力资产）**：首页「查看全部能力」**不跳** `enterpriseCapabilityCenter`，指向本模块「数据能力目录」二级页（Phase 4）。
- **决策 3（KPI 知识供给）**：定标为「**知识对象数**」(`knowledgeObjectCount` = `feedItemCount`)。
- **决策 4（授权卡 a vs b）**：在不引入新组织存储的前提下，先以现有 `seat.roleCode + seat.teamLabel`
  收口 `department` 解析：seat 保持权威 title；role 仍按 roleCode 分组计数并标注「非精确」；
  department 现已作为真实 target 展示 `label + count + precise`，不再仅披露 `departmentPolicyCount`。
  运行时边界不变：**seat 仍是唯一可编译执行粒度**；department 仅用于治理展示与 policy-backed grant 匹配。
- **字段数 vs 卡片数（口径统一）**：`DataCapabilityDashboardSummary` 返回 **6 个字段**——
  `totalDataSources` / `totalCapabilities` / `totalDepartments` / `knowledgeObjectCount` /
  `enabledBindingCount` / `pendingApprovals`；**首页 MetricsOverviewCards 只展示 5 张卡**
  （数据源 / 数据能力 / 开放部门 / 知识对象数 / 待审批）。`enabledBindingCount` 为**备用字段**
  （供 KPI 文案在「产出规模 ↔ 供给通道」间切换），**不单独占卡**。实现见
  `ui/src/ui/capability/enterprise-data-capability/types.ts` 与
  `src/gateway/enterprise-data/dashboard-summary-store.ts`。

## Overview

本实施计划聚焦**前端落地**：将既有「数据治理与供给中心」(`enterpriseDataGovernanceCenter`)
重命名并整屏重写为一级模块「**企业数据能力中心**」，呈现「数据资产 → 能力 → 知识 → 部门/岗位」
企业数据价值链。当前该一级页只展示运营身份/数据源绑定/Seat 覆盖（见
`ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts:162`、
`ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts:241`），整屏替换比新开模块更稳。

后端 `src/gateway/enterprise-data/`（M1–M5）已就绪，但**首页所需的聚合/计数字段大多不存在**，
故本计划以「**模块重命名 + 3~4 个首页聚合 RPC + module-local surface controller + 缩小首期字段集**」推进，
而非「2 个 RPC + 大量前端拼装」。

### 技术栈锁定（不引入新栈）

- lit-html + TypeScript + `GatewayBrowserClient`（对齐 `ui/src/ui/controllers/enterprise-data-source-governance.ts`）。
- **前端状态**：module-local 可变 surface state + `ManagedControllerState<T>` 的 load-once，
  对齐 `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts:99-218`。**不扩展 read-model**。
  - **Surface key 必须按 `tenantId + client 实例` 复合键**（对齐 `buildSurfaceKey`
    `enterprise-capability-center-surface.ts:439-453`：WeakMap 给每个 client 实例分配 id，离线回退 `::offline`）；
    **禁止只用 tenantId**，否则重连/换 session（同租户）会保留陈旧 `loaded/error/data`。
  - **异步状态更新后必须显式触发重渲染**：复用 `refreshEnterpriseSurface()` 模式
    （`enterprise-capability-center-surface.ts:284-290`：`window.dispatchEvent(new PopStateEvent("popstate"))`）。
    每个 `load/refresh/openNode/closeNode` 的成功与失败分支都要调用，否则页面不会重画。
- **图谱**：自建 enterprise-data 专用 view model + 列式四层布局；仅复用 SVG 渲染原语，
  **不复用**知识宇宙的 `GraphViewModel`/`buildHomeGraphViewModel`（节点种类只有
  knowledge/data/agent/project/owner，布局为中心辐射，见
  `ui/src/ui/capability/knowledge-universe/types.ts:79-104`、`graph-layout.ts:25-103`）。**不引入第三方图库**。
- 不修改既有后端 RPC 契约；新增 RPC 一律 `enterprise-data.*` 前缀且**只读**。

### 必须先拍板的前置决策（阻断文案/跳转/计数口径）

> **门禁**：决策 3 是 **Phase 1 的硬前置**（`dashboard.summary` 字段名与 KPI 文案直接依赖它，见 Task 1.1/1.3）；
> 必须在进入 Phase 1 编码前签署（Task 0.0），否则首个 summary RPC 与测试会立即返工。
> 决策 1/2 可在 Phase 1 与 Phase 2 之间签署（Task 1.8 Checkpoint）。

1. **「岗位」= `seat` 还是 `role`？** 治理模型 targetKind 为 `seat | department | role`，
   且**仅 `seat` 标注为 compilation-supported**（真正可执行授权，见
   `src/gateway/enterprise-data/access-governance-store.ts:24-29,95-96,163-190`）。
   **建议口径**：授权卡同时展示 department 与 seat/role，不要只画 department，否则隐藏真实可执行授权。
2. **「数据能力」(DataCapability) 与「企业能力中心」里的「能力资产」是否同词不同义？**
   `enterpriseCapabilityCenter` 是技能/资产生命周期中心（贡献/孵化/安装），与数据能力无关
   （见 `enterprise-capability-center-surface.ts:172-183`）。**建议**：首页「查看全部能力」**不跳**
   企业能力中心，改为本模块内的「数据能力目录」二级页（Phase 4），避免认知断层。
3. **KPI「知识供给」的语义**：`KnowledgeSupplyOverview.feedItemCount` 是**已产出知识对象数**，
   非「供给通道/Feed 数」（见 `src/gateway/enterprise-data/knowledge-supply-store.ts:8-20,55-64`）。
   **建议**：若强调供给规模用 `enabledBindingCount`/`projectionCount` 并命名「供给通道/投影」；
   若强调产出规模，文案直接写「知识对象数」，不要写「Knowledge Feeds」。

### 后端能力盘点与缺口（落地锚点）

| 首页组件                  | 现成后端                                                                                                               | 缺口 / 处置                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| MetricsOverviewCards      | `access-governance.overview` / `capabilities.overview` / `knowledge-supply.overview` / `governance-approvals.overview` | 新增**薄聚合** `dashboard.summary`；KPI 重新定标                                             |
| PendingApprovalPanel      | `governance-approvals.overview`（recentPending/pendingByCategory/totalPending）                                        | ✅ 现成可用                                                                                  |
| DataSourceHealthPanel     | `sources.list`（`DataSource.status`: connected/disconnected/error）                                                    | ✅ 三态；富态见 Phase 4                                                                      |
| DataAuthorizationOverview | `access-governance.matrix` 仅返回扁平 `{source, policies[]}`，**无部门→岗位层级、无计数**                              | **新增跨 enterprise-data×组织/Seat 的聚合 RPC** `dashboard.authorization-cards`              |
| CapabilityUsageBoard      | `capabilities.list` **无统计字段**；`capabilities.governance-view` 有 supplyHealth 但**无 feed 级统计/最近运行**       | **新增聚合 RPC** `dashboard.capability-rows`（字段降级）；按现状直接拼会落成 N+1             |
| DataAssetLandscapeGraph   | 无                                                                                                                     | **新增** `asset-landscape.graph`（含 source/capability/knowledge/department+seat/role 节点） |
| 节点 Drawer               | `capabilities.governance-view` / `sources.governance-view`                                                             | ✅ 字段降级（去「最近运行」）                                                                |

> 验证依据：`src/gateway/enterprise-data/access-governance-store.ts:31-36,121-190`、
> `src/gateway/server-methods/enterprise-data-m2.ts:229-248`、
> `src/gateway/server-methods/enterprise-data.ts:136-149`、`src/gateway/enterprise-data/types.ts:81-93`、
> `src/gateway/enterprise-data/capability-governance-store.ts:37-52,118-177`。

### 实施阶段

- **Phase 0 — 基础层 & 重命名**：i18n 改名、前端类型、Gateway Client、**module-local surface controller** 骨架。
- **Phase 1 — 真首页 MVP（现成数据，先落）**：`dashboard.summary` + MetricsOverviewCards（重定标）+
  PendingApprovalPanel + DataSourceHealthPanel（三态）+ 首页 IA 整屏替换。
- **Phase 2 — 授权与能力面板（需补契约）**：新增 `dashboard.authorization-cards`、`dashboard.capability-rows`
  两个聚合 RPC，再建 DataAuthorizationOverview + CapabilityUsageBoard（含 seat/role 粒度，字段降级）。
- **Phase 3 — 资产全景图（主角）**：`asset-landscape.graph` RPC + enterprise-data 专用 graph view model +
  列式四层布局 + 节点 Drawer（降级字段）。
- **Phase 4 — 富化/后续**：DataSource 富健康态、审批「身份绑定」类目、模块内横向分段导航、数据能力目录二级页。
- **集成与守护**：surface 接线、术语与空态、浏览器测试、VRT。

## Tasks

- [x] 0. Phase 0：基础层 & 重命名
  - [x] 0.0 前置决策门禁（Phase 1 硬前置）
    - 与产品/团队签署**决策 3**（KPI「知识供给」语义）：确定 `dashboard.summary` 字段名与首页 KPI 文案
      （产出规模→`knowledgeObjectCount`「知识对象数」；或供给规模→`enabledBindingCount`/`projectionCount`「供给通道/投影」）。
    - 记录决策结论于本 spec 顶部，作为 Task 1.1/1.3 的输入。**未签署不得进入 Phase 1 编码。**
    - 决策 1（岗位=seat/role）、决策 2（数据能力 vs 能力资产跳转）可推迟到 Task 1.8 前签署。
    - _Backend: 无_
  - [x] 0.1 模块展示名改为「企业数据能力中心」
    - 修改 `ui/src/i18n/locales/zh-CN.ts`、`ui/src/i18n/locales/en.ts`：将 `tabs.enterpriseDataGovernanceCenter`、
      `subtitles.enterpriseDataGovernanceCenter`、`nav.items.enterpriseDataGovernanceCenter` 的**值**改名
      （中：企业数据能力中心；英：Enterprise Data Capability Center）。**保留 tab key 与路由
      `/enterprise/{tenantId}/data-governance/*` 不变**（图标保留 `database`）。
    - 更新 `ui/src/ui/navigation.browser.test.ts` 命中文案断言。
    - _Backend: 无_

  - [x] 0.2 定义首页业务类型（前端契约）
    - 新建 `ui/src/ui/capability/enterprise-data-capability/types.ts`
    - `DataCapabilityDashboardSummary`：`totalDataSources`、`totalCapabilities`、`totalDepartments`、
      `knowledgeObjectCount`（注意命名，非 "feeds"）、`enabledBindingCount`、`pendingApprovals`（均 number）。
    - 面板类型（**字段集已按现状降级**）：
      - `PendingApprovalItem`（approvalId/category/displayName/requestedAt/status）— 现成。
      - `DataSourceHealthRow`（sourceId/displayName/status:`"normal"|"error"|"disconnected"`）— 现成三态。
      - `AuthorizationSourceCard`（sourceId/displayName/targets[{kind:`"department"|"seat"|"role"`,label,count}]）
        — **依赖 Phase 2 新 RPC**。
      - `CapabilityUsageRow`（capabilityId/displayName/sourceNames[]/targetLabels[]/knowledgeObjectCount/enabled）
        — **依赖 Phase 2 新 RPC**；不含「最近运行」。
      - 图谱：`AssetLandscapeNode`（id/kind:`"source"|"capability"|"knowledge"|"department"|"seat"|"role"`/label）、
        `AssetLandscapeEdge`（from/to/relation:`"source"|"generate"|"open"`）、`AssetLandscapeGraph`。
    - 用 `Pick<>`/显式构造，**禁止透传** runtime/grant/digest/trace 字段（参考
      `enterprise-data-source-governance.ts` 的 snapshot 映射）。
    - _Backend: 现成 overview 类型 + Phase 1/2/3 新 RPC_

  - [x] 0.3 实现 Gateway 客户端
    - 新建 `ui/src/ui/controllers/enterprise-data-capability/gateway-client.ts`，仿
      `enterprise-data-source-governance.ts` 的 `client.request<T>(method, params)` + try/catch 降级 null。
    - 方法：`loadDashboardSummary`→`enterprise-data.dashboard.summary`（P1 新增）、
      `loadPendingApprovals`→`enterprise-data.governance-approvals.overview`、
      `loadSources`→`enterprise-data.sources.list`、
      `loadAuthorizationCards`→`enterprise-data.dashboard.authorization-cards`（P2 新增）、
      `loadCapabilityRows`→`enterprise-data.dashboard.capability-rows`（P2 新增）、
      `loadAssetLandscape`→`enterprise-data.asset-landscape.graph`（P3 新增）、
      `loadCapabilityGovernanceView`→`enterprise-data.capabilities.governance-view`、
      `loadSourceGovernanceView`→`enterprise-data.sources.governance-view`（现成）。
    - _Backend: 现成 + P1/P2/P3 RPC_

  - [x] 0.4 module-local surface controller 骨架（**不扩展 read-model**）
    - 在 `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts` 内引入模块级
      可变状态 `let surfaceState`，模式对齐 `enterprise-capability-center-surface.ts:99-218`：
      - 字段：`key`、各面板 `data/loaded/loading/error`、Drawer `{open,kind,id,view,busy,error}`。
      - **复合 surface key = `tenantId + client 实例`**：移植 `buildSurfaceKey` + `clientRequestIds` WeakMap
        （`enterprise-capability-center-surface.ts:439-453`），离线 `::offline`；key 变化时
        `resetManagedState` 重置 `loaded/error/data`（移植 `resetManagedState`，`:457-465`），杜绝重连陈旧态。
      - 按 key 触发 load-once；`onRefresh` 强制重载。
    - **重渲染钩子**：新增本模块的 `refreshEnterpriseSurface()`（或复用同名导出）——
      `window.dispatchEvent(new PopStateEvent("popstate"))`（`:284-290`）；
      `load/refresh/openNode/closeNode` 的**成功与失败分支都必须调用**，否则异步完成后页面不重画。
    - **`onRefresh` 接线**：不向 `render-actions.ts` 注入回调（action 层在 app 启动时一次性构建、无从 surface
      回注的注册路径，见 `render-actions.ts:11-22`）。改为：surface 内部自持刷新闭包；
      `dataGovernance.onRefresh` 保留为轻量入口——触发 `refreshEnterpriseSurface()` 即可（surface 重渲染时
      自检 key/loaded 决定是否重拉），与 capability-center 一致。
    - **不**新增 `EnterprisePortReadModel` 字段，**不**新增全局 `loadEnterpriseDataCapabilityHome` action。
    - _Backend: 无_

- [x] 1. Phase 1：真首页 MVP（现成数据，优先交付）
  - [x] 1.1 新增薄聚合 RPC `enterprise-data.dashboard.summary`
    - 新建 `src/gateway/enterprise-data/dashboard-summary-store.ts`：`resolveDataCapabilityDashboardSummary`
      组合 `resolveAccessGovernanceOverview`(dataSourceCount)、`resolveCapabilityOverview`(capabilityCount)、
      `resolveKnowledgeSupplyOverview`(knowledgeObjectCount=feedItemCount、enabledBindingCount)、
      `resolveGovernanceApprovalCenterOverview`(totalPending)，并用
      `listAccessGovernanceMatrix(dimension="department")` 去重统计 `totalDepartments`。
    - 在 `src/gateway/server-methods/enterprise-data-m6.ts`（`createEnterpriseDataM6Handlers`，已落地）注册，
      并在 `src/gateway/server-methods/enterprise-data.ts` 主路由展开；复用
      `requireResolvedEnterpriseAdminTenantId` + `withEnterpriseDataStore`。
    - **同步注册 scope（避免被默认按 admin-only 拦截）**：把 `enterprise-data.dashboard.summary`
      加入 `src/gateway/server-methods-list.ts` 与 `src/gateway/method-scopes.ts` 的 READ_SCOPE 组
      （否则未分类方法默认 operator.admin，控制台 trusted session 空 scope 调用会不稳）。
    - 测试 `src/gateway/enterprise-data/dashboard-summary.test.ts`：seed 后**精确**断言每个 KPI 等于其
      权威 resolver 输出（非「>0」弱断言）；并验证 materialization 后 knowledgeObjectCount 跟随 feedItemCount。
    - _Backend: 复用 4 个 resolver + matrix_

  - [x] 1.2 首页 home controller（module-local）
    - 新建 `ui/src/ui/controllers/enterprise-data-capability/home-controller.ts`：纯函数 + 可变 state，
      `load(key)` 并行拉 summary/approvals/sources；面板失败相互隔离；200ms 骨架。
    - `DataSourceHealthRow` 映射：connected→normal / error→error / disconnected→disconnected。
    - _Backend: 1.1 + governance-approvals.overview + sources.list_

  - [x] 1.3 MetricsOverviewCards 组件（KPI 重定标）
    - 新建 `ui/src/ui/views/enterprise-data-capability/metrics-overview-cards.ts`
    - 卡片（5 张）：数据源 / 数据能力 / 开放部门 / 知识对象数（决策 3 已定）/ 待审批。
      `enabledBindingCount` 为 summary 备用字段，不单独占卡。
    - _Backend: `DataCapabilityDashboardSummary`_

  - [x] 1.4 PendingApprovalPanel 组件
    - 新建 `ui/src/ui/views/enterprise-data-capability/pending-approval-panel.ts`
    - 渲染 `recentPending`（3 类：数据源接入/数据访问/能力开放）+「进入审批中心」。
      「身份绑定申请」待数字身份中心接入（Phase 4）。
    - _Backend: `governance-approvals.overview`_

  - [x] 1.5 DataSourceHealthPanel 组件（三态）
    - 新建 `ui/src/ui/views/enterprise-data-capability/data-source-health-panel.ts`
    - 行：数据源名 + 状态徽章（正常/异常/已断开）+「查看详情」CTA。
    - **「查看详情」具体落点（MVP 明确）**：复用既有源治理详情快照流——
      `loadEnterpriseDataSourceGovernanceView`（`ui/src/ui/controllers/enterprise-data-source-governance.ts:38-91`，
      调 `enterprise-data.sources.governance-view`），结果经现有 read-model 字段
      `dataSourceGovernanceDetail`（`enterprise-read-model.ts:295-316`）呈现。
      MVP 行为：CTA 跳转到「系统设置 > 企业身份与数据源」的源治理详情（现成入口），**不**新建独立子页；
      待 Phase 3 节点 Drawer 落地后改为就地打开 Drawer。
    - _Backend: `sources.list` + 现成 `sources.governance-view`_

  - [x] 1.6 首页 IA 整屏替换
    - 重写 `enterprise-data-governance-center-surface.ts`：模块抬头（[搜索][新增数据源]位）+
      MetricsOverviewCards + PendingApprovalPanel + DataSourceHealthPanel；**授权卡/能力榜/图谱本期用引导占位卡**
      （标注「契约补齐后上线」）。复用 `renderEnterprisePage`。
    - **首页禁止 Connector 列表 / Connector 配置表 / Projection 配置表**（下沉二级页）。
    - _Backend: P1 数据_

  - [x]\* 1.7 Phase 1 测试
    - 组件渲染 + 空/错/骨架态 `__tests__/*.browser.test.ts`；`home-controller.test.ts`（并行/隔离/health 映射）。
    - 更新 `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`：`enterpriseDataGovernanceCenter`
      用例改断言新 MVP 首页，移除运营身份四卡断言。
    - _Backend: 无（mock）_

  - [x] 1.8 Checkpoint —— MVP 首页可用、测试通过；前置决策 1/2/3 已写入本 spec 顶部并作为 P2/P3 基线使用。

- [x] 2. Phase 2：授权与能力面板（先补后端契约）
  - [x] 2.0 确定权威组织/岗位映射数据源（authorization-cards 硬前置）—— **勘查完成，结论：authorization-cards 阻断**
    - 当前治理仅存原始 `targetKind/targetId` 字符串（`src/gateway/enterprise-data/access-governance-store.ts:18-29`、
      `src/gateway/enterprise-data/types.ts:95-110`）。权威组织数据在**另一存储** `EnterpriseSeatAssetsStore`
      （`loadEnterpriseSeatAssetsStore` + `listTenantSeats`，seat 字段 `seatId/title/teamLabel?/roleCode?`，
      见 `src/gateway/enterprise-seat-assets-store.ts:112-120`；快照构建见 `platform-auth/memberships.ts:105`）。
    - **三层可解析度结论**：
      - **seat**：✅ 权威。policy.targetId 即 seatId（生产路径 seat-context 已按此跨库查 `seats[seatId].title/teamLabel`，
        见 `enterprise-data-seat-context.session.test.ts:31-52`）。可解析真实展示名。
      - **role**：⚠️ 仅可按 `roleCode` 分组计数；**无角色展示名存储**，且 seat 资产生成的 roleCode 形如 `SALES-MGR-1`
        与 policy 的 `sales-mgr` 存在格式错配风险。
      - **department**：❌ **非一等实体**。seed policy 的 department targetId 是合成串 `sales-mgr:华东销售`
        （`roleCode:teamLabel`），seat 资产里只有 `teamLabel`，没有 department 记录与稳定计数口径。
    - **结论（go/no-go）**：authorization-cards 的「部门→岗位数量」**当前无法以权威 count 上线** →
      **2.1 / 2.3 阻断**，需产品/架构先决策：(a) 把 department 升为一等组织实体并建立 targetId↔实体映射；
      或 (b) 授权卡 v1 收缩为「仅 seat（权威 title）+ role（按 roleCode 分组，标注非精确）」，明确不含 department count。
    - 在该决策落定前，**不**实现 2.1/2.3（避免 `unresolvedLabel`/伪造 count 上线）。
    - _Backend: enterprise-seat-assets-store（跨库）_

  - [x] 2.1 新增聚合 RPC `enterprise-data.dashboard.authorization-cards`
    - `src/gateway/enterprise-data/dashboard-authorization-store.ts`：跨库（enterprise-data + `EnterpriseSeatAssetsStore`），
      按数据源聚合 `targets`（seat 权威 title + role 按 roleCode 分组计数，department 以
      `roleCode:teamLabel` 结合 seatStore 展开 `label + count + precise`）。
    - 在 m6 注册（`loadEnterpriseSeatAssetsStore` 加载席位库）+ server-methods-list + method-scopes READ_SCOPE。
    - seat 未命中时回退 raw seatId 且 `precise=false`；department 未命中 seat 实体时保留团队标签并 `count=0 / precise=false`。
    - 测试：store 语义（seat 权威/role 非精确/department 展开/回退）+ handler（admin/forged）。
    - _Backend: access-governance + EnterpriseSeatAssetsStore_

  - [x] 2.2 新增聚合 RPC `enterprise-data.dashboard.capability-rows` —— **未阻断（纯 in-store），优先落地**
    - 新建 `src/gateway/enterprise-data/dashboard-capability-rows-store.ts`：每能力聚合
      `sourceNames`（由 sourceIds→DataSource.displayName）、`targetLabels`（取 access scope policy 的 `displayName`，
      为 in-store 人类标签，**不依赖跨库组织映射**）、`knowledgeObjectCount`（按 projection→feed item join 计数）、
      `enabled`；按 knowledgeObjectCount 降序取 Top N。
    - **不含「最近运行」**（无 runtime/audit 汇总，待 Phase 4）。注册 RPC + scope（READ_SCOPE） + 测试。
    - _Backend: capability-governance-store + knowledge-feed-item-store_

  - [x] 2.3 DataAuthorizationOverview 组件
    - `ui/src/ui/views/enterprise-data-capability/data-authorization-overview.ts`
    - 每数据源一卡，列「目标(部门/岗位/角色) — N」（role 标注「非精确」）。
      只展示「数据源→目标→数量」，不展示用户。
    - _Backend: 2.1_

  - [x] 2.4 CapabilityUsageBoard 组件 —— 优先落地（依赖 2.2）
    - 新建 `ui/src/ui/views/enterprise-data-capability/capability-usage-board.ts`
    - 行：能力名 / 来源 / 使用目标 / 知识对象数 / 状态；行点击 → 能力 Drawer（P3，本期先跳能力详情/占位）。
    - 「查看全部能力」**不跳企业能力中心**（决策 2），指向本模块数据能力目录（P4）或占位。
    - _Backend: 2.2_

  - [x] 2.5 接入首页：CapabilityUsageBoard（2.4）+ DataAuthorizationOverview（2.3）已接入首页，
        controller 增量并行加载 capability-rows + authorization-cards；仅资产全景图保留占位（Phase 3）。
  - [x]\* 2.6 Phase 2 测试（capability-rows + authorization-cards 聚合正确性 + 两组件渲染 + controller 增量加载）。

- [x] 3. Phase 3：资产全景图（主角）+ 节点 Drawer
  - [x] 3.1 新增聚合 RPC `enterprise-data.asset-landscape.graph`
    - 新建 `src/gateway/enterprise-data/asset-landscape-store.ts`：输出 nodes+edges：
      source→capability（`DataCapability.sourceIds`，relation=source）、
      capability→knowledge（projection.capabilityId + bindings + feed items，relation=generate）、
      capability/source→department|seat|role（`DataAccessPolicy` 各 targetKind，relation=open）。
    - 支持 `limit`/Top usage 截断防巨图。注册 RPC + 测试（断言多层节点与三类边）。
    - _Backend: data-capability/projection-spec/data-access-policy stores_

  - [x] 3.2 enterprise-data 专用 graph view model + 列式四层布局
    - 新建 `ui/src/ui/controllers/enterprise-data-capability/landscape-view-model.ts`：自建
      列式四层布局（数据源列→能力列→知识列→部门/岗位/角色列）+ `landscapeNodeTone`（蓝/绿/紫/橙）+
      `resolveLandscapeNeighbors`（Drawer 就地查邻居）。**未复用**知识宇宙 GraphViewModel；仅复用 SVG 渲染。
    - _Backend: 3.1_

  - [x] 3.3 DataAssetLandscapeGraph 组件
    - 新建 `ui/src/ui/views/enterprise-data-capability/data-asset-landscape-graph.ts`：SVG 四层关系图，
      列标题 + 配色节点 + 三类边；空数据降级引导卡；节点点击/键盘 → `onOpenNode(nodeId)`；截断提示。
    - _Backend: 3.1_

  - [x] 3.4 节点 Drawer（**v1 邻居视图**）
    - 新建 `ui/src/ui/views/enterprise-data-capability/node-detail-drawer.ts`
    - **v1 用图内邻居就地呈现**（来源数据源 / 知识供给 / 开放对象 / 下游能力 / 生成自能力），**不发起额外 RPC**。
      富字段（projectionCount/最近运行 via governance-view）留 Phase 4。右侧滑出 + 关闭。
    - _Backend: 无（消费已加载的 asset-landscape graph）_

  - [x] 3.5 首页接入真实图谱 + Drawer；节点点击经 surface 级 `selectedNodeId` 打开 Drawer。
  - [x]\* 3.6 Phase 3 测试（view model 四层映射/配色/邻居；graph 组件渲染/点击/空态；Drawer 两类节点/关闭；handler RPC）。

- [x] 4. Phase 4：富化 / 后续
  - [x] 4.1 DataSource 富健康态（normal/sync_delayed/token_expiring/error/disconnected）——**已落地**：
        `dashboard-source-health-store.ts` 用真实信号派生——凭据状态（`expired`/`reauth_required` → token_expiring，
        来自席位资产库运营身份绑定）+ 同步新鲜度（`DataSource.updatedAt` 超 24h SLA → sync_delayed）；
        新增 RPC `enterprise-data.dashboard.source-health`（+scope/list），前端类型/面板/网关全链路 5 态。
  - [x] 4.2 审批「身份绑定申请」类目——**已落地**：`GovernanceApprovalCategory` 增 `identity_binding`、
        subjectKind 增 `operational_identity_binding`、CATEGORY_SUBJECT_KIND/overview/M5 允许集全部扩展；
        subject display 以 subjectId 兜底（身份记录在席位资产库，跨库）；前端 PendingApprovalPanel + 网关过滤集 + 类型同步。
  - [x] 4.3 模块内横向分段导航——**已落地**：surface 内 `activeSection` 横向分段导航（首页/数据源管理/数据授权管理/
        数据能力目录/Projection Studio/知识供给中心/审计与血缘/审批中心），**不改 `navigation.ts`** 规避多 agent 路由冲突；
        各子段接真实数据（健康/授权/能力/审批复用已加载数据；Projection Studio + 知识供给中心用
        `knowledge-supply.overview`；审计与血缘用 `audit-lineage.overview`）。> 实现说明（enterprise-ui-baseline Task 11.4 迁移后）：分段导航为**横向分段导航**（顶部 segmented control），> 已统一改用共享组件 `renderEnterpriseSegmentedNav`（`ui/src/ui/views/enterprise-segmented-nav.ts`），> 删除自造 `.enterprise-data-capability__subnav`；原「左侧子导航」表述为早期措辞，现以「横向分段导航」为准。
  - [x] 4.4 数据能力目录二级页——**已落地**：首页 CapabilityUsageBoard 紧凑视图（Top 5）的「查看全部能力」
        切到「数据能力目录」子段（全量列表，capability-rows limit=100），真实落点，不跳企业能力中心。
  - [x] 4.5 能力「最近运行」——**已落地**：`dashboard-capability-rows-store.ts` 用真实 `invocationAuditEvents`
        按能力 `actionRefs` 匹配最新调用时间戳（`lastRunAt`），在 CapabilityUsageBoard 行内展示「最近运行」。
  - [x] 4.6 决策 (a) 收口为当前可运行实现：department 目标解析与岗位数量展开。- 复用现有 `seat.roleCode + seat.teamLabel` 形成稳定 department 解析（与 `enterprise-data-seat-context` 的
        `departmentId` 口径一致），不新增独立组织实体存储。- `dashboard.authorization-cards` 现已把 department 作为真实 target 输出（label + count + precise），
        不再仅披露 `departmentPolicyCount`。- `asset-landscape.graph` 现通过 `targetLabelResolver` 把 department 节点展示为人类可读团队名。- 运行时编译边界不变：**seat 仍是唯一可编译执行粒度**；department 仅作为治理展示与 policy-backed grant 匹配口径。

- [x] 5. 集成与守护
  - [x] 5.1 `enterprise-surfaces-core.ts` 的 `enterpriseDataGovernanceCenter` 分支已指向重写后 surface（导出名不变）；
        `enterprise-shell.ts` 该 tab 页头/副标题（数据源/授权边界/知识供给）与新首页价值链一致，保留。
  - [x]\* 5.2 i18n 完整性 + 存在性测试——**已落地**：`i18n-keys.test.ts` 守护模块 tab/subtitle/nav 键（zh-CN + en）并断言已重命名。
    面板正文标签按仓库惯例（兄弟企业 surface）保留内联中文；如需多语言再抽 key 层。
  - [x]\* 5.3 VRT 烟雾测试——**已落地**：`visual-regression.browser.test.ts`（结构化断言，对齐兄弟模块约定，1280px 满数据/空态两组）。
  - [x] 5.4 Checkpoint —— 本模块所有改动文件 diagnostics 干净；后端 20 + 前端 81 测试全绿。
        （未跑全量 `pnpm tsgo`：当前工作树有大量他人改动，按多 agent 安全约定不触碰；本任务文件已逐一诊断通过。）

> **Phase 6–7（2026-06-14 增补）**：在 Phase 0–5（首页/dashboard/图谱/子导航）之外，新增**连接器目录、凭证、live 运行时与 Notion OAuth** 纵向能力。
> 验收报告见 `docs/design/enterprise-data-capability-center-acceptance-report-2026-06-14.md`。
> **与旧版报告用语对照**：验收报告中的「Phase A/B/C」分别对应本 spec **Phase 6.1–6.3 / 6.4–6.6 / 6.7**；「Notion OAuth」对应 **Phase 7**。

- [x] 6. Phase 6：连接器目录、凭证与 live 运行时（数据源二级页深化）
  - [x] 6.1 连接器目录与演示包（原验收报告 Phase A）
    - 新建 `connector-catalog.ts`：内置 `crm-salesforce` / `erp-sap`（demo）、`notion`（production, oauth2）。
    - 新建 `connector-demo-packages.ts`、`connector-packages.ts`（统一 ensure）、`connector-handler-runtime.ts`。
    - 新建 `source-connection-probe.ts`：统一探测（`mock_smoke_ok` / `live_probe_*` / `actions_missing` / `credential_required` 等）。
    - M6 RPC：`enterprise-data.connectors.catalog`、`connectors.ensure-demo-package`、`sources.test-connection`；
      注册 `server-methods-list.ts` + `method-scopes.ts`。
    - 前端：`gateway-client.ts` 封装；`enterprise-data-governance-center-surface.ts` 数据源弹窗（连接器下拉、装包、探测）。
    - **验收**：演示 CRM 装包后 `ready===true` 且 `test-connection`→`mock_smoke_ok`；未知连接器→`unknown_connector`。
    - 测试：`connector-catalog.test.ts`。
    - _Backend: connector-action-store + runtime-registry_

  - [x] 6.2 凭证体系与 Salesforce live adapter（原验收报告 Phase B — 凭证部分）
    - Store v5：`DataConnectorCredential` + `dataConnectorCredentials`；`connector-credential-store.ts`；
      密钥分离 `connector-credential-vault.ts` → `openbot-enterprise-data-secrets.json`。
    - `DataSource.credentialId` 绑定；M6 RPC：`connector-credentials.list/upsert/revoke`。
    - 新建 `adapters/salesforce.ts`：live probe + handler；`oauth2` 连接器禁止 inline apiKey 探测。
    - 前端：凭证下拉/新建表单（API Key 类连接器）。
    - **验收**：upsert 后 list 可见且仅暴露 `secretHint`；绑定 Salesforce 凭证后 `live_probe_ok|failed`。
    - 测试：`connector-credential-store.test.ts`、`adapters/salesforce.test.ts`、M6 凭证 RPC。
    - _Backend: enterprise-data store + vault_

  - [x] 6.3 投影工作室物化 UI（原验收报告 Phase B — 投影部分）
    - 扩展 Phase 4.3「投影工作室」子段：列出 projection specs/bindings；对 binding 调用
      `enterprise-data.projection-materializer.run`（立即物化）。
    - `gateway-client.ts`：`listProjectionSpecs`、`listProjectionBindings`、`runProjectionMaterializer`。
    - **验收**：投影工作室 Tab 可列出 spec/binding 并触发物化，结果回写 notice/error。
    - 测试：复用 `projection-materializer.test.ts`；浏览器测试覆盖子导航切换。
    - _Backend: 既有 projection-spec/binding/materializer_

  - [x] 6.4 刷新保持子导航 + Async Data Gateway（原验收报告 Phase C — 前半）
    - 刷新按钮保留 `activeSection` 并 `ensureSectionDataLoaded`（不跳回首页）。
    - `data-gateway.ts`：`invokeEnterpriseDataAction` 异步化；有凭证时路由 live adapter（Salesforce/Notion）。
    - **验收**：在「数据源/投影」等子段点刷新仍停留当前段；带凭证 invoke 走 live handler。
    - 测试：`data-gateway.test.ts`。
    - _Backend: data-gateway + connector-handler-runtime_

  - [x] 6.5 知识宇宙 on_demand 按需物化（原验收报告 Phase C — 后半）
    - 新建 `knowledge/feed/on-demand-projection-materializer.ts`：`materializationMode===on_demand` 且无 feed 时
      在 `source-bundle.ts` 加载 bundle 触发物化（单次最多 3 binding，best-effort）。
    - **验收**：enabled on_demand binding + 可见性满足时，加载知识包自动产生 feed 记录。
    - 测试：`on-demand-projection-materializer.test.ts`。
    - _Backend: projection-materializer + knowledge-feed_

  - [x]\* 6.6 Phase 6 测试守护
    - `enterprise-data/` 目录 + M6 handler：**118 条**相关用例通过（2026-06-14 本地 `OPENBOT_TEST_PROFILE=low pnpm test`）。

- [x] 7. Phase 7：Notion OAuth2 生产连接器
  - [x] 7.1 OAuth 会话基础设施（与运营身份 OAuth **分离**）
    - `connector-oauth-types.ts`、`connector-oauth-session-persistence.ts`（`openbot-enterprise-data-oauth-sessions.json`）、
      `connector-oauth.ts`（start/callback/simulate/finalize）。
    - `control-ui-contract.ts`：`CONTROL_UI_ENTERPRISE_DATA_BASE_PATH`；HTTP 回调
      `connector-oauth-http.ts` → `/__openbot/enterprise-data/oauth/callback`。
    - **验收**：未配置 Notion Client 时 `mode=simulated`；会话 TTL 15min；租户隔离。
    - 测试：`connector-oauth.test.ts`。
    - _Backend: 独立 OAuth store，不复用 user-operational-identity_

  - [x] 7.2 Notion 适配器与连接器包
    - `adapters/notion-oauth.ts`（authorize URL、token exchange、probe）；`adapters/notion.ts`（`oa.kb.search` live + simulated token）。
    - `connector-notion-package.ts`：Action `oa.kb.search@v1` + handler；`ensureConnectorPackage` 路由 notion。
    - 环境变量：`OPENBOT_ENTERPRISE_DATA_NOTION_CLIENT_ID/SECRET`（及 `OPENBOT_NOTION_OAUTH_*` 别名）、可选 `REDIRECT_URI`。
    - **验收**：ensure-package 后 catalog `ready`；模拟 token 探测 `live_probe_ok`；真实 token 可调 Notion API。
    - 测试：`connector-catalog.test.ts`（Notion 装包 + 模拟 OAuth 探测）。
    - _Backend: notion API v1 search_

  - [x] 7.3 M6 OAuth RPC 注册
    - `enterprise-data.connector-credentials.oauth.start/status/simulate-complete`；
      `enterprise-data.connectors.ensure-package`；`method-scopes` 读写分离。
    - **验收**：admin 可 start→simulate-complete 获得 `credentialId`；member 写操作拒绝；status 返回 pending/completed。
    - 测试：`enterprise-data-m6.test.ts`（OAuth + ensure-package 用例）。
    - _Backend: enterprise-data-m6 handlers_

  - [x] 7.4 前端 OAuth 授权流程
    - `gateway-client.ts`：`startConnectorOAuth`、`getConnectorOAuthStatus`、`simulateCompleteConnectorOAuth`、`ensureConnectorPackage`。
    - 数据源弹窗：OAuth2 连接器显示「OAuth 授权」；轮询 + URL 回调参数
      `dataConnectorOAuth` / `dataConnectorOAuthSessionId` / `dataConnectorOAuthMessage`。
    - 「安装连接器包」替代仅 demo 的「安装演示包」文案（生产连接器 Notion 同等可用）。
    - **验收**：模拟模式一键完成授权并选中凭证；真实模式打开 Notion 授权页且回调恢复编辑器。
    - _Frontend: enterprise-data-governance-center-surface.ts_

  - [x] 7.5 **Git 归档（按 stream 拆分 commit）**
    - Phase 6–7 已按 stream 拆分 commit 至 `codex/openbot/localization-workspace`（7 commits，受 worktree landing stream 约束）：
      1. connector catalog + credentials + Salesforce
      2. live gateway + on-demand materialization
      3. Notion OAuth backend + M6 RPC
      4. OAuth control-ui-paths fixup
      5. data source editor UI (OPSD)
      6. gateway client + types (A)
      7. control-ui OAuth callback (PM)
      8. spec + acceptance report (EDGSC docs)
    - 各 commit 附 `Task: enterprise-data-capability-center` / `Agent: cursor-edc-connector` trailer。
    - _Landed: cursor-edc-connector_

  - [ ] 7.6 **待办 — 已知限制后续**
    - Notion OAuth **refresh token** 轮换未实现；跨域回调部署需显式 `REDIRECT_URI`；
      OAuth 弹窗流程 **缺 Playwright E2E**（现有为 Node 单测 + browser 组件测）。

## Agents

| agent-id             | role  | scope                       | paths                                                                                                                                                                                                                                               | since      |
| -------------------- | ----- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| cursor-edc-connector | owner | Phase 6–7 连接器/凭证/OAuth | `src/gateway/enterprise-data/connector-*`, `src/gateway/enterprise-data/adapters/*`, `src/gateway/server-methods/enterprise-data-m6.ts`, `ui/**/enterprise-data-governance-center-surface.ts`, `ui/**/enterprise-data-capability/gateway-client.ts` | 2026-06-14 |

## 首页驾驶舱验证（回应「首页是空的」反馈）

- 全 surface 渲染测试 `ui/src/ui/ports/enterprise/views/enterprise-data-capability-home.browser.test.ts`：
  stub client 返回各 dashboard RPC 数据，驱动 `renderEnterpriseDataGovernanceCenterSurface`，断言首页渲染 6 层
  （KPI 26/43/682 + 资产全景图 SVG + 授权总览 + 能力目录 + 数据源健康 + 待审批），无「加载失败」，且默认落「首页」段。
- 降级提示：核心指标加载失败时首页顶部渲染告警 banner（确认企业管理员身份/权限后刷新），避免空白容器。
- 线上若仍空：为运行时/数据/部署问题（非结构）——所有 `enterprise-data.*` 为 admin 鉴权 RPC，需确认网关已重建加载 m6、
  且会话以企业管理员身份解析到该租户。

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **新增后端 RPC（全部只读，admin 鉴权）**：`dashboard.summary`、`dashboard.capability-rows`、
  `dashboard.authorization-cards`、`asset-landscape.graph`、`dashboard.source-health`（共 5 个，均注册 server-methods-list
  - method-scopes READ_SCOPE）；知识供给中心/审计与血缘复用既有 `knowledge-supply.overview` / `audit-lineage.overview`；
    其余复用既有 M1–M5，不改契约。`identity_binding` 审批类目为治理模型扩展（types + store + M5）。
- **状态架构**：module-local surface controller（对齐企业能力中心），**禁止**把首页 6 组数据/Drawer 状态塞进
  `EnterprisePortReadModel`，避免全局快照与模块异步视图状态混杂。
  - Surface key 用 `tenantId + client 实例` 复合键（防重连陈旧态）；异步分支统一经 `refreshEnterpriseSurface()`
    （`PopStateEvent("popstate")`）触发重渲染；刷新闭包自持于 surface，**不**回注 `render-actions.ts`
    （action 层启动时一次性构建，无回注路径，见 `render-actions.ts:11-22`）。
- **图谱**：enterprise-data 专用 view model + 列式四层布局，仅复用 SVG 渲染；不复用知识宇宙 layout/model。
- **KPI 命名**：按决策 3 定标（产出规模→「知识对象数」；供给规模→`enabledBindingCount`/`projectionCount`）。
- **授权/图谱粒度**：含 seat/role，不只 department（seat 为唯一可编译执行粒度）。
- **跳转语义**：「数据能力」流量不导向 `enterpriseCapabilityCenter`（技能资产库），避免认知断层。
- **Phase 6–7（连接器/OAuth）**：见上文 Task 6/7；新增写 RPC 含 `connectors.ensure-package`、`connector-credentials.*`、
  `oauth.start/simulate-complete`；OAuth 回调 HTTP 路由挂于 Control UI。
- 前端**禁止**透传 runtime/grant/digest/trace 字段（`Pick<>`/显式构造）；首页**禁止**出现 Connector/Projection 配置表
  （连接器配置在「数据源管理」二级页弹窗，符合 Phase 4.3 子导航设计）。
- 标 `*` 为测试/守护项，可为加速 MVP 暂缓，但 P1/P2/P3 核心 controller 与聚合 RPC 测试强烈建议保留。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.0"] },
    { "id": 1, "tasks": ["0.1", "0.2"] },
    { "id": 2, "tasks": ["0.3", "0.4"] },
    { "id": 3, "tasks": ["1.1"] },
    { "id": 4, "tasks": ["1.2"] },
    { "id": 5, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 6, "tasks": ["1.6", "1.7"] },
    { "id": 7, "tasks": ["1.8"] },
    { "id": 8, "tasks": ["2.0"] },
    { "id": 9, "tasks": ["2.1", "2.2"] },
    { "id": 10, "tasks": ["2.3", "2.4"] },
    { "id": 11, "tasks": ["2.5", "2.6"] },
    { "id": 12, "tasks": ["3.1"] },
    { "id": 13, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 14, "tasks": ["3.5", "3.6"] },
    { "id": 15, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 16, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 17, "tasks": ["5.4"] },
    { "id": 18, "tasks": ["6.1", "6.2"] },
    { "id": 19, "tasks": ["6.3", "6.4", "6.5", "6.6"] },
    { "id": 20, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 21, "tasks": ["7.5", "7.6"] }
  ]
}
```
