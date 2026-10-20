# 平台端套餐档位最终优化方案 v2（企业级 Agent Platform）

> 日期：2026-06-16 · 状态：最终方案 v2（已吸纳专家团队反馈）
> 关联：`.kiro/specs/cost-budget-billing/`、`.kiro/specs/model-entitlement-chain/`、`ui/src/ui/ports/platform/pricing/`、`docs/design/platform-ui-spec.md`
> 定位：**仅面向企业用户（B2B）**，目标是 OpenBot 未来 3~5 年作为**企业级 Agent Platform** 持续扩张——从「卖 Credits 的 AI 平台」升级为「卖业务能力与治理能力的 Agent 平台」。

---

## 0. v2 相对 v1 的关键升级（吸纳专家反馈）

| #   | 专家问题                         | v2 调整                                                                       |
| --- | -------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Credits 客户不可理解             | 套餐页突出**业务结果**（≈N 次任务 / 文档分析 / 问答），Credits 降级为高级说明 |
| 2   | Trial 易被薅羊毛                 | Trial 改按**试用任务次数**计量，不发 Credits                                  |
| 3   | Business / Enterprise 差异不足   | Enterprise 增独占能力：BYOM / 专属连接器 / Custom Policy / 99.95% SLA / CSM   |
| 4   | 计费维度单一                     | 明确 **Subscription + Usage 双层**计费（架构已支持 `PricingType`）            |
| 5   | Pricing 与 Unit Economics 未闭环 | 新增**套餐毛利目标 / 警戒线**配置 + 实时毛利监控告警                          |
| UI  | 旗舰版/卓越版 命名太近           | 改用国际化命名：Trial / Starter / Professional / Business / Enterprise        |

---

## 1. 现状（分析 + 去重）

代码真相（`ui/src/ui/ports/platform/pricing/plan-display.ts:3`）：当前 4 个付费档
`["starter","professional","business","enterprise"]`，每档带中英文别名。

问题：① plans-store 内同槽位 EN+CN 两条 Plan 重复漂浮（`plansForDisplay` 运行时收敛，底层未清理）；② `business→旗舰版` 语义错位；③ 缺免费档；④ `BillingCycle` 仅 `"monthly"`（`src/gateway/billing/types.ts:20`），无多周期折扣；⑤ 无套餐毛利目标配置。

**已具备的好底子**（专家确认的正确方向，v2 沿用）：

- **套餐与模型已解耦**：`Package → Credits → Policy → Tier → Model Pool`（`model-entitlement-chain`），换模型 / 调价不动套餐。
- **用量计费类型已存在**：`PricingType = "seat" | "usage" | "extra"`（`src/gateway/billing/types.ts:26`）——双层计费有结构支撑。
- **实际毛利已可算**：`unit-economics.ts`（`cohortMarginRate` / `projectedMarginRate`）+ CostVersion + 经营仪表盘。缺的是**目标/警戒线**与告警闭环。

---

## 2. 最终档位 + 命名（国际化优先）

**英文名为主锚点**，中文为辅；canonical key 全部沿用（仅新增 `trial`），最小化代码改动：

| 序  | canonical key  | 英文名（主） | 中文名（辅）       | 一句话卖点                         |
| --- | -------------- | ------------ | ------------------ | ---------------------------------- |
| 0   | `trial`        | Trial        | 免费试用           | 体验价值（限**任务次数**）         |
| 1   | `starter`      | Starter      | 基本版             | 小团队：Bot + 席位 + 基础 Agent    |
| 2   | `professional` | Professional | 专业版（**主推**） | 全标准模型 + 审计日志 + 多工作流   |
| 3   | `business`     | Business     | 商业版             | 高级模型 + SLA + 治理 + 隔离       |
| 4   | `enterprise`   | Enterprise   | 企业版             | BYOM + 私有部署 + VPC + 合规 + CSM |

