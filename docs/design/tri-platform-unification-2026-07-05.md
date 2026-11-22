# 三端统一设计文档 (Tri-Platform Unification)

> **状态：修订草案** | 首次创建：2026-07-05 | 本次修订：2026-07-06（可行性评审优化 pass）| 适用范围：员工端体验统一（含现有 Device Companion 约束）
>
> **本次优化 pass 摘要（2026-07-06）**：基于对仓库现状的逐条代码核对，本轮做了以下加固：
> (1) 把「原生员工身份 + web bootstrap 会话」明确为**全案关键路径**，而非只是 WebView 接入的一个子步骤；
> (2) 重写 §5.4，补齐 bootstrap token 的**开放重定向防护**、**token 生命周期（过期/刷新/登出传播）**、**WebView 数据存储策略**（与 Canvas 的 `.nonPersistent()` 隔离）；
> (3) §5.7 校正——tab 级子域门禁**已部分落地**（`isTabAllowedBySubdomain` 已存在），不再表述为"完全未做"；
> (4) §7.2 扩充内部命名债清单（Swift chat 类名、macOS logger subsystem、Android 主题名）；
> (5) Phase 1 增加**契约冻结测试 + embed 路由契约 + 原生桥接协议**为可交付物，并已落地对应基础模块（见 §14）。
> (6) 2026-11-02：Android `namespace` / `applicationId` 已是 `ai.openbot.app`。§3.4 / §7.2 不再把 `ai.openclaw.app` 当作现行安装身份；旧包不能覆盖升级（并列安装，需重装并重新登录）。

## 1. 背景

OpenBot 员工端 Web 已经不是“只有聊天”的早期形态，而是拥有较完整的员工工作台能力：今日日程、待处理任务、即将协作、重要通知、知识工作台、成长体系等都已经在 Web 员工端落地。

与此同时，macOS、iOS、Android 三个 native 客户端并不是同一类产品的简单“落后版本”。它们当前更接近 **node / device companion**：

- **macOS**：菜单栏常驻、Canvas/A2UI、Exec 审批、语音唤醒、全局能力较强
- **iOS**：屏幕 / 语音 / 设置分区明显，仍以 node 配对与设备能力为中心
- **Android**：Connect / Chat / Voice / Screen / Settings 结构，同样以 node 配对与设备能力为中心

因此，三端统一不能再假设“把 Web 功能搬进原生壳”就够了。真正的问题是：

1. **产品角色混杂**：员工工作台（employee shell）与设备陪伴端（device companion）尚未明确分层
2. **认证模型不一致**：Web 员工端是员工身份 / 组织视角；native 端目前主要是 node pairing / gateway pairing
3. **共享层处于半迁移状态**：Apple 共享包 product 已经是 `OpenBot*`，但 package / 工程 / 目录仍大量保留 `OpenClaw`
4. **方案与现状脱节**：文档原版低估了 Web / Gateway 已有能力，也高估了“新增统一 API”的必要性

本文档的目标不是输出一个“理想化终态图”，而是定义一条 **贴近当前仓库实现、可逐步交付、不会破坏既有 node 能力** 的统一路线。

## 2. 本文结论先行

本次修订后的核心结论如下：

1. **员工端统一必须拆成两个角色**
   - `Employee Workspace Shell`：员工登录后的工作台
   - `Device Companion / Node Runtime`：设备能力、配对、语音、屏幕、相机、后台能力
2. **短期不应强行把现有 iOS / Android / macOS 直接改造成纯员工端 App**
   - 否则会直接回归掉现有 node / canvas / voice / pairing 能力
3. **Gateway 的员工端 read-model 已经足够作为 v1 基线**
   - 应优先复用现有 `workbench.*`、`collaboration.spaces.*`、`knowledge.*`、`chat.*` 契约
   - 不应先重造一套 `daily-overview:*` / `workspace:*` 事件命名空间
4. **WebView 策略应分成两类容器**
   - 现有 `Canvas / A2UI WebView`：继续服务 node / agent-driven surface
   - 新增 `Employee Shell WebView`：承载员工工作台嵌入页面
5. **品牌统一要分“用户可见统一”与“内部命名债清理”两步**
   - 短期先统一用户可见品牌
   - 中期再收敛 package / target / path / storage / log category 等内部遗留

> **关键路径提示（本轮优化新增）**：以上 5 条里，真正的工程难点与依赖瓶颈**不是** WebView 本身，而是
> **原生「员工身份」+ web bootstrap 会话**这条新链路（服务端 + iOS + Android + macOS 都要动）。代码核对表明：
> Gateway 已有员工 actor/会话概念（`resolveEmployeeWorkbenchActor` + actor 作用域方法），但**原生端没有任何登录面**，
> `/native/bootstrap` 一次性 token → HttpOnly session 流程也**尚不存在**。因此本文把它从“Phase 2 的一个步骤”
> **提级为 Phase 0 必须先定案、Phase 1 必须先落地的主干**（详见 §5.3 / §5.4 / §9）。WebView 容器接入相对是“体力活”，
> 身份与会话模型才是“设计活”。

## 3. 当前事实（以仓库 2026-07-06 现状为准）

### 3.1 Web 员工端已具备的能力

当前 Web 员工端已经存在以下稳定构件：

- **工作台概览信号卡**
  - 今日日程
  - 待处理任务
  - 即将协作
  - 重要通知
- **工作台导航模型**
  - Assistant
  - Collaboration / Spaces
  - Tasks
  - Knowledge
  - Settings
- **知识工作台**
  - Knowledge workspace / library / governance / deliverables 等大块能力已存在
- **成长体系**
  - Growth badge
  - Growth prelude
  - Growth report / evolution summary
- **子域路由基础**
  - `gw.openbot.love`
  - `biz.openbot.love`
  - `admin.openbot.love`
  - 根路径默认落点已接入

这意味着“员工端功能基线”并不是从零开始定义，而是 **已经有一套 Web-first 的既有现实**。

### 3.2 Gateway 已具备的员工端 read-model

当前 Gateway 里已存在、可直接作为员工端共享契约 v1 的接口包括：

- `workbench.pending-tasks.list`
- `workbench.notices.list`
- `workbench.upcoming-collaboration.list`
- `workbench.schedule.list`
- `workbench.steward-suggestion.get`
- `collaboration.spaces.list`
- `knowledge.*`
- `chat.*`
- `sessions.list`
- `agents.list`

其中，`workbench.*` 已经是 **actor-scoped、员工安全的 read-model**，并不是全局平台态数据。

### 3.3 macOS / iOS / Android 当前定位

| 平台    | 当前定位              | 主要入口形态                               | 现状判断                         |
| ------- | --------------------- | ------------------------------------------ | -------------------------------- |
| Web     | 员工工作台主端        | Sidebar / Workbench                        | 已是员工端主实现                 |
| macOS   | 组合型 companion      | Menu bar + Canvas + native chat            | 最接近“员工壳 + companion”混合体 |
| iOS     | node / companion 优先 | Screen / Voice / Settings + Chat sheet     | 不是员工工作台主壳               |
| Android | node / companion 优先 | Connect / Chat / Voice / Screen / Settings | 不是员工工作台主壳               |

