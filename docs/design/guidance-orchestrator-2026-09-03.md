# Guidance Orchestrator — 统一引导编排层

- Date: 2026-09-03
- Status: **SoT（权威设计）· P0–P3 已合入 `main`（#923，`9e3338faf4`）**
- Owner intent: 连接已有引导基础设施，不新建第二套生命周期 / Wizard
- Related:
  - `docs/design/agent-onboarding-growth-p0-tech-plan-2026-08-04.md`（机器人上岗 Growth OS）
  - `skills/user-guidance-protocol/SKILL.md`（Agent 带路行为规范）
  - `src/gateway/server-methods/daibai-guide.ts`（大白引导快照）
  - `src/gateway/workbench/steward-suggestion-read-model.ts`（确定性模板 + 企业门控 LLM refine）

---

## 0. 定位（强制表述）

> OpenBot **已有多条可复用的引导基础设施**，但 **还没有统一的引导编排层**。  
> 不得把「代码已有能力」「已接入 UI」「已形成闭环体验」混为一谈。

| 层                                    | 现状                                                                  | 不是什么                                          |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| **Agent Growth OS**                   | 机器人上岗培养闭环（状态机 + 唯一主建议 + 任务门控 + 续跑）已基本形成 | 不是覆盖全产品的统一智能引导框架                  |
| **Daibai**                            | 自然语言入口 + 有限能力/工作区信号个性化                              | 不是完整用户画像驱动                              |
| **user-guidance-protocol**            | Agent 行为规范 + YAML 场景格式 + `guidance_event` 桥接                | **不是**已实现的通用持久化 NavigationState 运行时 |
| **协作提示**                          | 发言者 / mission stale / team awakening 等运行时提示                  | 不是团队入职 coach                                |
| **guidance_event → asset-incubation** | SOP/失败模式沉淀                                                      | 不是用户可恢复引导历史系统                        |

**本设计只增加轻量 Guidance Orchestrator**：统一选择与呈现「下一步」；底层继续复用上述模块。

---

## 1. 核验结论（相对早期盘点的修正）

1. Growth OS 描述为「状态机 + 唯一主建议 + 任务驱动门控」**成立**，但范围限于 **机器人上岗培养**。
2. `installedSkillKeys: []` 主路径已通过 `collectInstalledSkillKeys` 修复（`operational-growth.ts` → `syncRobotGrowthFromOperationalMetrics`）；`projectOperationalGrowth` 默认 `= []` 仍属 **API 设计风险**，P0 硬化为必填。
3. 「有导航状态机」须降级为：**协议定义了状态机格式，运行时尚未统一实现持久化推进器**。
4. `guidance_event` 持久化适合孵化分析，**不能**直接支撑「上次到哪一步 / 跨会话继续」。
5. Daibai 个性化勿宣传为「深度个性化」。
6. 协作引导 = 运行时提示，≠ onboarding coach。

---

## 2. 目标架构

```
User / Workspace Context
        |
        v
Guidance Orchestrator
  - 场景识别
  - 用户 / 机器人 / 团队作用域
  - 当前进度（P1 起可恢复）
  - 风险等级
  - 下一步唯一 CTA
        |
        +--> Growth OS          (robot onboarding)
        +--> Daibai             (NL entry + guide snapshot)
        +--> user-guidance-protocol  (step coach behavior)
        +--> skill lifecycle
        +--> collaboration guidance
```

### 核心原则

1. **Growth 生命周期仍由 `GrowthStatus` 唯一负责** — Orchestrator 不复制 Growth FSM。
2. **引导状态单独建模**（P1 持久化）— 不与 `preludeDismissed` / `daibaiGuideAcknowledged` 混用同一确认位。
3. **每次只输出一个主动作**；其他建议折叠到 optional 区。
4. **明确三种 scope**：`user` | `robot` | `team`。
5. **所有自动行为**必须有退出、跳过、恢复机制。
6. **LLM** 只改写表达或低置信度澄清；**不得**直接决定权限、状态推进或高风险动作（沿用 steward-suggestion 模式）。

---

## 3. 统一契约：`GuidanceSnapshot`