`CANONICAL_PLAN_ORDER` → `["trial","starter","professional","business","enterprise"]`；每槽位收敛为单条 active Plan，重复行 `status:"archived"`。

---

## 3. 双层计费结构（Subscription + Usage）

> 架构已支持（`PricingType` 三类）；v2 明确分层，未来新增成本源无需改套餐。

**第一层 · Subscription（固定订阅，`seat`）**：买**权限**——席位、SLA、治理能力、可用模型档、基础任务额度。
**第二层 · Usage（按量计费，`usage` / `extra`）**：买**超额**——超额任务/Credits、额外 Bot、额外存储、额外知识库、额外工作流。

### 计费周期与阶梯折扣（订阅层）

`BillingCycle` 由 `"monthly"` 扩展为 `"monthly" | "semiannual" | "annual"`：

| 周期              | 折扣（建议\*）      | 说明           |
| ----------------- | ------------------- | -------------- |
| 月度 Monthly      | 基准价              | 灵活           |
| 半年度 Semiannual | 约 95 折（5% off）  | 中等承诺       |
| 年度 Annual       | 约 85 折（15% off） | 最优单价，主推 |

单价单调递减不倒挂；周期 + 折扣进 `PlanVersion` 快照以复算账单。Trial 无周期（固定试用窗口）。

---

## 4. 逐档价值维度（以业务结果为主，Credits 为辅）

> 数字为**建议基线**（`*` 占位待商业确认）。**套餐页主展示「业务结果」行；Credits / 模型档 / 路由策略归入「高级说明」折叠区。** 席位 = viewer/creator/admin。

### 4.1 客户可感知层（套餐页主展示）

| 维度                 | Trial                                           | Starter         | Professional      | Business                  | Enterprise                                                             |
| -------------------- | ----------------------------------------------- | --------------- | ----------------- | ------------------------- | ---------------------------------------------------------------------- |
| **定位**             | 验证价值                                        | 小团队启动      | 成长团队（主推）  | 规模化部署                | 大客户 / 解决方案                                                      |
| **月度价（建议\*）** | ¥0                                              | ¥99             | ¥499              | ¥1,999                    | 面议（¥6,999 起）                                                      |
| **有效期**           | 14 天                                           | 持续            | 持续              | 持续                      | 合同期                                                                 |
| **业务额度**         | 20 次 Agent 任务 / 10 次知识库问答 / 5 次工作流 | ≈500 次标准任务 | ≈3,000 次标准任务 | ≈15,000 次标准任务        | 自定义 / 预算制                                                        |
| **席位 (v/c/a)**     | 3/1/1                                           | 10/3/1          | 30/10/2           | 100/30/5                  | 不限 / 自定义                                                          |
| **Bot 配额**         | 1                                               | 3               | 10                | 30                        | 自定义                                                                 |
| **可用模型**         | 经济档                                          | 经济 + 标准     | 全部标准          | 全部（含高级 / 旗舰模型） | 全部 + 专属接入                                                        |
| **工作流 / 知识库**  | 体验                                            | 基础            | 多工作流          | 高级编排                  | 自定义                                                                 |
| **SLA / 支持**       | 无                                              | 社区            | 邮件（工作日）    | 优先（99.5%）             | 专属（99.95% + 合同）                                                  |
| **治理 / 审计**      | —                                               | 基础日志        | 审计日志          | 高级治理（MFA / 审批流）  | 全量合规 + 私有化                                                      |
| **数据隔离**         | 共享                                            | 共享            | 共享              | 逻辑隔离                  | 物理 / VPC 隔离                                                        |
| **Enterprise 独占**  | —                                               | —               | —                 | —                         | **BYOM / 专属连接器（SAP·Salesforce·金蝶·用友）/ Custom Policy / CSM** |
| **营销标签**         | —                                               | —               | `recommended`     | —                         | —                                                                      |

### 4.2 高级说明层（折叠，给技术决策者）

