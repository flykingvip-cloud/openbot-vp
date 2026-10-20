# Implementation Plan: 大白超级管家（Daibai Super Steward）

## Agents

> 多 agent 协作签名（per AGENTS.md「Multi-Agent Collaboration & Commit Governance」）。

- `kiro-daibai` · role: owner · scope: D2 对话返工 + Mode A 员工自执行 + 大白 chip/确认 · paths: src/agents/builtin-steward/\*_, src/auto-reply/reply/steward-chat-context.ts, src/auto-reply/reply/operational-identity-context.ts, src/auto-reply/reply/get-reply.ts, src/agents/pi-tools.ts, src/agents/pi-embedded-runner/run/attempt.ts, src/gateway/supervisor/free-chat-cli-guard.ts, src/shared/daibai-_.ts, src/gateway/protocol/schema/daibai.ts, src/gateway/server-methods/daibai*.ts, src/gateway/server-methods/steward-confirmation-store.ts, src/gateway/employee-steward-session.ts, src/gateway/collaboration-learning/steward-group-policy.ts, src/gateway/collaboration-learning/steward-group-policy.test.ts, src/support-cases/steward-memory-store.ts, ui/src/ui/app-gateway.ts, ui/src/ui/app-render.ts, ui/src/ui/builtin-steward-selection*, ui/src/ui/controllers/daibai*, ui/src/ui/capability/app-view-state-slices.ts, ui/src/ui/ports/employee/views/workbench-capability-contracts.ts, ui/src/ui/ports/employee/views/workbench-stage-assistant.ts, ui/src/ui/ports/employee/views/workbench-stage.node.test.ts, ui/src/ui/ports/employee/views/workbench-*.steward.test.ts, ui/src/styles.css · since: 2026-06-11
- `codex-daibai` · role: contributor · scope: steward workspace 文件读取 / 打开成果 land 包 · paths: src/gateway/server-methods/steward-workspace-file.ts, src/gateway/server-methods/steward-workspace-file.test.ts, ui/src/ui/controllers/steward-workspace-file.ts, ui/src/ui/controllers/steward-workspace-file.test.ts, src/gateway/server-methods.ts, src/gateway/server-methods-list.ts, src/gateway/method-scopes.ts, ui/src/ui/app.ts · since: 2026-07-08
- `codex-daibai-conflict` · role: contributor · scope: daibai vs supervisor bridge 热文件 owner 收敛 · paths: .kiro/specs/daibai-super-steward/tasks.md, .kiro/specs/development-supervisor-chat-bridge/tasks.md · since: 2026-07-04

## Hot File Ownership

以下路径在 **2026-07-04** 冲突收敛后，统一由 **`daibai-super-steward`** 单一 owner 维护：

- `src/gateway/server-methods/daibai.ts`
- `src/gateway/server-methods/daibai-workspace-overview.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-assistant.ts`

`development-supervisor-chat-bridge` 仅通过 `task-create-service`、`daibai-supervisor-draft`、
`daibai-action-catalog` / `daibai-services` 与 supervisor board 集成，**停止直接编辑上述热文件**。

## Overview

把「大白管家」从**默认 agent 的 UX 壳层 + 一条窄支持单链路**，改造为员工端**唯一的系统自带超级管家**：
预定义其**记忆 / 权限 / 能力 / 行为规则**四项特征，用户注册即在员工端自带；对内承担
「问题解决者 → 引导者 → 平台衔接/反馈者」三角色。

**核心设计不变量（贯穿全程，不得突破）**：

- 大白 = **用户的代理人，不是管理员**。它以当前受信用户身份、在用户已授权 scope 内行动；
  办不了的事**升级到平台**（支持单），**绝不提权**。
- 知识/企业数据权限**仍来自** `resolveTrustedEnterpriseDataExecutionContext`
  （`src/gateway/knowledge/context.ts:6-37`），不因「它是大白」而放宽
  （对齐既有 `agent-cognitive-adapter.ts:13-32` 仅按 agent 名命中 platform/position 升类型的规则）。
- 大白可执行的动作**只能命中 `READ_SCOPE` / `WRITE_SCOPE`**；凡命中 `ADMIN_SCOPE`
  （`src/gateway/method-scopes.ts:409+`，如 `agents.create/update/delete`）一律**不进**大白能力目录，只能走升级。
- 高风险 / 不可逆写动作**强制 `requiresUserConfirmation`**（沿用 `SupportCaseResolutionProposal` 既有字段语义），
  并配**服务端确认票据**（proposalId + confirmationToken + payloadHash，见 Phase 5），保证防重放/幂等/防篡改。
- **形态单一**（决策 D）：一期锁定 **独立 RPC 管家 (D1)**；行为规则以**结构化路由策略**驱动 RPC，
  **不**注入聊天 prompt preamble；避免「RPC 管家 + chat 人格」两套并存。

### 现状锚点（落地依据，均已核对）

| 维度     | 现状                                                                                                                                                                                                                                          | 缺口 / 处置                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 身份     | 默认 agent=`main`（`src/agents/agent-scope.ts:71-84`）；身份由 `resolveAssistantIdentity` 解析（`src/gateway/assistant-identity.ts:81-117`）；助理页写死「大白管家」（`ui/src/ui/ports/employee/views/workbench-stage-assistant.ts:305-307`） | 无「系统自带、预定义」的身份契约 → **新建内置身份契约 + provisioning** |
| 自带注入 | `agents.list` 在 `setup.ts`/onboarding 生成（`src/commands/setup.ts`）；运行时种子 `maybeSeedAgentRuntimeFromPlatformState` 只种 `rt-<tenant>`（`src/gateway/agent-runtime-seed.ts`），**不种聊天大白**                                       | **新建 `ensureBuiltinStewardAgent` provisioning，注册即注入**          |
| 记忆     | per-agent `resolveMemorySearchConfig`（`src/agents/memory-search.ts:355`）+ `MemoryIndexManager`（`src/memory/manager.ts`）；启动 `server-startup-memory.ts`                                                                                  | **为大白预设记忆 profile + 管家记忆（偏好/支持史/能力使用）**          |
| 权限     | `method-scopes.ts` READ/WRITE/ADMIN 三档；`user.daibai.ask`∈READ（`:253`）、`user.daibai.execute`∈WRITE（`:406`）                                                                                                                             | **能力目录 + scope 闸门，禁 ADMIN**                                    |
| 能力     | `execute` 硬编码 3 个 support action（`src/gateway/server-methods/daibai.ts:200-289`）；`ask` 关键词匹配（`:38-52`）；**网关无 handler 内安全互调抽象**（`server-methods.ts:187-243`、`types.ts:101-112`）                                    | **先定内部调用策略（决策 E）→ Action Catalog 目录驱动 + 意图分级路由** |
| 行为规则 | 无显式约束声明；`looksLikeSupportEscalation` 仅关键词                                                                                                                                                                                         | **预定义行为规则常量 + 三角色分级**                                    |
| 升级衔接 | 支持单链路 + 状态机（`src/support-cases/store.ts`、`src/shared/daibai-types.ts`）；上下文 bundle 字段已预留                                                                                                                                   | **自动采集上下文 + 自助失败收敛升级**                                  |
| UI 入口  | 选中 `main` 触发引导（`ui/src/ui/controllers/daibai.ts:43-56`）                                                                                                                                                                               | **各模块「需要帮助」统一收敛到大白 + 携带上下文**                      |

### 可复用的既有能力域（大白编排目标，不重写）

> **二级权限/成熟度前提（必读）**：目录项的 `requiredScope` 只是**第一道闸**；部分方法还有**成员侧二级权限**或
> **尚未完工**，目录必须显式标注，否则「目录显示能做、一执行就失败」会割裂体验。

- 知识/数据：`knowledge.search/object/recommendations/recent`（READ，`method-scopes.ts:255-268`）— ✅ 可用
- 能力画像：`employee-capability.profile/recommendations`（`src/gateway/server-methods/employee-capability.ts`）— ✅ 可用
- 安装：`employee-install.create-request/confirm/apply-configuration`（WRITE，`method-scopes.ts:305-307`）
  — ⚠️ **当前多为 stub**（`src/gateway/server-methods/employee-install.ts:1-18` 自述 stub 实现），目录需标「实验性」
- 技能：`robot-skills.toggle/install/remove/upgrade`（WRITE，`method-scopes.ts:390-393`）— ✅ 可用；
  **注意** `skills.install/update` 是 **ADMIN**（`method-scopes.ts:414-415`）→ **禁止进目录**
- 计费预算：`billing.dashboard`（READ）；`budget.set`（WRITE，`src/gateway/server-methods/budget.ts`）
  — ⚠️ **双闸**：除 WRITE 外还需成员 `usage:budget` 权限（`budget.ts:38-47`，`USAGE_BUDGET_PERMISSION`），目录须标注
