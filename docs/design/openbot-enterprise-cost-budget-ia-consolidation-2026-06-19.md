# 企业端「成本与预算」模块 — 信息架构整合优化方案

Date: 2026-06-19

Status: **Frozen**（Phase 1–4 验收通过，2026-06-19）

Revision: v2.1（v2.0 + 待办数据源 / analytics 口径 / invoices 兼容 / nav 模块必做）

Audience: 产品、企业端 UI、Gateway/Billing、Subscription Commerce、QA

---

## Related Docs

- 计费内核（Billing Layer）：`.kiro/specs/cost-budget-billing/`
- 商业闭环（Commercial Layer）：`.kiro/specs/subscription-commerce/`
- 企业 UI 基线：`.kiro/specs/enterprise-ui-baseline/tasks.md`（任务 17）
- 套餐权益 v2 / 预测：`.kiro/specs/package-entitlement-v2/`
- 代码锚点：
  - 模块总外框：`ui/src/ui/views/cost-budget/cost-budget-page.ts`
  - 订单页：`ui/src/ui/views/cost-budget/cost-budget-orders.ts`
  - 发票页：`ui/src/ui/views/cost-budget/cost-budget-invoices.ts`
  - 席位面板：`ui/src/ui/views/cost-budget/cost-budget-seats-panel.ts`
  - RPC 契约：`ui/src/ui/capability/cost-budget-billing/endpoints.ts`
  - 子路由：`ui/src/ui/navigation.ts`（`COST_BUDGET_SUB_ROUTES`）
  - 企业表面挂载：`ui/src/ui/ports/enterprise/views/enterprise-usage-surface.ts`

---

## 0. 执行摘要

企业端「成本与预算」模块在工程上已具备 **Billing Layer** 与 **Commercial Layer** 双轨 RPC 能力，但 **前端 IA 仍按后端域平铺 Tab**，导致「选套餐 → 订阅 → 支付 → 开票」用户心智被打断（典型：`subscription` 创建订单后 `onNavigate("orders")`，见 `cost-budget-page.ts:1125-1145`、`1207-1215`、`1333-1354`）。

**产品判断（专家审阅：方向正确）：** 收窄导航、商业线以订单为轴、`Bill` 与 `Commercial_Order` 分离、resources/control/analytics 归并——均与现状问题高度一致。

**工程策略（v2.0 收紧）：** 不是一次性大重构，而是 **路由先收敛、页面后归并、组件逐步抽离** 的渐进式改造。原因：当前模块已是 **单页聚合加载 + 分 route 渲染** 模式——`loadAll()` 并行拉取订阅/预算/资源/账单/预测/分析，`renderSubPage()` 按子路由切内容（`cost-budget-page.ts:283-344`、`1930-1966`）。**IA 调整非常适合做；底层数据边界与 RPC 不应先动。**

```text
目标：收窄导航 · 收直商业线 · 区分「买套餐」与「看用量」
手段：外壳先收敛（4 Tab）→ 行为收直（panel 切换）→ 组件物理归并
约束：不新增聚合 RPC · 不删兼容子路由 · 不合并 orders/invoices 源文件
```

**建议顶层 Tab 数量：** 9 → **4**（总览 · 订阅与订单 · 席位与权限 · 用量与设置）。

---

## 0.1 专家审阅结论（2026-06-19）

| 维度                     | 结论                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| 问题诊断                 | **批准** — Billing + Commercial 双轨 vs 平铺 Tab 的矛盾判断准确         |
| 4 Tab 目标               | **批准** — 总览 / 订阅与订单 / 席位 / 用量与设置                        |
| 商业线以订单为轴         | **批准** — 与 `cost-budget-orders.ts` 现有结账工作台角色最匹配          |
| Bill 降出一级 Tab        | **批准（有条件）** — 总览吸收 **摘要与入口**，非吞并完整 billing 能力   |
| invoices 处理            | **修改** — 不「取消发票页」，而是 **拆组件 + 订单页组合**               |
| 路由一次性切 query panel | **修改** — 先做 **4 Tab 外壳 + 隐藏兼容子路由**，后做内容内嵌           |
| 待办区                   | **批准** — 纯前端规则推导，**不新增 Gateway 聚合 RPC**                  |
| 用量与设置默认 panel     | **修改** — 默认 **预算与控制**（`control`），非 resources               |
| analytics 可见性         | **批准** — Phase 1 冻结为 `aorTotal > 0`（见 §4.7.1）                   |
| 待办 pending 数据源      | **修改已纳入** — Phase 1 仅用 `subscription.pendingOrders`（见 §4.6.1） |
| `/usage/invoices` 兼容   | **拍板** — Phase 3 保留页级 wrapper；Phase 4 redirect（见 §6.4）        |
| `cost-budget-nav.ts`     | **必做** — Phase 1 必建，非可选（见 §8）                                |