| 维度                 | Trial            | Starter    | Professional     | Business                  | Enterprise      |
| -------------------- | ---------------- | ---------- | ---------------- | ------------------------- | --------------- |
| 月度积分 Credits     | 不发（按任务计） | 5,000      | 30,000           | 150,000                   | 预算制 / 自定义 |
| 路由策略             | `cheapest`       | `balanced` | `balanced`       | `best_quality` / `bandit` | 自定义          |
| 超额计费（Usage 层） | 不支持（到顶停） | 按量加购   | 按量加购（折扣） | 按量加购（更优惠）        | 协议价          |

> 「业务结果」与「Credits」的换算口径由平台维护（业务额度 ≈ Credits ÷ 每任务平均消耗），客户只看结果，平台内部按 Credits 结算。

### 4.3 价值跳档（驱动升级的质变点）

- **Trial → Starter**：跨试用墙，持续使用 + 多 Bot + 标准模型。
- **Starter → Professional**：席位 ×3、任务额度 ×6、全标准模型、首拿**审计日志 + 多工作流**；`recommended` 锚点。
- **Professional → Business**：价格 ≈4× 跳档，换**高级/旗舰模型 + `best_quality` 路由 + 高级治理 + 逻辑隔离 + 99.5% SLA**（质变非量变）。
- **Business → Enterprise**：从「产品」转「解决方案」——**BYOM、私有部署/VPC、专属连接器、Custom Policy、99.95% SLA、专属 CSM**。这些是 Business 不可获得的独占能力，确保差异足够大、避免客户停在 Business。

---

## 5. Pricing × Unit Economics 闭环（最重要）

> 当前只有「实际毛利可算」（`unit-economics.ts`），缺**目标 / 警戒线**与**自动告警**。v2 补齐闭环。

### 5.1 新增「套餐毛利目标」配置（平台后台）

每个 Plan（或 PlanVersion）新增可配置阈值：

| 套餐         | 目标毛利（建议\*） | 警戒毛利（建议\*） |
| ------------ | ------------------ | ------------------ |
| Starter      | 75%                | 60%                |
| Professional | 80%                | 65%                |
| Business     | 85%                | 70%                |
| Enterprise   | 按合同             | 按合同             |

### 5.2 实时监控闭环

```
MRR − Provider Cost = Gross Margin
                         ↓ 对比阈值
实际毛利 < 警戒毛利  → 经营仪表盘红色告警 + 通知（系统主动发现「某套餐正在亏钱」）
警戒 ≤ 实际 < 目标   → 黄色预警
实际 ≥ 目标         → 健康
```

复用 `unit-economics.ts` 的 `cohortMarginRate` / `projectedMarginRate` 作为「实际毛利」，与新增阈值对比；落点在经营仪表盘（`pricing-operating-dashboard.ts`）。让系统在用量/模型成本波动时**自动**发现亏损套餐，而非财务月底事后发现。

---

## 6. UI 优化方案（简约 · 大气 · 现代）

> 全栈统一：复用 `docs/design/platform-ui-spec.md` 设计语言（metric-card、`--radius-lg`、`--shadow-md`、`--duration-fast`/`--ease-out`、`--focus-ring`、600/700 字重、SVG 图标、token 化颜色）。当前 `page.ts` 的 `renderPlanList` 是密集的「管理员管理列表」，缺**对外档位对比视图**。

### 6.1 信息架构：两视图分离

| 视图                            | 受众                | 现状                             | 方案                         |
| ------------------------------- | ------------------- | -------------------------------- | ---------------------------- |
| 档位对比（Pricing Comparison）  | 决策者 / 企业管理员 | 缺失                             | **新增** 五列卡片 + 周期切换 |
| 套餐管理列表（Admin Plan List） | 平台管理员          | 已有 `renderPlanList`            | 保留，降级为二级折叠面板     |
| 毛利监控（Profitability）       | 平台运营            | `pricing-operating-dashboard.ts` | 扩展：增目标/警戒线 + 告警色 |

