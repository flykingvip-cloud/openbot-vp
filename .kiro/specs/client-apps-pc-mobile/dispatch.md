# 多 Agent 分派与执行指令（Dispatch & Per-Agent Briefs）

> 配套：`requirements.md`(v4) · `design.md`(v1.1) · `tasks.md`(可分派版)。
> **本文件只做"分派 + 启动指令"层**；任务内容与验收以 `tasks.md` 为唯一事实来源。所有 agent **共看同一套三份规格**，各自只执行自己 owner 的任务。

## 用法

1. 每个 agent 在**自己的 session/worktree** 内运行，先读三份规格 + 本文件对应 agent 段落。
2. 按「全体通用规则」完成 `loom register` 签入，再动工。
3. 只改自己 `paths` 内文件；跨边界需求走对应 owner，不直接改他人路径。

## 并行度（按阶段）

| 阶段               | 可并行 agent                                       | 说明                                       |
| ------------------ | -------------------------------------------------- | ------------------------------------------ |
| ① foundation       | **4**：spec/release、web-ui、apple-shared、android | 出决策/契约/手机层/深链解析基础            |
| ② platform fan-out | **6**：+ ios、macos（android 继续）                | 三平台流并行，web-ui/spec 收尾协调         |
| ③ integration/gate | 3–4：spec/release 主导 + 平台 owner 配合           | companion 回归、i18n/a11y、测试、内部 beta |
| Wave 2             | **+gateway**（共 ~7）                              | 推送后端 + C7 + 连续性                     |
| Wave 3             | **+windows**（共 ~8）                              | Tauri 桌面                                 |

> 关键路径：`1.0`(决策定案) ✅已完成 → `1.3-contract`(会话模型) → 平台 `1.3→1.4→1.5→1.6/1.7`。**决策门已清（2026-07-14）；平台 agent 仍需等 `1.3-contract` + `1.2-apple` 就绪**再开 fan-out。

## 全体通用规则（每个 agent 必须遵守）

1. **先读后做**：`requirements.md` + `design.md` + `tasks.md` + 本文件你的段落；不重复造 `/native/bootstrap`、employee-shell 契约、既有 companion。
2. **签入（落码前必做）**：
   `pnpm loom register --task client-apps-pc-mobile:<owner> --owner <你的具名 agent-id> --session-id <uuid> --ide <ide> --agent <你的具名 agent-id>`
   （registry 权威；只改 `tasks.md` 的 `## Agents` **不算**登记。worktree 由人建：`git worktree add ../openbot-<owner> <owner>/client-apps-pc-mobile`，**agent 不自建**。）
3. **路径纪律**：只改自己 `paths` 内文件；`scripts/committer "<msg>" <files...>` 限定自己文件，**禁止 `git add .`**。提交带 trailer：`Task: client-apps-pc-mobile` 与 `Agent: <owner>`。
4. **热区红线**：`apps/shared/OpenClawKit/**` 只有 **apple-shared** 能落地（含 `DeepLinks.swift`），ios/macos 只消费；共享注册表（`server-methods-list`/`method-scopes`，若 Epic E1 触及）只有 **gateway** 落地。
5. **决策门（2026-07-14 已清）**：Wave 1 的 D-LOGIN/D-MACOS-FORM/D-COMPANION-IA/D-PUSH-SCOPE **已定案**（`1.0` 完成），可据以落码；fan-out 仍需 `1.3-contract`(spec/release) + `1.2-apple`(apple-shared) 就绪。`【暂定】` 项（D-MINCLIENT/D-UPLOAD/D-PC-STACK/D-PC-ADMIN/D-RENAME）在各自波次前确认，**不得提前据以落码**。
6. **父任务不落码**：`1.2~1.8` 父任务仅协调 + 验收；你只做自己的 `-ios/-android/-macos/-apple/-contract` 子任务。
7. **不回归**：引入壳不得削弱既有 node 配对/Canvas/语音/相机/后台/Exec；每平台交付含 companion 回归（`1.8-*`）。
8. **验证**：改共享 `ui` 跑 `OPENBOT_TEST_PROFILE=low pnpm test <paths>` + 手机视口 Playwright；原生改动在 Mac/Android 真机编译冒烟（主 `pnpm` CI 不构建原生，真机优先）。
9. **净新增须带测试**：深链新 host、account 会话、（W2）推送、C7 门禁均须独立单测。
10. **完成即绿灯提交**：每到"诊断干净 + 相关测试过 + 一个逻辑单元完成"就提交（高频小步），阻塞则在 `tasks.md` 留签名 WIP note 交接。

