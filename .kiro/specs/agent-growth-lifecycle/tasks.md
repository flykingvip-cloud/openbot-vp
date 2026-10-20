# Implementation Plan: 员工端 Agent 成长操作系统（Agent Growth OS）

## Agents

> 实施前由 owner 在下方签名（per `AGENTS.md` Multi-Agent Collaboration）。未签名前请勿在同一路径并行开工。

- `kiro-growth-pipeline` · role: owner · scope: Agent Growth OS gateway 内核、运营指标成长聚合与 runner 收尾接线 · paths: `.kiro/specs/agent-growth-lifecycle/tasks.md`, `src/gateway/agent-growth/**`, `src/gateway/server-methods/agent-growth.ts`, `src/gateway/server-methods/agents.ts`, `src/gateway/collaboration-learning/operating-state-types.ts`, `src/gateway/collaboration-learning/shared.ts`, `src/auto-reply/reply/agent-runner-execution.ts` · since: 2026-07-29
- `cursor-p0b-growth` · role: owner · scope: Agent Growth OS P0B–P2 员工端 UI 接线（prelude / birth turn / evolution report / template picker / session-sync） · paths: `ui/src/ui/ports/employee/**`, `ui/src/ui/controllers/chat.ts`, `ui/src/ui/controllers/agent-growth.ts`, `ui/src/ui/app-gateway.ts`, `ui/src/ui/app.ts`, `ui/src/ui/app-port-state.ts`, `ui/src/ui/app-view-state-shell-slices.ts`, `ui/src/i18n/locales/*.ts`, `ui/src/styles/workbench.css` · since: 2026-06-15

## Overview

依据 [design.md](./design.md) v3 与 [requirements.md](./requirements.md)，分 **P0A → P0B → P1 → P2** 交付。  
**P0A 与 P0B 后半可并行**（UI owner 在 P0A RPC 稳定后接入 P0B）。

```text
P0A  Growth 内核（无 Prelude）
  ↓
P0B  激活路径 + 最小 badge
  ↓
P1   Prelude / Stepper / CTA
  ↓
P2   LLM Awakening + operationalScore + Growth Report
```

### 依赖关系

| 任务块                   | 阻塞方                      | 被阻塞方      |
| ------------------------ | --------------------------- | ------------- |
| 1.x 类型与模板           | —                           | 2.x、3.x、4.x |
| 2.x Readiness 计算       | 1.x                         | 3.x、5.x      |
| 3.x RPC                  | 1.x、2.x                    | 5.x、6.x      |
| 4.x 小组 state 迁移      | 1.x                         | 3.x、5.x      |
| 5.x agents.create 挂钩   | 3.x                         | 6.x、7.x      |
| 6.x UI switchSession     | 5.x（部分可 mock RPC 先行） | 7.x、8.x      |
| 7.x milestones telemetry | 3.x、6.x                    | 8.x           |
| 8.x P0B badge            | 3.x                         | 9.x           |
| 9.x+ P1 Prelude          | 8.x                         | —             |

---

## Tasks

> 任务按阶段组织（P0A → P0B → P1 → P2）；勾选状态即各任务实时进度，签名见 `## Agents`。

## Phase P0A：Growth 内核

### 1. 类型与模块骨架

- [x] **1.1** 创建 `src/gateway/agent-growth/types.ts` — 完成（含 CapabilityReadinessSignals 三态、operationalScore:number|null）— kiro-agent-growth
  - 定义 `LifecycleState`、`GrowthDimension`、`GrowthStatus`、`BootstrapStatus`
  - 定义 `GrowthMilestones`、`GrowthReportSnapshot`、`ImpactMetric`
  - 定义 `AgentTemplate`、`CapabilityRequirement`、`TeamTemplate`、`WorkflowStep`
  - **能力就绪三态（评审决策）**：`CapabilityReadinessSignals.requiredPermissionsGranted: true | false | "unknown"`（`unknown` = Provider 尚未接入，不可用 optional boolean）；`requiredSkillsInstalled: boolean`。`capabilityReadiness: boolean` 作为最终硬门槛保持 boolean（由信号 AND 推导）。
  - **序列化契约**：`operationalScore: number | null`（非 optional-undefined），由 1.4 round-trip 测试固定。
  - _Requirements: R1, R2, R9_

