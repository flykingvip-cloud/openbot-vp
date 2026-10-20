# AI 员工入职培养 — P0–P2 技术方案

- Date: 2026-08-04
- Status: **P0–P2.1 + P3 + P3.1 验收通过（2026-08-04）**
- Scope: Employee Growth Prelude → 非阻断智能上岗建议层（P0）+ 任务驱动缺口闭环（P1 C+3）+ **成长档案四区（P2）**
- Non-goals: 自动重放原任务；Working DNA / 经验偏好（**P2.1**）；new Wizard / second lifecycle FSM

## 发布表述（强制）

> P0：非阻断智能上岗建议层 + 模板能力缺口接线。  
> P1（C+3）：首条任务 LLM 解析胜任要求 → 任务缺口建议 → 增强/跳过 → 「继续原任务」条恢复上下文并由用户确认发送（**不**自动重放）。  
> P2：机器人成长档案四区（身份 / 能力 / 表现 / 建议）可读；接通 `operationalScore` 与 `growthReport` 持久化与展示。经验/偏好 Working DNA 归 P2.1。

| 层级     | 状态                | 说明                                                                        |
| -------- | ------------------- | --------------------------------------------------------------------------- |
| **P0**   | **验收通过**        | 决策器、真实技能缺口、唯一主 CTA、里程碑写入、Node/Lit + 浏览器非阻断用例   |
| **P1**   | **验收通过（C+3）** | LLM 任务解析 + 前置门控 + pendingTaskContext + 续跑条显式恢复；不 auto-send |
| **P2**   | **首切片已实现**    | 我的机器人 → 成长 tab 四区；`growthReport` 持久化；`operationalScore` 展示  |
| **P2.1** | **验收通过**        | Working DNA / 机器人经验偏好沉淀（含安全门槛）                              |
| **P3**   | **验收通过**        | 机巢只读成长聚合（含租户隔离）                                              |

### P1 C+3 行为（摘要）— 前置门控（非事后建议）

1. 用户发送首条任务 → `chat.send` **先** `analyze-growth-task`
2. 若存在 unmet 任务技能 → 返回 `status: growth_gate_blocked`，**不**启动真实 run；UI 恢复草稿并展示门控条
3. 用户选择「去安装推荐能力」或「先做再说」（`growthGateProceed: true`）后，才再次 `chat.send` 执行原任务
4. 放行成功：写入 `firstMissionSentAtMs` 并清除 `pendingTaskContext`
5. 分析基础设施失败：降级为可执行（不因门控挂掉而卡死发送）

### P2 首切片行为（摘要）

1. 有运营指标时，`projectOperationalGrowth` 写入 `operationalScore` 并持久化 `growthReport`
2. `agents.get-growth-status` / `robot.workspace.get` 返回 `dossier`（completeness + 四区摘要 + recommendation）
3. 设置 → 我的机器人 → **成长** tab：分区导航呈现身份 / 能力 / 表现 / 建议
4. 无实战数据时 `operationalScore` 显示「暂无」，不伪造分数
5. 建议区唯一主 CTA 跳转既有身份编辑 / 探索能力 / 进入工作区（不新建流程）

浏览器非阻断验收文件：`ui/src/ui/ports/employee/views/workbench-growth-prelude-nonblocking.browser.test.ts`  
（root `pnpm test` 跑 jsdom 逻辑；发布前另跑 `pnpm -C ui test` 覆盖 chromium 几何断言。）

## 0. 评审结论采纳

专家判断成立：产品方向正确，但现有 Growth OS **不等于**已具备智能上岗层。P0 必须先补：

1. 数据契约（recommendation + gaps + funnel flags）
2. 真实技能安装源统一
3. 里程碑唯一写入点与幂等
4. 纯函数决策器 → 唯一主 CTA
5. 布局级非阻断验收

**原则保留：** 不新建 Wizard / 第二套生命周期；挂在现有 `GrowthStatus` + `LifecycleState` + `dimensions` 上。

---

## 1. P0 / P1 边界（收紧后）

| 层级   | 交付                                                                                      | 明确不做                                                       |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **P0** | 智能上岗卡；模板缺口真实接线；唯一主建议；里程碑接线；非阻断；修 `installedSkillKeys: []` | 任务需求解析；增强后恢复原任务草稿；验证任务编排；成长档案四区 |
| **P1** | 任务 → 缺口闭环；增强后上下文恢复；验证任务引导                                           | 机巢聚合                                                       |
| **P2** | 成长档案四区（身份/能力/表现/建议）；operationalScore + growthReport                      | Working DNA / 经验偏好（P2.1）                                 |
| **P3** | 机巢只读成长/协作/成本                                                                    | 员工端治理控件                                                 |