---

## 1. 背景与问题陈述

### 1.1 产品定位

「成本与预算」是企业管理员的核心控制面，承担三类任务：

| 任务类型     | 用户说法                             | 频率                 |
| ------------ | ------------------------------------ | -------------------- |
| **商业交易** | 买套餐、续费、付款、开票             | 低，但步骤多、容错低 |
| **授权治理** | 给谁席位、什么档位、同步模型         | 中                   |
| **成本运营** | 本月花多少、会不会超、Bot/并发够不够 | 高                   |

三类任务 **不应在同一导航层级平行陈列**。

### 1.2 用户心智（目标模型）

```text
选套餐 → 确认订阅 → 生成订单 → 支付 → （可选）开票
              ↓
        我的订单（查历史 / 继续支付 / 申请开票 / 下载发票）
              ↓
        分配席位 → 员工可用 AI
              ↓
        总览看本月成本与周期账单摘要
```

**关键原则：** 付费与开票在 **「我的订单」** 上下文完成；不再单独寻找「发票与开票」一级 Tab。

### 1.3 现状 IA（2026-06-19 代码）

| #   | Tab        | route          | 主要职责                                   |
| --- | ---------- | -------------- | ------------------------------------------ |
| 1   | 总览       | `overview`     | KPI、成本构成、预测、钻取                  |
| 2   | 套餐与订阅 | `subscription` | 选套餐、订阅/换套餐/续费、待支付 banner    |
| 3   | 订单与支付 | `orders`       | 订单列表、结账（**已是商业主工作台**）     |
| 4   | 发票与开票 | `invoices`     | 开票资料、按订单申请（**完整页级状态机**） |
| 5   | 席位与权限 | `seats`        | 分配 / 治理 / 岗位报表                     |
| 6   | 资源与配额 | `resources`    | Bot、并发（信息量不足以支撑一级入口）      |
| 7   | 使用量分析 | `analytics`    | AOR 计量（**常为空态**）                   |
| 8   | 账单与明细 | `billing`      | 周期 Bill 列表（**UI 很薄**）              |
| 9   | 预算与控制 | `control`      | 预算编辑真入口（与总览告警重复展示）       |

### 1.4 现状实现约束（实施必须尊重）

```text
cost-budget-page.ts
├── loadAll()          ← 一次并行拉全量（见下表）；不含 commercial-orders.list
├── renderSubPage()    ← 按 subRoute switch 渲染，无独立页面 bundle
└── SUB_ROUTE_TABS     ← 9 项顶层 Segmented Nav（Phase 1 改为 4 项视觉 Tab）
```

**`loadAll()` 当前并行 RPC（`:283-316`）— Phase 1 待办/analytics 只能基于此集合推导：**

| 写入 `data.*`  | RPC                              | 待办/IA 用途                                          |
| -------------- | -------------------------------- | ----------------------------------------------------- |
| `dashboard`    | `billing.dashboard`              | 总览 KPI、成本构成                                    |
| `subscription` | `subscriptions.get`              | 含 **`pendingOrders`**（待办唯一商业订单源，Phase 1） |
| `seats`        | `seats.list`                     | 席位待办                                              |
| `allocation`   | `enterprise-allocation.overview` | 天花板、未分配提示                                    |
| `budget`       | `budget.get`                     | 预算待办                                              |
| `resources`    | `resources.summary`              | 容量 KPI                                              |
| `bills`        | `billing.list-bills`             | 总览周期账单摘要                                      |
| `analytics`    | `billing.analytics({})`          | analytics 内 Tab 显隐（Phase 1）                      |
| `attribution`  | `billing.attribution-by-seat`    | 席位治理                                              |
| `forecast`     | `consumption-forecast.get`       | 预测、预算告警待办                                    |

**不在 `loadAll()` 内：** `commercial-orders.list`（由 `cost-budget-orders.ts` 进入 `orders` route 时 **自行 lazy load**）。因此 Phase 1 **不得**假设待办能统计「全量 pending 商业订单」。

`navigation.ts` 中 `COST_BUDGET_SUB_ROUTES` 为 **九个固定字符串**；`parseCostBudgetSubRouteFromPath()` 仅解析 `/usage/{sub}` 第一段（`:91-111`）。

### 1.5 已识别的 IA 缺陷（摘要）

- **商业线四段跳转：** subscription → orders → invoices 跨 Tab（代码已多处 `onNavigate("orders")`）。
- **两种「账单」同级：** `Commercial_Order` vs `Bill` 混在导航层。
- **信息重复：** 预测/预算告警、容量 KPI、待支付 banner 多处出现。
- **一级入口过多：** 9 Tab + seats 内 3 Tab；analytics 对多数租户为空态。

---

## 2. 现状功能清单（基于代码梳理）

> 完整能力块与 RPC 对照见 v1.0 §2；迁移后须 **功能不丢失**，此处不重复展开。