- [x] **1.2** 创建 `src/gateway/agent-growth/store.ts` — 完成（机器人 read/write/update + 锁；小组 read/write 由 spaces 层委托 operating-state，3.2 接入）— kiro-agent-growth
  - 机器人：`readRobotGrowthStatus(agentId)` / `writeRobotGrowthStatus(agentId, status)`，路径 `~/.openbot/agents/{agentId}/growth-status.json`
  - 小组：`readGroupGrowthStatus(groupId)` / `writeGroupGrowthStatus(groupId, status)`，落在 operating-state.json 的 `growthStatus`（委托 collaboration-learning store）
  - **统一读写接口（评审修订）**：导出 `readGrowthStatus({ kind, entityId })` / `writeGrowthStatus(...)` 抽象，使 RPC（3.x）与 readiness（2.x）无需在两套后端间分支
  - _Requirements: R1_

- [x] **1.3** 创建 `src/gateway/agent-growth/templates/generic_worker.json` — 完成（JSON seed + index.ts TS 常量 + drift 测试）— kiro-agent-growth
  - 默认 `missionReadyThreshold: 78`，空或最小 `requiredCapabilities`
  - `src/gateway/agent-growth/templates/index.ts` 加载内置模板
  - _Requirements: R3_

- [x] **1.4** 单元测试 `src/gateway/agent-growth/types.test.ts`（类型 guard / 序列化 round-trip）— 完成（+ templates.test.ts）— kiro-agent-growth
  - _Requirements: R2_

### 2. Readiness 与 Lifecycle 纯函数

- [x] **2.1** 创建 `src/gateway/agent-growth/readiness.ts` — 完成（computeActivationScore / computeCapabilityReadiness / alignment helpers；recompute 编排在 factory.ts）— kiro-agent-growth
  - `computeDimensions(input)` → `GrowthDimension`
  - `computeActivationScore(dimensions, template)` → number
  - `computeCapabilityReadiness(dimensions, template, signals)` → boolean
  - `computeAlignmentComplete(space, members)` → boolean（`rolesAssigned && workflowDefined`）
  - **P0A 信号口径（评审决策）**：Skill 状态**必须真实接入**（Capability 维度不得为假数据）；OAuth 标记 `"unknown"`，**不计分、不扣分、不阻塞 Mission Ready**。
  - **P0A Mission Ready 规则**：`activationScore >= threshold && requiredSkillsInstalled`（暂不要求 `requiredPermissionsGranted === true`）。P0B/P1 再补 OAuth 真值门槛。
  - _Requirements: R4, R5_

- [x] **2.1a** 创建 `src/gateway/agent-growth/signals.ts`（signal collectors）— 完成（纯函数：computeRequiredSkillsInstalled / collectPermissionSignal=unknown / computeCapabilityGaps；数据注入留 3.1）— kiro-agent-growth
  - `collectSkillSignals(agentId, template)`：接 robot-skills / employee-capability，判定 required skill 是否安装（P0A 真实接入）
  - `collectPermissionSignals(...)`：P0A 恒返回 `"unknown"`（占位，operational-identity OAuth 接入留 P0B+）
  - 供 `recompute-growth` RPC（3.1）调用；受 NFR-1 `recompute` P95<500ms 约束
  - _Requirements: R4_

- [x] **2.2** 创建 `src/gateway/agent-growth/lifecycle.ts` — 完成（deriveLifecycleState + applyActivationTransition）— kiro-agent-growth
  - `deriveLifecycleState(growthStatus)`（纯函数，见 design §3.3）
  - `applyActivationTransition(growthStatus, event)` → 更新 `isActivated` / `activatedAtMs`
  - _Requirements: R2, R6_

- [x] **2.3** 创建 `src/gateway/agent-growth/milestones.ts` — 完成（recordMilestone first-write-wins + createMilestones）— kiro-agent-growth
  - `recordMilestone(milestones, key, atMs)` first-write-wins 语义
  - _Requirements: R7_

- [x] **2.4** 单元测试 `src/gateway/agent-growth/readiness.test.ts` — 完成（含 OAuth unknown 不阻塞、skill 真实驱动、permission=false 阻塞）— kiro-agent-growth
  - 天气插件 + 单 PDF **不能** mission_ready（mock template with required crm）
  - `activationScore >= 78 && !capabilityReadiness` → `growing`
  - 小组 alignment 未完成封顶分数
  - **OAuth `"unknown"` 不阻塞**：required skill 已装、OAuth=`unknown` 且 `activationScore>=78` → P0A Mission Ready 成立
  - **Skill 真实驱动**：安装 required skill 后 Capability 维度上升、`requiredSkillsInstalled` 翻真
  - _Requirements: R4, R5_

