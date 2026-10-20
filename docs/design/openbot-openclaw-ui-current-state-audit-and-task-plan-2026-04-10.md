# OpenBot / OpenBot UI 现状审计与实施任务清单

Date: 2026-04-10

## Related Docs

- 总体迁移策略：[/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10](/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10)
- 产品入口矩阵：[/design/openbot-product-entry-matrix-2026-04-11](/design/openbot-product-entry-matrix-2026-04-11)
- 实施状态复核：[/design/openbot-openclaw-ui-implementation-status-review-2026-04-11](/design/openbot-openclaw-ui-implementation-status-review-2026-04-11)

## 1. 文档目的

本文档只做两件事：

1. 基于当前仓库代码，盘点新旧系统与 UI 入口现状。
2. 基于现状，拆出可执行、可复核、可分配的实施任务。

本文不讨论抽象愿景，不把“应该怎样”当作“已经怎样”。

## 2. 审计范围

本次盘点覆盖以下代码面：

### 2.1 浏览器 UI

- `ui/`
- `src/gateway/control-ui*.ts`
- `src/commands/dashboard.ts`
- `docs/web/*.md`

### 2.2 原生 UI

- `apps/ios/Sources/**`
- `apps/macos/Sources/OpenBot/**`
- `apps/macos/Sources/OpenBotProtocol/**`
- `apps/shared/OpenBotKit/**`

### 2.3 已抽出的新领域层

- `packages/collaboration-core`
- `packages/collaboration-runtime`
- `packages/collaboration-openbot-adapter`

## 3. 现状结论

## 3.1 当前不是“旧系统 vs 新系统”二分，而是三层并存

当前仓库实际并存三类前台/交互系统：

1. Legacy native UI
2. Browser Control UI / Workbench UI
3. 已开始抽出的 collaboration domain/runtime/adapter

因此后续任务不能按“删旧页面 -> 重做新页面”理解，必须按“已有新层继续抽边界，旧层逐步退出”执行。

## 3.2 当前已经存在的新 UI 主体，但仍带旧控制面形态

`ui/` 不是空壳，也不是演示页，而是一套已经运行中的浏览器前端：

- 包名：`ui/package.json` -> `openbot-control-ui`
- 启动入口：`ui/src/main.ts`
- 顶层应用：`ui/src/ui/app.ts`
- 顶层渲染：`ui/src/ui/app-render.ts`
- 路由与 tab：`ui/src/ui/navigation.ts`

当前浏览器 UI 已有两套主要界面结构：

### 3.2.1 Frontstage / Workspace 入口

来自 `ui/src/ui/navigation.ts`：

- `chat`
- `me`
- `personas`
- `contacts`
- `groups`
- `control`

其中：

- `me` 已作为 employee workbench 主入口
- `control` 是前往控制台/控制中心的聚合入口

### 3.2.2 Console / Control 入口

来自 `ui/src/ui/navigation.ts` 的 `CONSOLE_TABS`：

- `overview`
- `channels`
- `instances`
- `sessions`
- `usage`
- `cron`
- `agents`
- `skills`
- `nodes`
- `config`
- `debug`
- `logs`

结论：

1. 新 UI 已经有工作台方向。
2. 但它同时仍承载旧控制台/网关运维面。
3. 用户感知上，它仍更像“OpenBot 管理后台”，还不是完全独立的 OpenBot 产品面。

## 3.3 新工作台边界已经部分成型

`ui/src/ui/ports/employee/**` 已形成明确的新 workbench 边界：

- `ui/src/ui/ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/ports/employee/render-actions.ts`
- `ui/src/ui/ports/employee/views/workspace-home-model.ts`
- `ui/src/ui/ports/employee/views/workspace-modules.ts`
- `ui/src/ui/ports/employee/views/workspace-signals.ts`

并且仓库已有现状说明文档：

- `ui/WORKSPACE_HOME_MODULE_MAP.md`
- `docs/design/workbench-boundary-parity-audit-2026-04-09.md`

结论：

1. employee workbench 已不再只是概念。
2. “新 UI 是否存在”这个问题已经结束。
3. 现在的问题是它是否已经从旧控制面、旧状态模型中脱离出来，答案是还没有完全脱离。

## 3.4 浏览器 UI 目前仍是单体状态架构

`ui/src/ui/app-view-state.ts` 仍然是超大单体状态对象，聚合了：

- 路由状态
- 平台认证状态
- chat 状态
- config 状态
- channels 状态
- sessions 状态
- presence 状态
- agents 状态
- collaboration learning / governance 状态
- usage 状态
- 本地 workspace/UI 偏好状态

