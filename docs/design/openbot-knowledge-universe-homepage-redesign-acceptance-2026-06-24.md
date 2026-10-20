# OpenBot 员工端知识宇宙首页重构验收方案

Date: 2026-06-24  
Status: **专家二次审议修订 · 待执行团队签收**  
适用范围: 员工端 `knowledge` 模块首页（用户面称「知识工作台」）  
关联文档:

- `docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 认知层定稿）
- `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md`（工作台重心修正）
- `.cursor/rules/ui-secondary-page-refinement.mdc`（全栈 UI 精修规范）

---

## 0. 执行摘要

本次优化**不是**在现有三 Tab 结构上「挪挪卡片、补补空状态」的修修补补，而是一次**信息架构与首屏布局的推倒重来**：

| 决策项    | 旧方案（当前实现）                                             | 新方案（本验收稿）                                            |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 页面形态  | 工作台 / 浏览 / 更多 三 Tab 切分                               | **单页纵向流**，供给区收为底部手风琴                          |
| 首屏主角  | 成果中心全宽大卡片 + 底部知识库                                | **左库右成果**双栏主工作区                                    |
| 关系网络  | 藏在「更多」Tab 全展开                                         | **默认折叠**于页底，搜索选中后联动展开（Phase 2）             |
| 来源概览  | 组件已实现但未挂载                                             | **metric-strip 首屏常驻**                                     |
| 最近/推荐 | 藏在「更多」Tab                                                | **首屏双列展示**（接受近期访问数据易空）                      |
| 快捷操作  | 埋在「当前知识库」卡片内                                       | **独立横条**，与当前库强绑定 + 无库兜底                       |
| 产品命名  | 知识宇宙（偏抽象）                                             | 用户面 **知识工作台**；内部模块名不动                         |
| 库内搜索  | 顶部 scope=library 隐式写 `kbSearchQuery`；**UI 无库内 input** | 左栏新增库内 input；**T1 前瞻护栏**禁止再叠顶部 library scope |

**核心结论**：

- **Phase 1 保持 `WorkbenchKnowledgeSurface` 与 `knowledge.*` RPC 不动**，只重写首页装配层。现有 callbacks 已覆盖库创建、库检索、成果归档、个人收录/上传，无需先改契约。装配入口见 `ui/src/ui/ports/employee/render-model.ts:3731-3844`。
- 后端能力全部保留；**前端装配层推倒重来**，并同步做**减框 + 层级收敛**。
- **五条铁律全部纳入 Phase 1 验收**（含 T2 选中库持久化；**取消 Phase 1.5**）。

**专家二次审议结论**：方向、IA、与代码吻合度均正确；签收前已落实 §10 四项修正。落实后 Phase 1 可放心执行。

---

## 1. 背景与问题陈述

### 1.1 产品定位（不变）

知识宇宙 / 知识工作台 = OpenBot 员工端与 Agent Runtime 共享的**统一认知层**。

### 1.2 当前实现的核心病症

1. **布局优先级倒置**：成果区置顶、知识库沉底——与概念设计「左库右成果」相反。
2. **Tab 碎片化**：高价值内容藏在非默认 Tab，首屏大面积空状态。
3. **组件孤岛**：`metric-strip`、`source-cards` 已实现但未接入；`relations-section` 的 `collapsed` 变体未用于工作台。
4. **库内搜索状态层与 UI 不对称（前瞻风险，非现行双入口 bug）**：
   - 状态层已有 `query`（全局）与 `kbSearchQuery`（库内）两套字段（`knowledge-universe.ts`、`knowledge-universe-workspace.ts`）。
   - 契约暴露 `onKbSearch` / `onKbSearchQueryChange`，但**当前 UI 没有任何输入框绑定它们**——`knowledge-universe-page.ts` 与 `knowledge-universe-workspace-panels.ts` 仅渲染 `knowledge-universe__library-search-results` 结果区，无库内 input。
   - 现行唯一搜索入口是**顶部输入框 + scope 切换**；`onSearch` 在 `scope=library` 时会隐式 `setKnowledgeUniverseKbSearchQuery(state, query)`（`render-model.ts:3731-3737`）。
   - **隐患**：新设计在左栏**新增**库内 input 后，若同时保留顶部 `library` scope，才会显性化为两个权威入口写同一 `kbSearchQuery`。**T1 是针对此前瞻护栏，不是修复一个当前并不存在的 UI 双入口 bug。**
5. **选中库无持久化**：`ui-prefs` 仅记 `pageTab` / `browseSubTab`（`knowledge-universe-ui-prefs.ts:6-71`）；默认选第一个库（`knowledge-universe-workspace.ts:47-57`）。Phase 1 把库升为首屏主舞台后，此问题体感会**比现在严重得多**。
6. **锚点与手风琴冲突 + 多处裸滚动器**：`knowledge-universe.ts:445-481` 三处 `scrollIntoView`；`metric-strip.ts`、`source-cards.ts` 各有一份本地 `scrollToAnchor`。企业/能力锚点将落入折叠的 [H]，裸滚动会失效。
7. **视觉噪声**：多组件带重边框（`workbench.css` 相关块），直接拼装仍会吵。
8. **成果分桶隐藏语义**（见 §3.4.1）：`resolveDeliverableBucket` 对带 `relatedKnowledgeBaseId` 的成果一律归为 `archived`，可能影响五态筛选预期。

### 1.3 为何要「重来」而非「修补」

**决策**：废弃三 Tab 首屏装配，重写 `renderKnowledgeUniversePage` 与 `renderKnowledgeUniverseWorkspacePanels`，并配套样式减框、统一锚点导航。

---

## 2. 目标态信息架构

### 2.1 页面区块（自上而下）

```text
┌─────────────────────────────────────────────────────────────────┐
│ [A] 全局搜索区（仅 workspace；见 §3.1）                          │
├─────────────────────────────────────────────────────────────────┤
│ [B] 快捷操作横条（含无库兜底）                                    │
├──────────────────────────────┬──────────────────────────────────┤
│ [C] 左栏 · 我的知识库         │ [D] 右栏 · 成果中心               │
│     库列表 + 库内搜索（新）   │     最近 5 条 + 五态筛选           │
├──────────────────────────────┴──────────────────────────────────┤
│ [E] 来源概览（metric-strip → navigateKnowledgeUniverseAnchor）    │
├─────────────────────────────────────────────────────────────────┤
│ [F] 最近访问 | 智能推荐                                          │
├─────────────────────────────────────────────────────────────────┤
│ [G] 关系洞察（默认折叠）                                         │
├─────────────────────────────────────────────────────────────────┤
│ [H] 供给与管理（手风琴）                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 废弃的结构

