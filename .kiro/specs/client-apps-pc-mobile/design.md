# Design Document

> 中文名：**PC 端与移动手机端客户端交付 — 设计方案（Client Apps — PC + Mobile Design）**
> 状态：**设计草案 v1.1（已纳入设计评审）** · 创建：2026-07-14 · 修订：2026-07-14（v1→v1.1：① 推送修正为 employee 净新增，非复用 node 通道，Android FCM 从零；② 深链修正为净新增客户端路由，`openclaw` canonical / `openbot` legacy；③ 会话模型改为 account-scoped 容器，弃用 `URLSession.shared`；④ Apple 侧 401 检测机制补明；⑤ SSO 澄清为非既有路由）· 关联：`requirements.md`（v4）、`docs/design/tri-platform-unification-2026-07-05.md`（employee-shell 设计基准）。

## Overview

本设计把 `requirements.md` 的波次交付落到**可实现的组件、接口与链路**上，覆盖重点为 **Wave 1（employee 内部 beta）与 Wave 2**，对 **Wave 3（Windows）/ Wave 4（管理面 Epic E1、CLI）** 给出架构草图与前置条件。

**核心策略（复用既有地基，不重造）**：原生客户端 = **原生壳（登录/导航/设备能力/推送/深链）+ 嵌入的 Web 员工端（`/embed/employee/*`）+ 桥接**。所有业务界面复用共享 `ui` 包；原生只做壳与设备能力。已落地并被本设计直接复用的契约层：

- 网关：`src/gateway/native-bootstrap-http.ts`（`POST /native/bootstrap/mint`、`GET /native/bootstrap`）、`src/gateway/employee-shell/{bootstrap-token-store,embed-target,contract-baseline}.ts`、会话签发 `establishPlatformSessionCookie` + `resolveSessionContext(store,user,"employee")`（`platform-auth/auth-helpers.ts`）。
- 前端：`ui/src/ui/employee-shell/{embed-routes,native-bridge,native-host,embed-context,workbench-embed}.ts` + `employee-embed.css`。
- 原生骨架（未编译验证，待接入）：`apps/ios/Sources/EmployeeShell/EmployeeShellWebView.swift`、`apps/macos/Sources/OpenBot/EmployeeShellWebViewController.swift`、`apps/android/app/src/main/java/ai/openclaw/app/employeeshell/EmployeeShellWebView.kt`。

### 工作假设（采用 v4 倾向意见，可被推翻）

本设计在以下三个 Wave 1 阻塞决策上采用 `requirements.md` 的倾向意见作为**工作假设**（若评审改判，按对应组件回改）：

- **D-LOGIN = 独立登录面；Wave 1 不引入 employee MFA**。原生登录复用 platform-auth **既有密码登录路由**（`/login`、`/password/forgot`、`/password/reset`、`/employee/register`）取得 **employee 域会话**。**SSO 非既有路由**（platform-auth 未导出 OIDC/SSO，见 C1），Wave 1 不默认含；MFA 亦作为后续独立认证改造项（不阻塞 Wave 1）。
- **D-MACOS-FORM = 复用主窗口内嵌 employee 壳**（保留菜单栏 companion 与本地网关托管）。
- **D-COMPANION-IA = `Me > Device`**（手机聚焦对话 + 任务，companion 收纳到"我"）。

### 范围边界（设计层）

不重写 employee-shell 契约层 / `/native/bootstrap` / 既有 companion；不在本设计内实现管理面 embed（仅出 Epic E1 前置草图）；不引入独立于 `ui` 的第二套业务 UI。

## Architecture