## 依赖速览（谁等谁）

- `1.0`(spec/release) → 解锁所有 fan-out（决策定案）。
- `1.3-contract`(spec/release) → 解锁 `1.3-{ios,android,macos}`。
- `1.2-apple`(apple-shared) → 解锁 ios/macos 的 `1.7-*`（深链消费）；`1.2-android` 自解锁 android `1.7-android`。
- 平台链：`1.3-<p> → 1.4-<p> → 1.5-<p> → {1.6-<p>, 1.7-<p>}`；`1.8-<p>` 可较独立、末期验收。
- `1.1`(web-ui) 与平台流并行；`1.9/1.10/1.11` 收口在最后。

---

## Agent: spec/release

- **owner id**：`spec/release`（register 时用具名，如 `kiro-release`）
- **owned tasks**：`1.0`、`1.3-contract`、`1.9`(协调)、`1.10`(测试收口)、`1.11`、`2.8/2.9`、`3.6`、`4.1/4.2/4.3`(GA 门)、`5.7`。
- **paths**：`.kiro/specs/client-apps-pc-mobile/**`
- **depends-on**：`1.0` 无（最先）；`1.11` 依赖 Wave 1 全部子任务。
- **done-when**：决策定案写回；1.3-contract 模型冻结；各 checkpoint/GA 门按 R-Matrix 指标收口。

```text
你是 spec/release owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements.md,design.md,tasks.md,dispatch.md}。
签入：pnpm loom register --task client-apps-pc-mobile:spec/release --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改 .kiro/specs/client-apps-pc-mobile/**。执行 1.0：推进 D-LOGIN/D-MACOS-FORM/D-COMPANION-IA/D-PUSH-SCOPE 正式定案，把结果写回 requirements 决策表 + tasks「决策状态」(标【已定案】)，并按 D-PUSH-SCOPE=A 微调 R-Native.6。随后产出 1.3-contract：account 会话/存储模型（accountId 命名空间、存储键、隔离规范）。之后守护各 checkpoint/GA 门（1.11/2.9/3.6/4.3）按 R-Matrix 指标验收。提交 trailer：Task: client-apps-pc-mobile / Agent: spec/release。不落任何 apps/** 或 ui/** 或 src/** 代码。
```

---

## Agent: web-ui

- **owned tasks**：`1.1`(手机层 overview/me)、`1.2` 深链 grammar 协调、`1.9`(embed i18n/a11y)、`2.4/2.5/2.7`(W2)。
- **paths**：`ui/src/ui/employee-shell/**`,`ui/src/styles/**`,`ui/index.html`,`ui/src/i18n/**`
- **depends-on**：无（foundation 并行）；深链 grammar 与 apple-shared/android 对齐后各自实现。
- **done-when**：`viewport-fit=cover` + 手机断点/安全区落地；overview/me 手机视口回归全绿；embed i18n/a11y 核心路径过。

```text
你是 web-ui owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements,design,tasks,dispatch}.md。
签入：pnpm loom register --task client-apps-pc-mobile:web-ui --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改 ui/src/ui/employee-shell/**、ui/src/styles/**、ui/index.html、ui/src/i18n/**。执行 1.1：ui/index.html 加 viewport-fit=cover；在 .employee-embed/.employee-embed--mobile 作用域加手机断点(≤430/≤380)+env(safe-area-inset-*)+惯性滚动；overview/me 触屏化(@media (hover:hover) 守卫)；补 Playwright 手机视口(390×844/360×800)断言无横向溢出/单列/点击区≥44px。与 apple-shared/android 对齐深链 grammar(1.2 父)。1.9：embed i18n(zh/en) + 核心路径 a11y。验证：OPENBOT_TEST_PROFILE=low pnpm test <改动的 ui 路径>。提交 trailer：Task: client-apps-pc-mobile / Agent: web-ui。不改 workbench.css 大面积、不碰 apps/**、src/**。
```

---

## Agent: apple-shared

- **owned tasks**：`1.2-apple`（`DeepLinks.swift` 新 host + 测试）；后续（稳定后）Apple 侧 bridge/bootstrap 上移共享包。
- **paths**：`apps/shared/OpenClawKit/**`（**唯一可落地此路径**）
- **depends-on**：深链 grammar（与 web-ui 对齐）。
- **done-when**：`DeepLinkParser` 支持 `employee/chat/space/knowledge` + 双 scheme(`openclaw`+`openbot`)，解析单测全绿；ios/macos 可消费。