### 3.4 当前品牌状态不是“未开始”，而是“半迁移”

| 维度                             | 当前状态                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- |
| iOS 显示名                       | 已显示为 OpenBot                                                              |
| iOS project / scheme / target 名 | 大量仍为 OpenClaw                                                             |
| iOS bundle 前缀                  | 已是 `ai.openbot.*`                                                           |
| Android app label                | `OpenBot Node`                                                                |
| Android package / namespace      | 现行 `ai.openbot.app`（2026-07 草稿曾记 `ai.openclaw.app`；旧包不能覆盖升级） |
| macOS App 名                     | 已是 OpenBot                                                                  |
| Apple shared package products    | 已是 `OpenBotProtocol` / `OpenBotKit` / `OpenBotChatUI`                       |
| Apple shared package name / path | 已为 `OpenBotKit`                                                             |

### 3.5 当前平台基线

| 平台    | 当前基线                     |
| ------- | ---------------------------- |
| iOS     | deployment target `iOS 18.0` |
| Android | `minSdk 31`                  |
| macOS   | `macOS 15`                   |

因此，原版方案中“Android 7+ 降级策略”这类假设已不再适用。

## 4. 设计目标（修订后）

### 4.1 目标

1. **统一员工工作台体验**
   - 让 Web、macOS、iOS、Android 都能进入同一套员工工作台能力模型
2. **保留并稳定设备陪伴能力**
   - 不牺牲现有配对、语音、屏幕、相机、后台能力
3. **统一品牌呈现**
   - 对用户可见层统一为 OpenBot
4. **减少重复实现**
   - 优先复用现有 Web workbench 和 Gateway read-model
5. **定义可执行迁移路径**
   - 每一阶段都能独立交付，不依赖“大爆炸式重写”

### 4.2 非目标

本轮统一 **不包括**：

- 为企业端 `biz.openbot.love` 单独开发 iOS / Android / macOS 原生客户端
- 为平台端 `admin.openbot.love` 单独开发原生客户端
- 在本轮内引入 React Native / Flutter / Kotlin Multiplatform / Tauri 之类的新跨端框架
- 在没有完成身份模型设计前，直接把原生 app 的首页整体替换成 WebView
- 把 bundle ID / package name 大迁移与员工端统一强绑定

## 5. 核心设计决策

### 5.1 先明确两个产品角色

#### A. Employee Workspace Shell

面向“员工登录后要完成工作”的主工作台，能力包括：

- Overview / Daily signals
- Assistant / Chat continuity
- Workspace / Collaboration
- Knowledge workspace
- Growth
- Personal settings

#### B. Device Companion / Node Runtime

面向“把设备能力接入 OpenBot 系统”的陪伴端，能力包括：

- Gateway pairing
- Node identity / auth
- Voice wake / Talk
- Screen / Canvas / A2UI
- Camera / location / motion / contacts / calendar / reminders / photos
- Push / Live Activity / Watch / background services
- Exec approvals（macOS）

#### 结论

三端统一不是“把 B 删除，只保留 A”，而是 **把 A 与 B 从概念上拆清楚，再决定一个平台上是否同包共存**。

### 5.2 近期产品形态建议

#### Web

- 继续作为 `Employee Workspace Shell` 的主实现
- 不承担 device companion 职责

#### macOS

- 继续保留单包混合形态
- 但在架构上拆成两个 surface：
  - `Employee Shell`
  - `Device Companion`

#### iOS / Android

- 近期保留单包策略
- 但不再把现有 node-first 壳直接等同于员工端
- 应逐步引入一个 **新的 Employee Shell surface**
- 现有 Connect / Voice / Screen / Device 设置，继续作为 companion surface 保留

### 5.3 原生 App 的身份模型必须双轨

这是原版方案缺失最关键的一块。

native App 后续需要同时处理两种身份：

1. **Employee Identity**
   - 员工登录态
   - 用于进入 `gw.openbot.love` 员工工作台
   - 访问员工作用域的 `workbench.*` / `knowledge.*` / `collaboration.*`
2. **Node Identity**
   - 设备配对身份
   - 用于 node capability、设备指令、屏幕 / 相机 / 语音 / 后台能力

这两者不能继续混用，也不能默认“有 node pairing 就等价于员工已登录”。

### 5.4 WebView 认证策略：不建议直接写死“注入 cookie”

原版方案里“App 将 session token 注入 WebView cookie/header”过于轻描淡写。

修订建议：

1. Native 先建立 **Employee Identity**
2. Native 向后端请求一次性 **web bootstrap token**
3. WebView 首次打开受控路由，例如：
   - `/native/bootstrap?token=...&target=/embed/employee/overview`
4. 服务端完成：
   - token 校验（一次性、短 TTL、绑定设备/员工）
   - 建立 HttpOnly session cookie
   - 跳转到最终 employee shell 页面

这样可以避免：

- 直接把长期 session 暴露给原生侧手工写 cookie
- 把当前 node/canvas WebView 的非持久会话策略打乱
- iOS / Android / macOS 各自发明一套不同的 cookie 注入逻辑

#### 5.4.1 `target` 必须做开放重定向防护（本轮新增，安全要点）

`/native/bootstrap?...&target=...` 里的 `target` 是**外部可控输入**，若不校验会变成开放重定向 / 会话劫持面。约束：

- `target` 只接受**站内相对路径**，且必须匹配白名单前缀 `^/embed/employee/<surface>`；
- 拒绝一切绝对 URL、协议相对地址（`//host`）、含 scheme（`javascript:` / `data:` / `http(s):`）、含 `\\` 或编码绕过的输入；
- 校验失败时**回退到默认 surface**（`/embed/employee/overview`），不透传原始输入。
- 该校验已在前端契约层实现（见 §14 的 `parseNativeBootstrapPath` / `isSafeEmbedTarget`），服务端 `/native/bootstrap` 落地时**必须再校验一次**（不信任前端）。

#### 5.4.2 Token 生命周期（本轮新增）

原版只说“建立 session cookie”，但没定义过期与联动，补齐：

- **bootstrap token**：一次性、短 TTL（建议 ≤ 60s），用后即焚；
- **session cookie**：HttpOnly + Secure + SameSite，设可控有效期；过期后 WebView 收到 401 → 触发**静默 re-bootstrap**（原生用 Employee Identity 重新换一次性 token），失败才提示重新登录；
- **登出传播**：原生侧登出 Employee Identity 时，必须使 WebView 的 session cookie 一并失效（清 cookie + 服务端吊销），避免“原生已登出、WebView 仍在线”的悬挂态；
- **与 Node Identity 解耦**：Employee session 过期/登出**不得**影响 node pairing 会话，反之亦然。

#### 5.4.3 WebView 数据存储策略（本轮新增）

代码核对发现 iOS 现有 Canvas WebView 使用 `.nonPersistent()` 数据存储（`apps/ios/Sources/Screen/ScreenWebView.swift`）——这正是**不能复用它承载员工 shell** 的硬理由（员工登录态需要可控持久化）。因此：

