# Phase 4 验收清单 — 机巢运营 + 绩效成型

Date: 2026-08-02  
Status: **专家验收完成 · Strong Separation 主线已关闭**  
Parent: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`  
Rule: **专家确认本清单后即可关闭本轮 Strong Separation 主线（图谱子页可另立项）**

---

## 1. 本阶段目标

在**不改入口位置**（仍为 `enterpriseMesh`）的前提下：

1. Legacy `enterprise-mesh-governance-surface` 恢复为路由壳（KPI + 运营/绩效 Tab）
2. Active `governance-assets-page` 嵌入「运营」Tab（`embedMode`）
3. `governance-engine` 驱动运营 KPI（异常计数）
4. `mesh.governance.*Config` 持久化到 `~/.openbot/organization/governance-config.json`
5. `governance-ranking-page` 挂载到「绩效」Tab

---

## 2. 已交付改动

### 2.1 路由 / 壳层

| 项   | 文件                                         | 说明                                             |
| ---- | -------------------------------------------- | ------------------------------------------------ |
| 路由 | `enterprise-surfaces-core.ts`                | `enterpriseMesh` → `renderMeshGovernanceSurface` |
| 壳层 | `enterprise-mesh-governance-surface.ts`      | Ops/Perf（`meshTab`）+ KPI + 嵌入 Active/Ranking |
| 别名 | `enterprise-workforce-governance-surface.ts` | 薄封装，兼容旧 import                            |

### 2.2 Active / Ranking

| 项    | 文件              | 说明                                           |
| ----- | ----------------- | ---------------------------------------------- |
| embed | `assets-page.ts`  | `embedMode` 隐藏本地 Ops/Perf，仅渲染资产/队列 |
| 绩效  | `ranking-page.ts` | 挂载于 `meshTab=performance`                   |

### 2.3 Gateway

| 项         | 文件                 | 说明                                                  |
| ---------- | -------------------- | ----------------------------------------------------- |
| 配置持久化 | `mesh-governance.ts` | get/update 读写 `organization/governance-config.json` |

### 2.4 Phase 3 可选改进（同轮落地）

| 项          | 说明                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| 保存 facade | `saveSystemSettingsGroup` → `collaboration.space.updateBasic/Mission/Rules` |
| 规则写入口  | `updateRules` 支持 openDiscussion / maxVisible；UI toggle + number          |
| DOM 顺序    | 详情区严格 1→2→3→4                                                          |
| 策略保留    | `syncGroupOperatingState` 不再硬重置 collaborationPolicy                    |

---

## 3. 专家验收 Checklist

### 3.1 入口未变

- [x] `enterpriseMesh` 导航入口未迁移
- [x] 员工端 robots / groups 入口未迁移

### 3.2 单表面

- [x] 路由渲染 Legacy 壳（`.enterprise-surface--mesh`）
- [x] 默认运营 Tab 内嵌 `governance-assets-page`（`embedMode`）
- [x] 绩效 Tab 内嵌 `governance-ranking-page`
- [x] Ops/Perf Tab 可见（`data-mesh-panel="ops-perf-tabs"`）

### 3.3 KPI / 引擎

- [x] KPI 计数优先来自 `detectGovernanceIssues`
- [x] Cost / Token 仍仅企业端展示（员工端未引入）

### 3.4 配置持久化

- [x] `mesh.governance.updateConfig` 后跨调用可读同配置（`governance-config.json` 落盘）
- [x] `_resetMeshGovernanceState` 清理持久化文件（测试隔离）

### 3.5 边界

- [x] 机巢不提供 Identity / Prompt 编辑入口（assets 只读详情保持）
- [x] 机巢不安装/切换 Skills

### 3.6 测试

- [x] `mesh-governance.test.ts` 通过
- [x] `mesh-governance-redesign.browser.test.ts` 通过
- [x] Phase 3 scoped 套件仍绿（合计 **88/88**，专家复验 2026-08-02）

### 3.7 Phase 3 可选改进（同轮复核）

- [x] `saveSystemSettingsGroup` → `collaboration.space.updateBasic/Mission/Rules`
- [x] `updateRules` 写 openDiscussion / maxVisible + UI toggle/number
- [x] 协作详情 DOM 严格 1→2→3→4
- [x] `syncGroupOperatingState` 保留已有 `collaborationPolicy`（`...(existingState?.collaborationPolicy ?? {})`）

---

## 4. 明确不在本阶段

| 项                                             | 归属                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| ~~Tab 内 Legacy 队列/排行与 embed 资产表去重~~ | **已清理**（Ops=assets only；Perf=ranking+graphs）   |
| ~~贡献度 v2~~                                  | **已落地**（独立 score + sessionShare 旁路字段）     |
| ~~能力/协作图谱~~                              | **已挂绩效 Tab**（只读列表面板；交互式图谱可再增强） |
| ~~`method-scopes` 未分类方法~~                 | **已补齐**                                           |
| 图谱精确成员边 / 交互式可视化                  | 可选增强                                             |
| 星级后端 `proficiency`                         | 可选增强                                             |

---

## 5. 专家验收结论

- **总体意见：`批准，关闭 Strong Separation 主线`**
- **必须修改点：** 无
- **可选后续（不阻塞主线关闭）：**
  1. ~~运营 Tab 内 Legacy/embed 重复 UI~~ → **已清理**。
  2. ~~`navigation.browser.test.ts` Mesh Governance 兜底~~ → **已收紧**。（2026-10-01 更正：收紧发生在本清单之后的 `0df166521`（2026-08-03），收紧后的「机巢」/「AI Mesh」从未进入 locale，测试因此失败（D3.R1）；#245 已改为按 locale 断言 Mesh 页眉。模块名保持「机巢治理」/ "Mesh Governance"，见 Phase 1 清单文首更正）
  3. ~~能力/协作图谱、贡献度 v2、`method-scopes`~~ → **已落地**（图谱为绩效 Tab 只读面板；精确交互式图谱可再增强）。
- **是否关闭 Strong Separation 主线：** ☑ 是　□ 否
- **签字 / 日期：** 专家验收（Cursor Agent） / 2026-08-02

### 5.1 专家核验摘要

| 维度         | 结论 | 证据                                                           |
| ------------ | ---- | -------------------------------------------------------------- |
| 单表面路由   | ✅   | `enterprise-surfaces-core` → `renderMeshGovernanceSurface`     |
| 运营 embed   | ✅   | `governance-assets-page` `embedMode=true` + Legacy Ops Tab     |
| 绩效 ranking | ✅   | `governance-ranking-page` @ `meshTab=performance`              |
| KPI 引擎     | ✅   | `detectGovernanceIssues` → KPI 计数                            |
| 配置持久化   | ✅   | `governance-config.json` + `persists config across calls` 测试 |
| 边界         | ✅   | 只读抽屉声明；员工端无 Cost/Token 引入                         |
| Phase 3 补丁 | ✅   | facade 保存 / 规则写 / DOM 1→2→3→4 / policy 保留               |
| 测试         | ✅   | **88/88** scoped 全绿                                          |

---

## 6. 建议验收命令

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/collaboration-space-boundary.test.ts \
  src/gateway/server-methods/mesh-governance.test.ts \
  ui/src/ui/ports/employee/views/collaboration-group-members-table.node.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage.node.test.ts \
  ui/src/ui/ports/enterprise/views/__tests__/mesh-governance-redesign.browser.test.ts \
  --reporter=dot
```