```text
你是 apple-shared owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements,design,tasks,dispatch}.md。
签入：pnpm loom register --task client-apps-pc-mobile:apple-shared --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改 apps/shared/OpenClawKit/**（热区，仅你可落地；ios/macos 只消费你的产物）。执行 1.2-apple：扩展 apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift 的 DeepLinkParser，新增 host employee/<surface>、chat、space、knowledge，两个 scheme(openclaw canonical + openbot legacy)都收，加解析单测。保持既有 agent/gateway/workspace host 不动。在 Mac 上编译验证。提交 trailer：Task: client-apps-pc-mobile / Agent: apple-shared。不改 apps/ios/**、apps/macos/**。
```

---

## Agent: ios

- **owned tasks**：`1.3-ios`、`1.4-ios`、`1.5-ios`、`1.6-ios`、`1.7-ios`、`1.8-ios`。
- **paths**：`apps/ios/**`（消费 apple-shared 的 `OpenBotKit`，**不改** `apps/shared/**`）
- **depends-on**：`1.0`(定案)、`1.3-contract`(模型)、`1.2-apple`(深链，供 1.7-ios)。
- **done-when**：真机 登录→bootstrap→embed(overview/me) 可用；401 静默 re-bootstrap；深链+本地通知直达；companion 不回归。

```text
你是 ios owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements,design,tasks,dispatch}.md。
签入：pnpm loom register --task client-apps-pc-mobile:ios --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
前置门：等 spec/release 完成 1.0 决策定案 + 1.3-contract 会话模型、apple-shared 完成 1.2-apple 深链后再开工。
只改 apps/ios/**（消费 OpenBotKit，勿改 apps/shared/**）。按序执行：
- 1.3-ios：Keychain + per-account URLSession/WKWebsiteDataStore（弃用 .shared，替换 EmployeeShellBootstrap.mintToken 默认参数）。
- 1.4-ios：原生登录/onboarding UI（密码+找回+邀请+网关选择+多账号/组织切换），接既有 platform-auth 路由取 employee 域会话；SSO 走 trusted-proxy；不引入 MFA。
- 1.5-ios：接入 EmployeeShellWebView.swift（gatewayBaseURL 默认云网关/TLS + tokenProvider=该账号 URLSession 调 mint）；严格解码桥接(version===1)：openChat/openAssistant→原生 chat，openSpace/openKnowledgeObject→embed 导航，openDeviceSettings→Me>Device；embed 失败→原生占位+退避；手机壳加 shell=mobile。
- 1.6-ios：WKNavigationDelegate.decidePolicyFor navigationResponse 检 statusCode==401 → 静默 re-bootstrap；mint 401→回登录；登出/切组织清双 jar+缓存、不动 node 配对。
- 1.7-ios：深链路由(经会话域鉴权)+本地通知点击直达。
- 1.8-ios：配对/Screen/Voice/相机/后台 companion 回归 + Me>Device 入口。
在真机编译冒烟。提交 trailer：Task: client-apps-pc-mobile / Agent: ios。
```

---

## Agent: android

- **owned tasks**：`1.2-android`(Kotlin 深链)、`1.3-android`、`1.4-android`、`1.5-android`、`1.6-android`、`1.7-android`、`1.8-android`；(W2) `2.2` Android FCM。
- **paths**：`apps/android/**`
- **depends-on**：`1.0`、`1.3-contract`；`1.2-android` 自解锁 `1.7-android`。
- **done-when**：真机 登录→bootstrap→embed(overview/me)；401(已有 onReceivedHttpError)→re-bootstrap；深链+本地通知；companion 不回归。