结论：

1. 新 UI 有了结构化渲染边界。
2. 但状态层仍是单体。
3. capability layer 的下一阶段重点不是“把 view 改漂亮”，而是拆状态与调用边界。

## 3.5 浏览器 UI 目前仍直接调用 Gateway 控制面 RPC

当前 `ui/src/ui/controllers/*.ts` 基本直接经 `GatewayBrowserClient` 调用 gateway RPC：

- `ui/src/ui/controllers/config.ts` -> `config.get` / `config.set` / `config.apply`
- `ui/src/ui/controllers/channels.ts` -> `channels.status` / `web.login.*` / `channels.logout`
- `ui/src/ui/controllers/sessions.ts` -> `sessions.list` / `sessions.patch` / `sessions.delete`
- 其他 controller 也采用同类模式

结论：

1. 这些 controller 已经像 capability 的前身。
2. 但它们还不是稳定 capability facade。
3. 它们仍然直接绑定 transport client 和 RPC method 名。

这意味着：

1. 新 UI 已经不是直接依赖旧 native view。
2. 但它仍依赖旧控制面协议语义。
3. capability 层最好优先从 browser controllers 中抽，而不是重新造一套平行层。

## 3.6 浏览器 UI 仍存在本地持久化业务状态

`ui/src/ui/storage.ts` 当前持久化：

- `sessionKey`
- `lastActiveSessionKey`
- `sessionSeenAt`
- `workspaceTeamObjects`
- `workspaceTeamOrder`
- `theme`
- `chatFocusMode`
- `splitRatio`
- `navCollapsed`
- `navGroupsCollapsed`
- `customBrandLogoDataUrl`

其中最关键的问题不是 token，而是：

- `workspaceTeamObjects`
- `workspaceTeamOrder`

这两项仍然是本地 UI 物件，不是后台统一领域对象。

结论：

1. 工作台里一些“团队对象/空间对象”仍是前端本地拼装的。
2. 这类状态如果继续扩展，会成为新的技术债。
3. 任务优先级上，应先冻结其扩张，再定义后端/能力层模型。

## 3.7 新工作台仍以 sessions/channels/presence 快照派生很多“业务对象”

例如：

- `ui/src/ui/data/frontstage-session-cards.ts`
- `ui/src/ui/data/frontstage-overview.ts`
- `ui/src/ui/ports/employee/render-model.ts`

当前 workbench 的联系人、群组、空间、最近会话、人员卡片，很大程度上仍由：

- `sessions.list`
- `channels.status`
- `presence`

等快照推导而来。

结论：

1. workbench 的展示边界已较清晰。
2. 但领域对象仍然大量是“从通用快照派生出来的 UI 读模型”。
3. 这代表新工作台仍未完全拥有独立后端能力域。

## 3.8 Collaboration 三层包已经是“新系统能力层”的真实基础

现有包：

- `packages/collaboration-core`
- `packages/collaboration-runtime`
- `packages/collaboration-openbot-adapter`

其 README 和目录结构已经显示出明确分层：

- core: types / state machines / policy helpers
- runtime: routing / projection / context / gates
- openbot-adapter: storage / directory / session / audit

结论：

1. collaboration 不是计划中的未来层，而是已落地的新能力层。
2. 后续 capability 设计应尽量对齐这类三层边界，而不是背离它。
3. 新 UI 的 collaboration/workbench 任务应优先复用这些已存在层次。

## 3.9 Legacy native UI 仍然掌握大量产品入口

### iOS

关键入口与页面：

- `apps/ios/Sources/RootView.swift`
- `apps/ios/Sources/RootCanvas.swift`
- `apps/ios/Sources/RootTabs.swift`
- `apps/ios/Sources/Settings/SettingsTab.swift`
- `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`
- `apps/ios/Sources/Chat/ChatSheet.swift`

现状：

1. `RootCanvas` 仍直接控制 onboarding、settings、chat sheet、quick setup。
2. `SettingsTab` 仍直接绑定大量 `AppStorage` 与 gateway/connect/debug/config 行为。
3. `OnboardingWizardView` 仍自带完整配对/鉴权/发现流程。

### macOS

关键入口与页面：

- `apps/macos/Sources/OpenBot/MenuContentView.swift`
- `apps/macos/Sources/OpenBot/ChannelsSettings.swift`
- `apps/macos/Sources/OpenBot/ConfigSettings.swift`
- `apps/macos/Sources/OpenBot/CronSettings.swift`
- `apps/macos/Sources/OpenBot/WebChatManager.swift`
- `apps/macos/Sources/OpenBot/CanvasManager.swift`
- `apps/macos/Sources/OpenBot/AppState.swift`