```text
                       ┌──────────────────────────────────────────────┐
                       │              Cloud Gateway (Node)              │
                       │  gw/biz/admin.openbot.love  ·  TLS wss/https   │
                       │  platform-auth 会话 · /native/bootstrap        │
                       │  employee-shell v1 read-models · Chat · Push   │
                       │  [净新增] 最低客户端版本门禁(C7)               │
                       └───▲───────────────▲───────────────▲────────────┘
        HTTPS 登录/mint    │   302+Cookie   │   WS(node)     │  Push(APNs/FCM)
        ┌──────────────────┘               │                └──────────────┐
        │                                   │                               │
┌───────┴───────────────────────────────────┴───────────────┐   ┌──────────┴─────────┐
│                原生客户端壳（iOS/Android/macOS/Win）        │   │  推送服务(APNs/FCM) │
│  ┌────────────────────┐   ┌───────────────────────────────┐│   └────────────────────┘
│  │ 原生登录/Onboarding │   │  Device Companion（既有，不回归）││
│  │  → platform-auth    │   │  node 配对/Canvas/语音/屏幕/相机││
│  │    employee 会话     │   │  /后台/Exec(macOS)             ││
│  └─────────┬──────────┘   └───────────────────────────────┘│
│            │ mint→bootstrapPath                              │
│  ┌─────────▼───────────────────────────────┐  桥接(openbotEmployeeShell)
│  │  Employee Shell WebView（独立持久 cookie）│◀────────────┐│
│  │   加载 /native/bootstrap?token=&target=   │             ││
│  │   → 302 → /embed/employee/<surface>       │  ready/openChat/openSpace…
│  └───────────────────────────────────────────┘─────────────┘│
│            深链(openbot://) · 推送点击 · 语言/安全区          │
└──────────────────────────────────────────────────────────────┘
```

**原则**：① Gateway 唯一事实来源；② Employee Shell 与 Device Companion 双 surface 分离（独立 WebView + 独立数据存储）；③ 双身份（employee 会话 / node 配对）正交；④ chat 保持原生，经桥接跳转；⑤ 业务 UI 全部复用 `ui`。

## 关键链路（Sequence Flows）

### F1. 登录 → bootstrap → 嵌入（Wave 1 主链路）

1. 用户在**原生登录面**输入凭据（或走 SSO）。原生 HTTP 客户端（iOS `URLSession` / Android `OkHttp` / 桌面等价）向云网关 platform-auth 登录路由认证，取得 **employee 域的 HttpOnly 签名会话 cookie**，存入**该客户端专属 cookie jar**（非 WebView jar）。
2. 客户端以该会话 `POST /native/bootstrap/mint?target=/embed/employee/overview` → 返回 `{ ok, token, target, bootstrapPath }`（token 单次、≤60s、绑定 `{userId,userEmail,target}`）。
3. 客户端令 **Employee Shell WebView** 打开 `gatewayBaseURL + bootstrapPath`（`GET /native/bootstrap?token=&target=`）。
4. 网关 `consume(token)` → `resolveEmployeeSessionContext` → `establishPlatformSessionCookie`（写 **WebView 自己的 cookie jar** 的 HttpOnly 会话）→ **302** 到再校验后的 `target`。
5. WebView 落到 `/embed/employee/overview`（chrome-less 渲染，手机壳带 `?shell=mobile`）。embed 就绪后经桥接发 `ready`。

> 关键：mint 的鉴权主体是**客户端 cookie jar 的会话**；bootstrap 写入的是 **WebView cookie jar 的会话**。两 jar 隔离，避免长期会话被原生手工搬运（对齐 §5.4）。

### F2. 会话过期 → 静默 re-bootstrap

WHEN WebView 主帧收到 **401** THEN 客户端用 cookie jar 里的 employee 会话重新走 F1.2–F1.5（静默）；仅当客户端会话本身失效才回登录面。

### F3. 登出 / 切换组织

登出或切组织时：清 WebView cookie jar + 客户端 cookie jar 的 employee 会话（并请求服务端吊销）、清上一身份内存/缓存态；**不触碰 node 配对会话**。切组织后以新身份重跑 F1。

### F4. 推送 → 深链（Wave 1 原生价值）

推送投递（APNs/FCM）→ 用户点击 → 客户端解析 `openbot://` 深链 → **经会话域鉴权**（未登录先登录）→ 定位目标 surface/会话/知识条目：employee surface 走 embed 导航（`buildEmployeeEmbedPath`），chat/space/knowledge 走桥接 intent（`openChat`/`openSpace`/`openKnowledgeObject`）。

### F5. 最低客户端门禁（C7）

WS 握手时网关比对 `client.version` 与配置的最低支持版本：低于**硬下限**→拒绝并回结构化"需升级"错误；处于**软窗口**→放行 + 告警/提示升级。

## Components and Interfaces

### C1. 原生登录与会话（Wave 1 · R3）

