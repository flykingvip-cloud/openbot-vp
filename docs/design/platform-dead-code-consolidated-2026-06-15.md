# 平台端 UI 死代码清理 — 汇总决策文档

**汇总日期**：2026-06-15
**编制背景**：平台端 8 模块 UI 验收（平台总览 / 租户管理 / 套餐与定价 / 能力中心 / 模型管理 / 资产管理 / 高级治理 / 系统设置）过程中，在 4 个模块发现一批历史重构遗留的「死代码」——已定义但**无任何 live 渲染路径引用**的组件 / section / VM / adapter。
本文为**唯一汇总决策文档**，合并并取代此前 4 份单模块分析（models / agents / advanced / system-settings），供**专家团队统一评估并决策是否清理**。

**状态：专家团队已批准（2026-06-15）** —— 决策与执行铁律见 §6、§5；启动「平台端死代码清理」专项，严格两步走、独立 PR。

> 本轮 UI 验收**未删除任何死代码**，仅记录、求证与量化，等待决策。

---

## 1. 结论速览

- **死代码文件**：共 **23 个组件/section + 4 个 adapter + 3 个 legacy view-model**（详见第 3 节）。
- **死代码体量**：约 **1,400+ 行 TS**（不含其专属 CSS 与 VM builder 片段）。
- **共性成因**：四个模块均经历过「整页 → 标签页 section / 内联渲染」重构，旧实现未随之删除。live 页要么内联渲染、要么改用 runtime-canonical / readModel 数据源，不再走 legacy VM 路径。
- **风险**：删除本身低风险（无引用），但**牵连项**需逐一核对（VM builder 字段、专属 CSS、共享 actions、共享 route/drawer），见第 4 节。
- **建议**：作为**一个独立的「平台端死代码清理」专项**统一处理，不混入 UI 验收提交。

---

## 2. 求证方法（专家可复核）

对每个疑似文件执行「全仓引用计数（排除自身、含 .ts）」：

```bash
cd ui/src/ui
for f in <ComponentName>; do
  printf '%s %s\n' "$(grep -rln "$f" . --include='*.ts' | grep -v "/$f.ts$" | wc -l | tr -d ' ')" "$f";
done
```

**2026-06-15 复核结果：全部 23 个组件计数为 `0`（无非自身引用）。** adapter / view-model 同法复核亦为 0（live 页不 import）。

---

## 3. 死代码清单（按模块）

### 3.1 模型管理（models）— 最大块，约 1,082 行

live 路径：`models/page.ts` 走 5 Tab（ModelAssets / TaskPlans / SmartRouting / UsageAnalytics / Governance），用 `.stat` 原语与 readModel。

| 文件                                          | 角色                                                    | 关联                                   |
| --------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `models/sections/ModelsOverviewSection.ts`    | 旧「模型总览」整页（KPI/分布/趋势/analytics/readiness） | 独占 CSS `platform-models-overview__*` |
| `models/sections/ModelSummarySection.ts`      | 旧 summary stat 卡                                      | legacy VM                              |
| `models/sections/ModelMatchingSection.ts`     | 智能匹配规则说明区                                      | legacy VM                              |
| `models/sections/ModelAllowlistSection.ts`    | Allowlist 与别名治理                                    | legacy VM + actions                    |
| `models/sections/ModelPolicySection.ts`       | 平台模型目录策略                                        | legacy VM                              |
| `models/sections/ModelRoutingSection.ts`      | 平台模型路由配置                                        | legacy VM + actions                    |
| `models/sections/ModelOverrideSection.ts`     | 模型 override 配置                                      | legacy VM + actions                    |
| `models/components/ModelKpiGrid.ts`           | 通用 KPI 卡网格                                         | —                                      |
| `models/components/RoutingHealthPanel.ts`     | 路由健康面板                                            | `ModelOverviewVM.routingHealth`        |
| `models/components/TopModelPanels.ts`         | Top Used / Top Cost 面板                                | `ModelOverviewVM`                      |
| `models/components/GovernancePreviewPanel.ts` | 治理预览面板                                            | `ModelOverviewVM.governancePreview`    |

> 注：`models/adapter.ts`（`selectPlatformModelsActions` / `buildPlatformModelsVM`）**为 live**，**不在清单内**。

### 3.2 资产管理（agents）— 约 91 行 + adapter/VM

live 路径：`agents/page.ts` 走 runtime-canonical（`runtimeAgents/runtimeBindings/runtimeKpi`），复用 `platform-capabilities__*`。

| 文件                                          | 角色                                 |
| --------------------------------------------- | ------------------------------------ |
| `agents/sections/AgentSummarySection.ts`      | 旧 summary stat 卡                   |
| `agents/sections/AgentDistributionSection.ts` | 旧企业分发面板                       |
| `agents/sections/AgentWorkspaceSection.ts`    | 旧运行工作区面板                     |
| `agents/sections/AgentFleetSection.ts`        | 旧机群列表面板                       |
| `agents/adapter.ts`                           | `selectPlatformAgentsVM`             |
| `agents/view-model.ts`                        | legacy `PlatformAgentsVM` 类型再导出 |