现状：

1. 菜单栏壳层仍是重要产品入口。
2. 打开 Dashboard / Chat / Canvas / Settings 的路径还在旧壳层里。
3. `AppState` 仍是庞大的本地运行时状态核心。

结论：

1. Native 旧 UI 还没有退出产品主链路。
2. 即使浏览器新 UI 已存在，native 入口仍然会把用户拉回旧产品语义。
3. “页面混淆”的真实来源不只是浏览器页面，也包括原生入口和文案。

## 3.10 浏览器入口命名仍然混合

当前用户可见命名混杂于：

- dashboard
- control UI
- web chat
- canvas
- openclaw
- openbot

证据包括：

- `src/commands/dashboard.ts`
- `docs/web/dashboard.md`
- `docs/web/control-ui.md`
- `docs/web/webchat.md`
- `ui/src/ui/navigation.ts`
- `ui/src/ui/views/control-center.ts`

结论：

1. 产品混淆不只是代码结构问题。
2. 也是入口命名、信息架构和文案层的问题。
3. 任务中必须单列“命名与入口收口”，不能只做代码重构。

## 4. 当前系统分层判断

基于现状，可以把当前代码按成熟度分成四类：

### 4.1 已有清晰新边界，可继续演进

- `ui/src/ui/ports/employee/**`
- `ui/src/ui/data/**`
- `packages/collaboration-*`

### 4.2 已像 capability，但还未正式封装

- `ui/src/ui/controllers/config.ts`
- `ui/src/ui/controllers/channels.ts`
- `ui/src/ui/controllers/sessions.ts`
- `ui/src/ui/controllers/chat.ts`
- `ui/src/ui/controllers/agents.ts`

### 4.3 旧系统核心状态/能力节点，需被适配而不是继续暴露

- `apps/ios/Sources/Model/NodeAppModel.swift`
- `apps/ios/Sources/Gateway/GatewayConnectionController.swift`
- `apps/macos/Sources/OpenBot/AppState.swift`
- `apps/macos/Sources/OpenBot/ConfigStore.swift`
- `apps/macos/Sources/OpenBot/ChannelsStore.swift`
- `apps/shared/OpenBotKit/**`

### 4.4 必须冻结的 legacy UI 壳层

- `apps/ios/Sources/RootCanvas.swift`
- `apps/ios/Sources/Settings/SettingsTab.swift`
- `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`
- `apps/macos/Sources/OpenBot/MenuContentView.swift`
- 其他旧 settings / menu / shell 视图

## 5. 实施任务拆解原则

基于当前现状，实施任务必须遵守以下规则：

1. 优先接管已有新边界，不重造平行结构。
2. 先从浏览器 UI 的 controller/state 层抽 capability，再反向收 native legacy。
3. 先治理入口、状态、命名，再治理视觉。
4. collaboration 相关能力优先复用 `packages/collaboration-*`。
5. 所有任务都要能指出“当前来源文件”和“目标边界”。

## 6. 实施任务清单

## 6.1 P0 任务：先把“现状混乱点”锁住

| ID   | 任务                                 | 当前来源                                                               | 目标边界                           | 完成标准                                                               |
| ---- | ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| P0-1 | 冻结 legacy UI 改动范围              | `apps/ios/Sources/**`, `apps/macos/Sources/OpenBot/**`                 | legacy frozen zone                 | 在文档、review 规则、目录约定中明确“仅允许 bugfix/抽取/回退修复”       |
| P0-2 | 确认浏览器 UI 为新产品主前端候选     | `ui/src/ui/**`                                                         | OpenBot browser shell              | 明确 `ui/` 为后续 OpenBot 主浏览器 UI，而不是临时控制台                |
| P0-3 | 建立 UI 入口清单                     | `src/commands/dashboard.ts`, `docs/web/*.md`, `apps/macos`, `apps/ios` | product entry inventory            | 列出所有用户可进入的页面/面板/窗口/route，并标注保留、改名、下线、迁移 |
| P0-4 | 锁定新 UI 禁止直接扩张本地工作台对象 | `ui/src/ui/storage.ts`                                                 | local-only workbench object freeze | 不再新增 `workspaceTeamObjects` / `workspaceTeamOrder` 类本地业务对象  |

## 6.2 P0 任务：抽浏览器 capability facade 第一批