- ❌ 顶层三 Tab
- ❌ 成果区置于知识库之上
- ❌ 库列表仅在 `<details>` 内
- ❌ 顶部 `library` scope pill（T1 前瞻护栏）
- ❌ 各组件内本地 `scrollToAnchor` 函数

### 2.3 保留的后端与契约

- ✅ `WorkbenchKnowledgeSurface` 与全部 callbacks（Phase 1 不扩 surface 字段）
- ✅ `knowledge.*` RPC
- ✅ 内部模块名 `knowledge-universe`

### 2.4 五条实施铁律（Phase 1 必达 · 同生验收）

| #      | 铁律                             | 说明                                                                                                                                                                                                                                          | 代码依据                                                                              |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **T1** | **库内搜索前瞻护栏**             | Phase 1 左栏**新增**库内 input 绑定 `kbSearchQuery`/`onKbSearch` 时，**不得**同时保留顶部 `library` scope。采用方案 A：顶部仅 `workspace`；库内仅左栏。**注意：这是防止重构后产生双入口，非修复现行 UI bug**（现行仅顶部单入口 + 隐式拷贝）。 | 无库内 input：`page.ts`、`workspace-panels.ts`；隐式拷贝：`render-model.ts:3731-3737` |
| **T2** | **选中库持久化（并入 Phase 1）** | 扩 `knowledge-universe-ui-prefs.ts` 持久化 `selectedKnowledgeBaseId`；`onSelectKnowledgeBase` / 创建库后写入；进入页恢复，无效 id 回退首库。**与 IA 同生验收，不设 Phase 1.5 窗口期。**                                                       | `ui-prefs.ts:6-71`；`ensureSelectedKnowledgeBase`                                     |
| **T3** | **近期访问数据风险**             | 首屏可展示，接受刷新/重启后常为空；无数据整块隐藏。                                                                                                                                                                                           | `recent-visits.ts:10-44`                                                              |
| **T4** | **统一锚点导航**                 | **删除** `metric-strip.ts`、`source-cards.ts` 内本地 `scrollToAnchor`；**改造** `knowledge-universe.ts:445-481` 裸 `scrollIntoView`；全部走 `navigateKnowledgeUniverseAnchor`。清理 `KNOWLEDGE_UNIVERSE_ANCHORS` 死锚点。                     | 见 §3.5                                                                               |
| **T5** | **首次无库兜底**                 | 无库时不得死路：「创建并收录」或 inbox 收录（后端 `knowledgeBaseId` 可选）。                                                                                                                                                                  | `knowledge-universe.ts:571-616`                                                       |

