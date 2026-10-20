# OpenBot 企业 AI 劳动力套餐 — Land 分包与验收核对

Date: 2026-06-22

Status: **Working — 实施收口用**

Audience: 执行团队、Land 负责人、QA

Related:

- `docs/design/openbot-enterprise-ai-workforce-pricing-execution-breakdown-2026-06-22.md`
- `docs/design/openbot-plan-requirements-guided-selection-2026-06-21.md`
- `.loom/registry.yaml` → `enterprise-ui-baseline:cost-budget-ia`
- Loom landing streams: **MERGE J** / **MERGE ME** / **MERGE A**

---

## Part A — Land 分包策略

### A.1 原则

1. **一次 land 只选一个 primary landing stream**（`scripts/committer` / worktree audit 强制）。
2. **UI 购后/选购** 归 `enterprise-ui-baseline:cost-budget-ia`（paths: `ui/src/ui/views/cost-budget/**` + 配套 i18n/css）。
3. **Gateway 订阅/entitlement** 归 **MERGE J**（`subscriptions.*`、`package-entitlement/*`、seed）。
4. **平台画像/economics** 归 **MERGE ME**（`platform-plan-bundle.*`、platform pricing UI、economics-section）。
5. **`cost-budget-page.ts` 与 `cost-budget.css` 同时出现在 ME 与 UI task** — 必须跟 **UI 包** 一起 land，ME 包 **禁止** 单独改这两文件。

### A.2 推荐 Land 顺序（4 PR）

| 包        | Primary stream                          | 范围                                                                                                                             | Commit 主题                                  |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **J0**    | MERGE J                                 | `src/gateway/package-entitlement/**`、`subscriptions.get` / `preview-plan-allocation`、`scripts/seed-platform-plan-templates.ts` | Contract + entitlement RPC                   |
| **UI0–2** | `enterprise-ui-baseline:cost-budget-ia` | `ui/src/ui/views/cost-budget/**`、`ui/src/styles/cost-budget.css`、`ui/src/i18n/locales/{zh-CN,en}.ts`（仅 costBudget.\* 键）    | Phase 0–2 展示 + 选购 + 购后 Hub + 5A 换套餐 |
| **ME3**   | MERGE ME（不含 page.ts/css）            | `platform-plan-bundle.*`、`Plan.matchingProfile` UI、`persona-tags.ts` 平台侧                                                    | Phase 3 平台画像                             |
| **ME4**   | MERGE ME（不含 page.ts/css）            | `margin-aware-selection`、`plan-suitability-outlook`、`economics-section` 推荐健康度                                             | Phase 4 毛利联动                             |

**依赖**：`J0` → `UI0–2`；`ME3` → `ME4`；`UI0–2` 与 `ME3` 可并行开发，但 **land UI 后再 land ME3/ME4** 更安全（避免 page 半接线）。

### A.3 每包命令模板

```bash
# 1. 确认归属
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict

# 2.  scoped test
OPENBOT_TEST_PROFILE=low pnpm test ui/src/ui/views/cost-budget/…   # UI 包
OPENBOT_TEST_PROFILE=low pnpm test src/gateway/package-entitlement/… # J0 包

# 3. scoped commit（示例 UI 包）
scripts/committer "Cost & Budget: plan catalog Phase 0-2 and change-plan wizard

Task: plan-requirements-guided-selection
Agent: <your-agent-id>" \
  ui/src/ui/views/cost-budget/… \
  ui/src/styles/cost-budget.css \
  ui/src/i18n/locales/zh-CN.ts \
  ui/src/i18n/locales/en.ts
```

### A.4 已知阻塞

| 阻塞                            | 缓解                                                                     |
| ------------------------------- | ------------------------------------------------------------------------ |
| i18n 全文件含其他 stream 改动   | UI land 前只 stage `costBudget.*` hunk，或先 rebase 清掉无关 locale 改动 |
| `cost-budget-page.ts` ∈ ME + UI | UI 包 land 时 **带上** page；ME 包 **排除** page/css                     |
| worktree 混流                   | 严格按 A.2 分包；勿 `git add .`                                          |

### A.5 Staging 验证（land 后）