- [x] **2.5** 单元测试 `src/gateway/agent-growth/lifecycle.test.ts` — 完成（birth→growing→mission_ready→activated→evolution + 小组 alignment 门槛）— kiro-agent-growth
  - birth → growing → mission_ready → activated 路径
  - _Requirements: R2, R6_

- [x] **2.6** 创建 `src/gateway/agent-growth/operational-score.ts`（stub）— 完成（恒 null）— kiro-agent-growth
  - 导出 `computeOperationalScore()` 返回 `null`；P2 实现
  - _Requirements: R9, R16_

- [x] **2.7** 创建 `src/gateway/agent-growth/impact-metrics.ts`（stub）— 完成（空 businessImpact[]）— kiro-agent-growth
  - 空 `businessImpact[]`；P2 实现
  - _Requirements: R9, R17_

### 3. Gateway RPC

- [x] **3.1** 创建 `src/gateway/server-methods/agent-growth.ts` — 已 land（AGS）
  - `agents.get-growth-status`
  - `agents.recompute-growth`
  - `agents.record-growth-milestone`
  - `agents.list-templates`
  - _Requirements: R8_ — kiro-agent-growth

- [x] **3.2** 扩展 `src/gateway/server-methods/spaces.ts`（或 agent-growth 内 space 变体）— 已 land（AGS：实现于 agent-growth.ts，避免触碰 MERGE C 的 spaces.ts）
  - `collaboration.spaces.get-growth-status`
  - `collaboration.spaces.recompute-growth`
  - `collaboration.spaces.record-growth-milestone`（group 读写经 shared.ts readGroupGrowthStatusById/updateGroupGrowthStatusById）
  - _Requirements: R8_ — kiro-agent-growth

- [x] **3.3** 注册 `src/gateway/server-methods-list.ts` + `src/gateway/method-scopes.ts` + `server-methods.ts` — 已 land（ME 单一 primary commit）
  - **Scope 归属（评审决策，已实现）**：
    - `READ_SCOPE`：`agents.get-growth-status`、`agents.list-templates`、`collaboration.spaces.get-growth-status`
    - `WRITE_SCOPE`：`agents.recompute-growth`、`agents.record-growth-milestone`、`collaboration.spaces.recompute-growth`、`collaboration.spaces.record-growth-milestone`
  - _Requirements: R8_ — kiro-agent-growth

- [x] **3.4** 集成测试 `src/gateway/agent-growth/rpc.test.ts`（置于 AGS 流内）— 已 land：list-templates / get（含未知 agent 错误）/ recompute（skill 驱动 capability）/ record（first-write-wins + 未知 key 拒绝）/ space get 未知错误，7 passing — kiro-agent-growth

### 4. 小组 Bootstrap / Growth 字段迁移

> **✅ 落地完成（kiro-agent-growth, 2026-06-15）**：经 operator 采纳 option 1，已在 `.loom/registry.yaml` 将 agent-growth 集成路径并入 `agent-growth-lifecycle:kiro-agent-growth` 任务与 `AGS` landing stream。4.x 已分流 land：`collaboration-learning/*` 归 AGS；`spaces.test.ts` 归 MERGE C；RPC 注册（3.3）归 ME；`agents.ts` 创建挂钩（5.x）归 H1K——各为单一 primary 流的独立 commit。

- [x] **4.1** 更新 `src/gateway/collaboration-learning/operating-state-types.ts` — 已 land（AGS）：新增 bootstrapStatus/growthStatus，onboardingStatus 保留只读别名 — kiro-agent-growth
  - 新增 `bootstrapStatus`、`growthStatus`；`onboardingStatus` 只读别名（一期）
  - _Requirements: R1_

- [x] **4.2** 更新 `src/gateway/collaboration-learning/shared.ts` — 已 land（AGS）：syncGroupOperatingState 镜像 bootstrapStatus + 初始化/保留 group growthStatus；新增 readGroupGrowthStatusById / updateGroupGrowthStatusById — kiro-agent-growth

- [x] **4.3** 更新 `src/gateway/server-methods/spaces.test.ts` — 已 land（MERGE C）：断言新 space `growthStatus.lifecycleState==='birth'` + `isActivated===false`（17 passing）— kiro-agent-growth

### 5. agents.create 初始化 Growth

- [x] **5.1** 更新 `src/gateway/server-methods/agents.ts` — `agents.create` 成功后 — 已 land（H1K）
  - 写入 `growth-status.json`：`templateId: generic_worker`、`milestones.createdAtMs`、`lifecycleState=birth`（best-effort，不阻断创建）
  - _Requirements: R11_ — kiro-agent-growth

