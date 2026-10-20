# 平台「套餐与定价」经营控制台 — 任务交付与验收汇报

**汇报日期**：2026-06-13  
**任务主题**：将平台「套餐与定价」首屏从基础销售统计升级为 Stripe 式经营控制台，并完成经营表 UI 精简与操作链路打通  
**适用验收范围**：Phase 0–3 全量交付 + 用户反馈修复项

---

## 1. 背景与目标

### 1.1 业务背景

原「套餐与定价」页面以套餐 CRUD 与版本管理为主，缺少平台经营者视角的收入、成本、毛利与订阅动态总览，Tab 结构也未区分「套餐配置」「资源策略」「经营分析」三类工作流。

### 1.2 交付目标

| 目标     | 说明                                                      |
| -------- | --------------------------------------------------------- |
| 经营首屏 | 套餐 Tab 首屏展示 KPI → 分布 → 经营表三层结构             |
| 信息架构 | 子 Tab 调整为：**套餐管理** → **经营分析** → **资源策略** |
| 数据闭环 | 后端提供环比、活动流、Ledger 钻取、营销标签等能力         |
| 可钻取   | 经营表行操作可跳转经营分析、单元经济、套餐配置            |
| 销售联动 | 企业订阅页展示营销标签并按标签排序                        |
| UI 简洁  | 经营表单行展示，去除冗余版本/状态行                       |

---

## 2. 分期交付清单

### Phase 0 — 套餐 Tab 经营仪表盘（基础框架）

**实现内容**

- 新增经营总览组件 `pricing-operating-dashboard.ts`，包含：
  - **经营 KPI 卡片**：MRR、生效套餐数、活跃企业订阅数、平台毛利率
  - **套餐分布图**：按 MRR 占比横向条形展示
  - **套餐经营分析表**：套餐、企业数、MRR、ARR、成本、毛利、趋势、操作
- 页面 `page.ts` 调整：
  - 子 Tab 顺序改为「套餐管理 / 经营分析 / 资源策略」
  - 套餐 CRUD 与版本管理收入折叠面板「套餐配置与管理」

**关键文件**

- `ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.ts`
- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/styles/components.css`（`.platform-pricing__executive-*` 等样式）

---

### Phase 1 — 环比趋势与最近变化活动流

**实现内容**

- **后端扩展**
  - `platform-economics.overview` 增加 `previousByPlan`、`previousSummary`、`marginTrendDelta` 等环比字段
  - `plan-commercial-summary` 扩展 `mrrTrendDelta`、`subsTrendDelta`
  - 新增 `platform-pricing-activity` 活动流聚合（版本发布/废弃、订阅开通/结束等）
  - `platform-subscriptions.summary` 返回 `recentActivity`
- **前端展示**
  - KPI 卡片与经营表趋势列展示 MRR / 订阅数 / 毛利率环比
  - 经营总览底部「最近变化」Feed

**关键文件**

- `src/gateway/server-methods/platform-economics.ts`
- `src/gateway/billing/plan-commercial-summary.ts`
- `src/gateway/billing/platform-pricing-activity.ts`
- `src/gateway/billing/platform-pricing-activity.test.ts`
- `src/gateway/billing/plan-commercial-summary.test.ts`

---

### Phase 2 — 营销标签、钻取与升降级活动

**实现内容**

- **营销标签**
  - `Plan.marketingTags` 支持 `default` / `recommended`
  - 新增 RPC `platform-plan-bundle.set-marketing-tags`
  - 平台套餐配置区可编辑营销标签；经营表展示默认/推荐/热门/即将下线标签
- **钻取链路**
  - 经营表「经营分析」→ `setEconomicsFocus` + 切换至「经营分析」Tab
  - 经营表「单元经济」→ 打开单元经济抽屉
  - 经营表「配置」→ 展开套餐配置面板并定位套餐行
- **活动流扩展**
  - 订阅升降级事件：`subscription_upgraded` / `subscription_downgraded`
- **企业销售侧**
  - `subscriptions.get` 按营销标签排序（默认 > 推荐 > 其他，同档按价格）
  - 企业成本预算订阅页展示默认/推荐标签

**关键文件**

- `src/gateway/server-methods/platform-plan-bundle.ts`
- `src/gateway/server-methods/subscriptions.ts`
- `src/gateway/server-methods/platform-plan-bundle.test.ts`
- `ui/src/ui/ports/platform/pricing/economics-focus.ts`
- `ui/src/ui/ports/platform/pricing/unit-economics-drawer.ts`
- `ui/src/ui/views/cost-budget/cost-budget-page.ts`

---

### Phase 3 — Ledger 钻取与经营分析深化

**实现内容**

- **后端**
  - 新增 RPC `platform-economics.ledger`
  - `listFilteredUsageLedgerEntries()` 支持按 `planId`、`enterpriseId`、时间窗、条数过滤
- **前端**
  - 「经营分析」Tab：聚焦套餐时 KPI 按套餐 scope 展示
  - Ledger 明细表（按任务/模型/扣费/成本/收入）
  - 按套餐行可切换 economics focus

**关键文件**

- `src/gateway/server-methods/platform-economics.ts`
- `src/gateway/billing/usage-ledger-store.ts`
- `src/gateway/billing/usage-ledger-filter.test.ts`
- `ui/src/ui/ports/platform/pricing/economics-section.ts`
- `ui/src/ui/capability/cost-economics/endpoints.ts`

---

### 用户反馈修复 — 经营表 UI 精简与按钮打通

**问题**

1. 套餐列第二行（`v3`、`生效中` 等）信息冗余，与「热门」标签分行展示，表格行过高
2. 「经营分析 / 单元经济 / 配置」三个按钮点击无可见反馈（单元经济抽屉原在折叠 `<details>` 内）

**修复**

| 项           | 处理                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| 套餐列       | 删除版本号/状态第二行；套餐名与营销/热门/即将下线标签同一行 flex 展示                         |
| 毛利/趋势列  | 改为单行 inline 展示                                                                          |
| 单元经济抽屉 | 移至经营仪表盘与「套餐配置与管理」折叠区之间，始终可见                                        |
| 配置按钮     | 受控展开 `planConfigPanelOpen`，自动 `scrollIntoView` 到 `plan-row-{planId}`                  |
| 按钮样式     | 使用标准 `btn btn--sm`，加 `stopPropagation` 防止事件冒泡                                     |
| CSS          | `vertical-align: middle`、`.platform-pricing__operating-plan-cell` 单行布局、操作列 `z-index` |

**关键文件**

- `ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.ts`
- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/styles/components.css`