**实施相关要点：**

| 模块     | 文件                                    | 改造时注意                                                              |
| -------- | --------------------------------------- | ----------------------------------------------------------------------- |
| 订单     | `cost-budget-orders.ts`                 | 已有 master-detail、对公/在线支付、paid→席位 CTA；**保留 route 与测试** |
| 发票     | `cost-budget-invoices.ts`               | 页级状态机（资料/已支付订单/申请记录）；**先拆组件再组合**              |
| 周期账单 | `cost-budget-page.ts` `renderBilling()` | 仅列表壳；RPC 已有 `get-bill`/`export-bill` 待 UI 展开                  |
| 预算     | `renderControl()`                       | **唯一可编辑**预算入口；总览仅只读告警                                  |

---

## 3. 设计原则

| #   | 原则                                   | 说明                                                                                       |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1  | **顶层 Tab = 用户阶段**                | 4 个日常入口；专项二级化                                                                   |
| P2  | **商业线以订单为轴**                   | 支付、开票动作在订单上下文                                                                 |
| P3  | **Commercial Order ≠ Bill**            | 订单=买套餐；Bill=周期结算                                                                 |
| P4  | **总览 = 指挥台**                      | 看数 + 待办 + 周期账单 **摘要**                                                            |
| P5  | **渐进式收敛**                         | **外壳先收敛，内容后归并**；不一次性改 route 语义                                          |
| P6  | **兼容子路由长期保留（Phase 1–2）**    | `orders`/`invoices`/… 仍可 deep link；对外隐藏一级入口                                     |
| P7  | **RPC 与 loadAll 边界不变（Phase 1）** | 不扩 `loadAll()`、不新增聚合 RPC；待办仅消费上表字段；全量订单列表仍属 orders 页 lazy load |
| P8  | **发票 = 拆页不删页**                  | 抽组件由订单组合；资料配置独立抽屉/次级面板                                                |
| P9  | **Bill = 总览收入口权**                | 摘要进总览；完整列表/未来详情进二级面板，避免总览再次膨胀                                  |

---

## 4. 目标信息架构

### 4.1 顶层导航（4 Tab — 用户可见）

```text
┌────────────────────────────────────────────────────────────────┐
│  [ 总览 ]  [ 订阅与订单 ]  [ 席位与权限 ]  [ 用量与设置 ]        │
└────────────────────────────────────────────────────────────────┘
```

| 新 Tab（视觉） | 对应内容域                                    | 定位               |
| -------------- | --------------------------------------------- | ------------------ |
| **总览**       | `overview` + 周期账单摘要                     | 看成本、预测、待办 |
| **订阅与订单** | `subscription` + `orders` +（后期）发票动作   | 商业闭环           |
| **席位与权限** | `seats`                                       | 授权治理           |
| **用量与设置** | `control` + `resources` + `analytics`（条件） | 预算编辑默认       |

### 4.2 两阶段路由模型（v2.0 核心）

#### 阶段 A — 外壳收敛（Phase 1，推荐先做）

- **用户只见 4 Tab**；点击 Tab 时 **映射到既有 subRoute**（不必立刻改 URL 结构）。
- **保留全部 9 个 `COST_BUDGET_SUB_ROUTES`** 为 **兼容子路由**（含 `/usage/orders`、`/usage/invoices` 等 deep link）。
- `renderSubPage()` **暂不搬家**；仅改 `SUB_ROUTE_TABS` 展示层 + Tab→route 映射表。
- 旧书签 **继续有效**；测试里 `subRoute="orders"` **无需立刻改**。

```text
用户点击「订阅与订单」
  → 默认 subRoute=subscription（或内部记录 activePanel）
  → 仍 renderSubscription() / renderOrders()，逻辑不变

用户访问 /usage/orders（旧链接）
  → 仍 parse 为 orders，高亮「订阅与订单」Tab
```

#### 阶段 B — 内容归并（Phase 2–3）

- 订阅流：`onNavigate("orders")` → **同 Tab 内 panel 切换** + `ordersInitialOrderId`。
- `subscription` 壳内 Tab：`当前套餐 | 选择套餐 | 我的订单`（可配合 query `?panel=`，**在阶段 A 稳定后**引入）。
- 发票：组件嵌入订单详情；**Phase 3 仍保留** `/usage/invoices` 页级 wrapper（见 §6.4）；Phase 4 再 optional redirect。

**不急于：** 将 `subscription` route 语义改成承载一切的唯一 route 名；**概念上**叫「订阅与订单」，**路由上**可长期并存 `subscription` + `orders`。

### 4.3 「订阅与订单」— 目标内结构

**内 Tab（Phase 2 落地）：**

```text
[ 当前套餐 ]  |  [ 选择套餐 ]  |  [ 我的订单 ]
```