**P0「立即增强」降级（验收口径）：**

- 点击主 CTA `install_capabilities` → 打开员工工作台 `assistant` 模块 skills 页，并带上 `recommendedSkillKeys`（来自 unmet gaps）
- **不**在 P0 实现「增强完成自动回到原任务草稿」——该能力标为 **P1**，UI 文案用「去安装推荐能力」而非暗示会自动续跑

---

## 2. 数据契约

### 2.1 `GrowthCapabilityGapView`（RPC + UI 共用形状）

扩展现有 `computeCapabilityGaps` 输出，补 `label` + `satisfied`，与 Prelude `GrowthCapabilityGap` 对齐：

```ts
export type GrowthCapabilityGapView = {
  key: string;
  label: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  /** missing | pending_integration | satisfied */
  status: "missing" | "pending_integration" | "satisfied";
};
```

- `skill`：未安装 → `missing`；已安装 → `satisfied`（详情列表可含已满足项；主建议只看 unmet）
- `oauth`：P0 恒 `pending_integration`（不计分、不阻塞主建议优先级，除非无任何 skill 缺口且用户在培养详情中查看）

### 2.2 `NextGrowthAction`（唯一主建议）

```ts
export type NextGrowthActionKind =
  | "start_work" // 直接开始工作：聚焦 composer + optional prefill
  | "confirm_identity" // 确认岗位/职责
  | "install_capabilities" // 安装模板缺口技能
  | "verify_with_task" // 有能力但尚无成功任务
  | "none"; // 无主建议（已 dismiss / 已 activated+ 等）

export type NextGrowthActionTarget = {
  focusComposer?: boolean;
  prefill?: string;
  module?: "assistant" | "knowledge" | "settings";
  tab?: "skills";
  recommendedSkillKeys?: string[];
};

export type NextGrowthAction = {
  kind: NextGrowthActionKind;
  /** i18n key suffix，如 growth.recommend.start_work */
  reason: string;
  /** 越小越优先；决策器写出，便于测试断言 */
  priority: number;
  /** 与本建议直接相关的缺口（install 时为 unmet skills） */
  gaps: GrowthCapabilityGapView[];
  canSkip: boolean;
  target: NextGrowthActionTarget;
};
```

### 2.3 `GrowthFunnelFlags`（UI 决策可读摘要）

避免 UI 直接扒 `milestones` 时间戳逻辑分叉：

```ts
export type GrowthFunnelFlags = {
  hasSessionOpened: boolean;
  hasIdentityCompleted: boolean;
  hasFirstSkillInstalled: boolean;
  hasFirstMissionSent: boolean;
  hasFirstMissionSuccess: boolean;
  preludeDismissed: boolean;
};
```

派生规则（gateway 单一实现）：

| flag                     | 条件                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `hasSessionOpened`       | `milestones.sessionOpenedAtMs > 0`                          |
| `hasIdentityCompleted`   | `milestones.identityCompletedAtMs > 0`                      |
| `hasFirstSkillInstalled` | `milestones.firstSkillInstalledAtMs > 0`                    |
| `hasFirstMissionSent`    | `milestones.firstMissionSentAtMs > 0`                       |
| `hasFirstMissionSuccess` | `milestones.firstMissionSuccessAtMs > 0` \|\| `isActivated` |
| `preludeDismissed`       | `preludeDismissedAtMs > 0`                                  |

### 2.4 RPC 响应扩展

`agents.get-growth-status` / `agents.recompute-growth`（机器人）响应从：

```json
{ "agentId", "growthStatus" }
```

扩展为：

```json
{
  "agentId": "...",
  "growthStatus": { "...existing GrowthStatus incl. milestones..." },
  "capabilityGaps": [GrowthCapabilityGapView],
  "funnel": GrowthFunnelFlags,
  "recommendation": NextGrowthAction
}
```

**兼容：** 旧客户端忽略新字段仍可工作；新 UI **不得**在缺 `recommendation` 时本地再发明第二套优先级（可降级 `kind:"none"` + 隐藏主 CTA）。

小组侧 RPC **P0 不改交互**（仍可用现有 team prelude）；契约可先只落机器人路径，小组后续对称。

### 2.5 UI `GrowthStatusView` 扩展

`ui/src/ui/controllers/agent-growth.ts`：