### 3.3 高级治理（advanced）— 约 100 行 + adapter/VM

live 路径：`advanced/page.ts` 内联渲染 7 Tab，复用 `platform-capabilities__*` + 共享 `views/{instances,logs,nodes,sessions}.ts`。

| 文件                                           | 角色                                   |
| ---------------------------------------------- | -------------------------------------- |
| `advanced/sections/AdvancedChannelsSection.ts` | 旧通道面板                             |
| `advanced/sections/AdvancedDomainsSection.ts`  | 旧域/路由面板                          |
| `advanced/sections/AdvancedRuntimeSection.ts`  | 旧运行态面板                           |
| `advanced/sections/AdvancedSummarySection.ts`  | 旧 summary 卡                          |
| `advanced/sections/AdvancedUsageSection.ts`    | 旧使用面板                             |
| `advanced/adapter.ts`                          | `selectPlatformAdvancedVM`             |
| `advanced/view-model.ts`                       | legacy `PlatformAdvancedVM` 类型再导出 |

### 3.4 系统设置（system-settings）— 约 140 行 + adapter

live 路径：`system-settings/page.ts` 内联渲染 4 Tab + summary KPI，复用 `platform-capabilities__*` + `views/platform-auth-panel.ts`。

| 文件                                                            | 角色                             |
| --------------------------------------------------------------- | -------------------------------- |
| `system-settings/sections/SystemSettingsConsoleSection.ts`      | 旧控制台/入口面板                |
| `system-settings/sections/SystemSettingsQuickActionsSection.ts` | 旧快速操作面板                   |
| `system-settings/sections/SystemSettingsSummarySection.ts`      | 旧 summary 卡                    |
| `system-settings/adapter.ts`                                    | `selectPlatformSystemSettingsVM` |

> **勿删（仍被 live/租户页引用）**：`system-settings/route.ts`、`system-settings/create-tenant-drawer.ts`、`system-settings/view-model.ts`（类型）。

---

## 4. 删除前必须核对的牵连项（关键）

> **风险重心说明（专家修正）**：真正的风险**不在第一步删 23 个零引用文件**，而在**第二步的「VM builder 字段精简」与「共享 actions 清理」**。下列 4.1、4.2 为第二步的**硬性前置闸门（Gate）**，未通过禁止动手。

### 4.1 🚧 Gate A — 跨端消费核验（VM builder 字段精简的硬前置）

`view-models/builders.ts` 仍构建 `PlatformPageViewModels.{models,agents,advanced,systemSettings}` 并经 `render-model.ts` 透传。平台 live 页大多不消费，但**字段可能被企业端 / 员工端读取**。

**Gate 通过条件（全部满足才可删字段）：**

- [ ] 对每个拟删字段（如 `ModelOverviewVM.{routingHealth,governancePreview}`、各模块 `summary` 等），全仓核验**企业端（`ports/enterprise/**`）与员工端（`ports/employee/**`）无读取**。
- [ ] 核验 `render-model.ts` / `builders.ts` 之外无其它构建方依赖该字段。
- [ ] `pnpm tsgo` 类型检查通过（删字段后无悬空类型引用）。

未通过 Gate A → **保留字段**，只删组件文件（第一步范围）。

### 4.2 🚧 Gate B — 共享 actions 清理（唯一能造成 live 回归的路径）

`render-actions.ts` 的 `surfaceActions.advanced.*` / `surfaceActions.platformAgents.*` 中，**部分回调仍被 live 内联 tab 依赖**——已代码核验 `onRefreshChannels` / `onRefreshInstances` 等被 live 使用。**误删即 live 回归。**

**Gate 通过条件：**

- [ ] 逐个回调确认「仅被死 section 使用」（候选：agents 的 `onRefreshWorkspaces/onRefreshDirectory/onRefreshFleet`）。
- [ ] 该清理**单独成 PR**，做 **diff 级 review**，不与其它改动混合。

### 4.3 专属 CSS

`platform-models-overview__*`（含第 4 种 KPI 卡 `__kpi-card`、硬编码 hex `#ef4444/#22c55e/#f59e0b`、硬编码阴影）仅服务死的 `ModelsOverviewSection`，第二步删 CSS 后可直接上 stylelint 防回流（见 §6）。

### 4.4 共享文件勿删

system-settings 的 `route.ts` / `create-tenant-drawer.ts` / `view-model.ts` 被 live 页或租户页引用。

### 4.5 文件内局部死代码（性质不同，勿误判）

> **`ModelAssetsSection.ts` 是 live 文件（模型管理 5 Tab 之一），整文件不可删。** 其中 `renderFilterDisclosureGroup`、`renderDrawerActionButton` 是**文件内未被调用的局部 helper**，属 trivial 的文件内修复，归第二步处理。