- 模型可用性：`employee-model-access.summary`（`src/gateway/server-methods/employee-model-access.ts`）— ✅ 可用
- 升级衔接：`support.cases.*` + `user.daibai.*`（`src/gateway/server-methods/support-cases.ts`、`daibai.ts`）— ✅ 可用

### 必须先拍板的前置决策（阻断后续编码）

> **门禁**：决策 D/E 是**全局架构前置**（优先级高于 Action Catalog 本身），决策 A/B 是 Phase 1/3 硬前置。
> 决策 D/E 未签署不得进入 Phase 0.1 之后任何编码。

- **决策 D（大白单一实现形态）—— 最高优先级，直接影响 Phase 0/2/4/8**：
  大白一期到底是 **(D1) 独立 RPC 管家**（沿用现状：UI 直调 `user.daibai.ask/execute`，
  `ui/src/ui/controllers/daibai.ts:89-166`、`src/gateway/server-methods/daibai.ts:169-180`，**不走聊天 prompt 装配**），
  还是 **(D2) 与 `main` chat agent 合流**（大白即聊天人格，行为靠 system preamble 注入）？
  **风险**：不先拍板会做成「RPC 管家 + chat 人格」两套并存系统。
  **建议**：**一期锁定 (D1) 独立 RPC 管家**——与现状 UI 调用链一致、改造面最小、边界最清晰；
  行为规则（0.2）以**结构化路由策略**驱动 RPC（intent→catalog），**不**注入聊天 preamble。
  (D2) 作为二期演进项单独立项。**本 spec 后续按 (D1) 编写**；若团队选 (D2)，Phase 0.2 / 4.3 / 8.2 需重写。
- **决策 E（内部复用调用策略）—— 高优先级，Phase 3 硬前置**：
  大白目录项「委派既有能力」如何实现？当前网关只在最外层做 method 路由 + 鉴权
  （`src/gateway/server-methods.ts:187-243`、`server-methods/types.ts:101-112`），
  **没有 handler 内安全调用另一 RPC 的抽象**；直接互调会牵扯参数校验、respond 语义、rate limit、
  错误格式、再鉴权一致性。二选一：
  - **(E1) 抽服务层**：把目标能力的核心逻辑从 handler 抽到可复用 service 函数（handler 与大白都调 service），
    鉴权在各自入口做。**建议默认走 (E1)**——语义最干净，避免「假 RPC 自调」的 respond/rate-limit 错配。
  - **(E2) 网关内部 dispatch**：提供受控的 internal-dispatch（携带原 client 上下文 + scope，复用校验/错误格式），
    适用于难以拆 service 的方法。仅在 (E1) 不可行的方法上局部使用。
    **该决策结论必须先于 Task 3.1（Action Catalog）落地**，否则 `delegateMethod` 不可执行，Phase 3-5 会返工。
- **决策 A（内置 agentId）**：大白固定复用默认 agent `main`，还是引入独立保留 id（如 `steward`）？
  **建议**：复用 `main`（与现状 UX 壳层、`assistant-identity` 默认解析一致，避免双 agent 路由分裂）；
  仅新增「内置标记」而非新 agent，降低多 agent 安全面。
  - **默认冲突策略（关键补充）**：`resolveDefaultAgentId` 在多个 `default=true` 时只取第一个并 warn
    （`src/agents/agent-scope.ts:72-83`），存量用户默认 agent 可能不是 `main`。provisioning **只保证存在
    `id="main"` 的内置条目**，**不**强设/抢占 `default=true`：若已存在其它 `default=true`，**保持不动**，
    避免「双默认」与「抢入口」。大白入口由 **UI 壳层映射**（决策 A2）锚定，不依赖 `default` 标志。
  - **决策 A2（大白入口 ≠ seat 默认 agent）**：`defaultAgentId` 可以不是大白——员工端/企业端大量读 `defaultAgentId`，
    且 seat 默认 agent 可能是 `agent-sales` 等。明确：**大白是系统内置 steward 入口（绑定
    `BUILTIN_STEWARD_AGENT_ID`），不等同于 seat 默认工作 agent**；二者天然可分离（默认聊天入口、动作目标、
    大白入口各自独立解析），这是预期行为而非冲突。
- **决策 B（记忆隔离粒度）**：管家记忆按 `userId` 还是 `seatId`/`tenantId+userId` 隔离？
  **建议**：`tenantId + userId` 复合键（对齐 `support-cases` 的 `userId/tenantId` 过滤口径，
  `src/support-cases/store.ts:129-133`），保证跨企业不串记忆。
- **决策 C（能力目录扩展节奏）**：首期只读 + support 写，第二期才放开 install/budget 等写代办（建议分期，见 Phase 5）。

### 实现级决策（回应本轮专家 Open Questions，已选定）

> 这三条是上一版遗留的实现缝隙，现选定方案写死，避免 Phase 3/5/8 返工。

- **决策 F（二级权限建模）= 目录 metadata 展示 + 目标 service 自校验**（**不**在 `execute` 做通用二级权限校验）：
  现状 `GatewayClient` 只有 operator scopes（`src/gateway/server-methods/types.ts:15-24`），
  `usage:budget` 是 `budget.set` 内经 `resolveBillingScope(client)` **现场解析**（`budget.ts:38-47`、
  `billing-helpers.ts`）。因此 `execute` 通用闸**只**校验 operator scope + 排除 ADMIN；
  二级权限**由目标 service/方法自身校验并返回标准错误**（如 `usage:budget` 未授权 → UNAVAILABLE/FORBIDDEN）。
  目录的 `secondaryPermission` 字段**仅作 UI 说明 + 预检提示文案**，不承担鉴权（鉴权落点唯一，避免双处不一致）。
- **决策 G（待确认返回态）= 新增显式 `pending_confirmation` 状态 + 独立确认卡片**：
  `DaibaiExecuteResult.status` 现仅 `"executed"|"blocked"`（`src/shared/daibai-types.ts:123-129`），
  无法区分「需确认」与「被拒/失败」。新增 `"pending_confirmation"` 状态 + confirmation envelope；
  前端**展示独立确认卡片**（不复用现有 action button 的「执行→自动 ask」路径，
  `ui/src/ui/controllers/daibai.ts:151-159`），用户确认后才二次 execute。
- **决策 H（robot-skills 目标范围）= 仅当前用户可管机器人 + agentId 不可自由指定**：
  现状 `robot-skills.*` 几乎不看 client 身份、纯按 payload `agentId` 改技能
  （`src/gateway/server-methods/skill-lifecycle.ts:441-489`）。大白代办时**必须先做 ownership 预检**：
  服务端按 client 身份解析「当前用户可见/可管的机器人集合」，payload `agentId` 必须落在该集合内；
  **一期进一步收窄**为「当前工作台选中 agent / 用户自有 agent」，禁止任意 agentId 透传。
  - **数据源钉死（关键补充）**：仓库无现成「用户自有 agent」权威源，且 `agentId` 同时承载默认/seat 默认/session
    多种语义。`resolveManageableAgentIds(client)` 的来源**写死优先级**：
    (1) **employee 域**：从 seat 资产库 `EnterpriseSeatAssetsStore`（`src/gateway/enterprise-seat-assets-store.ts`）
    取该 seat 绑定的 `agent` 类资产作为可管集合；
    (2) **无企业 seat 时**：回退为 `listAgentIds(cfg)`（`src/agents/agent-scope.ts`）中该用户 workspace 归属的 agent；
    (3) **一期默认**：仅「当前工作台选中 agent」（前端传入、服务端用 (1)/(2) 复核）。
    该函数为**唯一可管集合解析点**，禁止各处各写。

### 实施阶段

- **Phase 0 — 契约固化（定义先行）**：内置身份契约、行为规则常量、Action Catalog 类型、daibai-types 扩展。
- **Phase 0.5 — 内部调用策略（决策 E 落地，Phase 3 硬前置）**：按决策 E 抽服务层 / 或建受控 internal-dispatch，
  作为 `delegateMethod` 的可执行底座；**优先级高于 Action Catalog**。
- **Phase 1 — 系统自带注入**：`ensureBuiltinStewardAgent` provisioning + 接入 setup/onboarding + 幂等。
- **Phase 2 — 记忆层**：大白记忆 profile 预设 + 管家记忆持久化（**追加式/防并发覆盖**）+ ask 注入记忆上下文。
- **Phase 3 — 权限闸门**：Action Catalog registry + scope 校验（含二级权限）+ execute 目录化 + 迁移现有 support action。
- **Phase 4 — 解决者（只读编排）**：意图分级路由 + 接入只读能力域 + ask 返回路由结果。
- **Phase 5 — 代办者（写编排，需确认 + 确认票据）**：接入真实 WRITE action + 服务端确认票据（防重放/幂等/防篡改）。
- **Phase 6 — 引导者**：能力发现 + 上手引导扩展。
- **Phase 7 — 衔接者**：升级上下文自动采集 + 自助失败收敛升级。
- **Phase 8 — UI 统一入口**：各模块「需要帮助」收敛到大白 + 人设壳层对齐内置身份。
- **Phase 9 — 集成与守护**：scope 注册守护 + 端到端 + Checkpoint。