| 内 Tab   | Phase 1                                | Phase 2+                |
| -------- | -------------------------------------- | ----------------------- |
| 当前套餐 | 即 `renderSubscription()` 已订阅部分   | 去掉跨 Tab banner       |
| 选择套餐 | 即套餐对比 / contact_sales             | 创建订单 → panel=orders |
| 我的订单 | 仍可通过 Tab 映射直达 `renderOrders()` | 同壳内切换，零顶层跳转  |

**订单详情目标动作区（Phase 3 组件化后）：**

```text
订单 #xxx
├── 基本信息
├── [ 支付 ]                         ← pending
├── [ 申请开票 ] / 开票状态 / PDF     ← paid（RequestInvoiceAction 组件）
└── [ 下一步：分配席位 ]              ← 已有 order-paid-goto-seats
```

### 4.4 发票 — 组件抽离策略（非删页）

`cost-budget-invoices.ts` 拆为可组合单元（**新文件或同目录 export**）：

| 组件                    | 职责                     | 挂载位置                             |
| ----------------------- | ------------------------ | ------------------------------------ |
| `BillingProfileForm`    | 开票资料 CRUD            | 模块内「开票设置」抽屉；首次申请引导 |
| `RequestInvoiceAction`  | 单订单申请开票           | 订单详情 actions                     |
| `InvoiceRequestList`    | 申请记录表               | 我的订单页底部 或 开票设置内         |
| `InvoiceEligibleOrders` | 可开票订单列表（过渡期） | Phase 2 前保留于原 invoices route    |

**原则：** 订单详情只承载 **该订单** 的发票动作与状态；**不**把完整 invoices 页硬塞进详情（避免超长页 + 状态机耦合）。

Phase 1–2：`/usage/invoices` **仍渲染完整页**（兼容）；对外 **无一级 Tab 入口**。

### 4.5 总览 — 周期账单（收入口权，不收完整职责）

| 层级           | 内容                                     | 阶段                                  |
| -------------- | ---------------------------------------- | ------------------------------------- |
| 总览摘要       | 最近 **3～5 条** 周期 Bill + 金额 + 周期 | Phase 1 可用 `data.bills` 切片        |
| 查看全部       | 链至 **二级面板**（抽屉 / 全屏 overlay） | Phase 1 可先链 hidden route `billing` |
| Bill 详情/导出 | `billing.get-bill` / `export-bill`       | Phase 4+；**不**塞回一级 Tab          |

超额成本钻取 → **周期账单**上下文，非商业订单。

### 4.6 总览 — 待办区（纯前端推导）

基于 **`loadAll()` 已写入 `data` 的字段** 组合，**不新增 RPC、Phase 1 不扩 `loadAll()`**。

实现：`buildCostBudgetTodos(data)` 纯函数 + 单元测试（输入类型对齐 `CostBudgetData`，见 `cost-budget-page.ts`）。

#### 4.6.1 Phase 1 冻结规则（必做）

| 待办       | 条件                   | 数据来源（仅 Phase 1）                                                                       | 跳转                                    |
| ---------- | ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| 未订阅     | 无 active subscription | `data.subscription?.subscription == null`                                                    | 订阅与订单 → `subscription`             |
| 待支付订单 | 存在 pending 商业订单  | **`data.subscription?.pendingOrders`**（来自 `subscriptions.get`，与订阅页 banner 同源）     | 订阅与订单 → `orders` + 首条 `order.id` |
| 未分配席位 | 已订阅但缺席位         | `data.allocation` + `data.seats`（规则与现有 `seats-no-subscription` / governance 提示一致） | `seats` / assign                        |
| 预算告警   | 预计超阈               | `data.forecast` + `data.budget`（复用 `renderForecastBudgetAlerts` 判定）                    | 用量与设置 → `control`                  |

**Phase 1 明确不做：**

- 不用 `commercial-orders.list` 做待办计数（该 RPC **不在** `loadAll()`）。
- 不承诺「历史上所有 pending 订单」与 orders 页列表 100% 一致；仅与 **`subscriptions.get.pendingOrders`** 一致。

**Phase 2 可选增强（二选一，实施前 ADR）：**

| 方案          | 说明                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| A. Lazy fetch | 用户进入 `orders` route 后，orders 页 load 结果 **回写**模块级 pending 快照，供待办刷新     |
| B. 扩 loadAll | 在 `loadAll()` 增加 `commercial-orders.list`（**改变 Phase 1 边界**，需单独 PR 与性能评估） |

**默认推荐 Phase 2 方案 A**，保持 Phase 1 的 P7 边界不变。

### 4.7 用量与设置 — 内 Tab

```text
[ 预算与控制 ]  |  [ 容量与配额 ]  |  [ 使用量分析 ]  ← 条件显示
     ↑ 默认 panel
```