- [x] **5.2** 更新 `src/gateway/server-methods/agents-mutate.test.ts` — 已 land（H1K）
  - 断言创建后 `writeRobotGrowthStatus` 以 birth、`isActivated === false` 调用
  - _Requirements: R11_ — kiro-agent-growth

### P0A 合并门（Checkpoint）

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/agent-growth src/gateway/server-methods/agent-growth.test.ts
# 兼容性回归（NFR-2）：onboardingStatus 只读别名不得破坏既有断言
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/spaces.test.ts \
  src/gateway/server-methods/chat-scheduling.test.ts \
  src/gateway/server.chat.gateway-server-chat-b.test.ts
pnpm tsgo  # 或 pnpm build — 按 CI 惯例
```

- [x] **P0A 签收**：owner 在 Agents 块确认，并在 `tasks.md` 勾选本节全部项 — 已完成（kiro-agent-growth, 2026-06-15）：agent-growth 套件 27 passing + spaces.test 17 passing；`pnpm tsgo` 对本 spec 所触文件零类型错误（仓库内其余 tsgo 报错均为他流 WIP，与本任务无关）。已分流 land 至 AGS / ME / MERGE C / H1K 各单一 primary commit。

---

## Phase P0B：激活路径

> **可与 P0A 任务 3.x 完成后并行**（UI 侧可 mock RPC 先写 6.x，联调前等待 5.1）。

### 6. 机器人创建后自动进会话

- [x] **6.1** 更新 `ui/src/ui/ports/employee/render-model-workbench-actions.ts` — `onCreateAgent`
  - 成功后 `switchEmployeeWorkbenchSession` + 去重 `upsertWorkbenchAgent`；`sessionOpenedAtMs` 由 switch 链 `syncGrowthOnWorkbenchSessionOpen` 写入
  - _Requirements: R10_ — cursor-p0b-growth

- [x] **6.2** 更新 `ui/src/ui/ports/employee/render-model.node.test.ts`
  - 断言创建后 `sessionKey` 指向新机器人
  - _Requirements: R10_ — cursor-p0b-growth

### 7. Milestones 与 Telemetry controller

- [x] **7.1** 创建 `ui/src/ui/controllers/agent-growth.ts` — 已 land
  - `loadGrowthStatus(state, { kind, entityId })`、`recomputeGrowth(state, ref)`、`recordGrowthMilestone(state, ref, key, atMs?)`、`normalizeGrowthStatus`
  - 机器人/小组对称；UI-local `GrowthStatusView`，无跨包导入；7 controller 测试通过
  - _Requirements: R7_ — kiro-agent-growth

- [x] **7.2** 小组创建路径 `onCreateSpace` — `switchEmployeeWorkbenchSession` 触发 `syncGrowthOnWorkbenchSessionOpen`（`sessionOpenedAtMs` + recompute）
  - _Requirements: R7, R11_ — cursor-p0b-growth

- [x] **7.3** `publish_event` type `agent_growth.*` 与 milestones 双写 — 已 land：`agent_growth.create`（agents.create，H1K）、`agent_growth.mission_ready` / `agent_growth.activated`（recompute/record handler，R7.3/7.4/7.5）。`false_ready_detected` 待运营信号源 — kiro-agent-growth
  - _Requirements: R7_

### 8. render-model 映射与 P0B 最小 badge

- [x] **8.1** 更新 `ui/src/ui/ports/employee/render-model.ts`
  - `bootstrapArtifactsReady`（保留 `onboardingInitialized` 只读别名）
  - 映射 `growthStatus`：`lifecycleState`、`activationScore`、`isActivated`
  - _Requirements: R1, R12_ — cursor-p0b-growth

- [x] **8.2** 更新 `ui/src/ui/ports/employee/views/workbench-types.ts`
  - `WorkbenchSettingsRobotEntry` / group 类型增加 growth 摘要字段
  - _Requirements: R12_ — cursor-p0b-growth

- [x] **8.3** 侧栏或 stage 标题区最小 badge — `workbench-stage.ts` 接线 `renderGrowthBadge`
  - _Requirements: R12_ — cursor-p0b-growth

- [x] **8.4** 会话打开时 `recompute-growth` — `growth-session-sync.ts` + `switchEmployeeWorkbenchSession`
  - _Requirements: R4, R10_ — cursor-p0b-growth

### P0B 合并门

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/ports/employee/render-model.node.test.ts \
  src/gateway/server-methods/agent-growth.test.ts
pnpm ui:build
```