- **登录面（三端原生）**：Wave 1 = **密码登录 + 忘记密码 + 受邀加入**（复用既有路由）；网关选择（云默认/自托管）；多账号/多组织切换。UI 用各端原生（不嵌入），文案走 i18n（R11）。
- **SSO 澄清（证据）**：platform-auth 仅导出 `handleLoginRoute`/`handlePassword*`/`handlePlatformBootstrapRoute` 等（`http-handler.ts`），控制 UI 提交 `/login`、`/password/forgot`、`/password/reset`、`/employee/register`（`controllers/platform-auth.ts`）——**无 SSO/OIDC 登录路由**。因此 SSO 分两种、二选一由 D-LOGIN 定：**(a) trusted-proxy 部署下企业入口（既有部署特例，非应用内 SSO）**；**(b) 面向云网关的通用 OIDC/SSO（净新增后端 + 客户端，单列依赖，Wave 1 不含）**。
- **认证复用**：调用既有密码登录路由取得 **employee 域会话**（复用后端，不新造）。**MFA**：employee entry 当前不经 MFA gate（`routes-login-password.ts` 仅 platform-entry gate）；Wave 1 不引入，作为 D-LOGIN 后续项。
- **account-scoped 会话容器（关键，防串味）**：每个 `{accountId, orgId}` 拥有**独立** HTTP 客户端会话 + cookie jar + WebView 数据存储；**弃用 `URLSession.shared`**（现骨架 `mintToken(session: URLSession = .shared)` 默认 `.shared` 是多账号 foot-gun，须替换为按账号注入的 `URLSession`/`WKWebsiteDataStore`）。切组织/登出只清对应账号容器。
- **会话存储（R10.6）**：各账号的 employee 会话与 node 凭据存平台安全存储——iOS Keychain、Android Keystore（复用 `SecurePrefs.kt`）、macOS Keychain、Windows Credential Manager/DPAPI、Linux Secret Service；**明文不落盘**，按 `accountId` 命名空间隔离。
- **接口（新增，端内）**：`AccountStore.list()/add()/remove(accountId)`；`AuthClient(accountId).login()/currentSession()/logout()`；`OrgSwitcher.switch(accountId, orgId)`；每个 `AuthClient` 绑定该账号的独立 `URLSession`（非 `.shared`）。

### C2. Bootstrap 接线（Wave 1 · R3/R4/R10）

- **复用服务端**：`POST /native/bootstrap/mint`、`GET /native/bootstrap` 已实现；**不改契约**。原生侧新增"取 token → 载入 bootstrapPath"客户端逻辑。
- **端内构件**：`EmployeeShellBootstrap.mintToken(target)`（用**该账号的独立 `URLSession`/OkHttp**（非 `.shared`）`POST …/mint`，解析 `bootstrapPath`）；`EmployeeShellBootstrap.withMobileShellMarker(target)`（手机壳给 target 追加 `?shell=mobile`；macOS 不加，均已在骨架）。
- **目标构造/校验**：用 `buildNativeBootstrapPath({token,target})` + `isSafeEmbedTarget`（前端）与服务端 `safeEmbedTargetOrDefault` 双校验，杜绝开放重定向。
- **401 处理（三端须等价，现状不等价）**：区分两类 401——(a) **mint 401**（账号会话失效，骨架 `mintToken` 已抛 `.unauthorized`）→ 回登录面；(b) **embed 主帧 401**（bootstrap 会话失效）→ 静默 re-bootstrap。检测机制：**Android 已实现** `WebViewClient.onReceivedHttpError`（主帧+401）；**Apple 侧需补** `WKNavigationDelegate.webView(_:decidePolicyFor:navigationResponse:)` 检查 `(response as? HTTPURLResponse)?.statusCode == 401`（现 iOS/macOS 骨架仅处理 `didFail`/`didFailProvisionalNavigation` 导航错误，**未检 HTTP 401**）。
- **后端演进（可选，非 Wave 1 必需）**：`NativeBootstrapHttpDeps.readSessionContext` 目前读 web 会话 cookie；native-login 落地后 mint 主体切到 native Employee Identity 时，仅需替换该注入依赖，`consume` 侧不变（tri-platform §14.5）。

### C3. Employee Shell 容器与桥接（Wave 1 · R4）

三端骨架已在（§14.6），本组件做**编译验证 + 接入导航/网关/会话**：