- **默认 panel = `control`（预算与控制）** — 唯一可编辑预算入口；符合管理员高频任务。
- Phase 1：点击「用量与设置」Tab → 默认 `subRoute=control`；resources 经内 Tab 或次级 Segmented 映射旧 route。

#### 4.7.1 analytics 内 Tab 显隐 — Phase 1 冻结规则

当前前端 **没有**「租户已启用 AOR」的独立信号；仅有 `loadAll()` 拉取的 `data.analytics`（`billing.analytics({})`）与常量 `AOR_METERING_KEYS`（`:101-107`），与 `renderAnalytics()` 内 `aorTotal` 计算一致（`:1804-1808`）。

**Phase 1 冻结（可执行、无需新 RPC）：**

```typescript
// 与 renderAnalytics() 同源
const aorTotal = AOR_METERING_KEYS.reduce((sum, key) => sum + (data.analytics?.byKey[key] ?? 0), 0);
const showAnalyticsPanel = aorTotal > 0;
```

| `showAnalyticsPanel` | 「用量与设置」内 UI                                                                     |
| -------------------- | --------------------------------------------------------------------------------------- |
| `false`              | **不渲染** analytics 内 Tab / 次级入口；`subRoute=analytics` deep link 仍可直达（兼容） |
| `true`               | 显示「使用量分析」内 Tab                                                                |

**非目标（另开任务，不阻塞 Phase 1 Frozen）：**

- 新增 Gateway「AOR 启用态」字段或租户 capability 信号。
- 用 `analytics.recordCount` / `totalQuantity` 等非 AOR 键做显隐（避免误展示空壳 Tab）。

**Phase 4+ 可选：** 若有正式 `tenantCapabilities.aor` 信号，可改为「启用即显示 Tab + 空态引导」；替换规则须 ADR。

**实现备注（2026-06-19 收官）：** Gateway 已在 `billing.dashboard` / `billing.analytics` 响应中预埋 `tenantCapabilities.aor`（`src/gateway/billing/resolve-tenant-capabilities.ts`）。**UI Phase 1–4 仍严格遵循本节冻结规则**（`aorTotal > 0`）；capability 驱动显隐仅可在 Phase 4.7 ADR 后启用。

### 4.8 席位与权限 — 保持不变

内 Tab：分配 · 治理 · 岗位报表；hash 钻取保留。

---

## 5. 用户旅程（目标态）

### 5.1 新企业首次订阅

**Phase 1 后（外壳收敛）：** 仍可能经 subRoute 切换，但 **用户始终只在 4 个顶层 Tab 内**；旧 orders 路由高亮「订阅与订单」。

**Phase 2 后（行为收直）：**

```text
总览（待办）→ 订阅与订单 / 选择套餐 → 确认
→ 同模块 panel=我的订单 → 支付 → （可选）订单内开票
→ 分配席位 → 总览看周期摘要
```

### 5.2 财务角色

- 入口：**订阅与订单 → 我的订单**（Phase 1 即 `orders` route，无一级 Tab 文案）。
- 周期用量：**总览摘要** → 查看全部（二级面板 / 兼容 billing route）。

---

## 6. 路由与兼容策略（修订）

### 6.1 Phase 1 — Tab 映射表（推荐）

| 视觉 Tab   | 默认 subRoute  | 可映射的兼容 subRoute                              |
| ---------- | -------------- | -------------------------------------------------- |
| 总览       | `overview`     | `billing`（高亮总览，内容仍 renderBilling 或摘要） |
| 订阅与订单 | `subscription` | `orders`, `invoices`                               |
| 席位与权限 | `seats`        | —                                                  |
| 用量与设置 | `control`      | `resources`, `analytics`                           |

**`COST_BUDGET_SUB_ROUTES`：** Phase 1 **维持 9 项**；`resolveCostBudgetNavTab(subRoute)` 等指标函数放在 **`cost-budget-nav.ts`（Phase 1 必建）**，见 §8。

### 6.2 Phase 2+ — Query panel（可选，稳定后引入）

| 示例                                         | 说明                                                |
| -------------------------------------------- | --------------------------------------------------- |
| `/usage/subscription?panel=orders&orderId=…` | 内 Tab 深链                                         |
| `/usage/orders?orderId=…`                    | **继续有效**；映射到 subscription Tab + orders 内容 |

### 6.3 Redirect 策略（Phase 2 起，渐进）

| 旧 route   | 行为                                                |
| ---------- | --------------------------------------------------- |
| `orders`   | **保留解析**；视觉归「订阅与订单」；不要求 URL 改写 |
| `invoices` | **保留解析**；无一级入口；Phase 3–4 策略见 §6.4     |
| `billing`  | 高亮「总览」；内容可仍在 billing 或迁摘要           |

**禁止 Phase 1：** 从 `COST_BUDGET_SUB_ROUTES` 删除 `orders`/`invoices` 等枚举（会破坏现有测试与 deep link）。