```ts
export type GrowthStatusView = {
  // ...existing fields...
  milestones?: {
    sessionOpenedAtMs?: number | null;
    identityCompletedAtMs?: number | null;
    firstSkillInstalledAtMs?: number | null;
    firstMissionSentAtMs?: number | null;
    firstMissionSuccessAtMs?: number | null;
    firstCtaClickedAtMs?: number | null;
  };
  capabilityGaps: GrowthCapabilityGapView[];
  funnel: GrowthFunnelFlags;
  recommendation: NextGrowthAction;
};
```

`normalizeGrowthStatus` 必须解析上述字段；缺省时 `capabilityGaps=[]`、`recommendation={kind:"none",...}`、`funnel` 全 false（除能从已有 `preludeDismissedAtMs` 推导的）。

---

## 3. 技能安装权威源（P0 必修一致性）

### 3.1 单一采集函数

已有：`collectInstalledSkillKeys(agentId)` in `src/gateway/server-methods/agent-growth.ts`（基于 `listRobotSkillAssets`）。

**P0 动作：**

1. 抽到 `src/gateway/agent-growth/installed-skills.ts`（或 `signals.ts` 旁）并 export，供：
   - `recomputeRobot`
   - `projectOperationalGrowth` / `syncRobotGrowthFromOperationalMetrics`
   - `get-growth-status` 组装 `capabilityGaps`
2. **删除** `operational-growth.ts` 中 `installedSkillKeys: []` 的用法；改为真实 keys。
3. readiness 合并策略保持：`requiredSkillsInstalled` 以真实安装为准；不得因运营投影把未装技能标成已就绪（今日用 `current.capabilityReadiness ? true : signals` 的短路需复核：若 `capabilityReadiness` 曾被空 keys 污染，recompute 必须以真实 keys 纠正）。

### 3.2 缺口组装

```ts
function buildCapabilityGapViews(template, installedSkillKeys): GrowthCapabilityGapView[];
```

- 对每个 `requiredCapabilities` 项产出一行（含 satisfied）
- skill：installed Set 命中 → satisfied，否则 missing
- oauth：pending_integration（P0）
- knowledge_binding / workflow：P0 可列 status=missing 且 **不进入**主建议 `install_capabilities` 的强制 gaps（仅详情展示），避免无安装器时卡死

---

## 4. 纯函数决策器

新文件：`src/gateway/agent-growth/next-action.ts`

```ts
export function resolveNextGrowthAction(input: {
  lifecycleState: LifecycleState;
  funnel: GrowthFunnelFlags;
  gaps: GrowthCapabilityGapView[];
  /** P0 optional: UI 本会话选择培养优先 */
  preferCultivate?: boolean;
}): NextGrowthAction;
```

### 4.1 优先级（任务优先，可跳过）

```
if funnel.preludeDismissed OR lifecycle ∈ {activated, evolution}:
  → none

unmetSkills = gaps where kind==skill && status==missing

# 默认任务优先（非 preferCultivate）
if !funnel.hasFirstMissionSent && !preferCultivate:
  → start_work (canSkip=true)  // 详情里仍可看到缺口与培养入口

if unmetSkills.length > 0:
  → install_capabilities (gaps=unmetSkills, canSkip=true,
       target={module:assistant, tab:skills, recommendedSkillKeys})

if !funnel.hasIdentityCompleted:
  → confirm_identity (canSkip=true, target={focusComposer, prefill:identity})

if funnel.hasFirstMissionSent && !funnel.hasFirstMissionSuccess:
  → verify_with_task (canSkip=true, focusComposer + firstTaskPrefill)

→ none
```

`preferCultivate=true`（用户点「开始培养」）时：将 `confirm_identity`（若未完成）提到 `start_work` 之前；`start_work` 仍留在详情。

### 4.2 测试（必做）

`next-action.test.ts` 表驱动覆盖：

| 场景                            | 期望 kind              |
| ------------------------------- | ---------------------- |
| 新机器人，无任务，有 skill 缺口 | `start_work`           |
| 同上 + preferCultivate，无身份  | `confirm_identity`     |
| 已发任务，有 skill 缺口         | `install_capabilities` |
| 已发任务，无缺口，无身份        | `confirm_identity`     |
| 已发任务，能力齐，无成功        | `verify_with_task`     |
| preludeDismissed                | `none`                 |
| activated                       | `none`                 |

---

## 5. 里程碑写入矩阵（唯一写入点 + 幂等）

幂等：**一律**经 `recordMilestone` / `agents.record-growth-milestone`（first-write-wins）。禁止 UI 本地伪造完成态。