---

## 3. 分区详细规格

### 3.1 [A] 全局搜索区

#### T1：前瞻护栏（非修现行 bug）

| 现状（诚实描述）                                          | Phase 1 目标                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| 单一 UI 入口：顶部 input + scope pill                     | 顶部 input **仅全局**；移除 library scope UI                     |
| `kbSearchQuery` 仅由 scope=library 时 `onSearch` 隐式写入 | 左栏新 input **显式**绑定 `onKbSearchQueryChange` / `onKbSearch` |
| 无库内 input                                              | 左栏为库内**唯一**权威入口                                       |

**验收**：顶部无「当前库」scope；左栏库内搜索独立工作；`onSearch` 不再向 `kbSearchQuery` 隐式拷贝（或 scope 固定 workspace 后该分支不可达）。

---

### 3.2 [B] 快捷操作横条

（同前：T5 兜底；申请能力/浏览企业走 T4 控制器。）

---

### 3.3 [C] 左栏 · 我的知识库

| 区块     | 规格                           |
| -------- | ------------------------------ |
| 库列表   | 常驻；顶部「+ 新建」           |
| 选中态   | **Phase 1 即恢复上次库（T2）** |
| 库内搜索 | **新 UI**；绑定已有 callbacks  |
| 证据卡片 | 静态列表；选中高亮 → Phase 2   |

---

### 3.4 [D] 右栏 · 成果中心

| 规格项   | 要求                |
| -------- | ------------------- |
| 数量     | 最近 5 条           |
| 来源标签 | Phase 1 i18n 本地化 |
| 分桶     | 见 §3.4.1           |

#### 3.4.1 成果分桶语义确认（Phase 1 顺手核对）

`knowledge-universe-workspace-panels.ts` 中 `resolveDeliverableBucket`：

```ts
if (item.relatedKnowledgeBaseId || item.status === "archived") {
  return "archived";
}
```

**隐藏语义**：任何已关联知识库（`relatedKnowledgeBaseId`）的成果，**无论真实 `status` 是否为 `draft`**，一律落入「已归档」筛选，不会出现在「草稿」。

| 选项     | 产品含义                                                    |
| -------- | ----------------------------------------------------------- |
| **保持** | 「已归档」= 已入库；草稿筛选仅看未入库草稿                  |
| **调整** | 分桶以 `status` 为主，`relatedKnowledgeBaseId` 仅作展示标签 |

**Phase 1 要求**：产品负责人在开工前勾选其一；重写 deliverables 区时按选定语义实现。未确认前默认**保持**现有逻辑并在 UI 文案中避免「草稿」与「已入库」混淆。

---

### 3.5 [E] 来源概览 + T4 统一锚点导航

#### 3.5.1 `navigateKnowledgeUniverseAnchor(anchorId)`

```text
1. 查 ANCHOR_NAV_MAP（见下表）
2. 若 target 在手风琴内 → 展开 [H] + 展开对应子 panel
3. rAF 后 scrollIntoView(anchorId)
4. 可选：目标区短暂高亮
```