### 6.4 `/usage/invoices` 兼容策略（已拍板）

| 阶段          | 行为                                                                                            | 理由                            |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| **Phase 1–2** | `/usage/invoices` 仍 `renderCostBudgetInvoicesPage()`；视觉 Tab 归「订阅与订单」                | 零行为变更；书签/popstate 稳定  |
| **Phase 3**   | **保留页级 wrapper**（薄壳调用拆出的组件）；订单详情为主入口，invoices route 作兼容 fallback    | 测试可渐进迁移；不强制 redirect |
| **Phase 4**   | 可选：`/usage/invoices` → `subscription?panel=orders&invoice=settings`（或等价）+ popstate 测试 | 仅在 redirect 与组件测完备后    |

**禁止 Phase 3：** 在组件未稳定前删除 invoices route 或 silent redirect（避免 `app-settings` 路由测与书签断裂）。

---

## 7. 实施分期（v2.1 渐进式）

### Phase 0 — 方案冻结

- [x] 专家审阅 v1：方向批准，渐进式收敛
- [x] 专家审阅 v2.1：待办数据源 / analytics 口径 / invoices 兼容 / nav 必做 — 已写入本文
- [x] 项目组 sign-off 后改 Status 为 **Frozen**（2026-06-19）

### Phase 1 — 外壳收敛（P0，1～2 迭代）

**目标：** 用户只见 4 Tab；待办区；兼容子路由全保留；**不改** `onNavigate("orders")` 行为。

| 任务 | 说明                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0  | **新建 `cost-budget-nav.ts`**：`CostBudgetNavTab` 类型、4 Tab 定义、`resolveCostBudgetNavTab(subRoute)`、`defaultSubRouteForNavTab()` |
| 1.1  | `SUB_ROUTE_TABS` → 4 项视觉 Tab；映射逻辑 **仅引用** nav 模块                                                                         |
| 1.2  | 访问 `orders`/`invoices`/… 时正确高亮所属视觉 Tab                                                                                     |
| 1.3  | 新建 `cost-budget-todos.ts`：`buildCostBudgetTodos(data)` — **严格 §4.6.1**（仅 `pendingOrders`）                                     |
| 1.4  | 总览增加周期账单 **摘要**（最近 3～5 条 +「查看全部」→ billing 或抽屉）                                                               |
| 1.5  | 「用量与设置」默认 landing `control`                                                                                                  |
| 1.6  | analytics 内 Tab：**仅当 `aorTotal > 0`** 显示（§4.7.1）                                                                              |
| 1.7  | 更新 browser test：Tab 映射、todos、analytics 显隐；**保留** `subRoute="orders"`                                                      |

**验收：** 9 subRoute 均可达；顶层仅 4 Tab；**`loadAll()` 无变更**；待办与 `subscription.pendingOrders` 一致；现有 orders 测试绿。

### Phase 2 — 行为收直（P1）

**目标：** 商业流 **同视觉 Tab 内** panel 切换；仍保留 `/usage/orders` route。

| 任务 | 说明                                                                                   |
| ---- | -------------------------------------------------------------------------------------- |
| 2.1  | `subscription` 内 Tab 壳（plan / catalog / orders）                                    |
| 2.2  | 订阅/续费/换套餐：`onNavigate("orders")` → **panel 切换** + select order（同视觉 Tab） |
| 2.3  | 移除 subscription 跨 Tab banner 文案，改 panel 内链                                    |
| 2.4  | 待办区跳转改用 panel + orderId                                                         |
| 2.5  | （可选）orders lazy load 回写 pending 快照，增强待办准确性（§4.6.1 方案 A）            |

**验收：** 用户视角「订阅与订单」内完成选套餐→结账，**无顶层 Tab 切换**；`/usage/orders` deep link 仍可用。

### Phase 3 — 发票组件化（P2）

| 任务 | 说明                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 3.1  | 从 `cost-budget-invoices.ts` 抽出 `BillingProfileForm`、`RequestInvoiceAction`、`InvoiceRequestList` |
| 3.2  | 订单详情嵌入 `RequestInvoiceAction` + 开票状态                                                       |
| 3.3  | 开票资料 → 抽屉 / 次级面板（非订单详情长表单）                                                       |
| 3.4  | `/usage/invoices` **保留页级 wrapper**（调用拆出组件）；不 redirect（§6.4）                          |

**验收：** paid 订单在详情页可完成开票；资料配置可达；`/usage/invoices` deep link 仍渲染；原 commerce 测试迁移至组件测。

### Phase 4 — 内容与体验抛光（P3，可选）