| Milestone                 | 唯一写入点（P0）                                                                                                                   | 触发条件                                                                                 | 调用方                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `sessionOpenedAtMs`       | 已有                                                                                                                               | 会话打开 sync                                                                            | `growth-session-sync.ts`                                              |
| `preludeDismissedAtMs`    | 已有（status 字段，非 milestones）                                                                                                 | 稍后再说                                                                                 | `growth-prelude-wire.ts`                                              |
| `firstCtaClickedAtMs`     | **新增接线**                                                                                                                       | 主 CTA 点击成功发起导航/prefill 前                                                       | UI → `recordGrowthMilestone`                                          |
| `firstMissionSentAtMs`    | **双保险**：(A) 已有 operational sync；(B) **P0 新增** agent 主会话首次 **user** `chat.send` 成功路径 gateway 侧 `recordMilestone` | 首条用户任务发出                                                                         | Gateway chat/agent runner 入口（与 operational 共用 FWW，不双写覆盖） |
| `firstSkillInstalledAtMs` | **新增**                                                                                                                           | `robot-skills.install` 成功返回前                                                        | `skill-lifecycle.ts` handler → growth store update                    |
| `identityCompletedAtMs`   | **新增**                                                                                                                           | 身份真实保存成功（现有 identity/workspace 写入 RPC，选一权威：机器人 IDENTITY 保存成功） | 该 handler 内 record                                                  |
| `firstMissionSuccessAtMs` | 已有                                                                                                                               | operational / activation transition                                                      | `operational-growth.ts`                                               |

**P0 身份保存挂钩点（需施工时锁定一个）：**

- 优先：员工端「定义身份」最终写入成功的 gateway 方法（检索 `IDENTITY.md` / robot identity update）
- 若 P0 时间内无法挂钩可靠 save：`confirm_identity` CTA 仅 prefill，**不**提前写 `identityCompletedAtMs`；待保存成功再写。禁止「点按钮即算完成」。

**禁止：** UI 在只打开 skills 页时写 `firstSkillInstalledAtMs`。

---

## 6. Prelude UI 改造（契约之后）

### 6.1 接线

`growth-prelude-wire.ts`：

- **删除** `gaps: []`
- 使用 `view.capabilityGaps` / `view.recommendation`
- 主按钮只绑定 `recommendation.kind`
- 「稍后再说」保留；dismiss 后 `shouldShowGrowthPrelude` 仍为 false

### 6.2 结构

`workbench-stage-growth-prelude.ts`：

```
[标题：我是【角色】· 上岗培养]
[苏醒中…]（可选）
[精简成长条：activationScore + 最多 2 个关键维度，或折叠五维]
[主建议区：reason 文案 + 相关 gaps（≤3 条，其余 +N）]
[主 CTA ×1]
[次要：成长详情（disclosure）→ 原四动作 + 完整 gaps]
[稍后再说]
```

四平级 CTA **移入**「成长详情」，不再默认平铺。

### 6.3 i18n

- 弃用「启动清单 {done}/{total}」为主标题（可删或留作详情）
- 主文案：「上岗培养」/ recommendation.reason 映射
- `install_capabilities` 按钮：「去安装推荐能力」（P0 降级语义）

### 6.4 本会话 `preferCultivate`

- `AppPortState` / shell slice：`workbenchGrowthPreferCultivate: boolean`
- 「开始培养」设 true 并 `recompute` 本地决策 **或** 带 flag 调 get（P0 允许纯客户端覆写：`resolveNextGrowthAction({...view, preferCultivate})` 在 UI 再跑一次同一纯函数——**函数实现必须前后端共享或 UI 复制同一测试向量**）

为免漂移：**决策器放 gateway；UI 只渲染 RPC 的 recommendation**。培养优先：新增 optional RPC param `preferCultivate?: boolean` 到 `get-growth-status`，或 UI 点击后 `record` 一个轻量 flag。

**P0 推荐最简：** UI 本地状态 `preferCultivate`；`normalize` 后若 true，调用 **同样** 的 `resolveNextGrowthAction`（把 `next-action.ts` 放到双方可 import 的位置，或 `ui` 侧单测复制决策表）。为减少包边界痛苦：决策器放 `src/gateway/agent-growth/next-action.ts`，UI 施工期先 **仅渲染服务端 recommendation**；「开始培养」= 调用 `get-growth-status` 带 `preferCultivate: true`（handlers 读取 params）。

---