- [x] **P0B 签收**（kiro-agent-growth reconcile, 2026-06-15）：创建机器人后自动进会话、`get-growth-status` 可读、Created ≠ Activated 均成立。
  - **分工与落地**：后端 + badge 组件 + controller 由 kiro-agent-growth（AGS / ME / H1K / ISOLATE F）；P0B 员工端 UI（6.1/6.2/7.2/8.1/8.2/8.3 接线/8.4）由 cursor-p0b-growth 按 AGS + OPSD 分笔 land（commits `7fe50dc776` AGS、`aba122f5e7` OPSD）。
  - **验证证据**：`growth-session-sync.node.test.ts` 5 绿；`render-model.node.test.ts` 创建后立即进导航 + `sessionKey === agent:market-helper:main` 绿；agent-growth 套件全绿（106/107，唯一失败 `render-model.node.test.ts > overview signals titles` 系 `workbench-signals.ts`/`workbench-home-model.ts` 未提交 overlay 所致，与本 spec 无关，非回归）。
  - **待办（reconcile 备注）**：① `growth-session-sync.ts` 历史落在 `79a90be2b2`（trailer 误为 Task: knowledge-rag-step9b / Agent: cursor-composer），建议后续修正 attribution；② `app-view-state-shell-slices.ts` 的 `workbenchActiveGrowthStatus` 行属 ME stream，尚未 land（cursor 可单 hunk 补 land）。— kiro-agent-growth

---

## Phase P1：表现层

### 9. Growth Prelude UI

- [x] **9.1** 创建 `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.ts` — 组件已 land（kiro-agent-growth）
  - `renderRobotGrowthPrelude(props)` — 自我认知卡片（角色叙事 + activation 进度 + 五维 Stepper + 缺口 ✓/□ + CTA） — 已实现
  - `renderTeamAwakeningPrelude(props)` — 集体叙事 + alignment 状态 — 已实现
  - 复用 `renderGrowthBadge`；语义 class `workbench-growth-prelude*`（CSS 映射归 10.x）；5 jsdom 测试
  - **接线契约（给 cursor 9.2/9.3）**：props 取 `GrowthStatusView`（来自 `loadGrowthStatus`）+ 可选 `gaps: GrowthCapabilityGap[]` + CTA 回调（`onDefineIdentity/onInstallCapability/onUploadKnowledge/onSetHabits/onDismiss`；小组 `onDesignOrg/onAssignRoles/onConfigureWorkflow`）
  - _Requirements: R13_ — kiro-agent-growth

- [x] **9.2** 更新 `ui/src/ui/app-render.ts` — 已 land（cursor-p0b-growth）：`workbenchThreadPrelude` 经 `growth-prelude-wire.ts` 接入非 Daibai 机器人/小组 growth prelude，按 `lifecycleState` + `preludeDismissedAtMs` 展示
  - _Requirements: R13_ — cursor-p0b-growth

- [x] **9.3** CTA 接线 — 已 land（cursor-p0b-growth）：身份/能力/知识/习惯 + 小组 CTA 接对应表面；dismiss → `recordGrowthMilestone(...,"preludeDismissedAtMs")`
  - _Requirements: R13, R7_ — cursor-p0b-growth

### 10. Stepper 与增强 badge

- [x] **10.1** Prelude 内五维 Stepper + `lifecycleState` 徽章 — 已 land：`renderGrowthStepper(view)`（五维进度条 + `renderGrowthBadge`；alignment 仅小组显示），含 jsdom 测试 — kiro-agent-growth
  - _Requirements: R14_

- [x] **10.2** 侧栏条目 growth badge 与 prelude 文案一致 — 已 land（cursor-p0b-growth）：侧栏 nav badge 复用 `renderGrowthBadge`
  - _Requirements: R14_ — cursor-p0b-growth

- [x] **10.3** i18n：`ui/src/i18n/locales/zh-CN.ts`、`en.ts` — growth 文案键 — 已 land（cursor-p0b-growth，ME stream：`growing: "成长中 {pct}%"` 等键）
  - _Requirements: R14_ — cursor-p0b-growth

### 11. 测试与可选模板向导

- [x] **11.1** `ui/src/ui/ports/employee/views/workbench-stage.node.test.ts` — 已 land：stage 测试 48 绿（prelude 渲染 / 缺口 / dismiss / Daibai 不受影响），另有 `workbench-stage-growth-prelude.node.test.ts`（5）+ `growth-prelude-wire.node.test.ts`（4）
  - _Requirements: R13, R14_ — cursor-p0b-growth / kiro-agent-growth