---

## 3. 验收标准（专家团队可逐项核对）

### 3.1 信息架构与首屏结构

| #   | 验收项       | 通过标准                                                               |
| --- | ------------ | ---------------------------------------------------------------------- |
| A1  | 子 Tab 顺序  | 页面展示「套餐管理」「经营分析」「资源策略」，默认进入套餐管理         |
| A2  | 经营首屏三层 | 套餐管理 Tab 首屏依次包含：KPI 区、套餐分布区、套餐经营分析表          |
| A3  | CRUD 收纳    | 套餐列表与创建入口位于可折叠「套餐配置与管理」面板内，不占据首屏主视觉 |

### 3.2 经营 KPI 与分布

| #   | 验收项     | 通过标准                                                             |
| --- | ---------- | -------------------------------------------------------------------- |
| B1  | MRR        | 展示当前周期合计 MRR（货币格式 ¥x.xx）                               |
| B2  | 生效套餐数 | 统计 `status === active` 的套餐数量                                  |
| B3  | 活跃订阅   | 展示 `commercialSummary.totals.activeSubscriptions`                  |
| B4  | 毛利率     | 有收入时展示 `marginCents / tenantRevenueCents`；无数据时展示占位    |
| B5  | 环比       | KPI 与经营表趋势列在存在 `*TrendDelta` 时展示 ↑/↓ 与百分比或计数变化 |
| B6  | 分布图     | 有订阅的套餐按 MRR 占比展示横向条形；无订阅时展示空态文案            |

### 3.3 套餐经营分析表

| #   | 验收项    | 通过标准                                                                 |
| --- | --------- | ------------------------------------------------------------------------ |
| C1  | 列完整性  | 含：套餐、企业、MRR、ARR、成本、毛利、趋势、操作                         |
| C2  | 排序      | MRR / 企业数 / 毛利列头可点击排序，激活列显示 ↑/↓                        |
| C3  | 单行展示  | 套餐名与标签（默认/推荐/热门/即将下线）同一行；无 `vN`、无「生效中」副行 |
| C4  | ARR       | `arrCents = mrrCents × 12`                                               |
| C5  | 成本/毛利 | 有 economics 数据时展示；投影估算带 `*` 脚注说明                         |
| C6  | 趋势      | 多指标以 `·` 分隔单行展示                                                |

### 3.4 操作按钮与钻取链路