### 6.2 档位对比视图（核心 UI）

**布局**：响应式卡片网格，桌面 5 列（`repeat(auto-fit, minmax(220px, 1fr))`），窄屏堆叠。
**周期切换器**：顶部居中分段控件（复用能力中心 `__segment` 原语）「月度 / 半年度 / 年度」；切换即时刷新各卡价格，年度旁挂「省 15%」徽标。

**单档卡片**（去释义化，**主展示业务结果而非 Credits**）：

```
┌──────────────────────────┐
│ [Recommended] 徽标（专业版）│
│ Professional 专业版         │  ← 英文主 / 中文辅
│ ¥499 /月  ← 大字价格(700)   │  ← 周期切换实时变化
│ 年付省 15% 划线原价         │
│ ──────────────────────── │
│ 主行动按钮（开始试用 / 升级）│
│ ──────────────────────── │
│ ✓ ≈3,000 次标准任务         │  ← 业务结果优先
│ ✓ 30 席位 / 10 Bot          │
│ ✓ 全部标准模型              │
│ ✓ 审计日志 + 多工作流        │
│ ▸ 高级说明（Credits/路由）   │  ← 折叠，技术决策者按需展开
└──────────────────────────┘
```

**视觉规范**：

- 卡片 `border-radius: var(--radius-lg)`；默认 `--shadow-sm`，hover `--shadow-md` + `translateY(-2px)`，过渡 `var(--duration-fast) var(--ease-out)`。
- **推荐档强调**：Professional 用 `--primary` 描边 + 轻微放大（`scale(1.03)`）+ 顶部色条，作转化锚点。
- 价格 700 大字；`/月` 用 `--muted` 小字；节省徽标用 `--success`。
- 价值清单统一 `renderIcon("check")` SVG（禁 ✓/✗ Unicode）；不可用项淡色 `minus`。
- 键盘可达：主按钮 + 周期切换 `:focus-visible { box-shadow: var(--focus-ring); }`。
- 字重仅 600/700；颜色全走 token，禁硬编码 hex。

**完整对比矩阵**：卡片下方「查看完整对比」`<details>`，展开为 §4.1 维度逐行对照表，移动端横向滚动。Enterprise 独占能力行用强调样式凸显「解决方案级」差异。

### 6.3 毛利监控 UI（运营内部）

经营仪表盘每套餐卡增「目标 / 警戒 / 实际毛利」三值，按 §5.2 红/黄/绿着色（色值走 `--danger`/`--warning`/`--success` token）。

---

## 7. 落地步骤

1. **类型扩展**（`src/gateway/billing/types.ts`）：`BillingCycle` 增 `semiannual | annual`；`Plan`/`PlanVersion` 增 `targetMarginRate?` / `guardMarginRate?`；周期折扣进快照。
2. **数据去重 + `trial` 槽位**（`plan-display.ts`）：`CANONICAL_PLAN_ORDER`/`CANONICAL_PLAN_SLOTS` 增 `trial`；英文主命名；store 重复行归档。
3. **双层计费落地**：明确 `seat`（订阅）与 `usage`/`extra`（超额）边界；Trial 走任务次数计量（非 Credits）。
4. **entitlement 绑定**：每档 active `PlanVersion` 绑 `allowedModelIds` + `monthlyCredits` + `selectorStrategy`（§4.2）；维护「业务结果 ↔ Credits」换算口径。
5. **Enterprise 独占能力**：BYOM / 专属连接器 / Custom Policy 接入点（依赖 `model-entitlement-chain` 与连接器框架，单列专项）。
6. **毛利闭环**：阈值配置 + 经营仪表盘告警（复用 `unit-economics.ts`）。
7. **UI**（`ui/src/ui/ports/platform/pricing/`）：新增档位对比视图 + 周期分段切换；管理列表降级折叠；毛利监控扩展；样式复用 `platform-ui-spec.md` token。
8. **测试**：`plan-display.node.test.ts` 增 `trial` + 去重断言；对比视图 browser test（5 档 + 周期切换 + 推荐徽标 + 业务结果展示）；毛利阈值告警单测。