- **独立 WebView + 独立数据存储**：iOS/macOS 用**持久** `WKWebsiteDataStore.default()`（与 Canvas 的 `.nonPersistent()` 隔离）；Android 靠 cookie 域隔离，必要时 `WebView.setDataDirectorySuffix` 按实例隔离。
- **桥接注册**：统一 handler 名 **`openbotEmployeeShell`**（`native-host.ts` 的 `EMPLOYEE_SHELL_HOST_HANDLER`）——WKWebView `WKUserContentController.add(_, name:)`；Android `addJavascriptInterface(_, "openbotEmployeeShell")`。
- **消息解码**：原生侧镜像 `parseEmployeeShellBridgeMessage` 的**严格版本化解码**（`version===1`，拒绝未知 type/缺失必填），映射为原生 `EmployeeShellIntent`（`ready/openChat/openAssistant/openSpace/openKnowledgeObject/openDeviceSettings`）。Android 回调经 `Handler(mainLooper)` 切主线程。
- **intent 路由（Wave 1 保持小范围）**：`openChat/openAssistant` → **原生 chat**（既有）；`openDeviceSettings` → companion（`Me > Device`）。**`openSpace/openKnowledgeObject`：Wave 1 采用 Web 复用**——桥接后由壳导航到对应 embed surface（`/embed/employee/workspace` / `.../knowledge`），**不新建原生目的地界面**（当前原生端无对应目的地，纯原生化会悄悄扩大范围）；原生专属界面延后到 Wave 2+ 视需要。
- **macOS 形态（D-MACOS-FORM=主窗口内嵌）**：`EmployeeShellWebViewController` 挂在主窗口的 employee 区，菜单栏 companion 独立保留；embed **不带** `shell=mobile`（功能与网页对齐）。
- **注入依赖**：`gatewayBaseURL` + `tokenProvider(target)`（= C2 mintToken）+ `onIntent` + `onBootstrapError`。

### C4. 云连通与网关选择（Wave 1 · R2）

- **默认云网关**：首启即可指向 `https://gw.openbot.love`（employee=gw；biz/admin 供 Wave 4），无需局域网发现/配对即可登录。
- **网关配置**：Onboarding 提供"云默认 / 自托管地址"入口；地址持久化到安全存储。传输强制 TLS；明文仅本地/局域网调试路径（对齐既有 Android `adb reverse`）。
- **连通与配对解耦**：employee 会话可独立于 node 配对；仅需设备能力时才配对。
- **失败态**：网关不可达 → 明确失败 + 重试；embed 主帧失败/超时 → 原生占位 + 退避重连；断网 → 只读降级 + 恢复重连（R2.5–2.7）。

### C5. 推送通知与深链（原生价值 · R-Native）· **均为净新增**

> **现状（证据，纠正 v1 的"复用"表述）**：iOS APNs 注册走 **node 通道**（`nodeGateway.sendEvent("push.apns.register")`，服务端按 `nodeId` 注册：`NodeAppModel.swift` / `server-node-events.ts`）——**绑定的是设备 node 身份，不是 employee 会话**；`apps/android` 下**无任何 FCM/Firebase 实现**（grep 无命中）。深链解析器只支持 `agent/gateway/workspace`，且 canonical scheme 是 **`openclaw`**、`openbot` 为 legacy alias（`DeepLinks.swift`）。因此推送与深链**都是净新增，不是薄接线**。

- **推送（净新增，employee-scoped）**：需新增**按 employee 身份/会话绑定**的注册与投递模型（区别于既有 node-scoped APNs）；**Android 从零接入 FCM**（注册/`onNewToken`/投递）；桌面用系统通知。登出/切账号注销 token。投递仅元数据（不含业务明文，R10.5）。
- **深链（净新增客户端路由）**：需在共享 `DeepLinkParser`（`apps/shared/OpenClawKit/.../DeepLinks.swift`）与 Android 等价物**新增 host**：`employee/<surface>`、`chat?sessionKey=&agentId=`、`space/<spaceId>`、`knowledge/<objectId>`；**两个 scheme 都要收**（`openclaw` canonical + `openbot` legacy）；+ universal/app links + 桌面协议注册。
- **鉴权**：深链解析**先过会话域鉴权**（未登录 → 登录后继续），再映射到 embed 导航或桥接 intent；**不绕过登录/权限**（R-Native.2）。
- **Wave 1 范围风险（D-PUSH-SCOPE）**：因两者均净新增（尤其 employee-scoped 推送 + Android FCM 从零），若要保持 Wave 1"小而可交付"，倾向 **Wave 1 先落"深链 + 本地/系统通知点击直达"**、**服务端 employee 推送（APNs 重绑 + FCM）作为 late-Wave1/Wave2 快随**。此选择会牵动 `requirements.md` R-Native.6（Wave 1 须证明"通知+深链"）——若采纳，需同步微调该验收。**待 D-PUSH-SCOPE 定案**。