- [ ] **11.2**（可选）创建向导模板选择 + `templateId` 写入 create 请求（P1 可选增强，未做）
  - _Requirements: R15_

### P1 合并门

```bash
pnpm ui:build
OPENBOT_TEST_PROFILE=low pnpm exec vitest run ui/src/ui/ports/employee/views/workbench-stage.node.test.ts
```

- [x] **P1 签收**（kiro-agent-growth reconcile, 2026-06-15）：表现层完成并通过合并门。
  - **分工**：组件层（9.1 prelude / 10.1 stepper）+ badge + controller 由 kiro-agent-growth；接线层（9.2 app-render、9.3 CTA、10.2 侧栏 badge、10.3 i18n）由 cursor-p0b-growth；`growth-prelude-wire.ts` 桥接。
  - **验证证据**：`pnpm tsgo` growth 全量零错误（cursor 已修 wire/session-sync 6 处类型错误）；`pnpm ui:build` ✓（3.21s）；测试 119 绿（workbench-stage 48 + prelude 5 + badge 6 + wire 4 + session-sync 5 + controller 8 + 网关 agent-growth 43）。
  - **余项**：11.2 模板选择向导为 P1 可选增强，暂未做；`false_ready_detected` 事件与 LLM Awakening（13.x）属 P2 跨流，待运营信号源/chat 路径。 — kiro-agent-growth

---

## Phase P2：智能化与运营闭环

> **进展（kiro-agent-growth, 2026-06-15，option 3）**：P2 中**纯后端、AGS 流内**的算子已实现并 land（12.1、12.2 检测算子、14.1、14.3、15.1）。依赖**真实运营信号采集**（任务/工具成功率、接管率——来自 reply/runner 遥测，属其他流）或**共享 UI**（13.2、14.2、15.2）或 **chat 路径**（13.1，跨流）的部分暂挂，待信号源/界面就绪再接线。

### 12. operationalScore 与 false-ready

- [x] **12.1** 实现 `src/gateway/agent-growth/operational-score.ts` — 已 land：加权 `computeOperationalScore`（任务/工具成功率、满意度、接管率反向；无信号→null，保 P0/P1 契约），单测覆盖 — kiro-agent-growth
  - _Requirements: R16_

- [x] **12.2** false-ready 检测与 `agent_growth.false_ready_detected` 事件 — 已 land：`detectFalseReady`（activation≥90 且 operational<30；null 不误报）+ recompute 链完整接通——`recompute-growth` 接受可选 `operationalSignals` → `computeOperationalScore` → 持久化 `operationalScore` → 检测 → `context.broadcast("agent_growth.false_ready_detected")`（agents + spaces），含端到端测试。**唯一跨流剩项**：运营信号 SOURCE（任务/工具成功率、接管率，来自 reply/runner 遥测）接入后即自动触发。 — kiro-agent-growth
  - _Requirements: R16_

- [x] **12.3** 运营指标 → 成长维度自动闭环 — runner 在 turn 收尾原子累计任务/工具结果后立即同步 `growth-status.json`；按 20 个任务的样本置信度将实战质量投影到 capability、持续实践投影到 habits，identity/knowledge 仍由显式信号驱动；`get-growth-status` 与员工端会话实际调用的 `recompute-growth` 均回放历史 `operational-metrics.json`，skill 重算只合并不回退运营成长；真实 Gateway 已验证 `bot-2` 从 64/66 指标持久化为 capability/habits=97。— kiro-growth-pipeline
  - _Requirements: R4, R6, R16_

### 13. LLM Awakening

- [x] **13.1** `chat.send` 支持 `growthBirthTurn` — 已 land（kiro-agent-growth）：`ChatSendParams.growthBirthTurn` schema + `GetReplyOptions.growthBirthTurn`；`chat.send` → `dispatchInboundMessage` replyOptions → `get-reply-run` 注入 `buildGrowthBirthSystemPrompt`（birth/growing 才生效，gated 默认关，零回归）；Swift 重生成 + `protocol:check` 绿；birth-context 4 单测
  - _Requirements: R16_ — kiro-agent-growth

- [x] **13.2** Prelude「正在苏醒…」加载态 + LLM 结果回落 — 已 land（cursor-p0b-growth）：`growth-birth-turn-wire.ts` 在 birth/growing prelude 首条以 `growthBirthTurn:true` 触发 `chat.send`；Prelude 展示 `awakening` 加载态；assistant 回复后 `syncGrowthBirthAwakeningState` 回落；`app-gateway` chat 事件同步
  - _Requirements: R16_ — cursor-p0b-growth