`agents/page.ts` 亦为 live 文件；`BINDING_SORT_DEFAULT_DIRECTIONS` / `resolveBindingSort` / `compareRuntimeBindings` 为文件内未用符号（绑定排序特性疑未接线），同样归第二步文件内修复。

---

## 5. 风险评估与建议执行路径

| 维度                             | 评估                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| 删除文件本身（第一步）           | **低风险**（零引用，编译不依赖）                                                      |
| VM 字段 / 共享 actions（第二步） | **中风险，且为真正风险重心**（须过 Gate A/B；共享 actions 误删 = 唯一 live 回归路径） |
| 用户可见影响                     | **无**（死代码不渲染）                                                                |
| 回归面                           | `pnpm build` + `pnpm test` + `pnpm check` 全量验证                                    |

### 执行铁律（专家批准）

- **第一步与第二步必须独立提交、独立可回滚。**
- **第二步禁止与 UI 验收 PR 混合。** 共享 actions 清理须**单独 PR + diff 级 review**。
- 每个子改动独立提交，便于精确回滚。

### 第一步（立即可做，低风险）

删除 **23 个零引用** section/component + **agents/advanced 各自的 adapter + legacy view-model**；**保留 system-settings 共享文件**（`route.ts`/`create-tenant-drawer.ts`/`view-model.ts`）。
验收：`pnpm build && pnpm test && pnpm check`。

### 第二步（需前置闸门，独立 PR）

1. **Gate A 通过**后，精简 VM builder 字段；
2. **Gate B 通过**后，单独 PR 清理「仅死 section 使用」的 actions；
3. 删除 `platform-models-overview__*` CSS；
4. 修复文件内局部死代码（§4.5 的 helper / 未用符号）；
5. legacy dashboard 收敛（见下）。

### legacy dashboard 收敛 —— 并入第二步，但不前置阻塞第一步

`renderLegacyDashboard` 收敛依赖 **browser test 迁移到现代 VM 断言**（`port-shells` 等导航测试当前以 legacy 路径兜底）。周期不确定，**不得拖住低风险的第一步**。
**硬约束**：**测试迁移完成后**才动 `renderLegacyDashboard`；否则 `port-shells` 等导航测试会失去兜底。合并进第二步可减少一次 `builders.ts` 改动面。

---

## 6. 专家决策记录（2026-06-15 已批准）

| 模块     | 第一步：删死 section/adapter/VM | 第二步：精简 VM builder/actions | 第二步：清理专属 CSS        |
| -------- | ------------------------------- | ------------------------------- | --------------------------- |
| 模型管理 | ✅ 批准                         | ✅ 批准（须过 Gate A/B）        | ✅ 批准（删后上 stylelint） |
| 资产管理 | ✅ 批准                         | ✅ 批准（须过 Gate A/B）        | —                           |
| 高级治理 | ✅ 批准                         | ✅ 批准（须过 Gate A/B）        | —                           |
| 系统设置 | ✅ 批准（保留共享文件）         | ✅ 批准（须过 Gate A/B）        | —                           |

**其它决议：**

- ✅ `docs/design/platform-ui-spec.md` 作为平台端 UI **唯一验收基准**（8/8 完成，正式生效）。
- ✅ 维持 **模型管理 `.stat` 双轨** 与 **平台/企业双轨基线**（代码不合并）。
- ⏳ legacy dashboard 收敛排期：测试迁移完成后并入第二步，**不阻塞第一步**。

### 工程化守门（决策 6，压实优先级）

- **stylelint 禁止硬编码 hex**：第二步删除 `platform-models-overview__*` CSS（其残留 `#ef4444/#22c55e/#f59e0b` 恰好**只服务死代码**）**之后**，立即上 stylelint 规则覆盖该范围，**一步到位防回流**。规则上线顺序：先删 CSS → 再上规则（避免规则报已知存量告警）。

---

## 7. 一键复核命令（全量）

```bash
cd ui/src/ui
for f in \
  ModelsOverviewSection ModelSummarySection ModelMatchingSection ModelAllowlistSection \
  ModelPolicySection ModelRoutingSection ModelOverrideSection ModelKpiGrid \
  RoutingHealthPanel TopModelPanels GovernancePreviewPanel \
  AgentSummarySection AgentDistributionSection AgentWorkspaceSection AgentFleetSection \
  AdvancedChannelsSection AdvancedDomainsSection AdvancedRuntimeSection \
  AdvancedSummarySection AdvancedUsageSection \
  SystemSettingsConsoleSection SystemSettingsQuickActionsSection SystemSettingsSummarySection; do
  printf '%s %s\n' "$(grep -rln "$f" . --include='*.ts' | grep -v "/$f.ts$" | wc -l | tr -d ' ')" "$f";
done
# 期望：每行计数均为 0
```

---

**关联**：UI 验收规范见 `docs/design/platform-ui-spec.md`（第 1–15 节 + 收官总结）。