### C6. 移动手机层重构（Wave 1: overview/me；Wave 2: 其余 · R5/§15）

- **基础层**：`ui/index.html` 加 `viewport-fit=cover`；在 `.employee-embed` / `.employee-embed--mobile` 作用域内加手机断点（≤430/≤380）+ `env(safe-area-inset-*)` + 惯性滚动；**局部落地**避免大改 `workbench.css`（22k 行、共享热区）。
- **平台标记**：手机专属裁剪一律经 `employee-embed--mobile` / `mobile` 门禁（`resolveEmployeeEmbedRouting` + `app-settings.ts` 的 embed 分支），**不用视口宽度**（防 macOS 窄窗误伤）。
- **触屏**：hover-only 交互加 `@media (hover: hover)` 守卫 + 触屏等价（常显/点击）。
- **surface 顺序**：overview → me（Wave 1）→ growth → workspace → knowledge（Wave 2），逐个附手机视口回归。
- **验证驱动**：每个 surface 配 Playwright 手机视口（390×844/360×800）断言无横向溢出 + 单列 + 点击区 ≥44px；真机 WebView 目检安全区/惯性滚动/hover。
- **任务型门禁**：M-COLD ≤10s / M-TTI ≤3s（R-Matrix）、关键路径单手可达、知识条目不被遮挡（Wave 2）。

### C7. 最低客户端版本门禁（净新增网关能力 · Wave 2 前就绪 · R9.7/D-MINCLIENT）

- **现状**：WS 握手（`src/gateway/server/ws-connection/message-handler.ts`）仅协商 `minProtocol/maxProtocol` 并记录 `client.version`，**无 app 版本门禁**。
- **新增**：网关配置 `gateway.minSupportedClient`（按平台可选：`{ios,android,macos,windows}` 的 `hardMin` / `softMin`）。握手读 `client.version` + 平台：`< hardMin` → 拒绝并回结构化 `code=client_upgrade_required`（客户端展示升级引导）；`hardMin ≤ v < softMin` → 放行 + 下发"建议升级"提示；`≥ softMin` → 正常。
- **兼容**：与既有协议协商叠加；legacy `openclaw-*` client id 仍按 `client-info.ts` 归一。
- **软门禁默认**：先告警后拒绝（D-MINCLIENT 倾向），给灰度留缓冲。

### C8. 管理面 embed（前置 Epic E1 · Wave 4 · 仅草图）

> ⚠️ **净新增，非复用**：当前 `EMPLOYEE_EMBED_SURFACES` 与 `isSafeEmbedTarget` **只允许 `/embed/employee/*`**（`embed-routes.ts` / `embed-target.ts`）。管理面需独立立项：

- 新增 `ENTERPRISE_EMBED_SURFACES` / `PLATFORM_EMBED_SURFACES` + `/embed/{enterprise|platform}/*` 路由契约；
- 前后端 `isSafeEmbedTarget` 扩展为**按会话域**的白名单（employee/enterprise/platform 各自允许集，互不越权）；
- `resolveSessionContext` 支持 `enterprise`/`platform` 域的 bootstrap（会话签发 `establishPlatformSessionCookie` 已支持域，可复用）；
- SPA 脱壳渲染这些 port + 子域 tab 门禁（`isTabAllowedBySubdomain`）强制执行；
- 桌面壳按 D-PC-ADMIN 接入。**Wave 1–3 不做**。

### C9. Windows/Linux 桌面壳（Wave 3 · R6/D-PC-STACK）

- **技术形态待定（D-PC-STACK，倾向 Tauri）**：Tauri = 系统 WebView + Rust 壳，天然复用 embed + 深链 + 托盘 + 自动更新，跨三桌面一致；Electron 为备选。选跨端框架 = 显式推翻 tri-platform §4.2，需评审确认。
- 复用 C1–C5 的登录/bootstrap/桥接/推送/深链设计；Windows 网关侧建议 WSL2 运行 Gateway（客户端仅作前端）。

## 数据模型与契约（Contracts）

