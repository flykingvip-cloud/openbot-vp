# Implementation Plan: PC 端与移动手机端客户端交付（Client Apps — PC + Mobile）

## Overview

本实施计划把 `design.md`（v1.1）的组件 C1–C9 落成**按波次、可独立交付、可分派**的任务。范围重点：**Wave 1（employee 内部 beta）与 Wave 2（设计伙伴 beta）** 详列；**Wave 3（Windows/Tauri）→ GA 门（employee 全端，独立发布门）→ Wave 4（管理面 Epic E1、CLI；GA 之后）** 给出可执行骨架。全部采用 requirements v4 / design v1.1 的**倾向决策**（见「决策状态」，均为**工作假设 · 未定案**）。

本版已按 **路径边界 owner + 基础层先行 + 平台 fan-out** 的执行模型拆分：跨端任务拆成「父任务（仅协调 + 验收，不落码）+ per-platform 子任务」，见「Owners 与 Path 分区」「执行顺序」。

**复用，不重做**：`/native/bootstrap`、employee-shell 契约、既有 companion 不改；净新增项（employee 推送、深链新 host、account-scoped 会话、最低客户端门禁、管理面 embed）显式标注。

## Agents

> **proposal only（重要）**：下列为**建议 owner**，**非生效归属**。真正生效以 `pnpm loom register` 写入 `.loom/registry.yaml` 为准（registry 权威，本块仅派生视图）；**仅改本文件不构成归属登记**。具名 agent-id、`since` 于 register 时填入；每 owner 一个独立 worktree（由人建，agent 不自建）。