| ID   | 任务                 | 当前来源                                                                                            | 目标边界                                     | 完成标准                                                  |
| ---- | -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| P0-5 | 抽 `gateway` facade  | `ui/src/ui/app-gateway.ts`, `ui/src/ui/gateway.ts`, `ui/src/ui/controllers/control-ui-bootstrap.ts` | `ui/src/ui/capability/gateway/**` 或等价边界 | UI 不再散落直接处理 gateway target/bootstrap/connect 细节 |
| P0-6 | 抽 `config` facade   | `ui/src/ui/controllers/config.ts`                                                                   | `ui/src/ui/capability/config/**`             | view/render 层不直接感知 RPC method 名                    |
| P0-7 | 抽 `channels` facade | `ui/src/ui/controllers/channels.ts`                                                                 | `ui/src/ui/capability/channels/**`           | channel status / login / logout 行为通过 facade 暴露      |
| P0-8 | 抽 `sessions` facade | `ui/src/ui/controllers/sessions.ts`                                                                 | `ui/src/ui/capability/sessions/**`           | workbench/frontstage 不直接依赖 raw sessions controller   |
| P0-9 | 抽 `chat` facade     | `ui/src/ui/controllers/chat.ts`, `ui/src/ui/app-chat.ts`                                            | `ui/src/ui/capability/chat/**`               | chat transport 与 UI composer/stream 呈现解耦             |

## 6.3 P0 任务：拆浏览器单体状态

| ID    | 任务                                     | 当前来源                                                                  | 目标边界                    | 完成标准                                                              |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| P0-10 | 识别 `AppViewState` 的 capability 子状态 | `ui/src/ui/app-view-state.ts`                                             | segmented state descriptors | 至少拆出 gateway/config/channels/chat/sessions/workbench 六类状态定义 |
| P0-11 | 建立 workbench 专属 state adapter        | `ui/src/ui/app-port-state.ts`, `ui/src/ui/ports/employee/render-model.ts` | employee port state adapter | employee workbench 不再直接吃整个 `AppViewState`                      |
| P0-12 | 建立 console/control 专属 state adapter  | `ui/src/ui/app-render.ts`                                                 | console port state adapter  | control/console tab 不再依赖整个 app 全量状态                         |

## 6.4 P1 任务：巩固新工作台为真正的新系统

| ID   | 任务                                                                 | 当前来源                                                                                           | 目标边界                         | 完成标准                                                                     |
| ---- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| P1-1 | 把 employee workbench 的读模型依赖收口到明确接口                     | `ui/src/ui/ports/employee/render-model.ts`                                                         | employee read-model contract     | 不再从 `AppPortState` 直接抽大量字段拼装                                     |
| P1-2 | 审查 `ui/src/ui/data/**` 与 `ui/src/ui/ports/employee/**` 的职责边界 | `ui/src/ui/data/frontstage-*`, `ui/src/ui/ports/employee/**`                                       | stable workbench boundary        | session/contact/group 派生仍在 data 层，employee 专属逻辑留在 ports/employee |
| P1-3 | 为 workbench 引入后端优先的团队/空间领域模型方案                     | `ui/src/ui/storage.ts`, `ui/src/ui/ports/employee/**`                                              | future workspace domain contract | 确认哪些对象仍是 UI 临时对象，哪些应转为后台/能力层对象                      |
| P1-4 | 将 collaboration UI 全量对齐现有 collaboration packages              | `ui/src/ui/controllers/collaboration-*`, `ui/src/ui/ports/employee/**`, `packages/collaboration-*` | collaboration domain-backed UI   | collaboration 读模型和动作不绕过已有 core/runtime/adapter 包                 |

## 6.5 P1 任务：管理混淆入口和命名

| ID   | 任务                                 | 当前来源                                                                | 目标边界               | 完成标准                                                                    |
| ---- | ------------------------------------ | ----------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| P1-5 | 建立浏览器入口命名矩阵               | `docs/web/*.md`, `src/commands/dashboard.ts`, `ui/src/ui/navigation.ts` | product naming map     | 明确 dashboard / control UI / workbench / webchat / canvas 的保留词与淘汰词 |
| P1-6 | 梳理浏览器路由层的产品命名           | `ui/src/ui/navigation.ts`, `ui/src/ui/views/control-center.ts`          | OpenBot IA             | 明确哪些 route 属于 OpenBot 产品面，哪些属于系统控制面                      |
| P1-7 | 制定 dashboard/control UI 的更名策略 | `src/commands/dashboard.ts`, `docs/web/dashboard.md`                    | stable external naming | 明确 CLI 是否保留 `dashboard` 命令名、UI 内是否继续展示 Control UI 术语     |