#### 3.5.2 锚点映射表（完整 · 含清理）

| 锚点 ID                         | 常量键             | 首屏可见 | 手风琴子区     | Phase 1 动作                      |
| ------------------------------- | ------------------ | -------- | -------------- | --------------------------------- |
| `ku-workspace`                  | `workspace`        | ✅       | —              | 保留                              |
| `ku-deliverables`               | `deliverables`     | ✅       | —              | 保留                              |
| `ku-personal`                   | `personal`         | ❌       | `personal`     | 保留；T4 须先展开                 |
| `ku-enterprise`                 | `enterprise`       | ❌       | `enterprise`   | 保留；T4 须先展开                 |
| `ku-capability-center`          | `capabilityCenter` | ❌       | `capabilities` | 保留；T4 须先展开                 |
| `ku-personal-title`             | `personalTitle`    | —        | —              | **删除死锚点**                    |
| `knowledge-universe-data-space` | `dataSpace`        | —        | —              | **删除或合并至 capabilityCenter** |
| `ku-resource-center`            | `resourceCenter`   | —        | —              | **删除死锚点**                    |

#### 3.5.3 须删除/替换的裸滚动器

| 位置                                      | 现状                    | Phase 1                                            |
| ----------------------------------------- | ----------------------- | -------------------------------------------------- |
| `knowledge-universe-metric-strip.ts:6-10` | 本地 `scrollToAnchor`   | 删；改调 `navigateKnowledgeUniverseAnchor`         |
| `knowledge-universe-source-cards.ts:5-9`  | 本地 `scrollToAnchor`   | 同上（Phase 3 复用 source-cards 时不再引入第三份） |
| `knowledge-universe.ts:445-481`           | 三处裸 `scrollIntoView` | 改调统一控制器                                     |
| 快捷操作 / 搜索命中                       | 部分裸滚动              | 全部走统一控制器                                   |

**grep 验收**：`rg 'scrollIntoView|scrollToAnchor' ui/src/ui/views/knowledge-universe*` 仅允许出现在 `knowledge-universe-anchor-nav.ts`（或等价单一模块）。

---

### 3.6 – 3.8 \[F\]\[G\]\[H\]

（同前；[H] 锚点 ID 以 §3.5.2 清理后常量为准。）

---

## 4. 视觉：减框与层级收敛（Phase 1 必做）

（同前 §4；首屏边框嵌套 ≤2 层。）

---

## 5. 命名策略与全量 sweep

### 5.1 原则

| 层面   | 策略                                                  |
| ------ | ----------------------------------------------------- |
| 用户面 | **知识工作台**                                        |
| 内部   | `knowledge-universe` 模块名、文件、RPC、类型 **不改** |

### 5.2 全量 sweep（禁止按固定行号改）

签收前对以下路径做 **`知识宇宙` → `知识工作台`** 全量 grep，用户可见文案全部更新：

```bash
rg -n '知识宇宙' ui/src/i18n ui/src/ui/ports/employee
```

**已知命中（2026-06-24 grep，非穷尽）**：

| 文件                                                    | 说明                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/src/i18n/locales/zh-CN.ts`                          | `universe`（~1535）、`knowledgeUniverse.*`（~1647+）、`label`（~1780）、`empty`（~1787）、`knowledgeVerse`（~1909）、`knowledge` nav（~3802） |
| `ui/src/ui/ports/employee/views/workbench-nav-model.ts` | `t("frontstage.workbench.nav.knowledgeVerse")`（~216）                                                                                        |

漏改会导致「知识工作台」与「知识宇宙」**混排上线**，直接违反 UX-6。

### 5.3 测试断言策略（RG-1 决策）

`workbench-stage-module.knowledge.node.test.ts` 现有 **~10 处**断言展示文案 `"知识宇宙"`（行 281、301、323、340、360、384、414、432、452、469…）。

| 策略             | 说明                                                          | 本方案选择 |
| ---------------- | ------------------------------------------------------------- | ---------- |
| 断言展示文案     | 每次改名都改测试                                              | ❌ 脆      |
| **断言稳定结构** | `.knowledge-universe__*` class、`#ku-*` 锚点、`role`/`aria-*` | ✅         |