> 所有价格 / 折扣 / 配额 / 毛利阈值为建议基线，需商业侧确认后写入 plans-store。

---

## 8. 落地记录（2026-06-16 第一批，已验证）

> 原则：仅落地**安全、自包含、可测**的基础层；触碰被其他 agent WIP 饱和的共享文件（`page.ts` / `components.css` / `pricing-operating-dashboard.ts`）的「实时挂载」步骤暂缓，待工作树隔离后进行。

### 已实现并通过测试

| 项                      | 改动                                                                                                                            | 测试                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| BillingCycle 三周期     | `BillingCycle = "monthly" \| "semiannual" \| "annual"`（后端 `types.ts` + UI `endpoints.ts`）                                   | 类型校验通过                                   |
| 套餐毛利阈值字段        | `Plan.targetMarginRate?` / `guardMarginRate?`（后端 + UI 镜像）                                                                 | —                                              |
| 周期定价（折扣math）    | 后端 `billing-cycle-pricing.ts` + UI `pricing-cycle.ts`（月度/95折/85折，等效月价不倒挂）                                       | `billing-cycle-pricing.test.ts`（6）           |
| 毛利健康度闭环          | `package-margin.ts`（target/guard/actual → healthy/warning/critical/unknown）                                                   | `package-margin.test.ts`（8）                  |
| 五档 + 去重 + Trial     | `plan-display.ts`：`CANONICAL_PLAN_ORDER` 增 `trial`；别名收录历史中文名（基本版/商业版/卓越版/旗舰版）去重；英文名优先         | `plan-display.node.test.ts`（5）               |
| RPC 校验放宽            | `platform-plans.ts` / `platform-plan-bundle.ts` 接受三周期（`parseBillingCycle`）                                               | 既有 handler 测试（65）通过                    |
| 档位对比视图（UI 核心） | 新增 `pricing-comparison-view.ts`：五列卡片 + 周期切换 + 推荐档锚点 + 业务结果价值清单（SVG check）                             | `pricing-comparison-view.browser.test.ts`（8） |
| 对比视图样式            | 新增 `ui/src/styles/platform-pricing-comparison.css`（全 token 化、600/700 字重、focus-ring、hover 浮起），在 `styles.css` 注册 | —                                              |
| i18n                    | `platformPricing` 增 `perMonth`/`cycle.*`/`compare*` 等键（zh-CN + en）                                                         | —                                              |

验证：相关单测 **108（billing）+ 54（pricing UI）+ 36（cost-budget UI）+ 65（handler）** 全绿；oxfmt/oxlint 对新增/改动文件 0 问题。
（注：`billing.test.ts:798` 预算控制用例失败属其他 agent 在 `runtime.ts` 的 WIP，与本批无关。）

### 待后续（需共享文件隔离或更大专项）

1. **实时挂载对比视图**：将 `renderPricingComparison` 接入 `pricing/page.ts`（该文件被他人 WIP 饱和），并将现管理列表降级为二级折叠面板。
2. **毛利监控 UI**：把 target/guard/actual 三值 + 红黄绿告警接入 `pricing-operating-dashboard.ts`；新增设置阈值的 RPC 并在 `updatePlan` 持久化。
3. **Enterprise 独占能力**：BYOM / 专属连接器（SAP·Salesforce·金蝶·用友）/ Custom Policy（独立专项，依赖 `model-entitlement-chain` 与连接器框架）。
4. **逐档 entitlement 数据**：业务侧确认价格/配额/积分后写入 plans-store + 绑定（含「业务结果 ↔ Credits」换算口径）。
5. **非月度结算引擎**：半年度/年度的预付 + 周期窗口结算/比例分摊（`resolveCycleWindow` 扩展，财务正确性专项，门禁后再做）。