- Employee Shell WebView 使用**独立、持久（或可 bootstrap 刷新）的数据存储**，与 Canvas 的 `.nonPersistent()` 完全隔离；
- iOS：独立 `WKWebsiteDataStore`（非 `.nonPersistent()`），或 App 侧托管 cookie 注入受控 store；
- Android：`CookieManager` 按 employee shell WebView 实例隔离，避免与 canvas WebView 串味；
- macOS：employee shell 走独立 `WKWebView` + 独立 data store，不复用 `CanvasWindowController` 的 configuration。

### 5.5 共享契约策略：先冻结现有 contract，再补缺口

本轮不建议先发明全新的：

- `daily-overview:sync`
- `workspace:tasks`
- `workspace:knowledge`
- `growth:*` push 事件

应先把现有 contract 明确为 v1 基线：

#### 概览 / Daily signals

- `workbench.pending-tasks.list`
- `workbench.notices.list`
- `workbench.upcoming-collaboration.list`
- `workbench.schedule.list`
- `workbench.steward-suggestion.get`

#### 协作空间

- `collaboration.spaces.list`
- 现有 space 成员 / reset / dissolve / leave / growth 状态接口

#### 知识工作台

- 现有 `knowledge.*` 与 `knowledge.base.*` / `knowledge.deliverables.*` / `knowledge.governance.*`

#### 助手 / 会话

- `chat.*`
- `sessions.list`
- `sessions.patch`
- `agents.list`

#### 原则

- **先复用 RPC read-model**
- **只有在 native 端确实需要实时推送、且轮询/refresh 不够时，才新增 push 事件**

### 5.6 UI 实现策略：Employee Shell WebView 与 Canvas WebView 分离

原版方案将 macOS 现有 Canvas WebView 视为“员工端 WebView 嵌入验证”，这个判断不准确。

当前 Canvas/A2UI WebView 的职责是：

- agent-driven canvas
- local scaffold
- local-network / advertised host
- A2UI bridge

它不是员工工作台嵌入容器。

因此修订后的策略是：

#### 保留现有 Canvas WebView

继续服务于：

- canvas
- a2ui
- node-driven screen surface

#### 新增 Employee Shell WebView

专门服务于：

- overview
- workspace
- growth
- knowledge workspace（必要时）

#### Chat 策略

- **移动端与 Apple 侧原生 chat 继续保留**
- 员工 shell 中点击“打开会话 / 打开助手”时，跳转到 native chat surface
- 不在本阶段把 chat 也强制改成 WebView

这样可以最大化复用现有投资：

- iOS Apple shared chat
- Android native chat
- macOS native chat / chat window

### 5.7 子域路由：认定为“部分落地”，不是“已完成”

当前已落地的部分：

- `gw` / `biz` / `admin` → port 映射（`ui/src/ui/routing/subdomain-resolver.ts`）
- `www` / 裸域 → public home
- 根路径默认落到对应 port 默认 tab（`defaultTabForSubdomain` / `defaultTabForPort`）
- **tab 级门禁原语已存在**：`isTabAllowedBySubdomain(tab, host)` 已实现（`ui/src/ui/navigation.ts`），可判断某 tab 是否属于当前子域锁定的 port

当前尚未认定为完成的部分：

- 全站 tab 级别的 subdomain hard lock **强制执行**（原语已有，但尚未在所有导航/深链入口统一 enforce；这是"接线"而非"造轮子"）
- 员工端嵌入路由独立化（`/embed/employee/*`，本轮新增契约层见 §14）
- 原生壳跨 subdomain / 跨 port 导航规范

因此，本文将其视为：

- **已可复用的基础设施**
- **但不是可以直接宣告完工的最终路由体系**

## 6. 目标信息架构

### 6.1 终态信息架构（Employee Shell）

#### 桌面 / Web

Sidebar:

- Overview
- Assistant
- Workspace
- Knowledge
- Me

#### 移动端

底部主导航建议以 Employee Shell 为中心：

- Overview
- Assistant
- Workspace
- Me

### 6.2 Companion 能力入口

device companion 能力不应被删除，而应在迁移期明确收纳：

#### 桌面

- 菜单栏
- Device / Runtime / Permissions / Voice / Screen 独立入口

#### 移动端

迁移期建议保留一个明确入口承载 companion 能力，例如：

- `Device Center`
- 或 `Me > Device`

其内部承载：

- Connect / pairing
- Screen
- Voice
- Permissions
- Device settings

### 6.3 迁移期 IA 与终态 IA 不必一次重合

这点很重要：

- **迁移期**：允许 iOS / Android / macOS 暂时共存旧 companion IA 与新 employee shell IA
- **终态**：再逐步收口到统一结构

不要把“目标导航美观”置于“能力不回归”之上。

## 7. 品牌统一策略（修订版）

### 7.1 用户可见层优先统一

本轮优先确保以下全部对外显示为 OpenBot：

- App 名称
- 图标
- 启动页
- 应用内品牌文案
- README / 构建指引里的用户可见命令与描述

### 7.2 内部命名债单独治理

以下属于“内部命名债”，应分批治理，不与 UI 改版强绑定（括号内为代码核对到的定位）：

- `OpenClaw` project / scheme / target（`apps/ios/OpenClaw.xcodeproj`）
- `OpenBotKit` package name / path（`apps/shared/OpenBotKit/Package.swift`；产物已是 `OpenBotProtocol` / `OpenBotKit` / `OpenBotChatUI`，包目录与引用已统一为 `OpenBotKit`）
- Android package / namespace **已是** `ai.openbot.app`（`apps/android/app/build.gradle.kts` 的 `namespace` / `applicationId`），不再当作待改包名。2026-07 草稿写作 `ai.openclaw.app`；旧包不能覆盖升级到现行包（并列安装，需重装并重新登录，无跨包数据迁移）。
- **Swift chat 类名仍是 `OpenClawChatView` / `OpenClawChatViewModel`**（在 `OpenBotChatUI` 模块内——模块已正名、类名未正名；iOS `apps/ios/Sources/Chat/ChatSheet.swift`、macOS `apps/macos/Sources/OpenBot/WebChatSwiftUI.swift` 都在消费）
- **Android 主题名 `Theme.OpenClawNode`**（`apps/android/app/src/main/AndroidManifest.xml`；注意 app label 已是 `OpenBot Node`、APK 产物已是 `openbot-*.apk`，属"半迁移"典型）
- **macOS logger subsystem `ai.openclaw`**（如 `apps/macos/Sources/OpenBot/CanvasManager.swift`；chat 侧 subsystem 已是 `ai.openbot`，两者混用）
- 存储目录中的 `OpenClaw`
- log category / defaults key / temp file prefix 中的 `openclaw`

> 治理提示：以上多为**用户不可见但会拖后腿**的债；rename 会牵动构建/签名/脚本/存储路径，务必按 §7.3 与 UI 改版解耦、分批推进。

### 7.3 Bundle ID / package name 不作为本方案前置条件

原版方案将：

- iOS Bundle ID → `love.openbot.employee`
- Android Package → `love.openbot.employee`

作为目标，但这会触发：

- App Store / Play Store 新应用或迁移策略
- 本地数据迁移
- 签名 / provisioning / 分发链路重建

修订建议：