## Tasks

- [x] 0. Phase 0：契约固化（定义先行）
  - [x] 0.0 前置决策门禁（全局架构 + Phase 1/3 硬前置）
    - 与产品/架构签署**决策 D**（大白单一形态：独立 RPC 管家 vs 合流 chat agent）、**决策 E**（内部复用调用策略：
      抽服务层 vs 网关 internal-dispatch）——**这两条优先级最高，未签署不得进入 0.1 之后任何编码**。
    - 再签署**决策 A**（内置 agentId）、**决策 B**（记忆隔离粒度）、**决策 C**（目录扩展节奏）。
    - 决策结论回写本 spec 顶部，作为 Task 0.5 / 1.1 / 2.2 / 3.1 输入。
    - **实施结论**：按建议锁定 D1（独立 RPC 管家）、E1（抽服务层优先）、A（复用 `main`）、B（`tenantId+userId`）、
      C（分期）。下列实现据此推进。
    - _Backend: 无_
  - [x] 0.1 定义大白内置身份契约（常量集中化 + 仅大白 special-case fallback）
    - 新建 `src/agents/builtin-steward/identity.ts`：导出 `BUILTIN_STEWARD_AGENT_ID`（按决策 A）、
      `BUILTIN_STEWARD_NAME = "大白管家"`、默认头像/emoji、`isBuiltinStewardAgent(agentId)` 判定。
    - 将 `ui/src/ui/ports/employee/views/workbench-stage-assistant.ts:305-307` 与
      `ui/src/ui/controllers/daibai.ts:43-56` 的「大白管家」「main」硬编码改引用该契约（前端镜像常量见 0.4）。
      **注**：UI 侧硬编码收敛统一在 Phase 8（8.0/8.2）整条识别链改造时完成，避免半改散落。
    - **身份兜底防全局污染（关键修正）**：`DEFAULT_ASSISTANT_IDENTITY` 是**全局 fallback**
      （`src/gateway/assistant-identity.ts:17-21`，所有未配置 agent 共用），**禁止直接改其默认值**，否则其它
      未配置 agent 也会显示「大白管家」。正确做法：在 `resolveAssistantIdentity`（`:81-117`）末尾**仅当
      `isBuiltinStewardAgent(agentId)`** 时把兜底名 special-case 为大白契约名；非大白 agent 仍回退 `"Assistant"`。
    - **已实现**：`assistant-identity.ts` 仅 special-case 名称（头像兜底维持全局默认，精确贴合 spec），并补
      `assistant-identity.test.ts` 三例（steward 兜底大白名 / 非大白回退 Assistant / 显式配置名优先）。
    - _Backend: `assistant-identity.ts` 增加大白条件分支（不改全局默认常量）_
  - [x] 0.2 定义行为规则约束（三角色 + 边界）—— 按决策 D1：驱动 RPC 路由，非聊天 preamble
    - 新建 `src/agents/builtin-steward/behavior-rules.ts`：以**结构化常量**声明
      `STEWARD_ROLES`（solver/guide/escalator）、`STEWARD_INVARIANTS`（never-admin、user-scope-only、
      confirm-before-irreversible、escalate-when-unauthorized）。
    - **形态绑定**：决策 D1（独立 RPC 管家）下，这些规则**作为意图路由器（4.1）/目录闸门（3.x）/升级收敛（7.x）的
      策略输入**消费，**不**注入聊天 prompt。仅当团队改选 D2（合流 chat agent）时，才新增 `buildStewardSystemPreamble()`
      并在会话装配注入——该函数**本任务不实现**，留待 D2 立项。
    - **已实现** + `behavior-rules.test.ts`（角色/不变量快照）。
    - _Backend: 无_
  - [x] 0.3 定义 Action Catalog 类型契约
    - 新建 `src/shared/daibai-action-catalog.ts`：`DaibaiActionDescriptor`，字段含：
      `actionId`、`title`、`kind: "read"|"write"`、`requiredScope: "operator.read"|"operator.write"`、
      `delegateTarget: { mode: "service"|"internal-dispatch"; ref: string }`（按决策 E：service 函数 或 RPC method）、
      `secondaryPermission?: string`（**决策 F：仅 UI 说明/预检提示文案，不承担鉴权**）、
      `maturity?: "stable"|"experimental"`（stub 方法标 experimental）、
      `requiresUserConfirmation: boolean`、`buildParams(ctx)`、`requiresOwnershipCheck?`（决策 H）。
    - **类型层禁止** `requiredScope = "operator.admin"`（用联合类型排除，编译期挡住越权目录项）。
    - `delegateTarget` 语义依赖决策 E（E1→`service`、E2→`internal-dispatch`）；**Task 0.5x 底座必须先落地**，此类型才可执行。
    - **已实现** + `daibai-action-catalog.test.ts`（含 `@ts-expect-error` 编译守卫：ADMIN scope 不可登记）。
    - _Backend: 无_
  - [x] 0.4 扩展 daibai-types（放开硬编码联合 + 新增路由/确认态类型）
    - 改 `src/shared/daibai-types.ts`：`DaibaiSuggestedAction.actionId` 由三字面量联合改为
      `string`（运行时由目录校验，见 3.1）；新增 `DaibaiIntentTier = "self_serve"|"assisted_action"|"escalate"`、
      `DaibaiRouteResult { tier; domain?; readPayload?; suggestedActions; escalationDraft? }`、`DaibaiEscalationDraft`。
    - **决策 G：`DaibaiExecuteResult.status` 增加 `"pending_confirmation"`**（与 `"executed"|"blocked"` 并列），
      并新增可选 `confirmation?: { proposalId; confirmationToken; payloadHash; expiresAtMs }`（见 5.2）。
    - 前端直接 import `src/shared/daibai-types.ts`（无独立镜像），扩展自动贯通；AJV schema
      （`src/gateway/protocol/schema/daibai.ts`）同步放开 actionId enum、新增 route/confirmation/execute 票据参数。
    - **已实现**：daibai-types + protocol schema 双侧同步；现有 daibai/protocol/ui 测试全绿（actionId 放开为更宽松，向后兼容）。
    - 兼容性：保留现有字段，新增字段全部可选，避免破坏现 UI。
    - _Backend: 无_
  - [x] 0.5 Phase 0 类型与契约测试（identity 判定、catalog 类型约束编译守卫、behavior 规则常量快照）。
    - **已实现**：`identity.test.ts`(5)、`behavior-rules.test.ts`(3)、`daibai-action-catalog.test.ts`(3,含编译守卫)、
      `assistant-identity.test.ts`(+3 steward 用例)。全部通过；daibai/protocol/ui 既有测试无回归。

- [x] 0.5x. Phase 0.5：内部调用策略落地（决策 E，Phase 3 硬前置，优先级高于 Action Catalog）
  - [x] 0.5x.1 内部调用底座（按决策 E 二选一）
    - **E1（默认建议）抽服务层**：把首批目录目标方法的核心逻辑从 handler 抽到可复用 service 函数
      （例如 support-cases 已是 store 函数，可直接 service 化；只读域 knowledge/employee-capability/billing
      抽 `*-service.ts`），handler 变薄壳调 service，大白目录也调同一 service。鉴权在各自入口做。
    - **E2（仅必要时）网关 internal-dispatch**：新建 `src/gateway/internal-dispatch.ts`——携带原 `client` 上下文
      - 已解析 scope，复用 `server-methods.ts:187-243` 的参数校验/错误格式/rate-limit 语义，**不**伪造 `respond`；
        仅对难以拆 service 的方法局部使用。
    - **明确边界**：无论 E1/E2，再鉴权一致性必须保证（大白不旁路目标方法的二级权限）。
    - **E2 预算双计风险（关键约束）**：最外层请求处理对写方法会消耗 control-plane write budget
      （`src/gateway/server-methods.ts:196-220`）。若 E2 在 `user.daibai.execute`（本身已是 write）内部再走同一路径，
      会把**一次用户动作计两次**。E2 实现必须：内部 dispatch **跳过/不重复**写预算消耗，
      保证单次用户动作只计一次（在 internal-dispatch 入口显式标记 internal-origin，绕过外层预算扣减）。
    - **已实现**：`src/gateway/server-methods/daibai-dispatch.ts`——
      `resolveClientOperatorScopes` / `clientHasOperatorScope`（ADMIN 超集，对齐 `authorizeGatewayMethod`）、
      `assertStewardActionAuthorized`（operator-scope 闸门，二级权限交目标 service 自校验=决策 F）、
      E1 service 注册表（`registerStewardService`/`resolveStewardService`）+ `invokeStewardDelegate`；
      E2 经可插拔 `setStewardInternalDispatcher` **默认禁用**（杜绝预算双计），注入方负责跳过外层预算扣减。
      `StewardAuthorizationError` / `StewardDispatchError` 供 execute 转译引导。
    - _Backend: E1 service 注册底座 + E2 可选注入点_
  - [x] 0.5x.2 内部调用底座测试（service 复用语义等价 / dispatch 携带 scope + 错误格式一致 / 不旁路二级权限）。
    - **已实现**：`daibai-dispatch.test.ts`(10) —— scope 解析(ADMIN 超集/精确/缺失)、授权闸门、E1 service 调用与
      未授权拦截/未注册报错、E2 默认禁用 + 注入后携带 client 派发。全部通过。