| #   | 验收项   | 通过标准                                                                        |
| --- | -------- | ------------------------------------------------------------------------------- |
| D1  | 经营分析 | 点击后切换到「经营分析」Tab；展示 `economics-scope-hint` 且 KPI 按该套餐 scope  |
| D2  | 单元经济 | 点击后在经营表下方出现 `unit-economics-drawer`，含 MRR、订阅数、收入等指标      |
| D3  | 配置     | 点击后「套餐配置与管理」`<details>` 展开，对应 `plan-row-{id}` 可见并可滚动定位 |
| D4  | 可点击性 | 三按钮均可正常触发，无被遮挡或点击无响应现象                                    |

### 3.5 最近变化活动流

| #   | 验收项   | 通过标准                                              |
| --- | -------- | ----------------------------------------------------- |
| E1  | 展示     | `recentActivity` 非空时展示活动列表                   |
| E2  | 事件类型 | 至少支持：版本发布/废弃、订阅开通/结束、订阅升级/降级 |
| E3  | 文案     | 中英文 i18n 键完整，无裸 key 露出                     |

### 3.6 营销标签（平台 ↔ 企业）

| #   | 验收项       | 通过标准                                                                    |
| --- | ------------ | --------------------------------------------------------------------------- |
| F1  | 平台编辑     | 套餐配置区可设置 `default` / `recommended`，保存后调用 `set-marketing-tags` |
| F2  | 经营表展示   | 标签在套餐名单行展示                                                        |
| F3  | 企业订阅排序 | `subscriptions.get` 返回套餐列表：默认 > 推荐 > 其他                        |
| F4  | 企业 UI      | 成本预算订阅页套餐卡片展示默认/推荐徽章                                     |

### 3.7 经营分析 Tab（Phase 3）

| #   | 验收项      | 通过标准                                                                                   |
| --- | ----------- | ------------------------------------------------------------------------------------------ |
| G1  | 汇总看板    | 展示任务数、扣费 Credits、供应商成本、租户收入、毛利                                       |
| G2  | 按套餐/企业 | 展示 `byPlan` / `byEnterprise` 分解列表                                                    |
| G3  | CostVersion | 展示成本版本面板与激活操作入口                                                             |
| G4  | Ledger      | `economics-ledger-panel` 展示过滤后的用量明细表                                            |
| G5  | Ledger RPC  | `platform-economics.ledger` 支持 `planId`、`enterpriseId`、`startTime`、`endTime`、`limit` |

### 3.8 自动化测试

| #   | 验收项     | 通过标准                                                                                                           |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| H1  | 浏览器测试 | `page.browser.test.ts` 含经营总览、三 Tab、经营表按钮钻取用例，全部通过                                            |
| H2  | 单元测试   | `pricing-operating-dashboard.node.test.ts` KPI/行构建/排序通过                                                     |
| H3  | 后端测试   | `usage-ledger-filter.test.ts`、`platform-pricing-activity.test.ts`、`platform-plan-bundle.test.ts`（营销标签）通过 |

**验收命令示例**

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  ui/src/ui/ports/platform/pricing/page.browser.test.ts \
  ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.node.test.ts \
  src/gateway/billing/usage-ledger-filter.test.ts \
  src/gateway/billing/platform-pricing-activity.test.ts
```

---

## 4. 手动验收步骤（建议专家团队执行）

### 4.1 环境准备

1. `pnpm install` && `pnpm build`
2. 重启 Gateway（`dist/` 变更后需重启，否则新 RPC 不可用）
3. 以平台管理员身份打开 Web UI → **套餐与定价**

### 4.2 套餐管理 Tab

1. 确认首屏为 KPI + 分布 + 经营表，而非直接展示长列表
2. 确认经营表「旗舰版」等行：**仅一行**，套餐名右侧为「热门」等标签，**无** `v3` / `生效中` 副行
3. 点击 **经营分析** → 应跳转经营分析 Tab，顶部有「已聚焦至套餐 xxx」提示
4. 返回套餐管理，点击 **单元经济** → 经营表下方出现抽屉，可关闭
5. 点击 **配置** → 「套餐配置与管理」展开，页面滚动至对应套餐卡片

### 4.3 经营分析 Tab

1. 确认汇总 KPI、按企业/按套餐列表、CostVersion 面板、Ledger 明细表均可见
2. 从经营表钻取进入时，KPI 应 scoped 到该套餐

### 4.4 营销标签

1. 在套餐配置区为某套餐勾选「默认」或「推荐」并保存
2. 经营表对应行应出现标签
3. 切换至企业端订阅页，该套餐应带徽章且排序靠前

### 4.5 最近变化

1. 执行订阅开通/换套餐/发布版本等操作后刷新
2. 经营总览底部「最近变化」应出现对应事件

---

## 5. 架构与数据流（摘要）

```
platform-subscriptions.summary ──► commercialSummary (MRR/订阅/活动流)
platform-economics.overview    ──► economicsOverview (成本/毛利/环比/byPlan)
platform-plan-bundle.overview  ──► plans + versions + marketingTags
         │
         ▼