### 桥接消息（既有，原生侧镜像实现）

```
version: 1 (EMPLOYEE_SHELL_BRIDGE_VERSION)
type: ready | openChat | openAssistant | openSpace | openKnowledgeObject | openDeviceSettings
payload:
  ready:               { surface?: EmployeeEmbedSurface }
  openChat:            { sessionKey?: string; agentId?: string }
  openAssistant:       { agentId?: string }
  openSpace:           { spaceId: string }
  openKnowledgeObject: { objectId: string; kind?: string }
  openDeviceSettings:  { section?: string }
wire: JSON string via handler "openbotEmployeeShell"（严格校验，未知即丢弃）
```

### Bootstrap（既有）

```
POST /native/bootstrap/mint?target=/embed/employee/<surface>
  auth: 客户端 cookie jar 的 platform-auth 会话（SameSite=Lax → CSRF 安全）
  200 → { ok:true, token, target, bootstrapPath }
GET  /native/bootstrap?token=&target=
  consume(token,单次≤60s) → establishPlatformSessionCookie(域=employee) → 302 target
  无效/过期/已用 → 401（触发 re-bootstrap）；缺 token → 400
```

### 深链 grammar（净新增 host，非薄包装）

- **scheme**：`openclaw`（canonical）+ `openbot`（legacy，均须接受，`DeepLinkSchemeSupport`）。
- **既有 host**：`agent` / `gateway` / `workspace`（`DeepLinkParser`）——不动。
- **新增 host（本规格）**：`employee/<surface>` · `chat?sessionKey=&agentId=` · `space/<spaceId>` · `knowledge/<objectId>`（+ universal/app links + 桌面协议）。需扩展 `DeepLinkParser` + Android 等价物 + 各 host 的解析测试。

### 最低客户端握手（新增，C7）

请求含 `client.{id,version,platform}`；网关按 `gateway.minSupportedClient[platform].{hardMin,softMin}` 判定 `ok | upgrade_suggested | client_upgrade_required`。

### 端上会话模型（account-scoped，新增，R10.6）

**按账号命名空间**（非单例）：`accounts[accountId] = { employeeSession(签名会话), gatewayBaseURL, orgId, pushToken, urlSessionId, webDataStoreId }`；全局 `activeAccountId` + `appLockPolicy`。每账号一套独立 `URLSession`/cookie jar/`WKWebsiteDataStore`，与 Canvas 非持久存储三方隔离；切账号仅切 `activeAccountId`，登出/移除只清该账号命名空间。**不用 `URLSession.shared`**。

## 错误处理与降级（R2/R3/R9）

| 场景                               | 处理                                               |
| ---------------------------------- | -------------------------------------------------- |
| 登录失败（凭据/网络）              | 明确错误 + 重试；区分"网关不可达"与"凭据错误"      |
| mint 401（客户端会话失效）         | 回登录面                                           |
| bootstrap 302 前 401（token 失效） | 静默 re-bootstrap（F2）；连续失败 N 次才提示重登   |
| embed 主帧加载失败/超时            | 原生占位 + 重试按钮 + 退避重连；不停留空白 WebView |
| 断网                               | 只读降级 + 恢复自动重连；不做离线写                |
| 桥接消息非法                       | 严格校验丢弃 + 记录，不 crash                      |
| 客户端过旧（C7 hardMin）           | 拒绝 + 升级引导；softMin → 提示但放行              |
| 组织切换                           | 清双 jar + 缓存，重跑 F1；不动 node 配对           |

## 测试策略（对齐 R-Matrix / AGENTS.md）

- **共享 `ui`（可在本机跑）**：employee-shell 契约层单测（已存在，扩展）；embed 手机视口 Playwright（390×844/360×800）断言无横向溢出/单列/点击区；`employee-embed--mobile` 门禁 chromium 测试。
- **网关（Node/Vitest）**：`/native/bootstrap` mint/consume 回归（已存在）；C7 最低客户端门禁新增单测（hardMin/softMin/平台矩阵）；platform-auth 会话回归。
- **原生（需 Mac/Android 工具链，真机优先）**：bridge 严格解码单测；登录→bootstrap→embed 冒烟；401 re-bootstrap；companion 不回归回归集（配对/Canvas/语音/Exec）；深链→鉴权→直达；a11y 核心路径（VoiceOver/TalkBack）。iOS/Android 优先连真机（AGENTS.md）。
- **发布门禁度量**：crash-free（诊断管道）、登录成功率、M-COLD/M-TTI 埋点；每阶段准入校验（R-Matrix）。
- 说明：主 `pnpm` CI 不构建原生 app；原生构建/测试走独立工具链（tri-platform §14.6）。

