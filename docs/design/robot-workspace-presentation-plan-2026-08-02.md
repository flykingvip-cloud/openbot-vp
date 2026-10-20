# 员工端 × 企业端三核心前端展现规划

Date: 2026-08-02  
Status: **规划定稿 · 试点 1/2 已落地**  
Parent: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md`  
Visual standard: `.cursor/rules/ui-secondary-page-refinement.mdc` + `enterprise-org-ws*` / `--flat`  
Scope: **仅** Strong Separation 三核心（入口位置不变）  
Non-goal: 不改导航归属、读模型/RPC、职责矩阵

---

## 1. 页型矩阵

| 表面         | 一级 (L1)                 | 二级 (L2)                          | 三级 (L3)                 | 页型                  |
| ------------ | ------------------------- | ---------------------------------- | ------------------------- | --------------------- |
| 我的机器人   | 列表 + 统计条             | 右侧抽屉 ~640px                    | accordion 六块内表单/行栈 | 列表 → 抽屉详情       |
| 我的协作小组 | 左锚点列表                | 右操作区四块详情                   | 群治理子分区 / 成员表     | 主从（锚点 + 操作区） |
| 机巢         | Compact header + Ops/Perf | 运营：队列+资产表；绩效：排行+图谱 | 只读详情抽屉 / 图谱边列表 | 工作台双 Tab          |

| 约束         | 员工机器人              | 员工协作组            | 企业机巢                                |
| ------------ | ----------------------- | --------------------- | --------------------------------------- |
| 产品问题     | 如何培养我的助手？      | 如何共同完成任务？    | AI 劳动力是否健康高效？                 |
| 禁止         | 企业成本/Runtime 深监控 | 机巢治理文案          | Identity/Prompt/Skills 编辑             |
| 边框层数目标 | L1 扁平；抽屉内 ≤1      | 外框 ≤1；分区无描边卡 | 壳层无 console 套卡；embed 无第二品牌条 |

---

## 2. 页面结构布局草图

### 2.1 我的机器人（列表 + 抽屉 · 本轮文档勾勒）

```text
┌─ 系统设置 · 我的机器人 (L1) ─────────────────────────┐
│  标题 + 一句产品定位（培养助手，非治理）                 │
│  统计条（拥有 / 参与 / 活跃）——行式，非小卡墙            │
│  ┌─ 列表行栈 ─────────────────────────────────────┐ │
│  │  emoji 名  · 简略态  · 主CTA「进入」  ·「详情」  │ │
│  │  …（更多收进 overflow）                          │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         点击「详情」→
┌─ 锚点列表仍可见 ─┬─ 右侧抽屉 640px (L2) ─────────────┐
│  列表（dimmed）   │  头：名 / 简略态 / 关             │
│                   │  accordion×6（Identity…Data）     │
│                   │  块内：行栈 KV + 唯一操作 footer  │
└───────────────────┴──────────────────────────────────┘
```

**形态决策**：产品已定抽屉；精修规范 §8.3 优先就地面板——**本轮保留抽屉**，强制抽屉内部扁平（下一波精修）。

关键文件：`ui/src/ui/ports/employee/views/workbench-stage-module.ts`、`my-bot-workspace-drawer.ts`

### 2.2 我的协作小组（主从 · 试点 1）

```text
┌─ 系统设置 · 我的协作小组 (L1) ───────────────────────┐
│  标题 + 一句定位（协作关系，非机巢）                   │
│  ┌─ 左锚点列表 ──┐  ┌─ 右操作区 / 详情 (L2) ───────┐ │
│  │ 组名 · 状态    │  │ 顶栏：名 / 状态 / 保存·放弃   │ │
│  │ …             │  │ ① 基本信息（行栈）            │ │
│  │               │  │ ② 使命（宽区）                │ │
│  │               │  │ ③ 成员表（唯一成员操作入口）  │ │
│  │               │  │ ④ 群治理（决策/保密/规则/生命）│ │
│  │               │  │ 底：危险区（重置/解散）        │ │
│  └───────────────┘  └──────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

约束：外框 ≤1（`--flat`）；分区用标题+间距，禁止 section 再套描边卡；键值行栈；成员管理唯一入口。

关键文件：`workbench-stage-module.ts`（`settings-group-shell--flat`）、`collaboration-group-members-table.ts`

### 2.3 机巢（运营 / 绩效 · 试点 2 = 运营）