```text
你是 android owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements,design,tasks,dispatch}.md。
签入：pnpm loom register --task client-apps-pc-mobile:android --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
前置门：等 spec/release 完成 1.0 + 1.3-contract 再开壳；1.2-android 可在 foundation 期先做。
只改 apps/android/**。按序执行：
- 1.2-android：Kotlin 深链解析器，host employee/chat/space/knowledge，双 scheme(openclaw+openbot)，加测试；**结果与 Swift 逐条一致，含 query 形 employee?surface=（见 deeplink-grammar.md 共享向量末行）**。
- 1.3-android：Keystore(SecurePrefs.kt) + per-account cookie/WebView.setDataDirectorySuffix；弃用共享 .shared 式默认。
- 1.4-android：原生登录/onboarding UI（同 ios 能力集），接既有 platform-auth 路由取 employee 域会话；SSO 走 trusted-proxy；不引入 MFA。
- 1.5-android：接入 EmployeeShellWebView.kt（gatewayBaseURL 默认云网关/TLS + tokenProvider）；桥接严格解码 + intent 路由(chat→原生，space/knowledge→embed 导航，deviceSettings→Me>Device)；embed 失败占位+退避；手机壳 shell=mobile。
- 1.6-android：复用 onReceivedHttpError(主帧 401)→静默 re-bootstrap；mint 401→回登录；登出/切组织清 cookie+缓存、不动 node 配对。
- 1.7-android：深链路由(会话域鉴权)+本地通知直达。
- 1.8-android：配对/Screen/Voice/相机/后台回归 + Me>Device。
在真机编译冒烟。提交 trailer：Task: client-apps-pc-mobile / Agent: android。勿碰 apps/ios、apps/macos、apps/shared。
```

---

## Agent: macos

- **owned tasks**：`1.3-macos`、`1.4-macos`、`1.5-macos`、`1.6-macos`、`1.7-macos`、`1.8-macos`。
- **paths**：`apps/macos/**`（消费 apple-shared 的 `OpenBotKit`，**不改** `apps/shared/**`）
- **depends-on**：`1.0`、`1.3-contract`、`1.2-apple`。
- **done-when**：主窗口内嵌 employee 壳（**不带** `shell=mobile`，与网页对齐）；401→re-bootstrap；深链+系统通知；菜单栏 companion/Canvas/Exec/语音唤醒不回归。

```text
你是 macos owner。先读 .kiro/specs/client-apps-pc-mobile/{requirements,design,tasks,dispatch}.md。
签入：pnpm loom register --task client-apps-pc-mobile:macos --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
前置门：等 1.0 定案 + 1.3-contract + 1.2-apple。只改 apps/macos/**（消费 OpenBotKit，勿改 apps/shared/**）。
- 1.3-macos：Keychain + per-account WKWebsiteDataStore（弃用 .shared）。
- 1.4-macos：登录/onboarding UI（同能力集）取 employee 域会话；SSO 走 trusted-proxy；不引入 MFA。
- 1.5-macos：EmployeeShellWebViewController.swift 主窗口内嵌(D-MACOS-FORM)，保留菜单栏 companion；gatewayBaseURL+tokenProvider；桥接 intent 路由(space/knowledge→embed 导航)；embed 失败占位；**embed 不带 shell=mobile**(保网页功能对齐)。
- 1.6-macos：decidePolicyFor navigationResponse 检 401→re-bootstrap；登出清会话、不动 node。
- 1.7-macos：深链路由(会话域鉴权)+系统通知直达。
- 1.8-macos：Canvas/Exec 审批/语音唤醒/本地网关托管回归 + companion 入口。
在 Mac 上编译验证（勿通过 SSH 重建 mac app，直接在 Mac 上）。提交 trailer：Task: client-apps-pc-mobile / Agent: macos。
```

---

## Agent: gateway （Wave 2 加入；Wave 1 基本空闲）

- **owned tasks**：`2.1`(employee APNs 重绑)、`2.2` 服务端投递、`2.3`(连续性后端)、`2.6`(C7 最低客户端门禁)；(W4) Epic E1 `5.1/5.2/5.3` 后端 + `5.5` CLI。
- **paths**：`src/gateway/employee-shell/**`,`src/gateway/native-bootstrap-http.ts`,`src/gateway/server-node-events.ts`,`src/gateway/server/ws-connection/**`,`src/gateway/platform-auth/**`,`src/gateway/protocol/client-info.ts`
- **W1 说明**：Wave 1 登录复用既有 `establishPlatformSessionCookie`/`resolveSessionContext`，**无需 gateway 改动**；gateway 从 Wave 2 开工。
- **done-when**：employee-scoped 推送注册/投递可用；C7 hard/soft 门禁 + 升级引导；平台/契约回归绿。

```text
你是 gateway owner。先读三份规格 + dispatch。签入：pnpm loom register --task client-apps-pc-mobile:gateway --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改上述 src/gateway/** 路径。Wave 2 起：2.1 employee 身份/会话维度的推送注册与投递(区别既有 node-scoped push.apns.register)；2.2 配合 android 的 FCM 投递端；2.6 gateway.minSupportedClient[platform].{hardMin,softMin} + WS 握手(读 client.version)判定 hard 拒绝/soft 提示，软门禁默认。共享注册表(server-methods-list/method-scopes)如被 Epic E1 触及由你单一落地。带测试。提交 trailer：Task: client-apps-pc-mobile / Agent: gateway。勿碰 apps/**、ui/**。
```