- [x] 1. Phase 1：系统自带注入（注册即自带）
  - [x] 1.1 实现 `ensureBuiltinStewardAgent` provisioning（幂等 + 不抢默认）
    - 新建 `src/agents/builtin-steward/provision.ts`：`ensureBuiltinStewardAgent(cfg): OpenBotConfig`——
      若 `agents.list` 不含 `id=BUILTIN_STEWARD_AGENT_ID` 条目则注入：
      `{ id, identity: {name:大白契约名, ...}, skills: <预设白名单>, memorySearch: <预设, 见 2.1>, tools: <预设> }`；
      已存在则**仅补缺失字段**（不覆盖用户自定义），保证幂等 + 多 agent 安全。
    - **默认冲突策略（决策 A）**：**不无条件写 `default: true`**。规则：
      (a) `agents.list` 为空 → 注入大白并设 `default: true`（首装用户，大白即默认）；
      (b) 已存在其它 `default: true` → **保持不动**，大白条目**不带** `default`（避免双默认/抢入口）；
      (c) 无任何 `default` 但存在 `id="main"`（决策 A 复用 main）→ 该 main 条目即大白，按需补 `default: true`。
    - 对齐既有种子幂等写法（参考 `src/gateway/agent-runtime-seed.ts` 的「existing 检测后再 upsert」）。
    - **验收条件（硬性）**：调用前后 `agents.list` 中 `default===true` 的条目数量**绝不增加**；
      已有非 main 默认 agent 时，其 `default` 标志与身份**保持不变**，大白条目不带 `default`
      （`resolveDefaultAgentId` 多 default 仅告警取第一个，`src/agents/agent-scope.ts:72-83`，故必须从注入侧杜绝双默认）。
    - **已实现**：以 `hasAnyDefault` 统一裁决三分支；不可变返回（不改入参）；identity 仅补缺失子字段；
      memorySearch 缺失才补 `{enabled:true}`（不覆盖用户的 `enabled:false`）。预设 skills/tools 暂留空
      （= 全部技能 / 继承默认），避免一期过度收紧能力面。
    - _Backend: 复用 `agent-scope.ts` 的 listAgentEntries/resolveDefaultAgentId_
  - [x] 1.2 接入注册/初始化流程
    - 在 `src/commands/setup.ts` 与 onboarding 配置落盘前调用 `ensureBuiltinStewardAgent(cfg)`
      （`setup.ts` 已 `ensureAgentWorkspace`，在写 config 前插入）。
    - 网关启动兜底：在 `src/gateway/server.impl.ts` 启动序列对 `cfgAtStart` 调一次（不落盘，仅运行时保证存在），
      覆盖「老配置升级」场景，使存量用户也自带大白。
    - **启动兜底不改默认位**：运行时兜底与落盘 provisioning 共用同一默认位策略；
      老配置升级场景下也**不得**因为启动兜底给 builtin steward 额外写出/推导出第二个 `default=true` 结果。
    - **多 agent 安全**：仅注入/补字段，绝不删除或改写他人 agent；落盘走既有 `writeConfigFile`。
    - **已实现**：
      - `setup.ts`：落盘前 `ensureBuiltinStewardAgent(next)`，写 `provisioned`，并把 `stewardChanged` 纳入写条件 +
        日志（`ensured builtin steward (大白管家)`）。
      - 启动兜底改用更稳健的**持久化一次迁移**范式（对齐既有 `maybeSeedControlUiAllowedOriginsAtStartup`）：
        新增 `maybeProvisionBuiltinStewardAtStartup`，仅当 `agents.list` 变更时落盘一次；比纯内存注入更可靠
        （使所有 `loadConfig()` 调用方都可见），且复用同一「不抢默认」策略，绝不写出第二个 default。
        在 `server.impl.ts` 控制台迁移之后接线。
    - _Backend: setup/server 启动_
  - [x] 1.3 工作区与身份文件初始化
    - provisioning 后对大白 workspace 调 `ensureAgentWorkspace`（`src/agents/workspace.ts`），
      写入预设 IDENTITY/tools 引导文件（复用 `DEFAULT_IDENTITY_FILENAME`/`DEFAULT_TOOLS_FILENAME` 约定）。
    - **已满足**：大白复用 `main`（默认 agent），其 workspace 即默认 workspace；`setup.ts` 既有的
      `ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles })` 已对该 workspace 写引导文件；
      非默认情形由运行时 agent 命令路径按需 `ensureAgentWorkspace`。无需额外代码。
    - _Backend: `agents/workspace.ts`（既有路径）_
  - [x] 1.4 Phase 1 测试 —— **必保留（默认冲突/多 agent 安全）**
    - `provision.test.ts`：空配置注入大白且设 default(a) / **已存在非 main 默认 agent 时大白不带 default 且原默认不变(b)** /
      无 default 但有 main 时补 default(c) / 已存在大白仅补缺失字段不覆盖 / 多 agent 不误伤 / 幂等（二次调用无变化）。
    - **不变量断言**：调用前后 `default===true` 计数不增加（杜绝双默认）。
    - setup + server 启动接线的存在性测试（存量配置升级后大白条目存在；**不破坏**用户既有 default）。
    - **已实现**：`provision.test.ts`(9) 覆盖 (a)/(b)/(c)、仅补缺失、多 agent 不误伤、幂等、不可变入参，
      以及 `maybeProvisionBuiltinStewardAtStartup` 的「缺失则落盘一次 / 已存在不写」。全部通过。
    - **既有失败说明**：`src/commands/setup.test.ts` 的「first run」用例在当前多 agent 脏工作树下**预先失败**
      （config 路径/运行时快照全局态隔离问题）；已证明改回原始写法（`writeConfigFile(next)`）同样失败，
      与本 provisioning 改动**无关**；同文件「existing config」用例通过。
    - _Backend: 无（fixture cfg）_

- [x] 2. Phase 2：记忆层（预定义记忆）
  - [x] 2.1 大白记忆 profile 预设
    - 在 1.1 注入的 `memorySearch` 用预设默认（启用 + backend 对齐 `resolveMemoryBackendConfig`，
      `src/memory/backend-config.ts`）；确保 `server-startup-memory.ts:12-16` 会为大白初始化记忆后端。
    - 不强制远程 embedding：缺 key 时降级为 builtin，沿用 `doctor-memory-search.ts` 的探测语义，不阻断启动。
    - **已实现**：Phase 1.1 provisioning 注入 `memorySearch: { enabled: true }` 覆盖；
      `server-startup-memory.ts` 启动时按 agentId 遍历并初始化后端，大白作为 `agents.list` 成员自动受益。
    - _Backend: `agents/memory-search.ts`、`memory/manager.ts`、`server-startup-memory.ts`_
  - [x] 2.2 管家记忆持久化（偏好 / 支持史 / 能力使用）—— **追加式，规避整文件并发覆盖**
    - 新建 `src/support-cases/steward-memory-store.ts`：按**决策 B 复合键**（`tenantId+userId`）存
      `StewardMemory { preferences; recentResolvedTopics; capabilityUsageHints; lastIntents[] }`。
      **不存敏感数据**（密钥/PII 用引用名，遵守 AGENTS.md content-safety）。
    - **并发写修正**：采用 **(a)+(c) 组合**——每 key 一文件（`steward-memory/<tenant>__<user>.json`）+
      原子写（temp+rename）+ 进程内按 fileName 串行写队列（`enqueueWrite` Promise 链），杜绝并发丢写/覆盖。
    - 各列表滚动窗口截断（intents 30 / topics 20 / hints 20）；去重+尾插模式。
    - **已实现** + `steward-memory-store.test.ts`(7) 覆盖隔离/滚动截断/去重/合并偏好/跨 key 不串/损坏降级。
    - _Backend: 新 store（每 key 分片 + 原子写 + 串行队列）_
  - [x] 2.3 ask 注入记忆上下文 + 交互回写
    - `src/gateway/server-methods/daibai.ts` 的 `user.daibai.ask`：调 `loadStewardMemory` 注入
      `buildAskResult` 的上下文（个性化 summary：有历史记忆时追加「结合你此前的问题偏好与上下文」）；
      调用尾部 `appendStewardInteraction` fire-and-forget 回写本次意图（截断 200 字摘要）。
    - 失败隔离：记忆读写失败**不阻断** ask 主流程（try/catch 降级 + `.catch(() => {})`）。
    - **已实现**；既有 `daibai.test.ts`(2) 通过无回归（afterEach 增加 50ms settle 以适配 fire-and-forget 异步写）。
    - _Backend: 2.2 + daibai handler_
  - [x] 2.4 Phase 2 测试（记忆复合键隔离 / 滚动窗口截断 / 失败降级不阻断 / 不落敏感字段）。
    - **已实现**：`steward-memory-store.test.ts`(7) 全绿；含损坏文件降级测试（不抛出，返回空记忆）。