## 6.6 P1 任务：Legacy native UI 退场准备

| ID    | 任务                                                    | 当前来源                                                                                        | 目标边界               | 完成标准                                                       |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| P1-8  | 盘点 iOS 旧壳层入口依赖                                 | `apps/ios/Sources/RootCanvas.swift`, `apps/ios/Sources/RootTabs.swift`                          | legacy shell inventory | 明确 onboarding/settings/chat/quick setup 各自是否已有新承接面 |
| P1-9  | 盘点 macOS 旧壳层入口依赖                               | `apps/macos/Sources/OpenBot/MenuContentView.swift`, `apps/macos/Sources/OpenBot/AppState.swift` | legacy shell inventory | 明确 dashboard/chat/canvas/settings 的入口迁移顺序             |
| P1-10 | 定义 native 旧壳层的 feature flag / build flag 退场机制 | `apps/ios`, `apps/macos`                                                                        | legacy isolation plan  | legacy shell 能被控制为默认非主入口                            |

## 6.7 P2 任务：对齐跨端能力层

| ID   | 任务                                                 | 当前来源                                                                                         | 目标边界                          | 完成标准                                     |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------- |
| P2-1 | 为 native 与 browser 明确共享 capability contract    | `apps/shared/OpenBotKit/**`, `apps/macos/Sources/OpenBotProtocol/**`, `ui/src/ui/capability/**`  | cross-surface capability contract | browser/native 不再各自扩写同一能力语义      |
| P2-2 | 识别哪些 legacy store 可下沉为 adapter               | `apps/macos/Sources/OpenBot/ConfigStore.swift`, `apps/macos/Sources/OpenBot/ChannelsStore.swift` | adapter layer                     | store 仍可复用，但不再被 UI 直接引用         |
| P2-3 | 识别哪些 native runtime 必须保留为 host-only service | `apps/ios/Sources/Model/NodeAppModel.swift`, `apps/macos/Sources/OpenBot/AppState.swift`         | host runtime services             | 只保留宿主专属职责，不继续承担产品语义层职责 |

## 7. 推荐执行顺序

基于当前现状，推荐顺序如下：

1. P0-1 ~ P0-4
   先冻结边界，避免继续变乱。
2. P0-5 ~ P0-12
   先从浏览器 UI 的 controller/state 层抽 capability。
3. P1-1 ~ P1-4
   把 workbench 真正巩固为新系统主载体。
4. P1-5 ~ P1-7
   再收口命名与入口，解决产品混淆。
5. P1-8 ~ P1-10
   在有替代入口后，再推动 native legacy 壳层退场。
6. P2-1 ~ P2-3
   最后做跨端 contract 收口与 host runtime 收敛。

## 8. 第一批应该立即落地的具体工作项

如果下一步要开始真正实施，而不是继续讨论，建议第一批只做以下五项：

1. 建一份“产品入口矩阵”
   目标：把 dashboard / control / workbench / webchat / canvas / native menu/chat/settings 的入口统一列清。

2. 在 `ui/` 下引入第一批 capability 目录
   目标：先落空壳和命名，不急着一次完成全部逻辑迁移。

3. 先迁 `config` 和 `channels`
   原因：它们最像独立能力，风险比 chat/workbench 低。

4. 建 `AppViewState` 拆分方案
   目标：明确哪些状态归 capability，哪些归 workbench，哪些仍归 app shell。

5. 给 legacy native UI 加“冻结约束说明”
   目标：阻止后续继续把新功能加回旧壳层。

## 9. 复核问题

每次实施前后，都应回答以下问题：

1. 当前变更是在扩展新边界，还是在继续喂大旧壳层？
2. 当前变更是在减少 `AppViewState` 的职责，还是在继续堆字段？
3. 当前变更是在沉淀 capability facade，还是只是换个文件继续直连 RPC？
4. 当前变更是否继续扩大了本地 UI 业务对象的存储范围？
5. 当前变更是否让用户入口和命名更统一，而不是更混乱？

## 10. 最终判断

基于当前代码现状，下一阶段正确的执行重点不是“删旧页面”，而是：

1. 先把 `ui/` 明确为新系统主前端。
2. 先把 `ui/` 里的 controller/state 抽成正式 capability 边界。
3. 先让 workbench 脱离单体状态与通用快照拼装。
4. 再推动 native legacy UI 从产品主链路退出。
5. 最后统一命名、入口和跨端能力契约。