**Phase 1 要求**：

- 将现有 `"知识宇宙"` 文案断言**迁移为 class/锚点/ARIA 断言**
- 仅保留 **≤1 处** 冒烟测试断言导航文案为「知识工作台」（验证 sweep 生效）
- 执行：`rg '知识宇宙' ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` 目标为 0 或仅保留冒烟条

---

## 6. 组件复用与改造清单

| 组件     | 文件                                            | 动作                                     |
| -------- | ----------------------------------------------- | ---------------------------------------- |
| 页面根   | `knowledge-universe-page.ts`                    | **重写**                                 |
| 工作区   | `knowledge-universe-workspace-panels.ts`        | **重写** + 分桶语义确认                  |
| 锚点导航 | **新建** `knowledge-universe-anchor-nav.ts`     | T4 唯一滚动入口                          |
| 指标条   | `metric-strip.ts`                               | 删本地 scroll；接统一导航                |
| 来源三卡 | `source-cards.ts`                               | 删本地 scroll；Phase 3 复用时不复发      |
| 锚点常量 | `knowledge-universe-anchors.ts`                 | 清理死锚点；补 `ANCHOR_NAV_MAP`          |
| ui-prefs | `knowledge-universe-ui-prefs.ts`                | **Phase 1** 增 `selectedKnowledgeBaseId` |
| 控制器   | `knowledge-universe.ts`                         | 搜索命中改走 T4                          |
| 样式     | `workbench.css`                                 | 减框                                     |
| i18n     | `zh-CN.ts` 等                                   | **全量 sweep**                           |
| 测试     | `workbench-stage-module.knowledge.node.test.ts` | class 断言策略                           |

### 6.1 契约变更

| 阶段    | 变更                                                                  |
| ------- | --------------------------------------------------------------------- |
| Phase 1 | **零变更** `WorkbenchKnowledgeSurface` 字段；仅 `ui-prefs` 本地扩字段 |
| Phase 2 | 可选 `supplySectionExpanded`、证据卡选中 state、搜索联动              |

---

## 7. 实施阶段

### Phase 1 — 推倒装配层 + 五条铁律 + 减框（P0，2–3 人日）

- [ ] 单页 A–H，去三 Tab
- [ ] 双栏 C/D；成果 ≤5 条 + source 本地化 + **分桶语义确认（§3.4.1）**
- [ ] **T1** 前瞻护栏：顶部仅 workspace；左栏新库内 input；去掉隐式拷贝路径
- [ ] **T2** `selectedKnowledgeBaseId` 持久化（**并入 Phase 1，无 1.5**）
- [ ] **T4** `navigateKnowledgeUniverseAnchor`；删全部裸滚动器；清理死锚点
- [ ] **T5** 无库兜底
- [ ] metric-strip / 最近推荐 / 关系折叠 接入 + 减框
- [ ] **§5 全量 i18n sweep** + 导航改名
- [ ] **§5.3 测试改断 class 名** + ≤1 处文案冒烟
- [ ] node test / `pnpm test` 相关路径通过

### ~~Phase 1.5~~ — **已取消**（T2 并入 Phase 1）

### Phase 2 — 交互闭环（P1）

- [ ] 搜索选中 → 成果/图/证据卡联动高亮
- [ ] 搜索选中 → 自动展开 [G]
- [ ] 成果「查看全部」；窄屏库横向 chips

### Phase 3 — 体验抛光（P2）

- [ ] source-cards 三卡（**必须**接 T4，禁止本地 scroll）
- [ ] 证据卡关键词高亮；来源色板

### Phase 4 — 后端增强（本次重构范围）

- [x] T3 recent visits 持久化落盘 — `src/gateway/knowledge/recent-visits.ts` → `CONFIG_DIR/knowledge/recent-visits.json`；测试 3 项
- [x] 员工身份成果打通 — `context.ts` 平台用户 fallback + `deliverables/read-model.ts` 按成员/席位群过滤；`knowledge.deliverables.list` 接线；RPC/read-model 测试通过
- [x]（附带）T5 无库后端兜底 — `personal-inbox-knowledge-base.ts`：未指定 `knowledgeBaseId` 时自动归入「我的收录」并 ingest（**不等于**下方「自动收录」Epic）