- spec/release · role: owner · scope: 规格/决策落档/跨端 checkpoint 与 GA 门收口/契约模型 · paths: .kiro/specs/client-apps-pc-mobile/\*\* · since: (待 register)
- web-ui · role: owner · scope: 手机层/embed 渲染/深链路由契约/i18n · paths: ui/src/ui/employee-shell/**, ui/src/styles/**, ui/index.html, ui/src/i18n/\*\* · since: (待 register)
- gateway · role: owner · scope: 推送后端/C7 门禁/登录会话后端/Epic E1 · paths: src/gateway/employee-shell/**, src/gateway/native-bootstrap-http.ts, src/gateway/server-node-events.ts, src/gateway/server/ws-connection/**, src/gateway/platform-auth/\*\*, src/gateway/protocol/client-info.ts · since: (待 register)
- apple-shared · role: owner · scope: Apple 共享层(含 DeepLinks.swift)；**唯一可落地此路径**，ios/macos 只消费 · paths: apps/shared/OpenClawKit/\*\* · since: (待 register)
- ios · role: owner · scope: iOS 壳 · paths: apps/ios/\*\* · since: (待 register)
- android · role: owner · scope: Android 壳(Kotlin 深链/FCM) · paths: apps/android/\*\* · since: (待 register)
- macos · role: owner · scope: macOS 壳(主窗口内嵌) · paths: apps/macos/\*\* · since: (待 register)
- windows · role: owner · scope: Windows/Tauri 壳(Wave 3 新建) · paths: apps/windows/\*\* · since: (待 register)

### 定位（强约束）

- **Web-first 复用**：业务面走 `/embed/employee/*`；原生只做壳 / 登录 / 设备能力 / 推送 / 深链。
- **双身份正交**：employee 会话 / node 配对互不连累。
- **Companion 不回归**：每波验收含 companion 回归集。
- **净新增显式化**：employee 推送、深链新 host、account-scoped 会话、C7 门禁、管理面 Epic E1 均为净新增，非"接线"。
- **一任务一 owner（lander）**：跨端任务一律拆父+子；父任务只协调/验收，不落码。

### 技术栈锁定（不引入计划外栈）

- 后端 TS(ESM) 复用 platform-auth / employee-shell；前端复用共享 `ui`（lit-html）。
- iOS/macOS = Swift + WKWebView（复用 `apps/shared/OpenClawKit`）；Android = Kotlin + WebView；**Windows/Linux = Tauri**（D-PC-STACK）。
- 不引入 RN/Flutter/KMP；不新造第二套业务 UI；不改 Gateway 唯一事实来源。

### 实施阶段（对齐 design 波次）

- **Wave 1（P1，内部 beta）**：登录 + 云网关 + overview/me 手机层 + 三端 Employee Shell 接入 + 深链/本地通知 + companion 不回归。
- **Wave 2（P2，设计伙伴 beta）**：employee 服务端推送、跨端会话连续性、图片上传、更多 surface、最低客户端门禁。
- **Wave 3（P3，公测）**：Windows(Tauri) 桌面客户端。
- **GA 门（employee 全端，独立发布门 · Wave 3 之后 / Wave 4 之前）**：合规门禁 + a11y/i18n GA 校验 + GA checkpoint。
- **Wave 4（P4，GA 之后增量）**：管理面 Epic E1（可选）、CLI 完善、Linux。

### 决策状态（工作假设 vs 已定案）

> **状态（2026-07-14 · spec/release 定案）**：Wave 1 阻塞项 **D-LOGIN / D-MACOS-FORM / D-COMPANION-IA / D-PUSH-SCOPE 已定案**——fan-out 的**决策门已清**（仍需 `1.3-contract` + `1.2-apple` 就绪）。其余为 `【暂定】`（默认见下），按各自波次 Deadline 前确认；**agent 不得仅凭 `【暂定】` 项落码**。

- **【已定案】D-LOGIN**：独立登录面；Wave 1 **不引入 employee MFA**；**SSO = trusted-proxy 既有入口**（通用 OIDC 延后，净新增）。
- **【已定案】D-MACOS-FORM**：主窗口内嵌 employee 壳，保留菜单栏 companion。
- **【已定案】D-COMPANION-IA**：`Me > Device`。
- **【已定案】D-PUSH-SCOPE = A**：Wave 1 先做**深链 + 本地/系统通知**；employee 服务端推送（APNs 重绑 + Android FCM）落 Wave 2。
- **【已定案】D-PUSH-W2-\*（2026-10-08）**：MVP 触发=@mention；平台=iOS APNs 首刀→FCM→Mac 后置、Windows WNS 不在 MVP；多设备并存；员工独立 APNs 配置/topic；点击复用 Wave 1 Router + 强制 deepLink + alert + logout 注销。契约：`contracts/push-model.md`。**D-PUSH-W2-RPC 已确认落地**（`employee.push.*`）。任务 2.1：**部分完成**（plumbing 已合 PR，真机 e2e 待凭据+本机 smoke）；2.2 未开工。
- **【暂定】D-MINCLIENT**：软门禁（先告警后拒绝），Wave 2 对外前确认。
- **【暂定】D-UPLOAD**：一期图片。**【暂定】D-PC-STACK**：Tauri。**【暂定】D-PC-ADMIN**：是（仅 PC，先交付 Epic E1）。**【暂定】D-RENAME**：延后（仅保用户可见品牌统一）。

## Owners 与 Path 分区（proposal only · 需 `loom register` 生效）

> 归属按 `paths:` glob 机器匹配（`bun scripts/agent-attribution.ts`）。**热区红线**：`apps/shared/OpenClawKit/**` 仅 `apple-shared` 可落地（含 `DeepLinks.swift`），`ios`/`macos` 只消费；共享注册表（若 Epic E1 触及 `server-methods-list`/`method-scopes`）由 gateway 单一 owner 落地。

| owner        | paths（machine-matchable）                                                                                                                                                                                            | 负责范围                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| spec/release | `.kiro/specs/client-apps-pc-mobile/**`                                                                                                                                                                                | 决策落档、契约模型（1.3-contract）、跨端 checkpoint/GA 门、验收收口 |
| web-ui       | `ui/src/ui/employee-shell/**`,`ui/src/styles/**`,`ui/index.html`,`ui/src/i18n/**`                                                                                                                                     | 手机层、embed 渲染、**深链路由契约**、i18n                          |
| gateway      | `src/gateway/employee-shell/**`,`src/gateway/native-bootstrap-http.ts`,`src/gateway/server-node-events.ts`,`src/gateway/server/ws-connection/**`,`src/gateway/platform-auth/**`,`src/gateway/protocol/client-info.ts` | employee 推送后端(W2)、C7 门禁、登录/会话后端、Epic E1              |
| apple-shared | `apps/shared/OpenClawKit/**`                                                                                                                                                                                          | Apple 共享层（**含 `DeepLinks.swift`**）；唯一可落地                |
| ios          | `apps/ios/**`                                                                                                                                                                                                         | iOS 壳：登录/容器/401/深链消费                                      |
| android      | `apps/android/**`                                                                                                                                                                                                     | Android 壳：登录/容器/401/Kotlin 深链/FCM                           |
| macos        | `apps/macos/**`                                                                                                                                                                                                       | macOS 壳：主窗口内嵌 employee 壳                                    |
| windows      | `apps/windows/**`（Wave 3 新建）                                                                                                                                                                                      | Windows/Tauri 壳                                                    |

## 执行顺序（三段 · 勿一开始五 owner 全开）

- **① foundation（先行，基础/契约）**：`1.0`[spec/release]、`1.1`[web-ui]、`1.2-apple`[apple-shared]、`1.2-android`[android]、`1.3-contract`[spec/release]。
- **② platform fan-out（契约就绪后并行）**：`1.3/1.4/1.5/1.6/1.7` 的 `-ios/-android/-macos` 子任务（各平台 owner）。
- **③ integration / gate（收口）**：`1.8-*`（companion 回归）、`1.9`（i18n/a11y/品牌）、`1.10`（测试）、`1.11`（Checkpoint 内部 beta）——由 spec/release 收口。

## Tasks

- [ ] 1. Wave 1 — employee 内部 beta（P1）
  - [x] 1.0 决策落档 + 需求对齐 · [spec/release]
    - ✅ 已完成（2026-07-14）：Wave 1 四项决策定案，写回 `requirements.md`「定案表」+ 本文件「决策状态」（标 `【已定案】`）；已按 **D-PUSH-SCOPE=A** 调整 R-Native.1/.2/.6（Wave 1 = 深链 + 本地/系统通知，employee 服务端推送移 Wave 2）。
    - _Requirements: R-Native, R1_

  - [x] 1.1 移动手机层基础（overview/me）· [web-ui]
    - `ui/index.html` 加 `viewport-fit=cover`；`.employee-embed`/`.employee-embed--mobile` 作用域加手机断点(≤430/≤380)+`env(safe-area-inset-*)`+惯性滚动；overview/me 触屏化（`@media (hover:hover)` 守卫）；Playwright 手机视口回归（无横向溢出/单列/点击区≥44px）。
    - ✅ 验收通过（2026-07-14）：commit `dbf0ce6d57`；chromium 浏览器测试 **4/4**（390×844+360×800：无横向溢出、main 占满>80%宽、四卡隐藏、me 单列、点击区≥44px）+ embed-routes node **19/19**。小 nit：`@vitest/browser/context` 导入已弃用，建议后续改 `vitest/browser`（5.6 的 M-COLD/M-TTI 属运行时指标，留 1.11 checkpoint 验）。
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.9_

  - [x] 1.2 深链契约净新增（父：契约 grammar + 联调验收）· [web-ui/apple-shared 协调]
    - ✅ 父任务收口（2026-07-17，spec/release）：子任务 `1.2-apple`(23/23) + `1.2-android`(parity 通过) 均已验收。
    - ✅ grammar 已冻结（2026-07-14）：见 `contracts/deeplink-grammar.md`（新 host `employee/<surface>`/`chat`/`space`/`knowledge`、双 scheme、校验/鉴权规则、**共享测试向量**）。父任务不落码；子任务据此实现。
    - _Requirements: R-Native.1, R-Native.2_
    - [x] 1.2-apple `DeepLinks.swift` 新增 host + 解析测试 · [apple-shared]
      - ✅ 验收通过（2026-07-14）：commits `e80c59cf21` + `373f709c10`；`swift test --filter DeepLinksGrammarTests` = **23/23 通过**（12 共享向量 + 边界注入/编码/控制字符 + agent/gateway/workspace 非回归）。**解锁 ios/macos 的 1.7-\***。
      - _Requirements: R-Native.1, R-Native.2_
    - [x] 1.2-android Kotlin 深链解析器（等价 grammar）+ 测试 · [android]
      - ✅ 验收通过（2026-07-15，commits `2445187208` + parity 修复 `059e84c4e9`）：Kotlin 解析器与 Swift grammar 逐条一致，覆盖 12 共享向量 + **query-form parity**（`employee?surface=growth`→Growth、`employee`→Overview、`employee/workspace?surface=growth`→Workspace 路径优先）+ 注入/控制字符/大小写 边界。
      - ⚠️ 测试执行受阻（环境，非代码）：本机无 Android SDK 且 `JAVA_HOME` 曾失效，`:app:testDebugUnitTest` 无法运行 → 需在配好 Android SDK 的环境（或 CI）跑绿；代码审查 + 与 Swift 语义交叉核验通过。
      - _Requirements: R-Native.1, R-Native.2_

  - [x] 1.3 account-scoped 会话容器 + 端上安全存储（父：协调 + 验收）
    - ✅ 父任务收口（2026-07-17，spec/release）：子任务 `1.3-contract`/`1.3-ios`/`1.3-android`/`1.3-macos` 全部验收通过。
    - 目标：每 `{accountId, orgId}` 独立会话/cookie jar/存储，**弃用 `URLSession.shared`**；切账号/登出只清对应命名空间。父任务不落码。
    - _Requirements: 3.4, 3.7, 10.6, 10.7_
    - [x] 1.3-contract account 会话/存储**模型定义**（accountId 命名空间、存储键、隔离规范）· [spec/release]
      - ✅ 已完成（2026-07-14）：见 `contracts/account-session-model.md`（v1 冻结；含平台映射与 iOS/macOS `WKWebsiteDataStore(forIdentifier:)` 修正、Android 单活跃账号约束）。
      - _Requirements: 3.4, 10.6_
    - [x] 1.3-ios Keychain + per-account `URLSession`/`WKWebsiteDataStore(forIdentifier:)` · [ios]
      - ✅ 验收通过（2026-07-14，commit `3c5c349e6d`）：per-account `URLSession`(非 `.shared`)+`WKWebsiteDataStore(forIdentifier:)`(取代 `.default()`，登出 `remove(forIdentifier:)`)+Keychain 命名空间；`EmployeeAccountIdentityTests` 用 golden vector 校验 accountId=`5f529248402f4ebf`(sha256 前16 hex、不含明文 email)，精确对齐契约公式。
      - ⚠️ 测试执行受阻：`xcodebuild test` 在本环境找不到可用 iOS 模拟器目标（"iOS 26.5 is not installed" 运行时不匹配）→ 需在配好 iOS 18+ 模拟器运行时的 Xcode 环境跑绿（代码审查 + 契约核验通过）。
      - _Requirements: 10.6, 10.7, 3.7_
    - [x] 1.3-android Keystore(`SecurePrefs.kt`) + per-account cookie/`setDataDirectorySuffix` · [android]
      - ✅ 验收通过（commit `7f302c072d`）：`EncryptedSharedPreferences`+`MasterKey(AES256)`、per-account `OkHttp CookieJar`(不跨账号泄漏)、单活跃账号 + `setDataDirectorySuffix` 约束处理、切账号清 gateway 域 cookie；对齐 `account-session-model.md`。（测试执行受阻同 1.2-android）
      - _Requirements: 10.6, 10.7, 3.7_
    - [x] 1.3-macos Keychain + per-account `WKWebsiteDataStore(forIdentifier:)` · [macos]
      - ✅ 验收通过（2026-07-14，commits `ab94ee461e`+`2cd6238ec2`）：per-account `URLSession`(非 `.shared`) + `WKWebsiteDataStore(forIdentifier:)`(显式取代 `.default()`) + Keychain 按 accountId 命名空间；`swift build` 通过。
      - ✅ 测试解阻并跑绿（2026-07-15，commit `732f672100`）：`MacNodeRuntimeTests.swift` 的 `#SendableClosureCaptures`（`@Sendable` 闭包捕获 `var callIndex`）改用 `OSAllocatedUnfairLock` 计数；`swift test --filter EmployeeAccountTests --filter EmployeeShellBridgeTests` = 17 tests/2 suites 全绿。— kiro-macos
      - _Requirements: 10.6, 10.7, 3.7_

  - [ ] 1.4 原生 Employee 登录面 + onboarding + 网关选择（父：协调 + 验收）
    - 密码登录 + 忘记密码 + 受邀加入 + 网关选择(云默认/自托管) + 多账号/组织切换；接 platform-auth 既有路由（`/login`、`/password/forgot`、`/password/reset`、`/employee/register`）取 employee 域会话；SSO 走 trusted-proxy；不引入 MFA。父任务不落码。
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_
    - [ ] 1.4-ios 登录/onboarding UI + 会话接线 · [ios]
      - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.4_
    - [x] 1.4-android 登录/onboarding UI + 会话接线 · [android]
      - ✅ 验收通过（2026-07-15，commits `0964c6b7cf` + `8dd8de07e2`）：`EmployeeLoginScreen` 覆盖 密码登录/忘记密码/受邀注册 + 网关选择(云默认 `gw.openbot.love`/自托管) + 多账号切换；`EmployeeAuthClient` POST platform-auth 既有路由(`/login`、`/password/forgot`、`/password/reset`、`/employee/register`、`/logout`、`/session`)经**该账号隔离的 OkHttp client** 落 employee 会话 cookie 入 per-account jar；`EmployeeShellController` 编排 auth+account，登出**不动 node 配对**(契约 invariant 5)；**不引入 MFA**、SSO=trusted-proxy 既有入口。`8dd8de07e2` 将 `EmployeeAuthResponseParser`/`EmployeeAuthClient` 从 `org.json`(android.jar stub 在纯 JVM 单测抛 "not mocked") 改用 `kotlinx.serialization`(纯 JVM、项目既有依赖)，语义不变、无需 Robolectric 即可单测。
      - ⚠️ 测试执行受阻（环境，非代码）：本机无 Android SDK → `:app:testDebugUnitTest` 无法运行；author 报 employee 套件 60 tests/0 fail，8 个 employee 测试文件均在位。
      - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.4_
    - [x] 1.4-macos 登录/onboarding UI + 会话接线（主窗口内嵌）· [macos]
      - ✅ 验收通过（2026-07-15，commit `021aee1b8e`）：`EmployeeLoginView` 覆盖 密码登录/忘记密码/重置(带验证码)/受邀注册 + 网关选择(云默认 `gw.openbot.love`/自托管)；`EmployeeAuthClient` 接 platform-auth 既有路由(`/__openbot/platform-auth/{login,logout,password/forgot,password/reset,employee/register,session}`) 取 employee 域会话入 per-account Client Jar；SSO=既有 trusted-proxy 入口(`beginSSO` 开网关 web 登录，不引 OIDC)；多账号切换 + 组织切换(`switchAccount`/`switchOrg`)；**不引入 MFA**。测试 `EmployeeLoginViewModelTests` 跑绿。— kiro-macos
      - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.4_

  - [x] 1.5 Bootstrap + Employee Shell 容器接入 + 桥接 intent 路由 + 离线占位（父：协调 + 验收）
    - ✅ 父任务收口（2026-07-17，spec/release）：子任务 `1.5-ios`/`1.5-android`/`1.5-macos` 全部验收通过。
    - 编译验证并接入三端骨架；注入 `gatewayBaseURL`(默认云网关/TLS) + `tokenProvider`(该账号 `URLSession` 调 `mint`)；严格解码桥接消息(`version===1`)：`openChat/openAssistant`→原生 chat，`openSpace/openKnowledgeObject`→embed 导航(Web 复用)，`openDeviceSettings`→`Me>Device`；embed 加载失败→原生占位+退避重连。手机壳 `withMobileShellMarker`（macOS 不加）。父任务不落码。（并入原 1.7 桥接路由 + 1.8 离线占位）
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 3.5, 2.6, 7.2_
    - [x] 1.5-ios `EmployeeShellWebView.swift` 接入 + 桥接路由 + 占位 · [ios]
      - ✅ 验收通过：手机壳加 `shell=mobile`(`withMobileShellMarker`)；桥接严格解码(`EmployeeShellBridgeParseTests`：version/type/必填校验)；`EmployeeEmbedRouting` 把 openSpace/openKnowledgeObject→embed 导航、chat/assistant/device→原生(`EmployeeEmbedRoutingTests`)。（测试执行受阻同 1.3-ios）
      - _Requirements: 4.1, 4.2, 4.3, 4.5, 3.5, 2.6, 7.2_
    - [x] 1.5-android `EmployeeShellWebView.kt` 接入 + 桥接路由 + 占位 · [android]
      - ✅ 验收通过（commit `4547839517`）：`MOBILE_SHELL_MARKER="shell=mobile"` + `withMobileShellMarker`（手机端加）、`addJavascriptInterface` 桥接、offline 占位、embed 路由。（测试执行受阻同 1.2-android）
      - _Requirements: 4.1, 4.2, 4.3, 4.5, 3.5, 2.6, 7.2_
    - [x] 1.5-macos `EmployeeShellWebViewController.swift` 主窗口内嵌 + 桥接路由 + 占位 · [macos]
      - ✅ 验收通过：主窗口内嵌(D-MACOS-FORM，`EmployeeShellWindowController`)+菜单入口；**embed 不带 `shell=mobile`**(含断言测试 `shell=mobile == false`)；桥接严格解码 + intent 路由；`swift build` 通过。
      - _Requirements: 4.1, 4.2, 4.3, 4.5, 3.5, 2.6, 7.2_

  - [x] 1.6 401 检测三端等价 + 会话失效联动（父：协调 + 验收）
    - ✅ 父任务收口（2026-07-17，spec/release）：子任务 `1.6-ios`/`1.6-android`/`1.6-macos` 全部验收通过。
    - embed 主帧 401→静默 re-bootstrap；mint 401→回登录面；登出/切组织清双 jar+缓存、吊销会话，**不动 node 配对**。父任务不落码。
    - _Requirements: 3.6, 3.7_
    - [x] 1.6-ios `decidePolicyFor navigationResponse` 检 `statusCode==401` + 失效联动 · [ios]
      - ✅ 验收通过：`WKNavigationDelegate.decidePolicyFor navigationResponse` + `isForMainFrame` + `statusCode==401` → re-bootstrap；mint 401→回登录。（测试执行受阻同 1.3-ios）
      - _Requirements: 3.6, 3.7_
    - [x] 1.6-android 复用 `onReceivedHttpError`(已有) + 失效联动 · [android]
      - ✅ 验收通过（commit `c4e302215d`）：`onReceivedHttpError` + `isForMainFrame && statusCode==401` → re-bootstrap；`EmployeeShellReconnectPolicy`(+单测)。（测试执行受阻同 1.2-android）
      - _Requirements: 3.6, 3.7_
    - [x] 1.6-macos `decidePolicyFor navigationResponse` 检 401 + 失效联动 · [macos]
      - ✅ 验收通过：`WKNavigationDelegate.decidePolicyFor navigationResponse` + `isForMainFrame` + `statusCode==401` → 静默 re-bootstrap；登出清会话不动 node。
      - _Requirements: 3.6, 3.7_

  - [x] 1.7 深链客户端路由 + 本地/系统通知点击直达（D-PUSH-SCOPE=A）（父：协调 + 验收）
    - ✅ 父任务收口（2026-07-17，spec/release）：子任务 `1.7-ios`/`1.7-android`/`1.7-macos` 全部验收通过。
    - 深链经**会话域鉴权**后映射 embed 导航或桥接 intent（不绕过登录）；本地/系统通知点击→深链→直达目标；**不含**服务端 employee 推送（Wave 2）。父任务不落码。
    - _Requirements: R-Native.1, R-Native.2, R-Native.6_
    - [x] 1.7-ios 深链路由 + 本地通知 · [ios]
      - ✅ 验收通过：消费 apple-shared `DeepLinkParser`(`EmployeeShellController.parse`) + `EmployeeNotificationRouter` 通知直达，经会话域鉴权。（测试执行受阻同 1.3-ios）
      - _Requirements: R-Native.2, R-Native.6_
    - [x] 1.7-android 深链路由 + 本地通知 · [android]
      - ✅ 验收通过（2026-07-15，commit `305ac065b9`）：`EmployeeDeepLinkRouter`(纯+可测) 把已解析深链映射为 shell 路由(employee/space/knowledge→embed 导航、chat→原生)，镜像 macOS switch；`EmployeeShellController.handleDeepLink` 解析 **UNTRUSTED 输入**、在活跃账号内路由、**登出时暂存 `pendingRoute` 延后到登录成功后 `consumePendingAfterLogin` 续跳（绝不绕过鉴权）**；`EmployeeNotificationRouter`(+纯提取器测试) 发本地通知，点击开 App 并路由所携深链；`MainActivity`+`AndroidManifest` 加 openclaw/openbot VIEW intent-filter + singleTop（additive/guarded）。（测试执行受阻同 1.4-android）
      - _Requirements: R-Native.2, R-Native.6_
    - [x] 1.7-macos 深链路由 + 系统通知 · [macos]
      - ✅ 验收通过：`DeepLinks.swift` 消费 apple-shared `DeepLinkParser` + `EmployeeNotificationRouter` 通知点击直达（经会话域鉴权）；`swift build` 通过。
      - _Requirements: R-Native.2, R-Native.6_

  - [ ] 1.8 Companion 不回归 + IA（Me>Device）（父：协调 + 回归验收）
    - companion 入口收纳到 `Me>Device`（D-COMPANION-IA），迁移期保留明确入口。父任务不落码。
    - _Requirements: 7.3, 1.6_
    - [ ] 1.8-ios 配对/Screen/Voice/相机/后台回归 + IA · [ios]
      - _Requirements: 7.3, 1.6_
    - [x] 1.8-android 配对/Screen/Voice/相机/后台回归 + IA · [android]
      - ✅ 验收通过（2026-07-15，commit `8ffd0f912c`）：companion 无回归——android 全部改动落在**净新增包**(`employeeshell/`+`employeeauth/`+`account/`+`deeplink/`)，`git diff ad25b71a04..91ceab9e53 -- apps/android/` 证实**未触碰任何 companion 代码**(NodeForegroundService/Canvas/voice/camera/pairing/gateway 均未改)，仅 `MainActivity`(深链转发)+`AndroidManifest`(intent-filter+singleTop) 为 additive/guarded；`EmployeeShellHost` 加 `onOpenDeviceSettings` 回调：`openDeviceSettings` 桥接 intent 打开原生 companion(D-COMPANION-IA `Me>Device`)，未接线时回退 web me 面(对齐 macOS)。（测试执行受阻同 1.4-android）
      - _Requirements: 7.3, 1.6_
    - [x] 1.8-macos Canvas/Exec 审批/语音唤醒回归 + IA · [macos]
      - ✅ 验收通过（2026-07-15）：companion 无回归——`git diff` 证实未改 `CanvasManager`/`ExecApprovals`/`VoiceWakeRuntime`/`GatewayProcessManager`/`NodeServiceManager`；employee 壳改动全为加法(新增 `EmployeeShell/*` + `DeepLinks`+6/`MenuBar`+2/`MenuContentView`+41/`NotificationManager`+13)；菜单栏 companion 开关(Canvas/Voice Wake/Exec Approvals/本地网关托管)保持不变。`Me>Device` 桥接：embed `openDeviceSettings` intent → 导航壳到 `me` 面(D-COMPANION-IA)。`swift build` 通过。— kiro-macos
      - _Requirements: 7.3, 1.6_

  - [ ] 1.9 i18n(zh/en) + a11y 核心路径 + 用户可见品牌 · [web-ui + 各平台 owner 配合]
    - embed i18n/a11y 由 web-ui；各端原生壳文案/读屏/动态字体/焦点在其 1.4/1.5 内落地并在此汇总验收；品牌统一 OpenBot（命名债延后，D-RENAME）。
    - 🔧 验收清单已定义：`wave1-status.md §3(1.9)`；剩余仅 **ios 原生壳 i18n/a11y**（随 1.4-ios/1.5-ios 落地）。
    - ✅ web-ui embed 部分（2026-07-17，commit `e5ec5a5605`，**本机实跑通过**）：i18n **双向键 parity 15/15**（`embed-i18n-parity.node`，覆盖 frontstage/common/nav/chat/authHome，无英文回退/无 raw-key 显示）+ a11y 核心路径 **3/3 real chromium**（`employee-embed-a11y.browser`：`:focus-visible` 可见焦点环 WCAG 2.4.7、控件 role+可达名+可键盘聚焦、点击区 ≥44px）+ `employee-embed.css` 焦点样式。— web-ui
    - ✅ macOS 原生壳部分（2026-07-15，commit `021aee1b8e`）：`EmployeeShellStrings`(自包含 zh-CN/en) 覆盖登录/占位/菜单/错误文案，随系统语言切换；登录字段/占位/账号菜单加 a11y label；品牌 = OpenBot。测试 `EmployeeShellStringsTests` 校验 zh/en 全键无回退。— kiro-macos
    - ✅ Android 原生壳部分（2026-07-15，commit `91ceab9e53`）：i18n 把登录/onboarding/壳容器文案外置到 `values/strings.xml`(en)+`values-zh-rCN/strings.xml`(zh-CN)，**19/19 `employee_*` 键两地全覆盖、无缺键无混合语言**，屏幕改用 `stringResource`；a11y：标题 `heading()` 语义、状态 `liveRegion=Polite`(TalkBack 朗读)、按钮 ≥48dp、sp 字号随动态字体；telemetry(R-Matrix/1.11)：`EmployeeTelemetry` sink + `onColdStart`(M-COLD,MainActivity)/`onShellInteractive`(M-TTI,Host 首帧)/`onLoginResult`(登录成功率,Controller) 钩子，默认 no-op，crash-free 交 crash reporter。— android
    - _Requirements: 11.1, 11.2, 11.4, 12.1, 12.2, 12.3, 8.1_

  - [ ]\* 1.10 Wave 1 测试 · [spec/release + QA]
    - 共享 `ui` 手机视口 Playwright + 深链解析单测；三端 登录→bootstrap→embed 冒烟（真机优先）；401 re-bootstrap；companion 回归集。
    - 🔧 聚合矩阵已定义：`wave1-status.md §3(1.10)`；共享 ui(4/4+19/19) + swift(23/23) 已 ✅，android/ios/macos 待环境跑绿（`wave1-status.md §2`）。
    - _Requirements: 5.5, 3.6, 7.3, R-Native.6_

  - [ ] 1.11 Wave 1 Checkpoint — 内部 beta · [spec/release]
    - 内部 beta 构建（iOS TestFlight 内部 / Android internal APK / macOS 包）；埋点 M-COLD≤10s、M-TTI≤3s、crash-free、登录成功率；companion 不回归确认。
    - 🔧 门禁已定义：`wave1-status.md §3(1.11)`；前置 = `§2` 各端跑绿 + `1.9` 清单 + `1.10` 矩阵全 ✅。
    - _Requirements: R-Matrix.1, R-Matrix.2, R-Matrix.3, R-Matrix.4, 9.1, 9.2_

- [ ] 2. Wave 2 — 深化 employee 体验（P2，设计伙伴 beta）
  - [x] 2.0-contract employee push 产品契约 · [spec/release]
    - 落地 `contracts/push-model.md`；同步 requirements/tasks 拍板表（D-PUSH-W2-\*）。**不含** Gateway/客户端运行时实现。
    - _Requirements: R-Native.1, 10.5_
  - [ ] 2.1 employee-scoped 服务端推送（APNs 重绑）· [gateway]（+ ios/macos 消费） · **部分：plumbing 已实现（register/store/test/mention enqueue/iOS 客户端），真机 e2e 待 OPENBOT*EMPLOYEE_APNS*\* + 本机 smoke；合入前勿勾满**
    - 新增按 **employee 身份/会话** 的推送注册与投递（区别既有 node-scoped `push.apns.register`/`server-node-events.ts`）；登出/切账号注销 token；仅元数据。
    - **前置契约：** `contracts/push-model.md`（2026-10-08 已拍板；v0.2 实现首刀）。MVP 触发=@mention；平台首刀=iOS APNs；多设备并存；独立员工 APNs env/topic；点击复用 Wave 1 Router。RPC=`employee.push.register|unregister|test`。本勾选框仅在**真机验收通过并合入 main**后勾选。
    - _Requirements: R-Native.1, 10.5_
  - [ ] 2.2 Android FCM 从零接入 · [android]（+ gateway 投递端）
    - 集成 FCM（注册/`onNewToken`/前后台投递）+ 服务端投递；与 employee 身份绑定。
    - **前置契约：** 同 `contracts/push-model.md`；排在 iOS 首刀之后。本勾选框仅在实现 PR 合并后勾选。
    - _Requirements: R-Native.1, 10.5_
  - [ ] 2.3 跨端会话连续性 · [gateway + ios/android/macos]
    - 统一 `sessionKey`/active agent；Web 发起 → 原生 chat 继续；`openChat` 携带 sessionKey/agentId。
    - _Requirements: 7.1, 7.2_
  - [ ] 2.4 图片上传（D-UPLOAD=图片一期）· [web-ui + gateway]
    - _Requirements: 7.4_
  - [ ] 2.5 更多 mobile surface（growth→workspace→knowledge）· [web-ui]
    - 按 §15.3 逐个手机重构 + 视口回归；知识条目阅读不被遮挡。
    - _Requirements: 5.8, 5.9_
  - [ ] 2.6 最低客户端门禁 C7（对外前就绪）· [gateway]
    - `gateway.minSupportedClient[platform].{hardMin,softMin}` + 握手判定（`message-handler.ts` 读 `client.version`）：`<hardMin`→拒绝+升级引导；软窗口→放行+提示；软门禁默认。
    - _Requirements: 9.6, 9.7_
  - [ ] 2.7 mobile agent picker parity · [web-ui]
    - _Requirements: 7.4_
  - [ ]\* 2.8 Wave 2 测试（推送 e2e / 连续性 / C7 门禁矩阵 / 上传）· [spec/release + QA]
    - _Requirements: 7.1, 9.7, R-Native.1_
  - [ ] 2.9 Wave 2 Checkpoint — 设计伙伴 beta（TestFlight external / Play closed）· [spec/release]
    - _Requirements: 9.1, 9.2, R-Matrix.3_

- [ ] 3. Wave 3 — Windows 桌面客户端（P3，公测 · D-PC-STACK=Tauri）· [windows]
  - [ ] 3.1 Tauri 壳脚手架（系统 WebView + Rust 壳）+ 托盘/窗口/深链协议注册 · [windows]
    - _Requirements: 6.2, 6.4, R-Native.2, R-Native.3_
  - [ ] 3.2 复用登录/bootstrap/桥接/深链到 Windows（对齐 macOS）· [windows]
    - _Requirements: 6.3_
  - [ ] 3.3 打包 + 签名 + 自动更新（Windows 更新源）· [windows]
    - _Requirements: 9.3, 9.4_
  - [ ] 3.4 Windows 网关侧文档（WSL2 运行 Gateway）· [windows]
    - _Requirements: 6.6_
  - [ ]\* 3.5 Windows 冒烟测试（登录→bootstrap→embed / 深链 / 自动更新）· [windows]
    - _Requirements: 9.1, R-Matrix.1_
  - [ ] 3.6 Wave 3 Checkpoint — 公测起步 · [spec/release]
    - _Requirements: 9.1, 9.2, R-Matrix.3_

- [ ] 4. GA 门 — employee 全端 GA（独立发布门 · Wave 3 之后 / Wave 4 之前）· [spec/release]
  - [ ] 4.1 GA 合规门禁：App Store 隐私标签 / Play Data Safety / 应用内账号删除(Apple 5.1.1(v)) / 遥测知情同意可关闭 · [spec/release + gateway]
    - _Requirements: 9.8, 9.9_
  - [ ] 4.2 a11y + i18n GA 校验：核心路径 a11y 全量、zh-CN/en 商店 listing 本地化 · [spec/release + web-ui]
    - _Requirements: 12.4, 11.3, R-Matrix.5_
  - [ ] 4.3 GA Checkpoint — employee 全端 GA（App Store / Play production / macOS Sparkle stable / Windows 稳定）· [spec/release]
    - _Requirements: 9.1, 9.5, R-Matrix.5_

- [ ] 5. Wave 4 — GA 之后增量（P4）
  - [ ] 5.1 Epic E1：新增 `ENTERPRISE_EMBED_SURFACES`/`PLATFORM_EMBED_SURFACES` + `/embed/{enterprise|platform}/*` 路由契约 · [gateway + web-ui]
    - _Requirements: 1.4, 3.8, 6.5_
  - [ ] 5.2 Epic E1：`isSafeEmbedTarget` 扩为**按会话域**白名单（前后端双校验）· [gateway + web-ui]
    - _Requirements: 3.8, 10.1_
  - [ ] 5.3 Epic E1：enterprise/platform 域 bootstrap + SPA 脱壳渲染 + 子域 tab 门禁 enforce · [gateway + web-ui]
    - _Requirements: 3.7, 6.5_
  - [ ] 5.4 PC 桌面接入管理面（D-PC-ADMIN=是；依赖 5.1–5.3）· [macos + windows]
    - _Requirements: 6.5, 1.4_
  - [ ] 5.5 `openbot` CLI onboarding 完善（端矩阵 CLI 行；无专属验收条款）· [gateway]
    - _Requirements: 1.1_
  - [ ] 5.6 Linux 客户端（视需求排期）· [windows]
    - _Requirements: 6.2_
  - [ ] 5.7 Wave 4 Checkpoint — 增量交付回归（不影响 employee GA 门禁）· [spec/release]
    - _Requirements: R-Matrix.1_

## Notes

- 文件路径全部仓库根相对（AGENTS.md）。标 `*` 为测试任务，可暂缓但强烈建议随波交付。
- **父任务不入依赖图**：`1.2/1.3/1.4/1.5/1.6/1.7/1.8` 为协调 + 验收门，不落码、不排 wave；依赖图只排**叶子子任务**。
- **归属生效**：`## Agents` 与本表均为 **proposal**；落码前各 owner `pnpm loom register`（registry 权威）+ 人建 worktree（`git worktree add ../openbot-<task> <owner>/<task>`，agent 不自建）。提交带 `Task: client-apps-pc-mobile` / `Agent: <owner>` trailer，`scripts/committer` 限定自己 paths，勿 `git add .`。
- **热区红线**：`apps/shared/OpenClawKit/**` 仅 `apple-shared` 落地（含 `DeepLinks.swift`）；Epic E1 若触及 `server-methods-list`/`method-scopes` 由 gateway 单一 owner 落地。
- **D-PUSH-SCOPE=A**：Wave 1 = 深链(1.7) + 本地/系统通知；employee 服务端推送(2.1/2.2)在 Wave 2。owner 分工：深链契约 = web-ui/apple-shared/android（1.2）；各端消费 = 平台 owner（1.7-\*）；服务端推送 = gateway（Wave 2）。**push 产品契约** = `contracts/push-model.md`（2.0-contract，2026-10-08）。
- **不回归红线**：`/native/bootstrap`、employee-shell 契约、既有 node/canvas/voice companion 不改语义；每波含 companion 回归（1.8-\*）。
- **原生构建 CI**：主 `pnpm` CI 不构建原生 app；iOS/Android/桌面走独立工具链，真机优先。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.0"] },
    { "id": 1, "tasks": ["1.1", "1.2-apple", "1.2-android", "1.3-contract"] },
    { "id": 2, "tasks": ["1.3-ios", "1.3-android", "1.3-macos"] },
    { "id": 3, "tasks": ["1.4-ios", "1.4-android", "1.4-macos"] },
    { "id": 4, "tasks": ["1.5-ios", "1.5-android", "1.5-macos"] },
    {
      "id": 5,
      "tasks": ["1.6-ios", "1.6-android", "1.6-macos", "1.7-ios", "1.7-android", "1.7-macos"]
    },
    { "id": 6, "tasks": ["1.8-ios", "1.8-android", "1.8-macos", "1.9"] },
    { "id": 7, "tasks": ["1.10"] },
    { "id": 8, "tasks": ["1.11"] },
    { "id": 9, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"] },
    { "id": 10, "tasks": ["2.8", "2.9"] },
    { "id": 11, "tasks": ["3.1"] },
    { "id": 12, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 13, "tasks": ["3.5", "3.6"] },
    { "id": 14, "tasks": ["4.1", "4.2"] },
    { "id": 15, "tasks": ["4.3"] },
    { "id": 16, "tasks": ["5.1", "5.2"] },
    { "id": 17, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 18, "tasks": ["5.6", "5.7"] }
  ]
}
```