## 安全考量（R10）

- **会话链路**：mint 靠 SameSite=Lax cookie（CSRF 安全）；token 单次≤60s、仅存哈希；`target` 站内相对白名单 + 前后端双校验（`isSafeEmbedTarget`）；bootstrap URL 的 token 经 `Referrer-Policy: no-referrer` 防泄漏（既有）。
- **双 cookie jar 隔离**：客户端登录会话 jar ≠ WebView 会话 jar ≠ Canvas 非持久 jar；三者互不串味。
- **端上凭据**：安全存储（Keychain/Keystore/DPAPI/Secret Service），可选 app-lock/生物识别。
- **不出域**：业务数据仅 OpenBot/Gateway 域；受控例外 = APNs/FCM(元数据)、商店、更新源、诊断上报(可 opt-out/不含业务明文)。
- **深链**：先鉴权后路由，防未授权直达。

## 波次落地映射（Component × Wave）

| 组件                     | Wave 1                           | Wave 2                                 | Wave 3     | Wave 4                      |
| ------------------------ | -------------------------------- | -------------------------------------- | ---------- | --------------------------- |
| C1 登录/会话             | ✅ iOS/Android/macOS             | 完善多组织                             | +Windows   | +enterprise/platform 域     |
| C2 Bootstrap 接线        | ✅                               | —                                      | +Windows   | mint 主体切 native identity |
| C3 Shell 容器/桥接       | ✅ 三端接入                      | intent 扩展                            | +Windows   | —                           |
| C4 云连通/网关选择       | ✅                               | —                                      | +Windows   | —                           |
| C5 推送/深链（净新增）   | 深链+本地/系统通知(D-PUSH-SCOPE) | employee 推送: APNs 重绑 + Android FCM | 桌面通知   | —                           |
| C6 移动手机层            | overview/me                      | growth/workspace/knowledge             | —          | —                           |
| C7 最低客户端门禁        | 设计                             | ✅ 就绪(对外前)                        | —          | —                           |
| C8 管理面 embed(Epic E1) | —                                | —                                      | —          | ✅(可选)                    |
| C9 Windows/Linux 壳      | —                                | —                                      | ✅ Windows | Linux 视需求                |

## 需求覆盖映射（Design → Requirements）

- C1 → R3, R10.6/10.7；C2 → R3, R4, R10.1/10.2；C3 → R4, R7；C4 → R2；C5 → R-Native；C6 → R5；C7 → R9.7；C8 → R1.4, R3.8, R6.5；C9 → R6, R9.3。
- 跨切：R1 端矩阵（波次映射表）、R8 品牌（各端壳文案/图标）、R11 i18n（C1/C6 文案）、R12 a11y（C3/C6 核心路径）、R-Matrix（测试/门禁）。

## 待确认决策（复述，影响本设计）

- **Wave 1 阻塞**：D-LOGIN（已假设=独立登录面 + 不引入 employee MFA；**SSO 二选一：(a) trusted-proxy 企业入口既有 / (b) 通用 OIDC 净新增**，见 C1）、D-MACOS-FORM（=主窗口内嵌）、D-COMPANION-IA（=Me>Device）。
- **D-PUSH-SCOPE（新增，影响 Wave 1 体量）**：employee 推送与深链均为**净新增**（APNs 现为 node-scoped、Android 无 FCM）。选项：**(A) Wave 1 先做深链+本地/系统通知，employee 服务端推送作 late-W1/W2 快随**（倾向，保 Wave 1 小）；**(B) Wave 1 直接做全量 employee 推送**（Wave 1 变大）。若选 A，须同步微调 `requirements.md` R-Native.6 的 Wave 1 验收。
- **后续波次**：D-MINCLIENT（C7，倾向软门禁）、D-UPLOAD（Wave 2）、D-PC-STACK（C9，倾向 Tauri）、D-PC-ADMIN（C8/Epic E1）、D-RENAME（GA 前）。

> 评审确认上述三个 Wave 1 决策后，进入 `tasks.md`（依赖图 + `## Agents` 签入块 + Loom 注册）。