| 任务 | 说明                                                                         |
| ---- | ---------------------------------------------------------------------------- |
| 4.1  | 周期账单二级面板 + `billing.get-bill` 详情                                   |
| 4.2  | 未订阅默认 landing → 订阅与订单                                              |
| 4.3  | 按角色隐藏 Tab                                                               |
| 4.4  | enterprise-ui-baseline T17 样式归一                                          |
| 4.5  | 评估是否收缩 `COST_BUDGET_SUB_ROUTES` 枚举（**仅**在 redirect 与测试完备后） |
| 4.6  | （可选）`/usage/invoices` redirect 至 subscription + panel（§6.4 Phase 4）   |
| 4.7  | （可选）租户 AOR 启用态信号，替换 `aorTotal > 0` 显隐规则                    |

---

## 8. 文件级改造映射

| 文件                                   | Phase | 改造要点                                                                                                                        |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`cost-budget-nav.ts`（新，必做）**   | **1** | `CostBudgetNavTab`、`NAV_TABS`、`resolveCostBudgetNavTab()`、`defaultSubRouteForNavTab()`、`isAnalyticsPanelVisible(analytics)` |
| `cost-budget-todos.ts`（新，必做）     | 1     | `buildCostBudgetTodos(data)` — §4.6.1；单元测试覆盖 pendingOrders                                                               |
| `cost-budget-page.ts`                  | 1–2   | 消费 nav/todos 模块；账单摘要；Phase 2 panel 状态；**不内联** Tab 映射表                                                        |
| `cost-budget-orders.ts`                | 2–3   | embed 模式；挂载 `RequestInvoiceAction`；Phase 2 可选 pending 回写                                                              |
| `cost-budget-invoices.ts`              | 3     | 拆 export 组件；**页级 wrapper 保留**至 Phase 4                                                                                 |
| `cost-budget-nav.node.test.ts`（新）   | 1     | Tab↔route 映射、analytics 显隐                                                                                                  |
| `navigation.ts`                        | 1     | **不删**九路由枚举；redirect 留 Phase 4                                                                                         |
| `cost-budget-page.browser.test.ts`     | 1–2   | Tab 映射 + panel 切换；保留 orders 用例                                                                                         |
| `cost-budget-commerce.browser.test.ts` | 3     | 组件级开票                                                                                                                      |

**明确不做（Phase 1）：** 合并 orders/invoices 单文件；**扩展 `loadAll()`**（含 `commercial-orders.list`）；新增待办 RPC；在 page.ts 内联 Tab 映射。

---

## 9. 非目标（Out of Scope）

- 修改 `Commercial_Order` / `Bill` / `Invoice_Request` 模型
- 新增 Gateway 聚合 RPC（含待办、商业仪表盘）
- 重构 `loadAll()` 为按 Tab 懒加载（可另立 perf spec）
- 平台端定价 IA 变更
- Phase 1 删除 `orders`/`invoices` 路由枚举

---

## 10. 风险与缓解

| 风险                                      | 缓解                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| 一次性改 route + query 导致回归面大       | **Phase 1 只改外壳映射**                                   |
| 发票状态机硬塞进订单详情                  | **组件抽离 + 抽屉承载资料**                                |
| 总览吞并 billing 后未来膨胀               | **只收摘要 + 二级面板**                                    |
| browser test 大量依赖 `subRoute="orders"` | Phase 1 **保留** orders route                              |
| 视觉 4 Tab 与真实 subRoute 不一致困惑调试 | `data-testid="nav-tab-commerce"` + `data-active-sub-route` |

---

## 11. 验收标准

### 11.1 功能不丢失 — 同 v1.0 §11.1

### 11.2 体验验收（按 Phase）

| Phase | 标准                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 1     | 顶层 ≤4 Tab；9 subRoute 可达；待办与 `pendingOrders` 一致；`aorTotal===0` 时无 analytics 内 Tab；账单摘要可见 |
| 2     | 订阅→支付无 **顶层** Tab 切换                                                                                 |
| 3     | 订单详情可开票；资料抽屉可用                                                                                  |

### 11.3 测试

- Phase 1 起：`cost-budget-page.browser.test.ts` 全绿
- 新增：`cost-budget-todos.node.test.ts`、`cost-budget-nav.node.test.ts`
- Phase 3：`cost-budget-commerce.browser.test.ts` 适配组件

---

## 12. 专家团队审核清单

| #   | 审核项                  | v2.0         | v2.1                                      |
| --- | ----------------------- | ------------ | ----------------------------------------- |
| 1   | 顶层 4 Tab              | 批准         | 批准                                      |
| 2   | 商业线以订单为轴        | 批准         | 批准                                      |
| 3   | Bill 降出一级 Tab       | 批准         | 批准                                      |
| 4   | invoices 处理           | 拆组件       | + Phase 3 wrapper / Phase 4 redirect 拍板 |
| 5   | 用量与设置              | 默认 control | 批准                                      |
| 6   | 路由策略                | 先外壳       | 批准                                      |
| 7   | Phase 1 保留旧 subRoute | 批准         | 批准                                      |
| 8   | 待办数据源              | 批准（笼统） | **已收紧** — Phase 1 仅 `pendingOrders`   |
| 9   | analytics 显隐          | 批准（笼统） | **已冻结** — `aorTotal > 0`               |
| 10  | subscription-commerce   | 无冲突       | 无冲突                                    |
| 11  | `cost-budget-nav.ts`    | —            | **必做** Phase 1                          |