## 7. 布局 / 非阻断验收（浏览器）

必过用例（Playwright 或手工清单写入 PR）：

1. Prelude 可见时，composer 可 focus，发送按钮 enabled
2. 发送一条短消息成功（不需完成缺口）
3. gaps 列表 10+ 项时（测试夹具），消息区与输入区不被遮挡；详情用 scroll/disclosure
4. 窄屏（≤390px）主 CTA 与输入框同屏可达（或输入框固定底部，卡可滚走）
5. dismiss 后刷新/重进会话：卡不再自动出现；聊天可用
6. dismiss 后五维 badge 仍可在侧栏/详情看到（若已有）

---

## 8. 施工顺序（降低风险）

```
1) installed-skills 抽取 + 修 operational-growth 空 keys      [gateway]
2) buildCapabilityGapViews + get/recompute 响应扩展           [gateway]
3) resolveNextGrowthAction + 单测                            [gateway]
4) GrowthStatusView / normalizeGrowthStatus                  [ui]
5) milestone 接线：skill install / chat.send first mission     [gateway]
6) identityCompleted 挂钩（仅真实 save）                     [gateway]
7) Prelude UI：单主 CTA + 详情折叠 + 文案                    [ui]
8) firstCtaClicked + preferCultivate param                   [ui+gateway]
9) 浏览器非阻断验收                                          [qa]
```

**禁止顺序：** 先改按钮文案再补契约。

---

## 9. 验收清单

### P0（有条件通过 — 2026-08-04）

- [x] `get-growth-status` 返回 `capabilityGaps` + `funnel` + `recommendation`
- [x] `recommendation.kind` 决策器单测表全绿
- [x] Prelude **仅一个**主 CTA；四旧按钮仅在详情
- [x] 不再出现 `gaps: []` 硬编码
- [x] `robot-skills.install` → `firstSkillInstalledAtMs`（FWW）
- [x] 首条 user `chat.send`（非苏醒）→ `firstMissionSentAtMs`（FWW）
- [x] `projectOperationalGrowth` 使用真实 `installedSkillKeys`
- [x] 「去安装推荐能力」= 打开 skills + `recommendedSkillKeys`；**无**任务草稿恢复
- [x] 浏览器/双模非阻断用例：`workbench-growth-prelude-nonblocking.browser.test.ts`
- [ ] （发布门禁）在**干净 P0 提交范围**内再跑一遍上述测试 + `pnpm -C ui test` 几何断言（勿用脏工作树全量归因）
  - 局部门禁（2026-08-04）：`pending-task-gap-sync.test.ts` + growth P3/P3.1 gateway 单测 + `governanceApi.node.test.ts`（blendPerformanceGrowth）已通过

### P1 登记（C+3 — 前置门控）

- [x] 首条任务 LLM 解析胜任要求（候选集约束；失败降级模板）
- [x] 任务缺口模型（`pendingTaskContext.taskGaps`，优先于模板 unmet）
- [x] **增强前不得执行**：`chat.send` 同步 analyze，unmet 时 `growth_gate_blocked`
- [x] 「先做再说」/`growthGateProceed` 后才放行真实 run
- [x] 安装完成后恢复同一份原始任务并放行发送
- [x] 分析基础设施失败时降级仍可执行
- [x] （P1+）多轮任务缺口刷新：`pending-task-gap-sync.ts` 持久化 taskGaps；get-growth-status / recompute / skill install 后 sync

### P2 首切片（成长档案四区 — 2026-08-04）

- [x] `projectOperationalGrowth` 持久化 `growthReport`（有任务指标时）
- [x] `operationalScore` 有信号非 null；无信号保持 null
- [x] `agents.get-growth-status` 返回 `dossier`（completeness + recommendation）
- [x] `robot.workspace.get` growth 投影含双分 / 四区 / report
- [x] 我的机器人 → **成长** tab 四区可读；能力 tab 不再重复薄成长块
- [x] 建议区唯一主 CTA 跳转既有路径
- [x] P2.1：Working DNA 存储 + 自调闭环 + 治理 RPC
- [x] P2.1：`robot.workspace.get` 返回 `workingStyle` 档案投影
- [x] P2.1：成长 tab 身份区展示经验偏好 + i18n
- [x] P2.1 安全门槛：`tasksTotal ≥ 5` 才允许学习；`≥ 10` 才允许 autonomous；档案展示证据窗口

### P3 首切片（机巢只读成长聚合 — 2026-08-04）