**移出本次重构验收范围**（见 §8.6，另立后端 Epic）：

- [ ] RAG 检索升级
- [ ] 自动收录（Knowledge Capture Runtime：chat/agent/deliverable 完成后主动建议入库）

---

## 8. 验收标准

### 8.1 信息架构

- [ ] **IA-1** – **IA-4**（同前）

### 8.2 五条铁律

- [ ] **T1** 前瞻护栏：无顶部 library scope；左栏库内 input；非「修双轨 bug」式验收
- [ ] **T2**（**Phase 1**）刷新后恢复上次选中库
- [ ] **T3** 最近访问无数据整块隐藏
- [ ] **T4** 全站无裸 `scrollToAnchor`/`scrollIntoView`（仅 anchor-nav 模块）；死锚点已清理；手风琴区先展开再滚
- [ ] **T5** 无库兜底可用

### 8.3 功能完整

- [ ] **FN-1** – **FN-9**（同前）
- [ ] **FN-10** 成果五态筛选行为与 §3.4.1 产品确认一致

### 8.4 视觉与体验

- [ ] **UX-1** – **UX-5**（同前）
- [ ] **UX-6** 全站用户面无「知识宇宙」混排（`rg '知识宇宙' ui/src/i18n ui/src/ui/ports/employee` 仅允许内部注释/模块 id）

### 8.5 回归

- [ ] **RG-1** node test 以 **class/锚点断言** 为主；`rg '知识宇宙' ...knowledge.node.test.ts` 仅 ≤1 处冒烟
- [ ] **RG-2** 相关 `pnpm test` 通过（合并前补 **全量** `pnpm tsgo` + `pnpm test`）
- [ ] **RG-3** 无 `WorkbenchKnowledgeSurface` 破坏性变更

### 8.6 非目标 / 独立排期（勿并入本次「P4 完成」口径）

与 `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md` §7 P2/P3 对齐：

| 能力                            | 本次状态              | 说明                                                                                                                                               |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RAG 检索升级**                | 未交付                | 既有 `kb-retrieve` / `knowledge-retrieval-runtime` / `knowledge.base.search` 索引路径可用；**本批次无新增**向量/混合检索工作                       |
| **自动收录（Capture Runtime）** | 未交付                | 需 `src/gateway/knowledge/capture/` + 聊天/Agent/协作完成 hook + 前端建议卡；全仓无 `autoCollect` / `collectSuggestion` 等实现                     |
| **个人收录 ingest**             | ✅ 已有（非 Capture） | `knowledge.personal.collect/upload` 在指定或 inbox 库上触发 `maybeIngestPersonalKnowledge` — 属 **T5 无库兜底 + 库内索引**，不是「完成后主动建议」 |

**工程注记（P3，不阻断合并）**：`recent-visits.ts` 热路径同步读写单 JSON、无锁；多席位并发有竞写隐患 — 建议后续异步化或按 scope 分片。

---

## 9. 涉及文件（repo-root 相对）

```
ui/src/ui/views/knowledge-universe-page.ts
ui/src/ui/views/knowledge-universe-workspace-panels.ts
ui/src/ui/views/knowledge-universe-metric-strip.ts
ui/src/ui/views/knowledge-universe-source-cards.ts
ui/src/ui/views/knowledge-universe-anchors.ts
ui/src/ui/views/knowledge-universe-ui-prefs.ts
ui/src/ui/views/knowledge-universe-anchor-nav.ts          ← 新建
ui/src/ui/controllers/knowledge-universe.ts
ui/src/ui/controllers/knowledge-universe-workspace.ts
ui/src/ui/ports/employee/render-model.ts
src/gateway/knowledge/recent-visits.ts
src/gateway/knowledge/personal-inbox-knowledge-base.ts   ← 新建（T5 兜底）
src/gateway/knowledge/context.ts
src/gateway/knowledge/deliverables/read-model.ts
src/gateway/server-methods/knowledge.ts
ui/src/ui/views/knowledge-universe-source-palette.ts      ← 新建
ui/src/ui/views/knowledge-universe-text-highlight.ts     ← 新建
ui/src/ui/views/knowledge-universe-anchor-nav.node.test.ts
ui/src/styles/workbench.css
ui/src/i18n/locales/zh-CN.ts
ui/src/ui/ports/employee/views/workbench-nav-model.ts
ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts
```