```ts
type GuidanceScope = "user" | "robot" | "team";
type GuidanceConfidence = "high" | "medium" | "low";
type GuidanceDegradeReason =
  | "none"
  | "no_data"
  | "analysis_failed"
  | "permission_denied"
  | "provider_unavailable";

type GuidanceNextAction = {
  kind: string; // e.g. start_work | confirm_identity | install_capabilities | bind_identity | open_settings | none
  label: string; // i18n key or resolved label
  reason: string;
  target?: {
    module?: string;
    tab?: string;
    focusComposer?: boolean;
    prefill?: string;
    recommendedSkillKeys?: string[];
    resumePendingTask?: boolean;
    deepLink?: string;
  };
  canSkip: boolean;
  risk: "low" | "medium" | "high";
};

type GuidanceBlocker = {
  code: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow" | "permission" | "data" | "other";
  label: string;
  actionable: boolean; // false → 不得阻塞任务（缺口卡死风险）
};

type GuidanceSnapshot = {
  scope: GuidanceScope;
  scenario: string;
  confidence: GuidanceConfidence;
  currentStage: string;
  nextAction: GuidanceNextAction;
  optionalActions: GuidanceNextAction[];
  blockers: GuidanceBlocker[];
  degrade: GuidanceDegradeReason;
  /** Isolation keys — required for any persisted progress (P1). */
  tenantId?: string | null;
  userId?: string | null;
  entityId: string; // agentId | spaceId | "steward" | ...
  source: "growth" | "daibai" | "protocol" | "collaboration" | "orchestrator";
  expiresAt?: number;
  generatedAt: number;
};
```

P0：契约 + 纯函数组装入口 + Growth/Daibai 适配映射。  
P1：可恢复进度存储（见 §5）。  
UI：消费 snapshot 时 **同一时刻只渲染一个主 CTA 面**。

---

## 4. 实施优先级

### P0 — 统一契约和决策入口（本迭代）

- [x] SoT 本文档
- [x] `src/gateway/guidance/`：`GuidanceSnapshot` 类型、`buildGuidanceSnapshot` / `resolvePrimaryGuidance`
- [x] Growth → Snapshot 适配（复用 `resolveNextGrowthAction` / gaps，不第二套决策）
- [x] Daibai guide snapshot → Snapshot 轻量适配（user scope）
- [x] 统一降级态：`no_data` / `analysis_failed` / `permission_denied`
- [x] `projectOperationalGrowth`：`installedSkillKeys` **必填**（去掉 `= []`）
- [x] 单测：契约形状、Growth 映射、降级、技能参数必填

**P0 非目标**：UI 全量改版、进度持久化、LLM 排序、新 Wizard。

### P1 — 协议状态变成可恢复状态

存储至少：

- `scenario`, `currentStage`, `completedSteps`, `nextAction`
- `confidence`, `failureCount`, `abandonedAt`, `lastSeenAt`

键：`tenantId + userId + scope + entityId`（**禁止**仅用浏览器 localStorage 作唯一事实源）。

落地（2026-09-03）：

- `src/gateway/guidance/progress/**` — record / store / idempotent ops / redaction
- `src/gateway/server-methods/guidance.ts` — `guidance.progress.get|upsert|advance|abandon|applyEvent`
- `skills/user-guidance-protocol/SKILL.md` — 字段对齐表 + Gateway 权威进度说明
- 与 `guidance_event` 相关：`lastGuidanceEventId` / `lastGuidanceEventType`（不复制 Growth FSM）

### P2 — 个性化排序（确定性信号优先）

信号优先级（稳定、可测试）：

1. 权限与风险
2. 当前阻塞项（仅 `actionable=true`）
3. 组织角色
4. 当前工作区/机器人角色
5. 最近任务类型
6. 已安装能力
7. 失败/放弃历史
8. 引导节奏偏好

落地（2026-09-03）：

- `src/gateway/guidance/personalization/**` — rank / LLM copy-refine / suppression
- `resolvePrimaryGuidance(..., { personalization })` 可选接入
- LLM：仅改写 `label` / `reason`；不得改 kind/target/risk/canSkip/blockers/权限/生命周期
- 抑制：Gateway 文件存储，键 `tenantId+userId+scope+entityId`；频率上限、全局关闭、版本化重入

### P3 — 体验收敛与度量

统一呈现：