```text
┌─ 机巢 (L1) ──────────────────────────────────────────┐
│  Compact header（标题 + 机器人/组/成本 + 刷新）        │
│  KPI 三卡（待处置 / 待复核 / 待优化）——可点回运营     │
│  Ops | Perf 主 Tab                                    │
│  ┌─ 运营 (L2) ─────────────────────────────────────┐ │
│  │  assets-page embed：搜索 + 治理队列 + 资产表     │ │
│  │  行点击 → 就地/侧栏只读详情（禁 Prompt/Skills）  │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌─ 绩效 (L2，本轮文档勾勒) ────────────────────────┐ │
│  │  ranking-page + 图谱只读双栏                     │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

约束：去掉运营区多余 `enterprise-console card`；KPI/overview 降噪；embed 顶栏无第二套「机巢」品牌条。

关键文件：`enterprise-mesh-governance-surface.ts`、`assets-page.ts`

---

## 3. 病症对照（精修前）

| 病症 (规范 §1)  | 我的机器人            | 协作小组                                    | 机巢运营                           |
| --------------- | --------------------- | ------------------------------------------- | ---------------------------------- |
| 多层外边框      | 列表/抽屉内可能卡中卡 | `settings-card--group-section` 与 list 双层 | `enterprise-console card` 套 embed |
| 头/体分隔线冗余 | 抽屉 header           | section-head 可能多余底边                   | assets topnav                      |
| 键值小卡化      | 统计若为小卡墙        | `--flat` 已改行栈，需守住                   | object-overview 多卡               |
| 操作入口分散    | 列表 CTA 并列         | 成员管理入口已收敛                          | 只读详情须守住                     |
| 文案跨层        | 「治理」语义残留风险  | 须标明非机巢                                | 须标明非培养台                     |

---

## 4. 目标态规范

1. **边框**：到达内容前连续描边 ≤1（理想扁平 0 外框 + 细分隔）。
2. **卡片数 = 信息分组数**：Groups 四块；Mesh Ops = 队列+表。
3. **操作收敛**：Groups 保存/危险区在右栏；Mesh 无 Identity/Prompt/Skills 写。
4. **键值**：左标签/右值行栈；禁止每字段独立描边小卡。
5. **文案**：员工「培养/协作」；企业「运营/绩效」。
6. **模板**：员工端抽取与 `orgWs*` 等价的轻量 helper（禁止 V2 卡片副本）。

---

## 5. 试点验收清单

### 试点 1 · 协作小组

- [x] DOM 顺序严格 1→2→3→4（收敛为四块：基本信息 / 使命 / 成员 / 群治理）
- [x] 整页主从重排（`wb-groups`：intro + 左锚点行栈 + 右操作区）
- [x] section 无额外描边卡层；危险区左侧强调条
- [x] 危险区唯一；保存条在右栏顶（`data-wb-settings-toolbar`）
- [x] `workbench-stage.node.test.ts` 断言通过

### 试点 2 · 机巢运营

- [x] 无 `operations-legacy-queue`
- [x] `operations-assets` 无 `enterprise-console card` 套层（改为 `enterprise-mesh-ops-panel`）
- [x] embed 顶栏无「机巢」/「资产视图」模块名重复（仅搜索）
- [x] `mesh-governance-redesign.browser.test.ts` 通过

### 下一波（本轮不改代码）

- 我的机器人列表 CTA 分层 + 抽屉内六块扁平
- 机巢绩效/图谱视觉精修
- 交互式图谱 / 精确成员边

---

## 6. 代码锚点

| 区域            | 路径                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| 员工设置舞台    | `ui/src/ui/ports/employee/views/workbench-stage-module.ts`               |
| 设置布局 helper | `ui/src/ui/ports/employee/views/workbench-settings-layout.ts`            |
| My Bot 抽屉     | `ui/src/ui/ports/employee/views/my-bot-workspace-drawer.ts`              |
| 成员表          | `ui/src/ui/ports/employee/views/collaboration-group-members-table.ts`    |
| 员工样式        | `ui/src/styles/workbench.css`（`settings-group-shell--flat`）            |
| 机巢壳          | `ui/src/ui/ports/enterprise/views/enterprise-mesh-governance-surface.ts` |
| 资产页          | `ui/src/ui/capability/ai-workforce-governance/pages/assets-page.ts`      |
| org-ws 模板     | `ui/src/ui/ports/enterprise/views/enterprise-org-workspace-template.ts`  |