- [x] Gateway `growth.aggregate` + facade `mesh.performance.growthSummary`（READ scope）
- [x] 跨机器人汇总：activationScore / operationalScore / lifecycle / 成长速度排行
- [x] Working DNA 企业观测：档案数 / 近期行为调整 / 有效改善率
- [x] 生命周期分布可视化（机巢绩效 Tab）
- [x] 企业绩效 Tab：`governance-ranking-page` + `assets-page` 绩效区挂载成长速度摘要
- [x] 只读边界：不含 Identity/Prompt 编辑或 Skill 安装入口
- [x] **租户隔离**：`growth.aggregate` 从认证 membership 解析 tenantId；仅聚合 ownership/seat/runtime 绑定的机器人；无 tenant → 空聚合
- [x] 单测：`mesh-growth-aggregate.test.ts` + `mesh-growth-rpc.test.ts` + `mesh-growth-tenant-isolation.test.ts`

验收清单：`docs/design/agent-onboarding-growth-p3-acceptance-2026-08-04.md`

### P3.1 增强（岗位筛选 / 协作组 / 成本×成长 — 2026-08-04）

- [x] `growth.aggregate` 可选 `positionId`（tenant 内岗位筛选；tenantId 仍来自 membership）
- [x] `growth.groupAggregate` + facade `mesh.performance.groupGrowthSummary`
- [x] 协作组：alignment 维度 + lifecycle + 成长速度排行
- [x] UI 岗位下拉（绩效 Tab 机器人视图）
- [x] UI 协作组成长摘要（绩效 Tab 协作组视图 + 运营绩效 Tab）
- [x] UI 成本×成长联合面板（`blendPerformanceGrowth` + `governance.metrics.dashboard`）
- [x] 单测：`mesh-group-growth-aggregate.test.ts` + position 筛选 + RPC 注册扩展

---

## 10. 文件级改动清单（施工用）

| 文件                                                   | 动作                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `src/gateway/agent-growth/installed-skills.ts`         | **新增** collectInstalledSkillKeys                         |
| `src/gateway/agent-growth/next-action.ts` (+test)      | **新增** 决策器                                            |
| `src/gateway/agent-growth/signals.ts`                  | 扩展 gap view（label/satisfied）                           |
| `src/gateway/agent-growth/operational-growth.ts`       | 修空 keys；必要时纠正 readiness 短路                       |
| `src/gateway/server-methods/agent-growth.ts`           | 响应扩展；preferCultivate；组装 gaps/recommendation/funnel |
| `src/gateway/server-methods/skill-lifecycle.ts`        | install 成功写 `firstSkillInstalledAtMs`                   |
| chat/agent send 路径（锁定具体 handler）               | 首条 user 消息写 `firstMissionSentAtMs`                    |
| identity 保存 handler（锁定具体方法）                  | 成功写 `identityCompletedAtMs`                             |
| `ui/.../agent-growth.ts`                               | View + normalize                                           |
| `ui/.../growth-prelude-wire.ts`                        | 去掉 `gaps:[]`；主 CTA 绑定 recommendation                 |
| `ui/.../workbench-stage-growth-prelude.ts`             | 单主 CTA + 详情折叠                                        |
| `ui/src/i18n/locales/zh-CN.ts` (+en)                   | 上岗培养文案 / reason                                      |
| `src/gateway/agent-growth/dossier.ts`                  | **P2** 四区 completeness 投影                              |
| `src/gateway/agent-growth/operational-growth.ts`       | **P2** attachGrowthReportFromMetrics                       |
| `ui/.../my-bot-workspace-panel.ts`                     | **P2** 成长 tab 四区                                       |
| `ui/.../semantic/my-bot-read-model.ts`                 | **P2** MyBotGrowthProjection 扩展                          |
| `src/gateway/agent-growth/mesh-growth-aggregate.ts`    | **P3** 机巢成长聚合                                        |
| `src/gateway/agent-growth/mesh-growth-tenant-scope.ts` | **P3** 租户 agent 筛选 + scoped 读取                       |
| `src/gateway/server-methods/mesh-boundary-facade.ts`   | **P3** `mesh.performance.growthSummary`                    |
| `ui/.../ranking-page.ts`                               | **P3** 成长速度企业摘要                                    |

---

## 11. 一句话

P0/P1 交付智能上岗建议 + 任务缺口前置门控；**P2** 把成长沉淀为「我的机器人 → 成长」四区档案；**P2.1** 接通 Working DNA 与安全门槛；**P3** 在机巢绩效 Tab 提供 tenant-scoped 只读成长聚合。