- 一个主 CTA（来自 `GuidanceSnapshot.nextAction`；UI 入口：`pickOrchestratedPrimary` + `renderOrchestratedGuidanceSurface`）
- 一个可选动作区（`<details data-guidance-optional>`；Steward suggestion / cultivate / team stale 仅作 optional）
- 「稍后处理 / 我知道了」（per-scope key `scope::entityId`，互不共用）
- 一个恢复入口（`guidance.progress.get` — Gateway 权威）
- 一个明确失败处理入口（`data-guidance-failure-recover`）
- 高风险二次确认（`onRequestHighRiskConfirm` → `data-guidance-high-risk-confirm`）

指标（Gateway `guidance.metrics.record`，与 incubation `guidance_event` 区分）：

- 事件：`guidance_shown` / `guidance_primary_clicked` / `guidance_optional_clicked` / `guidance_acknowledged` / `guidance_deferred` / `guidance_resumed` / `guidance_completed` / `guidance_abandoned` / `guidance_step_failed` / `guidance_high_risk_confirmed` / `guidance_context_low_confidence`
- 必填：`tenantId` `userId` `scope` `entityId` `scenario` `actionKind` `contentVersion` `timestamp`
- 脱敏：复用 progress redaction；禁止任务正文 / AppSecret / API Key
- 失败降级：`recordGuidanceMetricSafe` / 客户端 catch — **不阻塞**引导 UX

**禁止**同时展示 Growth Prelude + Daibai onboarding 卡 + Steward suggestion + 技能推荐 + 团队提示作为多个「下一步」。

落地（2026-09-03）：

- `src/gateway/guidance/metrics/**` + `guidance.metrics.record`
- `ui/src/ui/ports/employee/guidance/**` + growth/daibai/collab wire
- 浏览器：`guidance-orchestrator-p3.browser.test.ts`（5）

---

## 5. 作用域与风险

| 风险        | 约束                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| 作用域混淆  | user / robot / team **不得**共用同一确认状态字段                                          |
| 状态分裂    | UI / Gateway / Skill 文本不得各写一套权威进度（P1 起 Gateway 为权威）                     |
| 权限误导    | Daibai「可代办」必须受 action catalog + 授权状态约束                                      |
| 隐私 / 租户 | 引导事件、偏好、任务文本、能力使用记录需保留期限与访问边界                                |
| 自动打扰    | 频率上限、用户关闭后全局抑制、版本化重新引导                                              |
| 缺口卡死    | `knowledge` / `oauth` / `workflow` 在无安装器时 `actionable: false`，**不得**阻塞任务发送 |

---

## 6. 代码落点

| 路径                               | 职责                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `src/gateway/guidance/`            | Orchestrator 契约、组装、适配、降级（本 SoT 实现面）       |
| `src/gateway/agent-growth/*`       | 继续作为 robot 底层；Orchestrator **调用**而非改写生命周期 |
| `ui/.../growth-prelude-wire.ts` 等 | P0 后逐步改为消费 `GuidanceSnapshot`（可分 PR）            |
| `skills/user-guidance-protocol/`   | 仍为 Agent 规范；P1 起与 progress store 对齐字段名         |

---

## 7. 验收口径（P0）

1. 类型导出稳定，单测覆盖 Snapshot 必填字段与三种 scope。
2. 从 Growth recommendation 映射的 Snapshot：`scope=robot`，`source=growth`，`nextAction.kind` 与 Growth 一致。
3. 无数据 / 分析失败 / 权限不足时 `degrade` 明确，且 `nextAction.kind` 可为 `none` 或安全降级动作。
4. `projectOperationalGrowth` 未传 `installedSkillKeys` 时 TypeScript 编译失败；测试显式传入。
5. **不**引入第二套 lifecycle FSM；**不**新增全屏 Wizard。

---

## 8. 发布表述（强制）

> P0–P3 已合入 trunk（#923）：Guidance Orchestrator 契约、Gateway 可恢复进度 / 抑制 / 指标、确定性个性化、员工工作台单一主 CTA。底层仍复用 Growth OS / Daibai / user-guidance-protocol。  
> 尚未宣称「全产品统一智能引导已上线」——统一编排层已接入员工工作台主路径，其它表面仍按本 SoT 分阶段消费 `GuidanceSnapshot`。  
> 本 SoT **未定义 P4**。下一步若扩展范围，须先增补设计再实施；不得把合入 trunk 当成生产 cutover。