### 14. Growth Report

- [x] **14.1** 实现 `src/gateway/agent-growth/growth-report.ts` — 已 land：`buildGrowthReportSnapshot` + `computeBusinessImpact`（impact-metrics.ts，业务影响优先、跳过 0 计数、hoursSaved 估算），单测覆盖 — kiro-agent-growth
  - _Requirements: R17_

- [x] **14.2** Evolution UI：会话 prelude 展示报告摘要 — 已 land（cursor-p0b-growth）：`workbench-stage-growth-evolution.ts` 接线 `normalizeGrowthReport` + `renderGrowthReportSummary`；CSS `workbench-growth-report__*`
  - _Requirements: R17_ — cursor-p0b-growth

- [x] **14.3** Knowledge 质量分：模板 `preferredTags` 加权，降低刷文件 — 已 land：`computeKnowledgeDimension`（相关性驱动，非文件数），单测覆盖 — kiro-agent-growth
  - _Requirements: R4（增强）_

### 15. 扩展模板 catalog

- [x] **15.1** 新增行业模板 JSON（`contract_reviewer`、`sales_assistant`）+ index 注册 + drift 测试 — 已 land（验证 R3.5：扩展无需改 GrowthStatus schema）— kiro-agent-growth
- [x] **15.2** P1 创建向导模板选择 — 已 land（cursor-p0b-growth）：`workbench-creators.ts` 接线 `renderTemplatePicker`；`AGENT_CREATE_SUPPORTS_TEMPLATE_ID=true`；`agents.create` 传入 `templateId`
  - _Requirements: R15_ — cursor-p0b-growth
- [x] **15.3** CO Flow「Agent 成长」step — 已 land（kiro-agent-growth）：自包含 builder `src/gateway/agent-growth/co-flow-step.ts`（`buildGrowthFlowStep` 把 `GrowthStatus` 映射为与 `flow_step_create` 对齐的「Agent 成长」step：title≤12 字 + 五个生命周期 subSteps，past=done/current=in_progress/future=pending，终态 done；`isGrowthFlowStepActive` 门槛），8 单测覆盖；与 co-chat MCP flow 协议对齐、无运行时跨流依赖（co-chat 层喂给 `flow_step_create` 即可接线）
  - _Requirements: R15_ — kiro-agent-growth

### P2 合并门

- [x] **P2 签收**（kiro-agent-growth, 2026-06-16）：P2 可独立交付项全部完成——
  - ✅ 12.1 `computeOperationalScore`（加权、null 契约）
  - ✅ 12.2 `detectFalseReady` + `agent_growth.false_ready_detected` 事件全链路
  - ✅ 14.1 `buildGrowthReportSnapshot` + `computeBusinessImpact`
  - ✅ 14.3 `computeKnowledgeDimension`（相关性 > 文件数）
  - ✅ 15.1 行业模板 `contract_reviewer`/`sales_assistant`
  - ✅ 运营遥测 SOURCE（指令 2）：`operational-metrics-store`（recordTaskOutcome）+ runner hook + recompute 自动读取
  - ✅ 协议 schema（指令 4）：`agents.create` 接受 `templateId`（binding 已测）
  - ✅ 协议 Swift 重生成（指令 5）：`protocol:gen:swift` 同步累积 drift（含 templateId），`pnpm protocol:check` 绿
  - ✅ 14.2 Evolution Report 接线 + 15.2 模板选择器接线（cursor-p0b-growth）
  - ✅ 13.2 Prelude 诞生回合接线（cursor-p0b-growth）
  - ✅ 15.3 CO Flow「Agent 成长」step builder（`co-flow-step.ts`，与 flow 协议对齐，co-chat 层接线）
    — kiro-agent-growth

---

## Phase P3（暂缓）

- 跨 Agent 成长运营大盘
- Autopilot 驱动培养闭环
- 租户级 `missionReadyThreshold` 管理 UI

---

## 文件清单（汇总）