---

## 10. 专家审议记录

### 10.1 一轮审议（2026-06-24）

五条铁律、推倒装配层、契约冻结 — **修改后通过**。

### 10.2 二轮审议（2026-06-24）— 签收前四项修正

| #   | 修正项                                                                    | 文档落实                         |
| --- | ------------------------------------------------------------------------- | -------------------------------- |
| 1   | T1 改为**前瞻护栏**措辞；诚实描述现状（单 UI 入口 + 双状态层 + 隐式拷贝） | §1.2#4、§2.4 T1、§3.1            |
| 2   | T2 **并入 Phase 1**；取消 Phase 1.5                                       | §2.4 T2、§7、§8.2                |
| 3   | T4 覆盖**全部**裸滚动器 + 清理死锚点 + 完整映射表                         | §3.5、§6                         |
| 4   | 改名**全量 sweep** + 测试改断 **class 名**                                | §5.2、§5.3、§8.4 UX-6、§8.5 RG-1 |

**额外发现**：`resolveDeliverableBucket` 归档覆盖语义 — §3.4.1。

**二轮结论**：四项修正已纳入本文档；**可签收执行 Phase 1**。

### 10.3 三轮交付验收（2026-06-24）— 口径校准

| 阶段    | 结论       | 说明                                                                                    |
| ------- | ---------- | --------------------------------------------------------------------------------------- |
| Phase 1 | ✅         | 单页 IA、左库右成果、T1–T5、减框、选中库持久化                                          |
| Phase 2 | ✅         | 搜索联动、关系洞察折叠、成果查看全部、窄屏 chips                                        |
| Phase 3 | ✅         | source-cards + T4、证据高亮、来源色板；P1–P3 专家项已收口                               |
| Phase 4 | ⚠️ **2/4** | ✅ 近期访问落盘、员工身份成果打通（+ inbox 兜底）；❌ RAG、自动收录 — **移出范围** §8.6 |

**测试（作用域）**：UI 知识模块 ~27 项 + 后端 P4 ~14 项 ≈ **41 项绿**（未含全量 `pnpm tsgo` / `pnpm test`）。

**禁止表述**：「P1–P4 全部完成」— 准确表述为 **「P1–P3 完成 + P4 两项完成」**。

**合并门禁**：补全量 `pnpm tsgo` + `pnpm test` 后准予合并。

**P3 遗留跟踪**（不阻断）：chrome 夹具「知识宇宙」残留、未用 `searchScope` 兼容、de/es/pt-BR/zh-TW 缺 `knowledgeVerse` 译、改名正向冒烟 1 条。

---

## 11. 审批栏

| 角色 | 姓名 | 结论           | 日期 | 备注               |
| ---- | ---- | -------------- | ---- | ------------------ |
| 产品 |      | 二轮修改后通过 |      | 含 §3.4.1 分桶确认 |
| 设计 |      |                |      |                    |
| 前端 |      |                |      |                    |
| 架构 |      |                |      |                    |

---

## 12. 结论

- **不动**：`WorkbenchKnowledgeSurface`、`knowledge.*` RPC、内部模块名。
- **重写**：首页装配层 + 减框 + **统一锚点导航** + **全量改名 sweep**。
- **本次交付完成**：Phase 1–3 全数 + Phase 4 **持久化 / 身份打通**（§7、§10.3）。
- **本次不交付**：RAG 升级、自动收录 Capture Runtime — 见 §8.6 独立 Epic。

Phase 1 完成后按第 8 节验收；Phase 2 补搜索三处联动。