1. `bun scripts/seed-platform-plan-templates.ts --sync-profiles`（有平台 plan 的环境）
2. 重启 gateway（`dist` 变更后）
3. 手工：`subscriptions.get` → `planEntitlements`；`preview-plan-allocation`；已订阅换套餐 2 步流

---

## Part B — 验收核对清单

对照 `openbot-enterprise-ai-workforce-pricing-execution-breakdown-2026-06-22.md`。

图例：**✅ 已实现** · **◐ 部分** · **❌ 未做**

### Phase 0 — Contract 冻结

| ID   | 验收项                            | 状态 | 证据 / 缺口                                                                          |
| ---- | --------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| P0-1 | 五档 Capacity 唯一真相            | ◐    | `plan-capacity-contract.ts` + seed；**运营签字表 / 全字段**（overage、SLA 等）未归档 |
| P0-2 | `plan-capacity-display.ts` 展示层 | ✅   | `buildPlanCapacitySummary` / expansion hints                                         |
| P0-3 | 停止 comparison 堆静态权益        | ◐    | 推荐/Hub 走 display；comparison 仍部分静态 benefit                                   |
| P0-4 | Gateway entitlement 解析          | ✅   | `resolve-plan-version-entitlement.ts`、`subscriptions.get` → `planEntitlements`      |
| P0-5 | 企业 preview RPC                  | ✅   | `subscriptions.preview-plan-allocation`                                              |
| P0-6 | Seed 五档 + sync profiles         | ◐    | `scripts/seed-platform-plan-templates.ts`；staging 需重跑                            |

### Phase 1 — 企业端选购主路径

| ID    | 验收项                      | 状态 | 证据 / 缺口                                         |
| ----- | --------------------------- | ---- | --------------------------------------------------- |
| P1-1  | 总览 Hero 双入口            | ✅   | `cost-budget-overview-subscribe-hero.ts`            |
| P1-2  | Catalog Landing 双入口      | ✅   | `cost-budget-plan-selector/landing.ts`              |
| P1-3  | 需求向导（可跳过）          | ✅   | `wizard.ts` / `wizard-state.ts`                     |
| P1-4  | Deterministic matching      | ✅   | `matching-engine.ts` + tests                        |
| P1-5  | 推荐结果 + 理由             | ✅   | `recommendation-page.ts`                            |
| P1-6  | 三 Tab 购前详情             | ✅   | `plan-buyer-detail.ts`                              |
| P1-7  | 完整对比表（次级）          | ✅   | `renderPricingComparison` + skip 入口               |
| P1-8  | 仍走 `subscribe` RPC        | ✅   | `cost-budget-page.ts`                               |
| P1-9  | 4 Tab IA 不变               | ✅   | 无新顶级 Tab                                        |
| P1-10 | `compare-entry.ts` 独立文件 | ❌   | 合并在 Landing（可接受偏差）                        |
| P1-11 | 移除静默 redirect           | ◐    | 需确认 `maybeUnsubscribedLandingRedirect` 已删/禁用 |

### Phase 2 — 购后套餐中枢

| ID    | 验收项                                   | 状态 | 证据 / 缺口                                                          |
| ----- | ---------------------------------------- | ---- | -------------------------------------------------------------------- |
| P2-1  | 当前套餐 + Capacity KPI                  | ✅   | `cost-budget-subscribed-plan-hub.ts`                                 |
| P2-2  | 合同窗                                   | ✅   | `subscribed-contract-window`                                         |
| P2-3  | 用量条（seats/bots/concurrency/credits） | ✅   | `plan-capacity-usage-panel.ts`                                       |
| P2-4  | Entitlement 层级摘要                     | ✅   | `subscribed-entitlement-summary`（Tier + 模型数）                    |
| P2-5  | 摘要 KPI 条（模型/Credits/席位）         | ✅   | `subscribed-plan-summary-line`                                       |
| P2-6  | 生命周期进度条                           | ✅   | `cost-budget-onboarding-progress.ts`（总览 compact + commerce 全量） |
| P2-7  | 扩展两栏 + 深链                          | ✅   | `plan-expansion-action-columns`（席位/角色/换套餐/积分包/销售）      |
| P2-8  | 三 Tab 只读套餐详情                      | ✅   | Hub → `plan-buyer-detail`                                            |
| P2-9  | 换套餐入口                               | ✅   | `hub-change-plan` → 5A 向导                                          |
| P2-10 | 续费 / 积分包                            | ✅   | `renew-actions`、`capacity-packs`                                    |
| P2-11 | seats 面板「前置说明」                   | ◐    | 深链到 seats；seats 面板内未加引导文案块                             |
| P2-12 | 总览换套餐跨 Tab 导航                    | ✅   | `onChangePlan` → `onNavigate("subscription")`                        |