---

## 13. 附录 A — 概念对照表

| 用户说法      | 系统实体            | 新 UI 位置                          |
| ------------- | ------------------- | ----------------------------------- |
| 买套餐 / 续费 | `Commercial_Order`  | 订阅与订单 → 我的订单               |
| 付款          | Payment + 结账 UI   | 订单详情（`cost-budget-orders.ts`） |
| 开票          | `Invoice_Request`   | 订单详情 + 开票设置抽屉             |
| 套餐生效      | `Subscription`      | 订阅与订单 → 当前套餐               |
| 给谁用        | `Seat`              | 席位与权限                          |
| 本月花了多少  | dashboard + `Bill`  | 总览 + 周期账单摘要                 |
| 会不会超      | forecast + `Budget` | 总览告警；用量与设置 → 预算与控制   |
| Bot 够不够    | `resources.summary` | 用量与设置 → 容量与配额             |

---

## 14. 附录 B — 与 subscription-commerce 对齐

R147：「在成本与预算模块**内**完成下单、支付、查看订单与申请发票」。本方案通过 **渐进 IA** 落实该故事，Phase 2–3 完成后用户不再为开票单独找 Tab。

---

## 15. 附录 C — 架构示意（渐进收敛）

```text
                    ┌─────────────────────────────────────┐
 Phase 1            │  4 Tab 视觉层（cost-budget-nav.ts）  │
                    └─────────────────┬───────────────────┘
                                      │ resolveCostBudgetNavTab()
                    ┌─────────────────▼───────────────────┐
                    │  9 subRoute（COST_BUDGET_SUB_ROUTES）│
                    │  overview | subscription | orders | … │
                    └─────────────────┬───────────────────┘
                                      │ renderSubPage()
                    ┌─────────────────▼───────────────────┐
                    │  loadAll() 单页聚合（不变）          │
                    └─────────────────────────────────────┘

 Phase 2+：subscription 壳 + panel  ──►  renderOrders 内嵌
 Phase 3+：RequestInvoiceAction    ──►  订单详情组合
```

---

## 16. 附录 D — Phase 1 冻结实现契约（开发/QA 对照）

| 契约项               | 必须                                                |
| -------------------- | --------------------------------------------------- |
| `loadAll()` RPC 列表 | 与 §1.4 表一致，**不得**加 `commercial-orders.list` |
| 待支付待办           | 仅 `data.subscription?.pendingOrders?.length > 0`   |
| analytics 内 Tab     | `AOR_METERING_KEYS` 求和 `> 0` 才显示               |
| 视觉 Tab 数          | 4                                                   |
| 兼容 subRoute        | 9 个均可 parse + render                             |
| Tab 映射代码位置     | `cost-budget-nav.ts`，不在 page.ts 内联             |
| `/usage/invoices`    | 仍可访问、仍渲染 invoices 页                        |

---

## 17. 变更记录

| 版本   | 日期       | 说明                                                                                                                           |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v1.0   | 2026-06-19 | 初稿                                                                                                                           |
| v2.0   | 2026-06-19 | 渐进式收敛、专家首轮审阅                                                                                                       |
| v2.1   | 2026-06-19 | 冻结前必答题：pendingOrders 待办、analytics `aorTotal>0`、invoices Phase3/4 策略、nav 必做、loadAll 字段表                     |
| v2.1.1 | 2026-06-19 | Phase 1–4 实现收官：4 Tab IA、商业 panel、发票组件化、周期账单 drawer；验收整改（invoices wrapper-first、类型收口、i18n 去重） |

---

## 18. 验收记录（2026-06-19）

| 门槛                                         | 结果                      |
| -------------------------------------------- | ------------------------- |
| 方案与实现一致（v2.1 冻结口径）              | 通过                      |
| `ui/src/ui/views/cost-budget` + routing 测试 | 74 passed                 |
| IA 相关 `pnpm tsgo`（cost-budget 生产代码）  | 零报错                    |
| i18n `costBudget` 段 duplicate key           | 无                        |
| `/usage/invoices`                            | wrapper 渲染，不 redirect |

复验命令：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/views/cost-budget ui/src/ui/app-settings.cost-budget-routing.test.ts

pnpm tsgo 2>&1 | rg "cost-budget"   # 应为空
```

---

**文档状态：** **Frozen** — Phase 1–4 已落地；Phase 4.6 redirect / Phase 4.7 UI capability 显隐仍属可选后续。