pricing-operating-dashboard (KPI + 分布 + 经营表)
         │
         ├─► 经营分析 Tab (economics-section + Ledger)
         ├─► 单元经济抽屉 (unit-economics-drawer)
         └─► 套餐配置面板 (page.ts plan list)
```

---

## 6. 已知限制与部署说明

| 项              | 说明                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Gateway 重启    | Phase 1–3 新增/扩展 RPC 需重启 Gateway 后生效                                                      |
| 成本/毛利空值   | 无 Ledger 或 CostVersion 数据时，成本/毛利/趋势列显示 `—`，属预期行为                              |
| 投影估算        | 带 `*` 的毛利为 CostVersion 满额投影估算，脚注已说明                                               |
| 多 Agent 工作树 | 本任务涉及 `page.ts`、`components.css` 等共享热文件，落地时需按仓库 `AGENTS.md` 签名与归属规则提交 |

---

## 7. 交付物索引

### 7.1 前端（UI）

| 路径                                                              | 职责                              |
| ----------------------------------------------------------------- | --------------------------------- |
| `ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.ts` | 经营 KPI、分布、经营表、活动流    |
| `ui/src/ui/ports/platform/pricing/page.ts`                        | 页面编排、Tab、配置面板、按钮回调 |
| `ui/src/ui/ports/platform/pricing/economics-section.ts`           | 经营分析 Tab                      |
| `ui/src/ui/ports/platform/pricing/economics-focus.ts`             | 套餐聚焦状态                      |
| `ui/src/ui/ports/platform/pricing/unit-economics-drawer.ts`       | 单元经济抽屉                      |
| `ui/src/ui/views/cost-budget/cost-budget-page.ts`                 | 企业订阅营销标签展示              |
| `ui/src/styles/components.css`                                    | 经营表单行布局与操作列样式        |
| `ui/src/i18n/locales/zh-CN.ts` / `en.ts`                          | 中英文文案                        |

### 7.2 后端（Gateway）

| 路径                                                 | 职责                       |
| ---------------------------------------------------- | -------------------------- |
| `src/gateway/server-methods/platform-economics.ts`   | overview 环比 + ledger RPC |
| `src/gateway/billing/plan-commercial-summary.ts`     | 商业汇总与活动流挂载       |
| `src/gateway/billing/platform-pricing-activity.ts`   | 活动流聚合                 |
| `src/gateway/billing/usage-ledger-store.ts`          | Ledger 过滤查询            |
| `src/gateway/server-methods/platform-plan-bundle.ts` | set-marketing-tags         |
| `src/gateway/server-methods/subscriptions.ts`        | 企业套餐排序               |

### 7.3 测试

| 路径                                                                        | 覆盖                      |
| --------------------------------------------------------------------------- | ------------------------- |
| `ui/src/ui/ports/platform/pricing/page.browser.test.ts`                     | 端到端 UI（含经营表按钮） |
| `ui/src/ui/ports/platform/pricing/pricing-operating-dashboard.node.test.ts` | 行构建与排序              |
| `src/gateway/billing/usage-ledger-filter.test.ts`                           | Ledger 过滤               |
| `src/gateway/billing/platform-pricing-activity.test.ts`                     | 活动流                    |
| `src/gateway/server-methods/platform-plan-bundle.test.ts`                   | 营销标签 RPC              |

---

## 8. 验收结论模板（供专家填写）

| 模块                      | 验收人 | 日期 | 结论（通过/有条件通过/不通过） | 备注 |
| ------------------------- | ------ | ---- | ------------------------------ | ---- |
| Phase 0 经营首屏          |        |      |                                |      |
| Phase 1 环比与活动流      |        |      |                                |      |
| Phase 2 营销标签与钻取    |        |      |                                |      |
| Phase 3 Ledger 与经营分析 |        |      |                                |      |
| UI 单行与按钮修复         |        |      |                                |      |
| 自动化测试                |        |      |                                |      |

---

**文档版本**：v1.0  
**关联产品模块**：平台管理 → 套餐与定价  
**仓库路径**：`docs/design/platform-pricing-operating-dashboard-acceptance-report-2026-06-13.md`