### Phase 5A — 已订阅换套餐（子方案 §4.3，非 breakdown 独立 Phase）

| ID    | 验收项                     | 状态 | 证据 / 缺口                                          |
| ----- | -------------------------- | ---- | ---------------------------------------------------- |
| P5A-1 | 2 步：变化点 → 推荐 + diff | ✅   | `change-plan-wizard*` / `change-plan-result-page`    |
| P5A-2 | Q6=C：可跳过对比表         | ✅   | `change-wizard-skip-compare`                         |
| P5A-3 | 仍走 `changePlan` RPC      | ✅   | result / compare CTA                                 |
| P5A-4 | Capacity diff 共用 display | ✅   | `plan-entitlement-diff.ts`                           |
| P5A-5 | 浏览器 + 单元测试          | ✅   | `*.node.test.ts`、`cost-budget-page.browser.test.ts` |

### Phase 3 — 平台套餐画像

| ID   | 验收项                                                | 状态 | 证据 / 缺口                                 |
| ---- | ----------------------------------------------------- | ---- | ------------------------------------------- |
| P3-1 | `targetPersonas` / matchingProfile                    | ✅   | bundle metadata + 平台编辑 Tab              |
| P3-2 | preview-allocation 平台预览                           | ◐    | 企业端已接；平台侧预览入口需手工验          |
| P3-3 | 推荐不硬编码套餐特例                                  | ✅   | `matchPlansForPersona` + `planEntitlements` |
| P3-4 | `inPlanFlexibilityNotes` / `beyondPlanNotes` per-plan | ◐    | buyer-detail 可读；平台编辑待验             |

### Phase 4 — 成本/毛利/风险联动

| ID   | 验收项                | 状态 | 证据 / 缺口                                    |
| ---- | --------------------- | ---- | ---------------------------------------------- |
| P4-1 | 企业「长期使用展望」  | ✅   | `plan-suitability-outlook.ts`                  |
| P4-2 | 30 天触顶提示         | ◐    | outlook 有 first-limit；未接 live forecast RPC |
| P4-3 | 毛利 tie-break        | ✅   | `margin-aware-selection.ts`                    |
| P4-4 | 平台推荐健康度        | ✅   | economics-section 面板                         |
| P4-5 | Seed 默认 margin 阈值 | ◐    | seed `--sync-profiles` 环境依赖                |

### 横切 — 文档 / 流程 / Land

| ID  | 验收项                                  | 状态 | 证据 / 缺口                    |
| --- | --------------------------------------- | ---- | ------------------------------ |
| X-1 | Execution breakdown Status → Approved   | ❌   | 仍为 Draft                     |
| X-2 | 选购子方案评审门禁                      | ❌   | 仍写「评审通过前不开发」       |
| X-3 | Git land（scoped commit）               | ❌   | worktree audit 混流阻塞        |
| X-4 | 全量 `cost-budget-page.browser.test.ts` | ◐    | 关键用例绿；全量未作 land gate |
| X-5 | `pnpm check` whole-repo                 | ❌   | 共享树含他人 WIP               |

---

## Part C — 下一步建议（按优先级）

1. **Land J0** → **Land UI0–2**（含本次 Phase 2 细项 + 5A）。
2. staging 跑 seed + gateway 重启 + 手工 RPC。
3. **Land ME3** → **Land ME4**。
4. 补 **P0-1 运营签字**、**P2-11 seats 引导文案**（可选小 PR）。
5. 更新 execution breakdown **Status** 与 tasks.md 签入。

---

## Changelog

| 日期       | 说明                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| 2026-06-22 | 初版：Land 四包策略 + Phase 0–5A 核对清单；Phase 2 扩展两栏深链 / entitlement 摘要已实现 |