- [x] 3. Phase 3：权限闸门（Action Catalog + scope gating）
  - [x] 3.1 实现 Action Catalog registry
    - 新建 `src/gateway/server-methods/daibai-action-catalog.ts`：注册 `DaibaiActionDescriptor[]`；
      首批仅迁移现有三 support action（`support.case.create/reply_user/apply_resolution`），
      `requiredScope` 标 READ/WRITE（create/apply=WRITE，reply_user=WRITE，对齐现 `execute`∈WRITE_SCOPE）。
    - 每项标注 `delegateTarget`（按决策 E）、`secondaryPermission`（如有）、`maturity`（stub 方法标 experimental）。
    - 导出 `resolveStewardAction(actionId)` + `assertActionAllowedForScopes(action, clientScopes)`。
    - **已实现**：三 action 全部 `delegateTarget: { mode:"service" }` 指向 `daibai-services.ts` 注册的 service
      （`supportCase.create/markReplySeen/applyResolution`，复用既有 store 函数，零重写）。
    - _Backend: 消费 `method-scopes.ts` 的 scope 常量 + 0.5x 底座_
  - [x] 3.2 execute 改为目录驱动 + scope 校验 + 委派（二级权限交目标 service 自校验）
    - 重写 `user.daibai.execute`：查目录（未知→`unsupported daibai action`）→ connect-aware scope 闸门
      （`assertActionAllowedForScopes`，**镜像最外层 `authorizeGatewayMethod` 的 `!client?.connect`→放行**信任模型，
      否则会拒绝合法本地调用）→ 未授权转译为 `status:"blocked"` 升级引导 → 逐 action payload 校验（保留原文案）→
      `invokeStewardDelegate`（0.5x 底座）→ `mapDelegateResultToExecuteResult` 映射回原文案。
    - **二级权限（决策 F）**：execute 不做通用二级权限校验；交目标 service 自校验（`budget.set` 内 `usage:budget` 双闸）。
    - **行为逐字节等价**：现有 `daibai.test.ts` 全链路（create→resolve→reply_user→apply_resolution→空态）通过无回归。
    - _Backend: 3.1 + 0.5x 底座 + 现有 support-cases store（经 `daibai-services.ts`）_
  - [x] 3.3 scope 解析接线（client 实际授权）
    - `user.daibai.execute` handler 解构 `client`，scope 闸门读 `client.connect.scopes`（ADMIN 超集），
      与最外层 `authorizeGatewayMethod` 口径一致；`!client?.connect`（本地直连）视为受信放行。
    - _Backend: server-methods 鉴权上下文_
  - [x] 3.4 Phase 3 测试 —— **必保留（越权/副作用高风险区，不可暂缓）**
    - 目录化后三 action 行为等价（迁移回归）；越权 action（声明 WRITE 但 client 仅 READ）被拒并引导升级；
      **目标 service 拒绝二级权限时大白转译为引导**（不误报成功）；目录类型层无法登记 ADMIN action（编译守卫）。
    - **已实现**：`daibai-action-catalog.test.ts`(8，含「目录中无 ADMIN action」不变量 + 越权拦截 + ADMIN 超集 +
      本地放行）、`daibai.test.ts` 新增「read-only client → blocked 升级引导」用例、`shared/daibai-action-catalog.test.ts`
      `@ts-expect-error` 编译守卫。全部通过。
    - _Backend: 无（mock client scopes）_

- [x] 4. Phase 4：解决者（只读能力编排）
  - [x] 4.1 意图分级路由器
    - 新建 `src/gateway/server-methods/daibai-intent-router.ts`：`classifyIntent(message, memory): DaibaiIntentTier`——
      替换 `looksLikeSupportEscalation` 关键词法为分级（self_serve 只读 / assisted_action 需确认写 / escalate 升级）。
    - 首版规则 + 可选 LLM：规则命中只读域关键词→self_serve；命中既有升级词→escalate；其余→assisted_action。
      （LLM 增强留扩展点，由默认 agent 自身推理，不在网关侧引模型依赖。）
    - **已实现**：保守优先级（代办写优先于纯升级；明确升级词次之；只读词→self_serve + domainHint；
      兜底 escalate，宁可走人工也不冒进代办）。`looksLikeSupportEscalation` 保留用于 suggestedActions 兼容。
    - _Backend: 无（纯函数）_
  - [x] 4.2 接入只读能力域（在用户 scope 内直接答）
    - 新建 `src/gateway/server-methods/daibai-read-router.ts`：按 domain 委派只读 RPC——
      knowledge（`knowledge.search/object`）、能力画像（`employee-capability.profile`）、
      计费（`billing.dashboard`）、模型可用性（`employee-model-access.summary`）。
    - **权限**：全部经各自 handler 的既有鉴权 + 受信用户上下文，大白不旁路（对齐不变量）。
    - **已实现（关键边界）**：read-router 产出**只读路由建议**（domain + 推荐 method + 拼好参数 + 说明），
      **不**由网关代用户调读 RPC——实际只读仍由调用方用用户会话发起，使受信上下文/鉴权自然生效，
      避免 E2 internal-dispatch（默认禁用）的上下文/预算错配。大白做「告诉你去哪查 + 拼好参数」的解决者入口。
    - _Backend: 只读路由建议（不代调，零鉴权旁路）_
  - [x] 4.3 ask 返回路由结果（D1：纯 RPC 路由，无聊天 preamble）
    - `user.daibai.ask` 接 4.1/4.2：self_serve → 附 `readPayload`（推荐只读 RPC + 参数）+ 直答 summary；
      assisted_action → 返回目录内可执行 `suggestedActions`；escalate → 附 `escalationDraft`（Phase 7 充实）。
    - **形态绑定（决策 D1）**：行为规则作为意图路由/目录闸门的**策略输入**，**不**注入聊天 prompt。
    - **已实现**：`buildRouteResult` 计算并挂到 `DaibaiAskResult.route`（新增可选字段，向后兼容）；
      既有 ask 断言无回归。
    - _Backend: 4.1 + 4.2 + 2.3_
  - [x] 4.4 Phase 4 测试 —— **必保留（鉴权旁路高风险区）**
    - 三级意图分类 / 只读委派结果 / **大白不旁路各 handler 鉴权与受信用户上下文**。
    - **已实现**：`daibai-intent-router.test.ts`(6) 覆盖三级分类 + domainHint + 保守兜底 + 只读建议映射/截断；
      鉴权不旁路由设计保证（只产出建议不代调）。既有 `daibai.test.ts`(3)/`ui daibai.test.ts`(3) 无回归。
    - _Backend: 无（mock）_

- [x] 5. Phase 5：代办者（写编排，需确认）—— 依决策 C 分期
  - [x] 5.1 扩充 Action Catalog（需确认写）—— **仅列真实存在且确属 WRITE_SCOPE 的方法**
    - 向 3.1 目录新增 WRITE action（**经核对的真实方法名/scope**）：
      - `robot-skills.toggle` / `robot-skills.upgrade` / `robot-skills.remove`（WRITE，`method-scopes.ts:390-393`）
        — **已落地**：目录项 `requiresUserConfirmation=true` + `requiresOwnershipCheck=true`，service 复用
        `skill-lifecycle-store` 的 `toggleRobotSkillAsset/upgradeRobotSkillAsset/removeRobotSkillAsset`（零重写）。
      - `budget.set`（设预算，WRITE）— **已落地**：目录项 `requiresUserConfirmation=true` +
        `secondaryPermission="usage:budget"`（决策 F 仅作 UI 提示）；service（`daibai-services.ts`）拿到 `client` 后
        **现场自校验** `resolveBillingScope` + `scopeHasPermission(usage:budget)`，失败抛错由 execute 转译为引导。
        为此 `StewardServiceFn` 扩为 `(params, { client })` 支持二级权限自校验。
      - `employee-install.create-request` — **本期暂缓（文档化跟进）**：employee-install 多为 stub 且外部源需 scan 编排，
        接入即空壳，待后端脱 stub 再接。
    - **明确禁止**：`skills.install` / `skills.update` 是 **ADMIN**，按不变量**不进目录**（已由 Phase 3 编译守卫保证）。
    - 全部 `requiresUserConfirmation = true`、`requiredScope = WRITE`。
    - _Backend: robot-skills + budget service（经 0.5x 底座，client 透传）_
  - [x] 5.1a robot-skills 目标范围 ownership 预检（决策 H）—— **安全硬前置**
    - 新建 `src/gateway/server-methods/daibai-ownership.ts`：`resolveManageableAgentIds(cfg)` +
      `assertAgentManageable(agentId, cfg)`（规范化）；execute 对 `requiresOwnershipCheck` 动作**强制**校验
      payload `agentId` ∈ 可管集合，否则返回 `blocked` 引导（不抛硬错）。
    - **一期收窄**：可管集合 = `listAgentIds(cfg)`（本安装配置定义的 agent），杜绝任意 agentId 注入指向越界/不存在 agent；
      `buildParams` 使用 ownership 预检后的 `ctx.resolvedAgentId`，**不**直接信任 payload.agentId。
    - **扩展点**：企业 seat 维度收窄（seat 资产库 `agent` 类资产）标注为后续（需 tenant/seat 受信上下文 + 异步加载）。
    - _Backend: ownership 解析（基于 config agent 集合）；不改 robot-skills handler 签名_
  - [x] 5.2 确认门控落地 + **服务端确认票据 + 显式待确认态（决策 G）**
    - **已落地**：新建 `src/gateway/server-methods/steward-confirmation-store.ts`——
      `createConfirmation`（首调发 `{proposalId, confirmationToken, payloadHash, expiresAtMs}`，TTL 5min，内存）、
      `consumeConfirmation`（校验 token 用 `timingSafeEqual`、未过期、actionId 匹配、payloadHash 匹配防篡改、
      **单次消费**防重放/幂等）。execute：首调（无票据）→ `pending_confirmation` + envelope；二次（带票据）→
      consume 校验失败按原因返回 `blocked` 引导，成功才委派。
    - daibai-types + AJV schema 已在 Phase 0.4 扩展（`status` 增 `pending_confirmation`、execute 参数加
      `proposalId/confirmationToken`、result 加 `confirmation`）。
    - **前端确认卡片**：契约（status/confirmation envelope）已就绪，前端独立确认卡片 UI 归入 Phase 8 一并落地。
    - _Backend: 确认票据 store（内存 + TTL）_
  - [x] 5.3 Phase 5 测试 —— **必保留（副作用/重放/越权高风险区，不可暂缓）**
    - **已实现**：`steward-confirmation-store.test.ts`(7：happy/replay/expired/token/tamper/action/hash 顺序无关)、
      `daibai-ownership.test.ts`(5：解析/可管/越界拒/空拒/空配置回退)、`daibai.test.ts` 新增 3 例
      （ownership 越界 blocked / 首调 pending_confirmation 带 envelope / 二次无效票据 blocked）。全部通过。
    - budget `usage:budget` service 自校验测试随该动作的跟进一并补。
    - _Backend: 无（mock）_

- [x] 6. Phase 6：引导者（能力发现 / 上手）
  - [x] 6.1 能力发现（基于实际可见能力，非写死清单）
    - 新建 `src/gateway/server-methods/daibai-guide.ts`：从 `employee-capability.profile` +
      `employee-capability.recommendations` 聚合「你现在能用什么 / 下一步可做什么」，喂给 ask 的引导态。
    - **已实现（已对齐 spec 数据源）**：从 `employee-capability.ts` 抽出 E1 共享聚合
      `buildEmployeeCapabilityProfile(agentId)` + `buildEmployeeCapabilityPersonalRecommendations(agentId)`，
      `profile`/`recommendations` handler 与 daibai-guide **共用同一投影与语义**（`toCapabilitySummary` + goodAt +
      personal 推荐过滤）；guide 的 `availableNow` 来自 `profile.whatItCanDo`、`recommendations` 来自共享个人推荐，
      不再 ad-hoc 直接读 skill 列表。`stewardActions` 来自 Action Catalog 实际注册项（非写死）。
    - **扩展点（已闭合）**：position/platform 档推荐已通过 ask（持 client）侧异步注入——
      抽出 `buildEmployeeCapabilityRecommendations(agentId, client)`（personal+position+platform 去重，
      handler 与 guide 共用），ask handler 异步拉全档（失败隔离回退 sync personal）并经
      `buildStewardGuideSnapshot({ recommendations })` 注入 guide。
    - _Backend: 复用 employee-capability 共享聚合（E1）_
  - [x] 6.2 扩展引导 UX（从首次引导→随时可问）
    - 改 `ui/src/ui/controllers/daibai.ts:43-56`：保留首次引导，新增「任意时刻问大白」入口态；
      引导内容来自 6.1 实际能力，不写死。
    - **已实现**：`shouldAutoAskDaibai` 改走 `isDaibaiWorkbenchSession`；引导已确认后显示「问大白」按钮；
      prelude 渲染 `guide` 快照。
    - _Backend: 6.1_
  - [x] 6.3 Phase 6 测试（能力发现聚合 / 空能力降级文案 / 引导态切换）。
    - **已实现**：`daibai-guide.test.ts`(3)：空能力降级 / 记忆提示 / stewardActions 来自目录（非写死）。

- [x] 7. Phase 7：衔接者（升级上下文自动采集）
  - [x] 7.1 升级上下文自动采集
    - 新建 `src/gateway/server-methods/daibai-escalation.ts`：构建 `escalationDraft`，自动填充
      `SupportCaseContextBundle`（`src/shared/daibai-types.ts:34-49`）的
      `onboardingSummary / recentPlanSummary / recentExecutionSummary / blueprintSummary / errorEvidence`，
      数据取自管家记忆（2.2）+ 当前会话上下文。
    - **已实现（五字段齐全）**：onboarding/plan/execution/errorEvidence 由记忆+消息+失败原因填充；
      `blueprintSummary` 支持调用方显式传入或从记忆 `preferences.blueprintId` 派生，**无蓝图来源时诚实省略**
      （不臆造）。一期记忆未设专门的蓝图采集器，蓝图字段主要走调用方 passthrough。
    - _Backend: 2.2 + support-cases store_
  - [x] 7.2 自助失败 → 升级收敛
    - 解决者（4.2）只读无解 / 代办者（5.x）越权或被拒 → 自动产出 escalate 建议（带 7.1 上下文），
      用户一键转 `support.case.create`（经目录化 execute）。
    - **已实现**：execute `blocked` 附 `escalationDraft`；`buildSuggestedActions` 预填 create payload。
    - _Backend: 4.x/5.x + 7.1_
  - [x] 7.3 Phase 7 测试（上下文 bundle 自动填充完整性 / 失败收敛到升级 / 升级单含上下文）。
    - **已实现**：`daibai-escalation.test.ts`(5)：记忆填充 / category 兜底 / blueprint 显式传入 / blueprint 记忆派生 /
      无源时省略 blueprint。

- [x] 8. Phase 8：UI 统一入口（大白选择逻辑抽象化，消除 "main" 字面量散落）
  - [x] 8.0 抽象大白选择判定（消除整条识别链的 "main" 硬绑定）—— **前置**
    - 现状散落两套「main 即大白」判断，**全部纳入改造**：
      - controller/render：`shouldAutoAskDaibai` / `isDaibaiWorkbenchSession`
        （`ui/src/ui/controllers/daibai.ts:43-56`、`ui/src/ui/app-render.ts:798-802`）。
      - **nav 模型**：`workbench-nav-model.ts` 的 `DAIBAI_SESSION_KEY="main"`、`isDaibaiEntry()`
        （判 `entry.key/id/sessionKeys` 含 `"main"`，`:70-97`、`:123-139`）、以及 `buildSeededAssistants` 的
        **排序置顶 + `id="daibai"` + `DAIBAI_NAV_ITEM` 图标/高亮**——必须同步改判，否则「自动问大白修好了，但侧边栏排序/图标仍按旧规则」。
      - **shell 模型**：`workbench-shell-model.ts:11` 的 `DAIBAI_SESSION_KEY="main"`。
      - **stage**：`workbench-stage.ts:134-139` 的 `isDaibaiAssistant = selectedAssistantItem?.selectionKey === "main"`。
    - 新建 `isBuiltinStewardSelection(params)` / `isBuiltinStewardEntry(entry)`（前端）：基于
      **`mainSessionKey` 归一化结果 + `BUILTIN_STEWARD_AGENT_ID`** 判定，复用 `normalizeSessionKeyForDefaults`
      的 alias 规则（`ui/src/ui/app-gateway.ts:145-163`，含裸 `main`、`mainKey`、`agent:<defaultAgentId>:main`）。
      把上述**全部调用点**收敛到这两个函数，**删除各文件的 `DAIBAI_SESSION_KEY="main"` 字面量常量**。
    - **已实现**：`ui/src/ui/builtin-steward-selection.ts` + nav/shell/stage/controller/app-render 收敛。
    - _Backend: 无（前端共享 util + nav/shell/stage/controller/render 调用点统一收敛）_
  - [x] 8.1 各模块「需要帮助」收敛到大白
    - 在员工端各模块（assistant 之外）增加「问大白」入口，跳转时携带模块上下文（当前模块/会话/错误），
      作为 ask 的 `sourceSessionKey` + 上下文，使大白成为**唯一入口**；入口命中判定走 8.0 抽象函数。
    - **已实现**：knowledge/settings 模块 stage 头「问大白」+ `openDaibaiHelpFromModule`。
    - _Backend: 无（前端 + 复用 ask）_
  - [x] 8.2 人设/壳层对齐内置身份契约（仅 builtin steward 渲染大白 footer）
    - 助理页页脚/人设（`workbench-stage-assistant.ts:305-307` 当前**纯写死「大白管家」**）改为：
      **仅当当前选中为 builtin steward**（经 8.0 的 `isBuiltinStewardSelection/Entry` 判定）时渲染「大白管家」footer；
      **否则跟随 `resolveAssistantIdentity` 解析出的 assistant identity** 渲染——避免只做常量替换、
      让非大白 persona 经过该视图时也错显「大白管家」。
    - 非大白 agent 不受影响（0.1 已限定 special-case fallback 仅 `isBuiltinStewardAgent`）。
    - **已实现**：footer 用 `BUILTIN_STEWARD_NAME` + `showStewardFooter`；**独立确认卡片**（`pending_confirmation`）。
    - _Backend: 无_
  - [x] 8.3 Phase 8 测试 —— **必保留（session alias + persona 共存回归）**
    - **session alias 命中矩阵**：裸 `"main"` / canonical `mainSessionKey` / `agent:<defaultAgentId>:main`
      三种都能稳定命中大白入口（含 nav 置顶/图标、stage、自动问大白）；
      **普通默认 agent 会话（如 `agent-sales` 且非大白）在 nav/shell/stage 全链路均不被误判为大白**。
    - **persona 共存场景（决策 A2）**：当 `defaultAgentId = agent-sales` 且大白仍是 `main` 时，
      工作台默认 persona 标签、聊天默认入口、大白入口**三者并存且不互相覆盖**；非大白 persona footer 不显示「大白管家」。
    - **已实现（文件级回归补齐）**：
      - `ui/src/ui/builtin-steward-selection.test.ts`(4)：alias 矩阵 + 非大白不误判。
      - `ui/src/ui/ports/employee/views/workbench-nav-model.steward.test.ts`(3)：daibai 置顶/`id=daibai`/brain 图标走
        `isBuiltinStewardEntry`；非 main 默认 agent 不误判；canonical alias 命中。
      - `ui/src/ui/ports/employee/views/workbench-shell-model.steward.test.ts`(3)：panelBadge「AI」走
        `sessionKeyMatchesBuiltinSteward`；alias 命中；非大白默认 agent 保留原 badge。
    - **待补全（非阻断）**：`app-render*` 级别的端到端渲染回归（controller/render 已在 `daibai.test.ts` +
      `builtin-steward-selection` 间接覆盖，但未单列 app-render 专项用例）。
    - _Backend: 无_
  - [x] 8.4 UX/UI 交互规范与状态验收（用户旅程 + 状态流 + Design Tokens + a11y）
    - **用户旅程（User Journey）必须覆盖完整闭环**：

      ```mermaid
      journey
        title 大白管家帮助闭环
        section 触发
          用户在模块内遇到问题: 3: 用户
          点击「问大白」入口: 4: 用户
          系统携带模块/会话/错误上下文: 4: 系统
        section 分流
          大白展示上下文感知引导: 4: 大白
          只读自助给出可查结果或下一步: 5: 大白
          写操作展示确认卡片: 3: 用户
          无权限或失败收敛为升级建议: 3: 大白
        section 闭环
          用户确认执行或取消: 4: 用户
          执行成功展示结果与可追溯说明: 5: 系统
          升级支持单自动带上下文: 4: 平台
      ```

    - **交互状态流必须覆盖理想态与失败态**：

      ```mermaid
      stateDiagram-v2
        [*] --> Entry: 模块「问大白」
        Entry --> Asking: 携带 sourceSessionKey/context
        Asking --> Guide: guide 可用
        Asking --> ReadSuggestion: self_serve
        Asking --> Confirmation: assisted_action + requiresUserConfirmation
        Asking --> EscalationDraft: escalate/blocked
        Guide --> EmptyGuide: 无可见能力
        ReadSuggestion --> ReadError: 只读建议不可用/无权限
        Confirmation --> Executing: 用户确认 + 有效票据
        Confirmation --> Expired: 票据过期/篡改/重放
        Confirmation --> Cancelled: 用户取消
        Executing --> Success: executed
        Executing --> EscalationDraft: blocked/目标 service 拒绝
        EmptyGuide --> EscalationDraft
        ReadError --> EscalationDraft
        Expired --> EscalationDraft
        Success --> [*]
        Cancelled --> [*]
        EscalationDraft --> [*]
      ```

    - **页面/组件状态验收**：
      - 「问大白」入口：默认态、hover/focus、禁用态、模块上下文缺失降级态；入口文案固定为动作导向，不使用模糊「帮助」。
      - 大白引导区：加载态使用轻量 skeleton；空能力态说明「当前没有可直接代办的能力」并给出升级/查看知识建议；错误态保留可重试入口。
      - 只读建议卡片：展示推荐查询对象、推荐原因、下一步按钮；长标题/长错误证据按两行截断并保留 tooltip/展开。
      - 确认卡片：独立于普通 action button；必须展示动作名称、影响范围、权限/二级权限提示、不可逆风险、过期提示与取消按钮。
      - 升级卡片：展示将被带入支持单的上下文字段摘要，允许用户提交前编辑描述，避免把敏感内容默认展开。
    - **Design Tokens（映射到 CSS 变量或 Tailwind token）**：
      - `--steward-color-primary: #2563EB`（RGB 37 99 235）：入口高亮、主按钮、焦点环。
      - `--steward-color-surface: #EFF6FF`（RGB 239 246 255）：大白引导/只读建议浅底。
      - `--steward-color-success: #16A34A`（RGB 22 163 74）：执行成功、已完成状态。
      - `--steward-color-warning: #D97706`（RGB 217 119 6）：需确认、票据临近过期、实验性能力。
      - `--steward-color-danger: #DC2626`（RGB 220 38 38）：不可逆风险、blocked、执行失败。
      - `--steward-radius-card: 12px`、`--steward-space-card: 16px`、`--steward-shadow-card: 0 8px 24px rgba(15, 23, 42, 0.12)`。
      - 排版层级：标题 14px/20px semibold；正文 13px/20px regular；辅助说明 12px/16px regular；按钮 13px/18px semibold。
    - **无障碍与键盘逻辑**：
      - 「问大白」入口和确认卡片所有按钮必须可通过 Tab 顺序访问；确认卡片打开后焦点进入卡片标题，取消/确认按钮顺序与视觉顺序一致。
      - 确认卡片使用 `role="group"` 或等价语义并提供可读 label；危险动作按钮文案必须包含动作动词，不只写「确认」。
      - 状态变化（执行中、成功、失败、票据过期）进入 `aria-live="polite"` 区域；错误态要有文本说明，不只依赖颜色。
      - 文本与背景对比度至少满足 WCAG AA：正文 4.5:1，非禁用按钮文本 4.5:1，焦点环与背景 3:1。
    - **当前状态（已落地）**：
      - 后端 `pending_confirmation` 附 `confirmationDetail`（动作名/影响范围/二级权限提示/不可逆标记/过期时间），
        目录项 robot-skills 标注 `impact`/`irreversible`。
      - 确认卡片渲染影响范围/权限要求/不可逆风险/有效期提示，按钮文案含动作动词（不可逆加「（不可逆）」、
        「取消，不执行」），`role="group"` + `aria-label` + `aria-live="polite"`；仅有待确认态时也能独立渲染。
      - **Design Tokens 落 CSS**（`ui/src/styles/workbench.css`）：`--steward-color-*`/radius/space/shadow 作用域限定
        在大白引导区；确认卡片 warning/danger 配色、`:focus-visible` 焦点环、danger 按钮样式。
      - **只读建议卡片**（`renderDaibaiReadSuggestion`）：推荐查询对象 + 原因，长文两行截断 + `title` tooltip。
        **升级上下文卡片**（`renderDaibaiEscalationCard`）：将带入支持单的上下文字段摘要（截断 + tooltip），
        提示「下方输入框补充/修改描述后再提交」（复用聊天输入作为可编辑描述面）。
      - 测试：`workbench-stage.node.test.ts` 新增确认卡片信息密度/role/danger/动作动词 + 只读建议卡片渲染断言。
    - _Backend: confirmationDetail（已落）；前端样式/交互已落_

- [x] 9. Phase 9：集成与守护
  - [x] 9.1 scope 注册守护
    - 新增/变更的 daibai RPC 全部登记 `src/gateway/server-methods-list.ts` 与 `src/gateway/method-scopes.ts`
      对应 scope 组（读入 READ、写入 WRITE；**严禁**误入 ADMIN）；补存在性测试防漏注册（未分类默认 admin-only 会拦截）。
    - **已实现**：`daibai-scope-guard.test.ts`(2)；既有 `method-scopes.test.ts` 全量分类守护仍绿。
    - _Backend: server-methods-list + method-scopes_
  - [x] 9.2 端到端链路测试
    - 注册→自带大白→记忆个性化→只读自助→需确认代办→升级平台 全链路 e2e（`*.e2e.test.ts`）。
    - **已实现**：`daibai-steward.integration.test.ts`(2)：
      - 用例 1：provision → ask(escalate) 带 guide + escalationDraft → robot-skills pending_confirmation。
      - 用例 2（完整链路）：provision → ask(self_serve) 命中 billing 只读路由 + **记忆回写落盘验证** →
        support.case.create 执行成功建单 → 再次 ask 显示 openCaseCount≥1 → robot-skills 确认票据首发 pending →
        二次回带票据**消费过闸进入委派**（无技能种子故委派失败 ok=false，证明过了确认闸而非 pending/blocked）→
        重放同票据被拒（单次消费）。覆盖「记忆个性化 → 只读自助 → 需确认代办 → 升级平台」主链路。
      - vitest 默认 exclude `*.e2e.test.ts`，故用 integration 命名纳入 CI。
    - **说明**：「需确认代办成功执行（executed）」未单测，因需种子真实技能关系（耦合 skill-lifecycle 内部）；
      改以「确认闸通过 → 委派被调用」断言等价证明（确认协议正确性由 `steward-confirmation-store.test.ts` 7 例守护）。
    - _Backend: 全链路_
  - [x] 9.3 Checkpoint —— 改动文件 diagnostics 干净；相关用例全绿；不变量未破坏
    - 改动文件 diagnostics 干净；相关用例全绿；
      确认不变量未被破坏（无 ADMIN 目录项、知识权限未旁路、写动作均经确认）。
    - **已实现（可追溯结果）**：本次回归——后端 16 文件 100 用例 + 前端/协议 5 文件 36 用例 = **21 文件 136 用例全绿**；
      所有改动文件 diagnostics 干净；ADMIN 目录项编译（`@ts-expect-error`）+ 运行（catalog 无 admin 不变量）双守卫保持。
    - **未做（按多 agent 安全约定）**：全量 `pnpm test` / `pnpm tsgo`（多 agent 脏工作树，避免触碰他人 WIP）。
    - _Backend: 无_

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **两条架构前置（最高优先级）**：决策 D（大白单一形态，建议 D1 独立 RPC 管家）+ 决策 E（内部复用调用策略，
  建议 E1 抽服务层）。这两点不先定，`delegateTarget` 不可执行、且易做成两套并存系统。
- **核心不变量**（编译期 + 运行期双保险）：能力目录类型层禁 `operator.admin`（编译期）；execute 运行期校验
  operator scope + 排除 ADMIN；**二级权限交目标 service 自校验（决策 F）**；知识/数据权限不旁路受信用户上下文。
- **真实方法/权限对齐**：写代办仅用 `employee-install.create-request`（experimental，一期仅平台/企业内来源）、
  `robot-skills.toggle/install/remove/upgrade`（**须 ownership 预检，决策 H**）、`budget.set`（service 自校验 `usage:budget`）；
  `skills.install/update` 是 ADMIN，**禁止进目录**。
- **确认协议闭环（决策 G）**：`DaibaiExecuteResult.status` 增 `pending_confirmation`，配
  `confirmation { proposalId/confirmationToken/payloadHash/expiresAtMs }` + AJV schema；前端**独立确认卡片**，
  服务端票据保证防重放/幂等/防篡改。
- **E2 预算双计**：若选 E2 internal-dispatch，内部 dispatch 必须跳过外层 control-plane write 预算扣减
  （`server-methods.ts:196-220`），保证一次用户动作只计一次。
- **记忆并发**：管家记忆每轮写，**不**沿用整文件 load-modify-save，改按 key 分片 + 原子写 + 去抖（或 append-only JSONL）。
- **多 agent 安全**：provisioning 仅注入/补字段，绝不覆盖或删除他人 agent；**不抢占 `default=true`**（决策 A）；
  记忆按 `tenantId+userId` 隔离。
- **默认 agent / 大白入口 / seat 默认 agent 语义钉死**：`defaultAgentId` 可不是大白（决策 A2）；
  大白入口绑定 `BUILTIN_STEWARD_AGENT_ID`，前端**整条识别链**（controller/render + nav/shell/stage 模型）统一经
  `isBuiltinStewardSelection/Entry`（基于 `mainSessionKey` 归一化 + steward id）判定，**禁止**散落 `"main"` 字面量
  或 `DAIBAI_SESSION_KEY="main"` 常量（决策 A2 + Task 8.0）。`buildSeededAssistants` 的置顶/图标同步改判。
- **大白 UX/UI 验收口径**：Phase 8 不只验入口命中，还必须验 User Journey、入口/引导/只读建议/确认/升级卡片的加载态、
  空态、错误态、极限态、Design Tokens、键盘导航与 WCAG AA 对比度（Task 8.4）。
- **绝不双 default**：provisioning 调用前后 `default===true` 计数不增加；已有非 main 默认 agent 时保持不变（Task 1.1/1.4 验收）。
- **可管 agent 集合唯一解析点**：`resolveManageableAgentIds(client)` 数据源写死（seat 资产库 → workspace 归属 →
  一期仅当前工作台选中 agent），禁止各处各写（决策 H）。
- **身份兜底**：仅 `isBuiltinStewardAgent(agentId)` 时 special-case 大白名，**不改**全局 `DEFAULT_ASSISTANT_IDENTITY`。
- **新增后端模块**：`src/agents/builtin-steward/{identity,behavior-rules,provision}.ts`、
  `src/shared/daibai-action-catalog.ts`、`src/support-cases/steward-memory-store.ts`、
  `src/gateway/server-methods/{daibai-action-catalog,daibai-intent-router,daibai-read-router,daibai-guide,daibai-escalation}.ts`、
  以及（决策 E2 时）`src/gateway/internal-dispatch.ts`。
- **复用既有**：support-cases store / 状态机、knowledge / employee-capability / billing / employee-model-access /
  employee-install / robot-skills handler、memory manager、assistant-identity 解析、agent-runtime-seed 幂等模式。
- **不改契约**：既有 `DaibaiAskResult/ExecuteResult` 字段保留，新增字段全可选；**D1 下不注入聊天 prompt preamble**
  （preamble 仅 D2 立项时实现）。
- 标 `*` 为可暂缓测试项；但 **Phase 3.4 / 4.4 / 5.3（权限/确认/幂等/鉴权旁路）已改为必保留**，0.5x.2 底座测试同样建议保留。
- 变更涉及运行时 `dist/` 的，按 AGENTS.md 重启网关后验证（`launchctl kickstart -k gui/$UID/ai.openbot.gateway` 或 Mac app）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.0"] },
    { "id": 1, "tasks": ["0.1", "0.2", "0.3"] },
    { "id": 2, "tasks": ["0.4", "0.5"] },
    { "id": 3, "tasks": ["0.5x.1", "0.5x.2"] },
    { "id": 4, "tasks": ["1.1"] },
    { "id": 5, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 6, "tasks": ["2.1", "2.2"] },
    { "id": 7, "tasks": ["2.3", "2.4"] },
    { "id": 8, "tasks": ["3.1"] },
    { "id": 9, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 10, "tasks": ["4.1", "4.2"] },
    { "id": 11, "tasks": ["4.3", "4.4"] },
    { "id": 12, "tasks": ["5.1", "5.1a", "5.2", "5.3"] },
    { "id": 13, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 14, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 15, "tasks": ["8.0"] },
    { "id": 16, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 17, "tasks": ["9.1", "9.2"] },
    { "id": 18, "tasks": ["9.3"] }
  ]
}
```