---

## Agent: windows （Wave 3 加入）

- **owned tasks**：`3.1–3.5`(Tauri 壳/复用登录·bootstrap·桥接·深链/打包·自动更新/文档/冒烟)；(W4) `5.4` 桌面管理面、`5.6` Linux。
- **paths**：`apps/windows/**`（Wave 3 新建）
- **depends-on**：Wave 1/2 的登录·bootstrap·桥接·深链设计已稳定；D-PC-STACK=Tauri 定案。
- **done-when**：Windows 可安装+自动更新，employee 登录→embed 可用，深链/托盘就绪。

```text
你是 windows owner（Wave 3）。先读三份规格 + dispatch。签入：pnpm loom register --task client-apps-pc-mobile:windows --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改 apps/windows/**。3.1 Tauri 脚手架(系统 WebView+Rust 壳)+托盘/窗口/深链协议；3.2 复用登录/bootstrap/桥接/深链(对齐 macOS)；3.3 打包+签名+自动更新；3.4 WSL2 网关文档；3.5 冒烟。提交 trailer：Task: client-apps-pc-mobile / Agent: windows。
```

---

## 交接与冲突

- 跨端接口不一致（如桥接 intent 语义）时，由 **web-ui/apple-shared 定契约**、平台 owner 消费，不各自发明。
- 若某 owner 阻塞，在 `tasks.md` 对应子任务留 `— <owner>` 签名 WIP note 并交接，不提交半成品。
- `bun scripts/agent-attribution.ts` 核对脏文件归属；`UNATTRIBUTED`/`CONFLICT` 必须先解决再 land。

---

# Wave 2 分派与启动指令（设计伙伴 beta）

> **前置门**：Wave 1 内部 beta 达成（各端跑绿 + 1.9/1.10/1.11，见 `wave1-status.md`）后方进入 Wave 2**发布阶段**；但 Wave 2 的**基础契约**（push 身份/投递、会话连续性）可与 Wave 1 收尾**并行起草**（spec/release）。
> **通用规则同 Wave 1**：`loom register` 生效归属、只改自己 `paths`、`scripts/committer` + `Task: client-apps-pc-mobile`/`Agent: <owner>` trailer、真机/真环境优先、净新增带测试、companion 不回归。
> **Wave 2 决策**：`D-UPLOAD=图片一期`（已定案）；**`D-MINCLIENT`（C7）需 spec/release 于 W2 前正式定案**（倾向：软门禁·先告警后拒绝）。

## Wave 2 执行顺序（契约先行 → fan-out → gate）

- **① foundation（spec/release 先出，均为净新增契约）**：
  - `contracts/push-model.md`：**employee-scoped 推送**身份绑定 + 注册 + 投递模型（区别既有 node-scoped `push.apns.register`/`server-node-events.ts`）。**已落地（2026-10-08 拍板）**；RPC 名提案待 gateway owner 确认；实现见 tasks 2.1/2.2。
  - `contracts/session-continuity.md`：统一 `sessionKey` / active-agent 解析规则 + `openChat` 携带约定（Web 发起 → 原生 chat 继续）。
  - `D-MINCLIENT` 定案 + `gateway.minSupportedClient[platform].{hardMin,softMin}` 结构。
- **② platform fan-out（契约就绪后并行）**：gateway(2.1 投递端/2.3 后端/2.6 C7)、android(2.2 FCM/2.3 消费)、web-ui(2.4 上传/2.5 更多 surface/2.7 picker)、ios+macos(2.1 消费/2.3 消费)。
- **③ gate（spec/release）**：`2.8` 测试聚合、`2.9` 设计伙伴 beta checkpoint。

> 关键路径：`push-model` + `session-continuity` 契约 + `D-MINCLIENT` 定案 → 解锁 2.1/2.2/2.3/2.6 fan-out。

## Wave 2 · 每 owner 指令

### gateway（Wave 2 主力）