- **本方案不强制要求在同一期完成 ID 切换**
- 将其拆成单独的发布/运维决策
- 先完成用户可见品牌统一与员工 shell 能力接入

## 8. 技术架构（修订版）

### 8.1 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                        Gateway (Node.js)                    │
│  Employee read-models · Chat · Collaboration · Knowledge   │
│  + Node/device runtime · Pairing · Canvas/A2UI · Push      │
└────────────┬───────────────────────┬───────────────────────┘
             │                       │
   ┌─────────┴─────────┐   ┌─────────┴─────────────────────┐
   │ Employee Shell     │   │ Device Companion / Node Runtime│
   │ Web SPA / Embed    │   │ Native-only capabilities       │
   └──────┬─────────────┘   └──────────────┬────────────────┘
          │                                 │
   ┌──────┴──────┐                  ┌───────┴────────┐
   │ macOS App   │                  │ iOS/Android App │
   │ Hybrid      │                  │ Hybrid          │
   │ - Employee  │                  │ - Employee      │
   │ - Companion │                  │ - Companion     │
   └─────────────┘                  └─────────────────┘
```

### 8.2 原则

1. **Gateway 仍是唯一事实来源**
2. **Employee Shell 与 Node Runtime 分层**
3. **Web-first UI 复用，但 chat / device surfaces 不强制 Web 化**
4. **现有 native canvas 容器不直接承担 employee shell**

### 8.3 Apple 共享层策略

当前 Apple 侧有可复用共享层：

- `OpenBotProtocol`
- `OpenBotKit`
- `OpenBotChatUI`

package 已改名为 `OpenBotKit`。

修订建议：

- 本轮继续复用现有 shared package
- 先新增 employee shell 容器与导航整合
- package rename 放到单独重命名阶段处理

### 8.4 Android 共享层策略

Android 当前仍是独立 Kotlin 实现。

本轮建议：

- 继续使用 Kotlin 本地实现 native chat / companion
- 对 employee shell 通过 WebView 复用 Web UI
- 如果后续 contract 维护成本升高，再评估 JSON schema / codegen，而不是现在就引入 KMP

## 9. 分阶段实施路线图

## Phase 0：现状对齐与决策冻结（1 周）

目标：避免后续路线建立在错误前提上。

- [ ] 冻结角色划分：Employee Shell vs Device Companion
- [ ] 输出 native 双身份模型（employee auth / node pairing）说明
- [ ] 完成品牌 / target / package / path 的 rename inventory
- [ ] 列出 Web employee shell 可嵌入页面清单
- [ ] 确认 iOS / Android / macOS 当前 companion 能力不可回归清单

验收：

- 团队对“不是直接替换 node app”为共识
- 认证与嵌入策略得到确认

## Phase 1：契约冻结与可嵌入页面抽取（2-3 周）

目标：先让 Web / Gateway 成为稳定平台底座。

契约层（已落地，见 §14）：

- [x] 将现有 `workbench.*` 视为 employee overview v1 contract，并以**冻结测试**守护（`src/gateway/employee-shell/contract-baseline.ts` + 测试）
- [x] 定义 employee embed routes 契约（build/parse/validate + `/native/bootstrap` 开放重定向防护）：`ui/src/ui/employee-shell/embed-routes.ts`
  - `/embed/employee/overview`
  - `/embed/employee/workspace`
  - `/embed/employee/growth`
- [x] 定义 employee shell bridge schema（版本化 + 严格校验不可信输入）：`ui/src/ui/employee-shell/native-bridge.ts`
  - openChat / openAssistant / openSpace / openKnowledgeObject / openDeviceSettings（+ `ready` 握手）
- [x] 增加 contract / route / bridge smoke tests（三个模块均带 colocated 测试）

渲染与文档（待办）：

- [ ] 梳理并补齐 collaboration / knowledge / growth 所需 contract 文档
- [ ] **确认并实现 SPA 的 embed 渲染模式**：能脱离整体 app shell（sidebar/cross-port context）单独渲染一个 employee surface —— 这是本 Phase 真正的实现风险点，而非契约本身
- [ ] 把 embed 路由接入 `app.ts` 的路由/bootstrap 管线（history/hash 路由已存在）

验收：

- 浏览器直接访问 embed route 可稳定渲染（chrome-less）
- 无需新造 `daily-overview:*` 事件即可驱动 v1 页面
- 契约冻结测试通过：`workbench.*` v1 方法仍注册且 employee 自作用域

## Phase 2：Employee Shell 容器接入（2-4 周）

目标：在不破坏 companion 的前提下，把员工工作台真正带入原生端。

### macOS

- [ ] 新增 employee shell WebView 容器
- [ ] 与现有 CanvasWindowController 分离，不共用职责
- [ ] 支持从 employee shell 打开 native chat / settings / companion entry

### iOS

- [ ] 新增 WKWebView employee shell 容器
- [ ] 保留现有 canvas/screen WebView，不混用
- [ ] 建立 native auth bootstrap → employee shell 登录流程

### Android

- [ ] 新增 employee shell WebView 容器
- [ ] 保留现有 `CanvasScreen`
- [ ] 建立 native auth bootstrap → employee shell 登录流程

验收：

- 三端都能进入 employee shell overview / workspace
- 现有 companion 能力不回归

## Phase 3：Chat / Session / Agent 连续性（2-3 周）

目标：让“员工工作台”和“原生会话能力”真正连起来。

- [ ] Web employee shell 中“打开会话”跳到 native chat
- [ ] 统一 sessionKey / active agent 解析规则
- [ ] 补齐移动端 agent picker parity
- [ ] 补齐会话连续性验证
  - Web 发起
  - iOS 继续
  - Android 继续
  - macOS 继续
- [ ] 评估并补通“通用文件附件”缺口
  - 当前图片附件保留
  - 文件类附件单列为增量需求

验收：

- 用户可从 employee shell 打开正确的 native conversation
- 多端会话延续可用

## Phase 4：导航统一与品牌收口（2-4 周）

目标：统一用户感知，而不是仅统一内部实现。

- [ ] 三端统一 employee shell 导航文案
- [ ] 明确 companion 入口在各端的最终安放位置
- [ ] 清理剩余 OpenClaw 用户可见文案
- [ ] README / release / onboarding 指引统一 OpenBot 表达
- [ ] 评估是否进入内部命名债清理
  - iOS project / scheme rename
  - `OpenBotKit` package rename (done)
  - Android package rename

验收：

- 对用户可见层基本完成 OpenBot 统一
- IA 能被跨端映射理解

## Phase 5：稳定性与发布硬化（持续）

- [ ] Accessibility 对齐
- [ ] 深色模式对齐
- [ ] WebView 安全审计
- [ ] 启动性能与首屏性能基线
- [ ] 弱网 / 断网占位与恢复
- [ ] Companion capability 回归测试

## 10. 验收标准（修订版）

### 10.1 员工工作台统一

- Web、macOS、iOS、Android 都可进入 employee shell
- Overview / Workspace / Knowledge / Growth 至少具备 v1 统一入口
- 同一员工身份在多端看到一致的 workbench read-model

### 10.2 会话连续性

- Web 发起的会话可在 native chat 继续
- native chat 中的 active agent / session 与 employee shell 能对应

### 10.3 Companion 不回归

- iOS / Android 配对流程仍可用
- Screen / Voice / Device capabilities 仍可用
- macOS Canvas / Exec approvals / voice wake 仍可用

### 10.4 品牌统一

- 对用户可见名称、图标、启动页、主要文案统一为 OpenBot

## 11. 风险与约束（修订版）

| 风险                                  | 影响                                     | 缓解                                              |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| 员工身份与 node 身份混淆              | 登录态、权限、数据作用域出错             | 先冻结双身份模型，再接 WebView                    |
| 直接复用现有 Canvas WebView           | employee shell 与 A2UI/Canvas 职责冲突   | 新建 employee shell 容器，保留旧 canvas 容器      |
| 品牌改名与内部命名债一次性硬改        | 构建链、签名、脚本、存储路径大面积受影响 | 用户可见统一先行，内部 rename 分阶段              |
| iOS / Android 直接重做首页            | companion 能力回归                       | 迁移期保留旧 surface，并行接入 employee shell     |
| Android WebView 性能 / 生命周期复杂度 | 体验不稳                                 | employee shell 页面最小化、弱网占位、本地恢复策略 |
| Bundle ID / package name 强绑本期     | 发布与数据迁移复杂化                     | 作为独立 release / store 决策，不前置             |

> **本轮新增风险（可行性评审补充）**
>
> - **bootstrap `target` 未校验 → 开放重定向 / 会话劫持**：站内相对路径白名单 + 前后端双重校验（§5.4.1，契约层已实现 `isSafeEmbedTarget`）。
> - **token / session 生命周期未定义 → 悬挂登录态、原生登出后 WebView 仍在线**：短 TTL 一次性 token + 401 静默 re-bootstrap + 登出双向失效（§5.4.2）。
> - **SPA 无法 chrome-less 渲染单 surface → Phase 1 embed 目标落空**：先做 embed 渲染模式 spike，确认 port shell 可脱壳独立渲染，再接原生。
> - **时间线偏乐观（web+gateway+三端+契约）→ Phase 2/3 被压缩**：三容器 / 跨端会话连续性各自留出比当前更宽排期；每 Phase 独立可交付。

## 12. 待决问题

以下问题需要在 Phase 0 结束前定案（第 1 条已提级为全案地基，见 §2 关键路径提示）：

1. iOS / Android employee shell 是否要求独立登录，而不是复用 gateway pairing
2. 移动端 companion 入口最终是顶层 Tab，还是 `Me > Device`
3. macOS employee shell 是新窗口、侧栏内嵌，还是沿用已有主窗口体系
4. Bundle ID / package rename 是否进入本轮，还是延后到发布期
5. employee shell 的文件上传策略是否一期只支持图片，二期补通用文件

## 13. 相关文档

- `docs/design/platform-ui-spec.md`
- `docs/design/platform-dead-code-consolidated-2026-06-15.md`
- `apps/ios/README.md`
- `apps/android/README.md`
- `docs/platforms/mac/release.md`
- `docs/design/platform-pricing-tiers-2026-06-16.md`

## 14. 实施状态（Phase 1 契约层已落地）

> 本节记录已随本轮优化落地的**契约层**代码，作为后续 Phase 1 渲染接入 / Phase 2 原生容器的稳定底座。均为**新增文件、strict TS、带 colocated 测试**，不改动现有渲染管线 / 原生代码 / gateway 认证，因此对 companion 能力零回归风险。

### 14.1 Web 侧（`ui` 包）

- `ui/src/ui/employee-shell/embed-routes.ts` —— employee embed 路由契约
  - `EMPLOYEE_EMBED_SURFACES`（`overview` / `workspace` / `knowledge` / `growth` / `me`；chat 不入 embed，走 bridge）
  - `buildEmployeeEmbedPath` / `parseEmployeeEmbedPath` / `defaultEmployeeEmbedPath`
  - `isSafeEmbedTarget` / `safeEmbedTargetOrDefault` —— **开放重定向防护**（拒绝协议相对、scheme、控制字符、`..`、非白名单路径）
  - `buildNativeBootstrapPath` / `parseNativeBootstrapPath` —— `/native/bootstrap` token+target 构造/解析，unsafe target 自动降级默认 surface 并标记 `targetWasRejected`
  - 测试：`ui/src/ui/employee-shell/embed-routes.node.test.ts`
- `ui/src/ui/employee-shell/native-bridge.ts` —— 员工 shell ↔ 原生宿主 桥接协议（版本化）
  - `EMPLOYEE_SHELL_BRIDGE_VERSION`、消息类型 `ready` / `openChat` / `openAssistant` / `openSpace` / `openKnowledgeObject` / `openDeviceSettings`
  - `parseEmployeeShellBridgeMessage` / `parseEmployeeShellBridgeJSON` —— **严格校验不可信输入**（拒绝未知类型/版本、缺失必填、字段类型错误）
  - 类型化构造器（`openSpaceMessage` 等）+ `serializeEmployeeShellBridgeMessage`
  - 测试：`ui/src/ui/employee-shell/native-bridge.node.test.ts`
- `ui/src/ui/employee-shell/native-host.ts` —— 桥接协议的**运行时传输层**（让 `native-bridge.ts` 真正可用）
  - `EMPLOYEE_SHELL_HOST_HANDLER`（原生三端注册的统一 handler 名）
  - `createNativeHostTransport` / `sendToNativeHost` / `isEmbeddedInNativeShell` / `detectNativeHostKind`
  - 自动探测 WKWebView（iOS/macOS `window.webkit.messageHandlers`）与 Android（注入的 JS interface），纯 Web 环境下 `send` 为 noop 返回 false；投递前**再校验一次**并统一序列化为 JSON 字符串（两端同一 wire 格式）
  - 测试：`ui/src/ui/employee-shell/native-host.node.test.ts`（以 mock window 覆盖三种宿主）
- `ui/src/ui/employee-shell/embed-context.ts` —— embed 渲染**决策函数**（纯逻辑）
  - `resolveEmbedRenderContext(pathname)` → `{ isEmbedRoute, surface, chromeless }`；`resolveEmbedRenderContextFromLocation()`
  - 供后续 `app-render` 接线判定"是否 chrome-less + 渲染哪个 surface"，把 `/embed/employee/*` 判断收敛到一处
  - 测试：`ui/src/ui/employee-shell/embed-context.node.test.ts`
- `ui/src/ui/employee-shell/workbench-embed.ts` —— embed 路由 → 工作台**接线**（Phase 1 渲染，已落地）
  - `resolveEmployeeEmbedRouting(pathname, basePath)` → `{ surface, tab:"me", primaryModule, chromeless }`（base-path 感知）
  - `mapEmbedSurfaceToWorkbenchModule`（surface → `WorkbenchPrimaryModule`；注：`overview`/`growth` 无对应模块，回退 `assistant`——IA 待决）
  - `applyEmployeeEmbedRootClass` + `EMPLOYEE_EMBED_ROOT_CLASS`（在 document 根切换 `employee-embed` 类）
  - 测试：`ui/src/ui/employee-shell/workbench-embed.node.test.ts`
- `ui/src/ui/employee-shell/employee-embed.css` —— chrome-less 样式（`.employee-embed` 下隐藏 `.employee-workbench__sidebar` / `__header`），经 `ui/src/main.ts` 引入

### 14.2 Gateway 侧（`src` 包）

- `src/gateway/employee-shell/contract-baseline.ts` —— employee-shell v1 契约冻结清单
  - `EMPLOYEE_SHELL_WORKBENCH_V1_METHODS` / `_COLLABORATION_` / `_KNOWLEDGE_` / 合集 `EMPLOYEE_SHELL_V1_METHODS`
  - `EMPLOYEE_SHELL_DEFERRED_METHODS`（`sessions.list` / `sessions.patch` / `agents.list`：设计文档 §3.2 列为可复用，但**不在** `listGatewayMethods()` 静态注册表中，暂不纳入冻结，待确认注册路径后提级）
  - 测试：`src/gateway/employee-shell/contract-baseline.test.ts` —— 断言每个冻结方法仍在 `listGatewayMethods()` 中注册，且 `workbench.*` 个人面仍是 employee 自作用域（`getRequiredDomain` 非 `any` 且含 `employee`）

### 14.3 SPA chrome-less 渲染：已落地（低风险接线）

spike 结论：员工工作台渲染入口 `renderWorkbench`（`ui/src/ui/ports/employee/views/workbench.ts`）与
`buildEmployeeWorkbenchProps`（`ui/src/ui/ports/employee/render-model.ts`）体量极大、与完整 `AppViewState` 深度耦合，
且**工作台自身渲染 sidebar/header（即 chrome）**。因此**没有**改造这两个渲染函数（也因其在共享热区），而是走以下低风险接线：

**关键发现**：`renderApp` 已在 `tab==="me"` 时渲染员工工作台，且未知路径（含 `/embed/employee/*`）在路由层**已默认落到 `tab:"me"`**。
因此**无需改动 `app-render.ts`**（该文件当前还带其他 agent 的未提交 WIP，本轮亦避免触碰）。落地方式：

1. **路由接线（clean 文件）**：在 `ui/src/ui/app-settings.ts` 的 `syncTabWithLocation` 顶部加一段 embed 早分支——
   命中 `/embed/employee/<surface>` 时 `setTabFromRoute(host, "me")` + 设 `host.workbenchPrimaryModule = 映射模块`，
   并**提前 return 跳过 URL 改写**以保留 embed 路径；非 embed 路径行为不变。
2. **chrome 隐藏（CSS）**：同处调用 `applyEmployeeEmbedRootClass` 在 document 根切换 `employee-embed` 类，
   `employee-embed.css`（经 `main.ts` 引入）据此隐藏 sidebar/header。
3. **module 映射**：`mapEmbedSurfaceToWorkbenchModule`（见 §14.1 `workbench-embed.ts`）。

验证：`workbench-embed.node.test.ts`（7 项，纯逻辑）+ `ui/src/ui/app-settings.employee-embed.browser.test.ts`
（3 项 chromium，端到端断言 tab/module/chrome 类）+ `vite build` 通过。
（附注：`app-settings.test.ts` 有 1 项**既有** ordering 失败，与本改动无关——移除本分支后同样失败，已实测确认。）

### 14.4 尚未落地（其余承接项）

- 原生三端 employee shell WebView 容器：**骨架已落地（见 §14.6，未编译验证）**；**native 员工登录**（给 mint 提供已认证会话）仍待做——也用于把 §14.5 的 mint 主体从「web 会话」切到「native Employee Identity」
- collaboration / knowledge / growth 契约文档补齐

### 14.5 服务端 `/native/bootstrap`：已落地（mint + consume）

代码勘察确认该端点**可行**，复用现有路径：会话签发 = `establishPlatformSessionCookie`（本轮从 `createSessionAndReply`
抽出的单一签发源，`src/gateway/platform-auth/auth-helpers.ts`，HMAC 签名 HttpOnly cookie）；一次性 token 先例 =
`issueActivationCode`；路由注册 = `src/gateway/server-http.ts` 的 `requestStages[]`（置于 control-ui catch-all 之前，
自带 token 门禁、不走 gateway bearer 守卫）；员工 actor 由 `resolveEmployeeWorkbenchActor` 从「domain=employee + user=email」的会话解析。

**已落地基元（纯逻辑、带测试）：**

- `src/gateway/employee-shell/bootstrap-token-store.ts` —— 一次性 web bootstrap token 存储
  - `createBootstrapTokenStore()` → `mint(principal, ttlMs?)` / `consume(token)` / `prune` / `size`
  - 高熵随机 token，**仅存 sha256 哈希**；**单次使用**（consume 即删，杜绝重放）；TTL 默认且**上限 60s**；绑定 `{userId,userEmail,target}`
  - 内存实现（<=60s 单次 token，重启即失效为安全失败模式）；镜像 `issueActivationCode` 先例；测试 `bootstrap-token-store.test.ts`（8 项）
- `src/gateway/employee-shell/embed-target.ts` —— **服务端** redirect target 校验（不信任前端，独立再校验）
  - `isSafeEmbedTarget` / `safeEmbedTargetOrDefault` / `parseEmployeeEmbedTargetSurface`；拒绝协议相对 / scheme / 控制字符 / `\\` / `..` / 未知 surface；测试 `embed-target.test.ts`（5 项）

**已落地 HTTP 接线（`src/gateway/native-bootstrap-http.ts`，`createNativeBootstrapHttpHandler` 依赖注入、自持一个 token store）：**

- `POST /native/bootstrap/mint?target=/embed/employee/<surface>`
  - **鉴权**：调用方**现有 platform-auth 会话 cookie**（`readPlatformAuthSessionContextFromRequest`）。cookie 为 `SameSite=Lax`，跨站 POST 不带 cookie → **CSRF 安全**。
  - 用 `safeEmbedTargetOrDefault` 校验 target，`mint` 绑定 `{userId,userEmail,target}`，返回 `{ ok, token, target, bootstrapPath }`（token 仅同源可读）。
- `GET /native/bootstrap?token=...&target=...`
  - `consume(token)` → `resolveSessionContext(store, user, "employee")`（**不提权**，domain=employee）→ `establishPlatformSessionCookie` 写 HttpOnly 会话 cookie → **302** 到再校验后的 target。
  - target 优先取「安全的 URL target」，否则回退到「mint 时已校验的 target」（被篡改的 URL target 不会导致开放重定向）。
  - 无效 / 过期 / 已用 token → **401**（WebView 静默 re-bootstrap）；缺 token → 400。
  - `Referrer-Policy: no-referrer`（`setDefaultSecurityHeaders` 全局设置）避免 URL 中的 token 经 Referer 泄漏。
- 注册：`server-http.ts` 的 `native-bootstrap` stage（control-ui 之前）。

**验证：** `native-bootstrap-http.test.ts`（10 项）+ 基元测试（13 项）；platform-auth 回归 **39 项通过**（`createSessionAndReply` 抽取行为不变）；`oxlint --type-aware` / `oxfmt` / `tsgo` 对改动文件均干净。

**Native-login 后续（§14.4）：** 当前 mint 主体来自「现有 web 员工会话 cookie」（端到端可测）；native 员工登录落地后，把 mint 主体切到 native Employee Identity 即可，consume 侧不变。

### 14.6 原生三端 employee shell WebView 容器（骨架，未编译验证）

> ⚠️ **未编译验证**：本机无原生工具链（且按 AGENTS.md 不 through SSH 重建 macOS app）。以下为**贴合现有 WebView 模式的骨架**，需在 Mac / Android 上编译联调。它们**只依赖平台 SDK + 注入依赖**（不耦合无法验证的 app 内部类型），可先独立编译，再接入导航 / gateway URL / 员工会话。仓库主 `pnpm` CI 不构建原生 app（原生构建独立、需 Mac/Android 工具链），故本批文件不影响主 CI;若原生 CI 需保持绿,可在编译验证前先从 target 排除。

**落地文件（三端同构，消费 §14.5 的 `/native/bootstrap` + 步骤 1 的 `native-host.ts` handler 名 `openbotEmployeeShell`）：**

- iOS：`apps/ios/Sources/EmployeeShell/EmployeeShellWebView.swift`（`UIViewRepresentable` + Coordinator）
- macOS：`apps/macos/Sources/OpenBot/EmployeeShellWebViewController.swift`（`NSViewController`）
- Android：`apps/android/app/src/main/java/ai/openclaw/app/employeeshell/EmployeeShellWebView.kt`（`@Composable` + `AndroidView`）

**三端共同结构：**

1. **独立于 Canvas 的 WebView**：iOS/macOS 用**持久** `WKWebsiteDataStore.default()`（与 Canvas 的 `.nonPersistent()` 隔离，员工会话 cookie 可跨启动保留）;Android CookieManager 为进程级全局,靠**cookie 域**与 canvas 隔离（不同 host）,真正的按实例隔离需 `WebView.setDataDirectorySuffix`。
2. **桥接**：注册 `openbotEmployeeShell`（iOS/macOS `WKUserContentController.add(_,name:)`;Android `addJavascriptInterface(_, "openbotEmployeeShell")`）;`EmployeeShellBridge.parse` **严格解码**版本化协议(拒绝未知 version/type、缺失必填)→ 类型化 `EmployeeShellIntent`（`ready` / `openChat` / `openAssistant` / `openSpace` / `openKnowledgeObject` / `openDeviceSettings`）;Android 桥接回调经 `Handler(mainLooper)` 切主线程。
3. **bootstrap 流程**：`tokenProvider(target)` 取一次性 token → 载入 `/native/bootstrap?token=…&target=…` → 网关 302 的 `Set-Cookie` 把 HttpOnly 员工会话写入**该 WebView 自己的 cookie jar**;`EmployeeShellBootstrap.mintToken` 为 mint 调用的构件（`POST /native/bootstrap/mint?target=`，用带员工会话 cookie 的 URLSession/OkHttp）。
4. **注入依赖**：`gatewayBaseURL` + `tokenProvider` + `onIntent` 回调（+ `onBootstrapError`）;401 → 触发 re-bootstrap。

**接入步骤（每端）：**

- 把容器接入导航（新的 employee shell surface,保留现有 Connect/Voice/Screen/Canvas companion surface 不动）。
- 注入 `gatewayBaseURL`（如 `https://gw.openbot.love` 或本地 gateway http URL）。
- 实现 `tokenProvider`：调用 `EmployeeShellBootstrap.mintToken`,其 URLSession/OkHttp 需已持有员工会话 cookie —— 该 cookie 由 **native 员工登录**获得（§14.4 待做;当前网关连接用的是 node/device pairing,不含员工 web 会话)。
- 把 `onIntent` 连到原生 chat / space / knowledge / 设备设置导航（chat 保持原生,见 §5.6）。

**后续统一（可选）**：三端 `EmployeeShellBridge` / `EmployeeShellBootstrap` 目前按平台各自实现（便于独立编译）;稳定后 Swift 侧可上移到共享包 `OpenBotKit`,减少重复。

## 15. 移动端适配与页面重构（重点关注）

**前提**：移动端 employee shell 通过 WebView 复用**同一套 Web 员工端页面**，所以移动端 UX = **共享 `ui` 包的响应式/重构工作**，不是原生重写；这些改动同时惠及 Web 窄屏。

### 15.1 现状核对（证据，2026-07-06）

- **视口 meta 正确**：`width=device-width, initial-scale=1`（`ui/index.html`），但**缺 `viewport-fit=cover`**（安全区 `env()` 需要它才生效）。
- **工作台有平板/大屏手机层响应式**：`ui/src/styles/workbench.css` 26 个 `@media`，断点到 639/640px；例：知识宇宙 split/grid 在 ≤960 收单列、抽屉在 ≤640 全屏；个人设置表单在 ≤639 单列。**不是桌面独占。**
- **但没有 ≤430px 手机层**：workbench.css 最小断点是 639/640，未针对 ~390px 调密度/字号/点击区。
- **移动样式层未覆盖工作台**：`ui/src/styles/layout.mobile.css`（到 400px）只作用于**旧的通用 `.nav / .topbar / .card / .stat / .chat`** 系统，**未触及**新的 `.employee-workbench__*` 命名空间——即工作台本体不吃这层移动样式。
- **安全区未处理**：workbench.css / layout.mobile.css 中 `env(safe-area-inset-*)` 用量为 **0**；原生全屏 WebView 下内容会被刘海 / home indicator 遮挡。
- **重 hover 依赖**：workbench.css 有 **128 处 `:hover`**；触屏上要么不触发要么粘滞，需 `@media (hover: hover)` 守卫或触屏等价。

**结论：不是从零，但确实需要一轮「手机层 + embed 专项」重构。** 工作量集中在共享 `ui`。

### 15.2 embed 相对普通浏览器的假设变化

- chrome 已隐藏（sidebar/header）→ surface 需自带返回/上下文；
- 全屏、无浏览器地址栏/滚动链 → 安全区、惯性滚动、下拉刷新缺失；
- 纯触屏 → hover 菜单、密集点击区、宽表格需改造；
- 原生宿主 → 部分动作走 bridge（`openChat` 等）而非页面内跳转。

### 15.3 按 surface 的重构优先级与风险（embed v1 = overview/workspace/knowledge/growth/me）

| Surface                  | 现状                             | 手机重构                                           | 风险         |
| ------------------------ | -------------------------------- | -------------------------------------------------- | ------------ |
| Overview（每日概览四卡） | 桌面网格                         | → **移动端已隐藏四卡**（§15.7）；home 其余仍需适配 | 已落地(核心) |
| Me / 个人设置            | 已有 ≤639 单列                   | 补点击区/字号/安全区                               | 低           |
| Workspace / 协作         | 多面板                           | → 堆叠 / 抽屉                                      | 中-高        |
| Knowledge 工作台         | 表格/库/split/抽屉（部分已适配） | → 卡片/列表 + 全屏抽屉                             | 高           |
| Growth                   | 图表/报告                        | 窄屏可读性                                         | 中           |

### 15.4 推荐做法

1. `ui/index.html` 加 `viewport-fit=cover` 启用安全区（共享文件，影响所有 port，但对桌面无害）。
2. 加**手机层断点**（≤430 / ≤380）+ `env(safe-area-inset-*)`，**优先在 `.employee-embed` 作用域内**落地（少动 22k 行 workbench.css，稳定后再下沉为共享响应式）。
3. 用 `@media (hover: hover)` 守卫 hover-only 交互；触屏提供常显/点击等价。
4. **紧凑/移动模式信号**：embed 容器可通过视口宽度 / `?embed=1` / UA 让组件切换布局（`resolveEmbedRenderContext` 可扩展出一个 `compact` 标志）。
5. 组件级：宽表格 → 卡片/横向滚动；固定宽度 → `min-width:0` + 可收缩 flex/grid；WebView 内验证 sticky。

### 15.5 测试

- Playwright 浏览器测试设手机视口（390×844 / 360×800）跑 embed 路由：断言**无横向溢出**（`scrollWidth <= clientWidth`）、关键区单列、点击区 ≥44px。
- 真机 iOS / Android WebView 联调（安全区、惯性滚动、hover）。

### 15.6 落地边界（诚实说明）

移动层的「安全区 + `viewport-fit=cover` + 手机断点」是**相互耦合**的改动（`viewport-fit=cover` 若不配套安全区内边距，反而让内容钻到刘海下），且**必须有移动视口下的视觉验证**才能确认不破坏布局。因此本节**不盲改** `workbench.css` / `index.html` / `employee-embed.css`——避免落一堆无法验证的视觉 CSS。

推荐的落地方式（验证驱动，按 §15.3 优先级分批）：

1. 先落 `viewport-fit=cover` + `.employee-embed` 作用域内的安全区内边距/惯性滚动**基础层**，并配 Playwright 手机视口（390×844）回归：断言 embed 路由**无横向溢出**（`scrollWidth <= clientWidth`）。本机浏览器测试可跑（chromium 已装）。
2. 再逐个 surface 下沉手机断点（overview → me → growth → workspace → knowledge），每个都带移动视口断言 + 真机 WebView 目检。

（本机能跑组件级浏览器测试，但真实工作台 surface 需接入完整 app 状态渲染，故按上面的验证驱动方式推进，而不是本轮一次性盲改。）

### 15.7 本轮已落地并验证：移动端移除「每日概览四卡」

**产品决策**：移动端 employee shell **不展示**每日概览信号卡（历史上四卡；现为「今日日程 / 待办事项」两卡）。

- **实现**：`ui/src/ui/employee-shell/employee-embed.css` 在 `.employee-embed--mobile` 作用域内 `display:none` 隐藏 `.employee-workbench__signals-grid`（概览卡容器）。
- **作用域 = 手机（按平台，不是视口）**：`employee-embed--mobile` 类**只在手机壳**出现（iOS/Android 以 `?shell=mobile` 打开 embed，见 §15.9）；**macOS embed 与桌面 Web 不带该类 → 保留概览卡（与网页对齐，功能不缺失）**。「大白建议」条（steward bar，独立特性）**不受影响**。
- **不动共享代码**：未改 `workbench.css` / 渲染逻辑；`.employee-workbench__signals-grid` 选择器的存在已被既有 `workbench-signals-surface.node.test.ts` 守护（重命名会被测试捕获）。
- **验证**：`ui/src/ui/employee-shell/employee-embed.browser.test.ts`（chromium，3 项通过）—— `--mobile` 隐藏、`employee-embed`（无 `--mobile`，即 macOS）可见、非 embed 可见。
- **可选后续**：移动端顺带跳过 `workbench.*` 读模型加载（改共享 `refreshWorkbenchSignals`，省去无用请求）—— 归入 §15 的分批重构。

### 15.8 本轮已落地并验证：移动端设置仅保留「个人设置」

**产品决策**：**手机端** employee shell 只展示**个人设置**，不展示**系统设置**（手机以对话 + 任务为主）；**macOS embed 保留系统设置（与网页对齐）**。

- **根因**：`me` surface 映射到 settings 模块，而 settings 默认 `settingsView="system"`；系统/个人的切换入口在 sidebar/header（embed 已隐藏），故**纯 CSS 解决不了**——需在路由层定 view。
- **实现（手机标记门禁）**：`resolveEmployeeEmbedRouting`（`ui/src/ui/employee-shell/workbench-embed.ts`）**仅当带手机标记 `?shell=mobile` 且 surface 为 `me`** 时返回 `settingsView:"personal"`；`syncTabWithLocation`（`ui/src/ui/app-settings.ts`）的 embed 分支据此设 `host.workbenchSettingsView="personal"`。
- **macOS 全对齐**：macOS embed **不带** `shell=mobile` → `settingsView` 不设 → 系统/个人设置均保留（与网页一致，功能不缺失）；桌面 Web 同样不受影响（非 embed 不走此分支）。
- **未改** settings 模块渲染 / 共享逻辑；只动了我拥有的 embed 路由层。
- **验证**：`workbench-embed.node.test.ts`（手机标记 → me=settings+personal；无标记 → settingsView 不设）+ `app-settings.employee-embed.browser.test.ts`（`/embed/employee/me?shell=mobile` → personal；`/embed/employee/me` 无标记 → settingsView 未定义、无 `--mobile` 类），均通过。

### 15.9 手机 vs macOS 的区分机制（平台标记，非视口）

**要求**：macOS embed 与网页功能对齐、不缺失；仅**手机**（iOS/Android）屏蔽上述功能。因此区分维度是**平台**，不是视口宽度（否则 macOS 窄窗会误伤）。

- **标记**：手机壳打开 embed 时带查询参数 `?shell=mobile`；macOS 壳**不带**。
- **Web 读取**：`resolveEmployeeEmbedRouting(pathname, basePath, search)` 经 `isMobileEmbedSearch(search)` 得出 `mobile`；`applyEmployeeEmbedRootClass(chromeless, mobile)` 在文档根切换 `employee-embed`（所有 embed）与 `employee-embed--mobile`（仅手机）。所有手机专属裁剪都挂在 `.employee-embed--mobile` 或 `mobile` 分支上。
- **原生落地**：iOS（`apps/ios/.../EmployeeShellWebView.swift`）与 Android（`apps/android/.../employeeshell/EmployeeShellWebView.kt`）的 `EmployeeShellBootstrap.withMobileShellMarker(...)` 给 bootstrap target 追加 `shell=mobile`；**macOS（`apps/macos/.../EmployeeShellWebViewController.swift`）刻意不加**，从而拿到与网页一致的完整功能。
- **服务端兼容**：`shell=mobile` 作为 target 上的 query 通过 `isSafeEmbedTarget` 校验（只校验路径段 + 拒绝 scheme/协议相对/`..`），302 重定向保留该 query。

> 结论：新增的「手机专属裁剪」（四卡、系统设置等）一律经 `employee-embed--mobile` / `mobile` 门禁；macOS embed 因不带标记而保持与网页对齐。后续任何"仅手机"改动都应沿用此标记，不要用视口宽度或 `.employee-embed`（那会误伤 macOS）。