| 路径                                                               | 阶段          |
| ------------------------------------------------------------------ | ------------- |
| `src/gateway/agent-growth/types.ts`                                | P0A           |
| `src/gateway/agent-growth/store.ts`                                | P0A           |
| `src/gateway/agent-growth/templates/*`                             | P0A           |
| `src/gateway/agent-growth/readiness.ts`                            | P0A           |
| `src/gateway/agent-growth/lifecycle.ts`                            | P0A           |
| `src/gateway/agent-growth/milestones.ts`                           | P0A           |
| `src/gateway/agent-growth/operational-score.ts`                    | P0A stub / P2 |
| `src/gateway/agent-growth/impact-metrics.ts`                       | P0A stub / P2 |
| `src/gateway/agent-growth/growth-report.ts`                        | P2            |
| `src/gateway/server-methods/agent-growth.ts`                       | P0A           |
| `src/gateway/collaboration-learning/operating-state-types.ts`      | P0A           |
| `src/gateway/collaboration-learning/shared.ts`                     | P0A           |
| `src/gateway/server-methods/agents.ts`                             | P0A           |
| `ui/src/ui/controllers/agent-growth.ts`                            | P0B           |
| `ui/src/ui/ports/employee/render-model-workbench-actions.ts`       | P0B           |
| `ui/src/ui/ports/employee/render-model.ts`                         | P0B           |
| `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.ts` | P1            |
| `ui/src/ui/app-render.ts`                                          | P1            |
| `ui/src/i18n/locales/*.ts`                                         | P1            |

---

## 排期建议（EPR）

| 迭代      | 交付                  | 人力建议                 |
| --------- | --------------------- | ------------------------ |
| Sprint 1  | P0A 全部 + P0A 合并门 | 1 backend                |
| Sprint 2  | P0B 全部 + P0B 合并门 | 1 backend + 0.5 frontend |
| Sprint 3  | P1 全部               | 1 frontend               |
| Sprint 4+ | P2 按需拆分           | 1 full-stack             |

**并行策略：** Sprint 1 后半 frontend 可基于 mock RPC 开发 8.3 badge；Sprint 2 联调 6.x + 7.x。

---

## 风险登记

| 风险                                | 缓解                                                       | 任务     |
| ----------------------------------- | ---------------------------------------------------------- | -------- |
| operational-identity OAuth 信号不全 | P0 capability 维度先检 skill；OAuth 项标记「待接入」不计分 | 2.1      |
| 小组 workflow heuristic 过松        | P0 优先显式 `TeamWorkflow` 写入路径；heuristic 仅兜底      | 2.1, 4.2 |
| 与多 agent 共享树冲突               | Agents 块签名 + 路径隔离                                   | 文首     |
| Prelude 与 Daibai 冲突              | 独立分支 + 测试 11.1                                       | 9.2      |

### RISK-007（评审决策）：Capability Readiness 当前仅接入 Skill State

- **描述**：P0/P0A 的 `capabilityReadiness` 仅基于 Skill 安装态；OAuth / 外部权限 Projection 尚未纳入（`requiredPermissionsGranted === "unknown"`，不计分、不阻塞）。
- **影响**：P0A 的 **Mission Ready 代表 Internal Readiness，不等于真实 External Operability**（配置侧达标，但不保证外部系统已可执行）。BI / 产品 / 研发不得将 P0A Mission Ready 解读为「具备全部外部系统执行能力」。
- **缓解 / 演进**：后续通过统一 Permission Registry + OAuth Projection 补齐 `requiredPermissionsGranted` 真值，并在 P0B/P1 收紧 Mission Ready 门槛（追加 `requiredPermissionsGranted === true`）。
- **关联任务**：1.1（三态类型）、2.1 / 2.1a（信号口径）、3.1（recompute 接入）。

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- 多 agent：本 spec 集成路径已并入 `.loom/registry.yaml` 的 `agent-growth-lifecycle:kiro-agent-growth` 任务与 `AGS` landing stream；提交带 `Task:`/`Agent:` trailer，按单一 primary 流分提交（AGS / ME / MERGE C / H1K / ISOLATE F）。
- 评审决策固化：scope（get→READ_SCOPE，recompute/record→WRITE_SCOPE）；Skill 真实接入、OAuth 三态 `true|false|"unknown"`（P0A 恒 unknown，不计分不阻塞），详见 RISK-007。
- P0B 6.x/8.x 与 P1 表现层暂挂：员工端共享 UI 文件被其他 loom 流（OPSD/ops-decommission）活跃 WIP 占用，按多 agent 安全规则不覆盖他人 WIP，待文件释放或隔离 worktree 后续接。
- `false_ready_detected` 事件与 LLM Awakening（13.1）依赖真实运营信号源 / chat 路径（跨流），待协调。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.1a", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "10.1", "10.2", "10.3", "11.1", "11.2"] },
    {
      "id": 8,
      "tasks": ["12.1", "12.2", "13.1", "13.2", "14.1", "14.2", "14.3", "15.1", "15.2", "15.3"]
    }
  ]
}
```