```text
你是 client-apps-pc-mobile 的 gateway owner（Wave 2）。先读三份规格 + dispatch Wave 2 段 + contracts/{push-model,session-continuity}.md（spec/release 出后）。
签入：pnpm loom register --task client-apps-pc-mobile:gateway --owner <你的id> --session-id <uuid> --ide kiro --agent <你的id>
只改 src/gateway/employee-shell/**、native-bootstrap-http.ts、server-node-events.ts、server/ws-connection/**、platform-auth/**、protocol/client-info.ts。
- 2.1 employee-scoped 推送后端：新增按 employee 身份/会话的推送注册与投递（**不复用** node-scoped push.apns.register）；登出/切账号注销 token；投递仅元数据。
- 2.6 C7 最低客户端门禁：gateway.minSupportedClient[platform].{hardMin,softMin}；WS 握手(message-handler.ts 读 client.version)判定 hard 拒绝(结构化 client_upgrade_required)/soft 提示；软门禁默认(D-MINCLIENT)。带单测(平台×hard/soft 矩阵)。
- 2.3 连续性后端：按 session-continuity 契约统一 sessionKey/active-agent 解析。
- 2.4 上传后端：employee 图片附件上传路径（D-UPLOAD=图片）。
带测试；platform-auth 回归。trailer: Task: client-apps-pc-mobile / Agent: gateway。勿碰 apps/**、ui/**。
```

### android

```text
你是 android owner（Wave 2）。先读 contracts/push-model.md + dispatch Wave 2。只改 apps/android/**。
- 2.2 Android FCM 从零：集成 FCM（注册/onNewToken/前后台投递）+ 与 gateway 投递端对接；token 绑 employee 身份，登出注销。
- 2.3 连续性消费：openChat 携带 sessionKey/agentId → 续到原生 chat（按 session-continuity 契约）。
- （若 1.2–1.8 尚未在 Android SDK 环境跑绿，请一并补跑，见 wave1-status.md §2。）
带单测。trailer: Agent: android。
```

### web-ui

```text
你是 web-ui owner（Wave 2）。只改 ui/src/ui/employee-shell/**、ui/src/styles/**、ui/src/i18n/**、ui/index.html。
- 2.4 图片上传（embed 内，D-UPLOAD=图片一期；通用文件延后）。
- 2.5 更多 mobile surface：按 §15.3 优先级 growth → workspace → knowledge 逐个手机重构 + 手机视口 Playwright 回归（无横向溢出/单列/≥44px），知识条目阅读不被遮挡。
- 2.7 mobile agent picker parity。
每 surface 附回归测试。trailer: Agent: web-ui。
```

### ios

```text
你是 ios owner（Wave 2）。先读 contracts/{push-model,session-continuity}.md。只改 apps/ios/**（消费 OpenBotKit，勿改 apps/shared/**）。
- 2.1 消费 employee 推送：APNs 注册**重绑到 employee 会话**（区别既有 node 通道），token 随登出/切账号注销；通知点击→深链→直达(已有 1.7 链路)。
- 2.3 连续性消费：openChat 携带 sessionKey/agentId 续到原生 chat。
- （在 iOS 18+ 模拟器环境把 Wave 1 + Wave 2 employee 测试跑绿，见 wave1-status.md §2。）
trailer: Agent: ios。
```

### macos

```text
你是 macos owner（Wave 2 + Wave 1 收尾）。只改 apps/macos/**。
- 【承接 Wave 1】解阻 apps/macos/Tests/OpenBotTests/MacNodeRuntimeTests.swift(Swift 6.3.3 Sendable) → 跑绿 EmployeeAccountTests/EmployeeShellBridgeTests；收尾 1.4-macos(登录全项)/1.8-macos(companion 回归)。
- 2.1 消费 employee 推送（系统通知，重绑 employee 会话）。
- 2.3 连续性消费。
trailer: Agent: macos。在 Mac 本机构建。
```

### spec/release

```text
你是 spec/release owner（Wave 2 foundation + gate）。只改 .kiro/specs/client-apps-pc-mobile/**。
- 出 contracts/push-model.md（employee-scoped 推送身份/注册/投递，含 APNs 重绑 + FCM 对接约定 + token 生命周期）。
- 出 contracts/session-continuity.md（sessionKey/active-agent 统一解析 + openChat 携带约定 + 跨端续接验收）。
- 正式定案 D-MINCLIENT（写回 requirements 决策表 + tasks 决策状态，标【已定案】）。
- 汇总 2.8 测试矩阵 + 2.9 设计伙伴 beta checkpoint（TestFlight external / Play closed）。
trailer: Agent: spec/release。
```

---

> Wave 2 完成即达**设计伙伴 beta**；随后 Wave 3（Windows/Tauri）→ GA 门 → Wave 4（管理面 Epic E1 + CLI）。分派与门禁沿用本文件与 `wave1-status.md` 的同一模型。
