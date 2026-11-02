# Requirements Document

> 中文名：**PC 端与移动手机端客户端交付规划（Client Apps — PC + Mobile Delivery）**
> 状态：**需求终稿 v4（送专家审核 · 已修 High/Medium 冲突）** · 创建：2026-07-14 · 修订：2026-07-14（v3→v4：① PC 管理面 embed 拆为独立前置 Epic；② employee MFA 语义修正并移入 D-LOGIN；③ Wave 1 通知/深链口径统一；④ 冷启动/TTI 双指标澄清；⑤ Wave 4/GA 口径统一；⑥ 最低客户端版本提为新增网关能力 + 决策 D-MINCLIENT；⑦ 补端矩阵与平台支持矩阵表）· 适用范围：Web 已上线 + 云端已部署之后，PC 与移动客户端的落地路线。

## Introduction

本规格定义 OpenBot 在 **Web 端已上线、云端已部署** 之后，如何把产品体验交付到 **PC 端（桌面）** 与 **移动手机端（iOS / Android）** 原生客户端。

本规格**不是从零起步**。仓库中已存在一条经代码核对的主线——**三端统一（Tri-Platform Unification）**（`docs/design/tri-platform-unification-2026-07-05.md`），其 **Phase 1 契约层已落地**（`/native/bootstrap` 会话引导、`employee-shell` 冻结契约、`ui/src/ui/employee-shell/*` 嵌入路由与原生桥接、手机裁剪标记）。因此本规格定位是：**在既有地基上，做一份能用于范围控制与发布管理的产品交付方案**。

- **复用（不重做）**：混合壳架构（原生 `Employee Shell WebView` 嵌入 `/embed/employee/*`，与 `Canvas/A2UI WebView` 分离）、双身份模型（Employee 登录 + Node 配对）、`/native/bootstrap` 一次性 token → HttpOnly 会话、employee-shell v1 RPC 冻结契约。
- **交付（本规格新增/收口）**：原生**员工登录 + onboarding**、**云端连通产品化**、**移动手机层重构**、**PC 桌面客户端**、**原生差异化价值**（通知/深链/托盘/分享/后台/原生 chat 连续性）、**分阶段分发 + 自动更新 + 品牌收口**、**企业级质量基线**（a11y/i18n/端上凭据安全/离线弱网/隐私合规）。
- **明确为净新增（非复用）**：PC 管理面所需的 `/embed/{enterprise|platform}/*` 契约与安全白名单**当前不存在**（见证据），属独立前置 Epic E1；Gateway 的**最低客户端版本门禁**当前不存在，属净新增网关能力。

### 与三端统一文档的关系（Scope Framing）

| 维度                               | 三端统一文档（既有） | 本规格（交付规划）                                                                                                                                    |
| ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 员工端混合壳架构                   | 定义方（设计基准）   | 复用，不改设计                                                                                                                                        |
| `/native/bootstrap` + 冻结契约     | 已落地               | 复用为地基                                                                                                                                            |
| 原生员工登录 + onboarding          | §14.4 待做           | **纳入 Wave 1 主干（SSO/找回/邀请；MFA 见 D-LOGIN）**                                                                                                 |
| 移动手机层重构（§15）              | 少量落地、多数待办   | **Wave 1（overview/me）→ Wave 2（其余 surface）**                                                                                                     |
| PC 桌面 macOS                      | companion 已存在     | **Wave 1（员工壳接入）**                                                                                                                              |
| PC 桌面 Windows/Linux              | 非目标 / planned     | **Wave 3（Windows）/ 更后（Linux）**                                                                                                                  |
| 企业/平台管理面（原生端）          | §4.2 明确非目标      | **Wave 4（可选，PC only）；依赖前置 Epic E1（新增 `/embed/{enterprise\|platform}/*` 契约 + 安全白名单 + 会话域门禁 + 渲染），非"复用 employee 链路"** |
| 云连通 / 分发 / 发布 / 指标 / 合规 | 分散、未系统化       | **本规格系统化收口**                                                                                                                                  |

> **强约束**：本规格**不重写** employee-shell 契约层、`/native/bootstrap`、既有 node/canvas/voice companion，只做接线 + 产品化。内部命名债按三端统一 §7 分批治理，**不与本交付强绑**。

### 设计原则（强约束 / 非功能性需求）

1. **Web-first 复用**：客户端业务界面优先复用共享 `ui` 包（经 `/embed/<port>/*` 嵌入），原生只承担壳、导航、登录、设备能力、推送、离线与深链。
2. **原生要有下载理由**：不得只是"打包网页"——须以原生差异化能力（推送、深链、托盘/常驻、分享扩展、后台 companion、原生 chat 连续性）构成首发价值（R-Native）。
3. **双身份不混用**：登录身份（会话域）与 Node 配对身份正交；任一失效不连累另一。
4. **Companion 不回归**：引入客户端壳不得削弱既有 node 配对、Canvas/A2UI、语音、屏幕、相机、后台与 macOS Exec 审批。
5. **云端可达**：客户端默认面向云网关（`gw/biz/admin.openbot.love`），局域网/本地为兼容路径。
6. **安全默认 + 受控例外**：业务数据默认不出 OpenBot/Gateway 域；分发与系统通知列为受控例外（R10）。
7. **每波次可独立交付、可发布门禁**：每个 Wave 有独立 persona、验收与发布阶段，靠成功指标收口（R-Matrix）。
8. **企业级质量基线是门禁而非补丁**：a11y（R12）、i18n（R11）、端上凭据安全（R10）、隐私合规（R9）在对应阶段作为准入门禁。
9. **不把净新增伪装成复用**：涉及新契约/新网关能力（管理面 embed、最低客户端门禁）的项显式标为前置工作。

## 首发范围与波次（MVP + Release Waves）

> PM 评审核心结论：**先收窄 MVP，只做 employee 场景**，把 Windows/Linux 与管理面推后。范围以波次为闸门，每波绑定一个发布阶段（R9）。

- **Wave 1（MVP，内部 beta）— employee 首发**
  - iOS/Android：原生员工登录 + 云网关接入 + 手机版 **overview / me** + **推送通知 + 深链**（利用既有 APNs / Android push 管道）。
  - macOS：员工壳接入（Employee Shell 容器，保留 companion）。
  - 目标：内部 beta 可用、可闭环反馈；companion 不回归；**首发即具备"非网页"价值（通知 + 深链）**。
- **Wave 2（设计伙伴 beta）— 深化 employee 体验**
  - 跨端会话连续性；图片上传；更多 mobile surface（workspace / knowledge / growth）；通知内容/深链目标扩展。
- **Wave 3（公测）— Windows 桌面客户端**
  - 依 D-PC-STACK 落 Windows 桌面客户端（employee）。Linux 视需求再排。
- **GA（employee 全端）— 公测通过后的独立发布门**
  - iOS/Android/macOS/Windows 的 employee 体验达 GA 门禁（R9 + R-Matrix）。**GA 是 Wave 3 之后、Wave 4 之前的独立闸门**。
- **Wave 4（GA 之后增量）— CLI 完善 + 可选管理面**
  - `openbot` CLI 体验/onboarding 完善；**可选**在 PC 桌面接入管理面（依 **D-PC-ADMIN** 且**先交付前置 Epic E1**）。

> 波次是**范围闸门**：非当前波次的能力 SHALL NOT 进入当前波次的验收与排期。

## 端矩阵（Device × Port × Companion × Wave × 阶段）

| 端               | 承载 Port                    | Companion | 首次 Wave      | 发布阶段     | 备注                                  |
| ---------------- | ---------------------------- | --------- | -------------- | ------------ | ------------------------------------- |
| Web（既有）      | employee/enterprise/platform | 否        | 已上线         | 线上         | 本规格不改                            |
| iOS              | employee（overview/me→更多） | 是        | Wave 1         | 内部 beta→GA | 通知/深链 Wave 1                      |
| Android          | employee（overview/me→更多） | 是        | Wave 1         | 内部 beta→GA | FCM 管道                              |
| macOS            | employee(+companion)         | 是        | Wave 1         | 内部 beta→GA | 壳形态=**D-MACOS-FORM**               |
| Windows          | employee                     | 视需求    | Wave 3         | 公测→GA      | 技术栈=**D-PC-STACK**                 |
| Linux            | employee                     | 视需求    | 更后           | 待定         | 不绑定 Wave 3                         |
| PC 管理面        | enterprise/platform          | 否        | Wave 4（可选） | GA 之后      | 依赖**前置 Epic E1** + **D-PC-ADMIN** |
| CLI（`openbot`） | employee（onboarding）       | n/a       | Wave 4         | GA 之后      | 体验完善                              |

## 首发用户与核心任务（Personas）

> 每平台**只保留 1 主 persona + 3 核心任务**，避免优先级漂移。其余角色为**内部干系人**（诉求由 R9/R10/R-Matrix 承载）。

| 平台                              | 主 persona           | 3 个核心任务                                                                                        |
| --------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| 移动手机端（iOS/Android，Wave 1） | **一线员工（随身）** | ① 登录后看到"今日任务/概览" ② 与助手/Agent 对话并延续会话 ③ 收到通知并深链跳到对应条目（Wave 1 内） |
| PC macOS（Wave 1）                | **桌面知识工作者**   | ① 常驻壳查看任务/协作工作台 ② 原生 chat 连续性 + Canvas/Exec companion ③ 深链/通知直达              |
| PC Windows（Wave 3）              | **桌面知识工作者**   | 同 macOS 主任务（employee 场景对齐）                                                                |

- **内部干系人（非首发 user story）**：发布负责人（R9）、平台运维（R10）、产品负责人（R-Matrix）。
- 管理员（enterprise/platform）persona **不进入 Wave 1–3**；仅 Wave 4 可选。

## Glossary

- **波次（Wave）**：范围与发布的最小闸门单位（Wave 1–4 + GA 门）。
- **发布阶段**：`内部 beta`(W1) → `设计伙伴 beta`(W2) → `公测`(W3) → `GA`（W3 后独立门） → `GA 之后增量`(W4)。
- **前置 Epic E1（管理面 embed 契约）**：为 enterprise/platform 新增 `/embed/{enterprise|platform}/*` 路由契约 + 前后端安全白名单 + 会话域门禁 + 脱壳渲染。当前**不存在**（见证据），是 Wave 4 管理面的硬前置。
- **Port**：Web UI 的 `employee`/`enterprise`/`platform` 三层视图，对应子域 `gw/biz/admin`（`subdomain-resolver.ts`）。
- **Employee Shell WebView**：承载 `/embed/employee/*` 的原生容器，与 `Canvas/A2UI WebView` 分离。
- **Employee/Node Identity**：登录态（会话域 `employee`）/ 设备配对身份，二者正交。
- **`/native/bootstrap`**：`POST …/mint` → `GET …?token=&target=`（写 HttpOnly 会话并 302 跳嵌入页），已落地 `src/gateway/native-bootstrap-http.ts`。
- **最低支持客户端**：Gateway 声明的最低 app 版本门禁；**当前握手只协商协议版本、记录 `client.version`，无 app 版本门禁**（`message-handler.ts`）→ 净新增（D-MINCLIENT）。
- **成功指标**：M-COLD（冷启动可见）、M-TTI（热态首屏）、crash-free、登录成功率（R-Matrix）。

## Requirements

### Requirement 1: 端矩阵、波次角色与范围闸门

**User Story:** 作为产品负责人，我希望明确"每个波次、每个客户端承载什么"，避免范围失控。

#### Acceptance Criteria

1. 本规格 SHALL 维护上文「端矩阵」表，每次改动 SHALL 同步波次归属。
2. WHEN 处于 **Wave 1** THEN 范围 SHALL 限于 iOS/Android employee（overview/me + 通知/深链）+ macOS employee 壳；管理面与 Windows/Linux **SHALL NOT** 进入 Wave 1 验收。
3. WHEN 客户端为移动手机端 THEN 形态 SHALL 为 employee port + Device Companion；管理面 SHALL NOT 作为手机端目标（任何波次）。
4. WHEN 客户端为 PC 桌面端 THEN 其 SHALL 至少承载 employee port；管理面由 **D-PC-ADMIN** 定案、**不早于 Wave 4**、且 **SHALL 先交付前置 Epic E1**。
5. 端矩阵 SHALL 与既有子域/port 路由（`subdomain-resolver.ts` / `isTabAllowedBySubdomain`）语义一致，不新造第二套 port 定义。
6. 移动端 companion 入口位置（顶层 Tab vs `Me > Device`）SHALL 由 **D-COMPANION-IA** 定案（绑 Wave 1）；迁移期保留明确 companion 入口，能力不回归。

### Requirement 2: 云端连通与离线弱网韧性

**User Story:** 作为一线员工，我希望任意网络下用账号登录即可用，弱网/断网有明确降级与恢复，而不是白屏或误导。

#### Acceptance Criteria

1. WHEN 客户端首次启动 THEN SHALL 支持指向云网关（默认 `https://gw.openbot.love`），无需局域网发现或 node 配对即可进入登录。
2. 客户端 SHALL 允许配置**自定义网关地址**（自托管/本地/私有云），云网关为默认而非唯一。
3. WHEN 连接云网关 THEN 传输 SHALL 为 TLS（`wss`/`https`）；明文仅在显式本地/局域网调试下允许。
4. **云连通与 node 配对解耦**：员工仅需工作台时 SHALL 可只登录 Employee Identity，不要求 node 配对。
5. WHEN 云网关不可达 THEN 客户端 SHALL 给出明确失败态与重试，SHALL NOT 静默卡死或误导为"未登录"。
6. WHEN embed 主帧加载失败/超时 THEN 客户端 SHALL 显示原生占位与重试，带退避重连，SHALL NOT 停留空白 WebView。
7. WHEN 网络中断 THEN 客户端 SHALL 只读降级 + 恢复后自动重连；**不做离线写入/编辑**（见 Non-Goals）。

### Requirement 3: 登录与 Onboarding（产品化，Wave 1 地基）

**User Story:** 作为一线员工/受邀新人，我希望在原生客户端顺畅完成登录与首启配置，登录后无缝进入工作台。

> **现状（证据）**：`/native/bootstrap/mint` 依赖调用方已有的 platform-auth 会话（`native-bootstrap-http.ts`），但原生端**无登录/onboarding 面**（§14.4）。**MFA 现仅作用于 platform-entry 登录**（`routes-login-password.ts`：`platformRole !== null && isPlatformLoginIntent` 才走 MFA gate）；**employee/enterprise entry 当前不经 MFA**。

#### Acceptance Criteria

1. 客户端 SHALL 提供原生 **Employee 登录面**，登录后持有可用于 `/native/bootstrap/mint` 的已认证 platform-auth 会话（会话域 `employee`）。
2. 登录面 SHALL 覆盖员工登录**当前已有**能力：**SSO**、**忘记密码/找回**、**受邀加入（邀请链接/码）**；未支持项 SHALL 明确标注为后续增量而非静默缺失。
3. **MFA 属认证语义变更，不默认纳入**：employee 登录当前不经 MFA gate；**是否引入由 D-LOGIN 定案**；IF 引入 THEN SHALL 作为独立认证改造项（后端放开 employee-entry MFA + 客户端 OTP/enroll），而非客户端"顺手覆盖"。
4. Onboarding SHALL 含**网关选择**（云默认/自托管）与**多账号/多组织切换**（同 app 内切换，不需卸载重装）。
5. WHEN 登录成功 THEN 客户端 SHALL `mint(target)` → 打开 `/native/bootstrap?token=…&target=…`，服务端写 HttpOnly 会话并 302 至嵌入页（不手工注入长期 cookie）。
6. WHEN 嵌入 WebView 返回 401 THEN 客户端 SHALL 用 Employee Identity **静默 re-bootstrap**，仅失败时提示重登（§5.4.2）。
7. WHEN 登出或**切换组织/账号** THEN SHALL 使嵌入会话失效（清 cookie + 服务端吊销）并清上一身份缓存；Employee 会话过期/登出 SHALL NOT 影响 Node 配对，反之亦然。
8. IF 目标为管理面（Wave 4） THEN 会话签发**可复用** `establishPlatformSessionCookie`（支持 `enterprise`/`platform` 域），但 **`/embed/{enterprise|platform}/*` 路由/白名单/渲染当前不存在**，SHALL 先交付前置 Epic E1，不得假设现成。

### Requirement 4: 混合壳架构复用（嵌入 + 桥接，与 Canvas 分离）

**User Story:** 作为工程团队，我希望原生客户端复用已冻结的 employee-shell 契约与桥接协议，而非每端各写一套。

#### Acceptance Criteria

1. 原生 Employee Shell 容器 SHALL 复用既有契约：`embed-routes.ts`、`native-bridge.ts`（版本化：`ready/openChat/openAssistant/openSpace/openKnowledgeObject/openDeviceSettings`）、宿主 handler `openbotEmployeeShell`（`native-host.ts`）。
2. Employee Shell WebView SHALL 与 Canvas/A2UI WebView 分离（独立容器 + 独立持久存储），SHALL NOT 复用 Canvas 的 `.nonPersistent()`（§5.4.3）。
3. WHEN WebView 发桥接消息 THEN 原生侧 SHALL 严格版本化解码（拒绝未知 version/type、缺失必填），把 `openChat/…` 路由到**原生**界面（chat 保持原生）。
4. 客户端消费的 employee 读模型 SHALL 限于 v1 冻结契约（`contract-baseline.ts`）；新增推送仅在轮询/refresh 不足时引入。
5. 三端骨架（iOS/macOS/Android EmployeeShell\*）SHALL 在 Wave 1 被**编译验证并接入**导航/网关地址/会话，而非停留未验证骨架。

### Requirement 5: 移动手机层适配与页面重构（§15，含任务型验收）

**User Story:** 作为随身使用的一线员工，我希望手机上的工作台为触屏与窄屏设计，关键任务能单手快速完成。

> **现状（§15.1）**：`ui/index.html` 缺 `viewport-fit=cover`；`workbench.css` 最小断点 639/640、无 ≤430 手机层、`env(safe-area-inset-*)` 为 0、128 处 `:hover`。已落地仅：手机隐藏四卡、手机仅个人设置、手机标记。

#### Acceptance Criteria（工程层）

1. `ui/index.html` SHALL 加 `viewport-fit=cover`（对桌面无害）。
2. 嵌入页 SHALL 在 `.employee-embed` / `.employee-embed--mobile` 作用域内提供手机断点（≤430/≤380）+ `env(safe-area-inset-*)` + 惯性滚动，优先局部落地。
3. hover-only 交互 SHALL 用 `@media (hover: hover)` 守卫并提供触屏等价。
4. 手机专属裁剪 SHALL 一律经 `employee-embed--mobile` / `mobile` 门禁，SHALL NOT 用视口宽度区分。
5. 每个 surface SHALL 附手机视口回归（Playwright 390×844 / 360×800）：无横向溢出（`scrollWidth<=clientWidth`）、关键区单列、点击区 ≥44px。

#### Acceptance Criteria（任务型产品结果）

6. **Wave 1**：冷启动+登录到可见"今日任务/概览" SHALL 满足 **M-COLD ≤ 10s**；已登录热态 embed overview SHALL 满足 **M-TTI ≤ 3s**（R-Matrix 统一口径，二者为不同阶段的独立指标，不冲突）。
7. **Wave 1**：overview/me 关键路径（看今日任务、打开会话、进个人设置）SHALL 可**单手完成**（热区拇指可达、纵向滚动为主）。
8. **Wave 2**：阅读知识条目 THEN 内容 SHALL NOT 被刘海/home indicator/悬浮 chrome 遮挡，长文可完整滚动。
9. surface 落地顺序 SHALL 为 overview → me（Wave 1）→ growth → workspace → knowledge（Wave 2），按 §15.3 优先级。

### Requirement 6: PC 桌面客户端（macOS 对齐 + Windows/Linux 分波）

**User Story:** 作为桌面知识工作者，我希望有一个可安装、可自动更新的 OpenBot 桌面应用。

> **现状**：macOS 有菜单栏 companion（`apps/macos`）；Windows/Linux 桌面客户端仅 "planned"（`docs/platforms/windows.md:200`）。

#### Acceptance Criteria

1. **Wave 1**：macOS SHALL 接入 Employee Shell 容器，embed **不带** `shell=mobile`（与网页对齐）；菜单栏 companion / 本地网关托管不回归；壳形态由 **D-MACOS-FORM** 定案（绑 Wave 1，§12.3）。
2. **Wave 3**：Windows SHALL 获桌面客户端（employee）；技术形态由 **D-PC-STACK** 定案。Linux 视需求排期，不绑定 Wave 3。
3. PC 桌面客户端 SHALL 面向云网关登录（R2）并复用 R3 登录链路与 R4 嵌入/桥接契约。
4. PC 桌面客户端 SHALL 提供桌面级能力：可安装包、窗口/托盘、深链、自动更新（R9），开机自启可选。
5. **Wave 4（可选）**：IF D-PC-ADMIN=是 THEN SHALL 经 `/embed/{enterprise|platform}/*` + 会话域嵌入管理面并遵守子域 tab 门禁；**依赖前置 Epic E1**（当前 embed 仅 employee），SHALL NOT 假设现成、SHALL NOT 为管理面另造原生界面。
6. Windows 运行形态 SHALL 说明网关侧建议（WSL2 运行 Gateway），客户端作为连接云/本地网关的前端。

### Requirement 7: 会话 / Agent 连续性与 Companion 不回归

**User Story:** 作为多设备用户，我希望一端发起的会话能在另一端继续，同时设备能力照常可用。

#### Acceptance Criteria

1. **Wave 2**：WHEN 员工在 Web 发起会话 THEN SHALL 能在 iOS/Android/macOS 原生 chat 继续（统一 `sessionKey` / active agent）。
2. employee shell 中"打开会话/助手"SHALL 经桥接跳原生 chat surface（chat 不强制 WebView 化）。
3. 引入 Employee Shell **SHALL NOT** 致 companion 回归：iOS/Android 配对、Screen/Voice/相机/后台；macOS Canvas/Exec/语音唤醒。**每波次验收 SHALL 含 companion 回归测试**。
4. **Wave 2**：SHALL 补齐 mobile agent picker parity；文件附件当前仅图片，通用文件列为 Wave 2+ 增量（依 D-UPLOAD）。

### Requirement R-Native: 原生差异化价值（为什么要下载 App）

**User Story:** 作为一线员工，我希望原生 App 提供网页做不到的能力，否则我没有理由安装它。

#### Acceptance Criteria

1. **Wave 1（D-PUSH-SCOPE=A）**：客户端 SHALL 提供**深链 + 本地/系统通知**点击直达对应 surface/会话/知识条目，作为内部 beta 的"非网页"价值。**Wave 2**：employee 服务端推送（iOS APNs 重绑 + Android FCM）——**均为净新增**（现 APNs 为 node-scoped、Android 无 FCM），非复用既有 node 通道；产品契约见 `contracts/push-model.md`（2026-10-08 拍板：MVP=@mention、iOS 首刀、多设备、独立凭据、点击复用 Wave 1 Router）。
2. 深链（双 scheme：`openclaw://` canonical + `openbot://` legacy；**净新增 host** `employee`/`chat`/`space`/`knowledge`；+ universal/app links + 桌面协议）解析 SHALL 经会话域鉴权，SHALL NOT 绕过登录/权限。
3. 桌面客户端 SHALL 提供托盘/常驻入口；移动端 SHALL 保留后台 companion（在平台后台限制内）。
4. 移动端 SHALL 保留分享扩展（iOS ShareExtension 已存在），可从其他 app 分享进入会话。
5. 客户端 SHALL 提供**原生 chat 连续性**（Wave 2，与 R7 联动）。
6. **Wave 1 验收（D-PUSH-SCOPE=A）** SHALL 证明"**深链 + 本地/系统通知**点击直达"端到端可用（收到本地通知 → 点击 → 鉴权 → 直达目标）；**服务端推送 e2e 验收移至 Wave 2**。

### Requirement 8: 品牌统一与命名债治理（用户可见优先）

**User Story:** 作为用户，我希望所有客户端对外一致呈现 OpenBot；作为工程团队，我希望内部命名债不阻塞交付。

#### Acceptance Criteria

1. 所有客户端**用户可见层**（App 名、图标、启动页、应用内文案、README 用户可见命令）SHALL 统一为 OpenBot。
2. 内部命名债（`OpenClaw.xcodeproj` / `OpenClawKit` / `Theme.OpenClawNode` / logger `ai.openclaw` / `OpenClawChatView*`）SHALL 分批治理，不与本交付强绑（§7.2）。Android 现行 `applicationId` 是 `ai.openbot.app`，不再把 `ai.openclaw.app` 当作可安装包名；旧包不能覆盖升级（并列安装，需重装并重新登录）。
3. Bundle ID / package name 迁移 SHALL 作为独立发布决策（D-RENAME），不作交付前置（§7.3）。
4. 新增用户可见命令文本 SHALL 用 `openbot`（`openclaw` 仅向后兼容别名）。

### Requirement 9: 分发、版本、自动更新、最低客户端与隐私合规（分阶段发布门禁）

**User Story:** 作为发布负责人，我希望每个波次对应清晰的发布阶段、合规门禁与升级机制，而不是假设一上来就能公开上架。

> **现状（诚实约束）**：iOS 现 `super-alpha / internal-use only`、公开分发不可用（`apps/ios/README.md:3`、`:7`）；Windows companion 尚不存在；Gateway 握手**无 app 版本门禁**（`message-handler.ts` 仅协议协商 + 记录 `client.version`）。

#### Acceptance Criteria

1. 发布 SHALL 分阶段：**内部 beta(W1) → 设计伙伴 beta(W2) → 公测(W3) → GA（W3 后独立门，employee 全端）→ GA 之后增量(W4)**；每阶段进入 SHALL 以 R-Matrix 指标 + companion 不回归为门禁。
2. 移动端分发：iOS 内部=本地 archive + Fastlane/TestFlight 内部，外部 beta=TestFlight external，GA=App Store；Android 内部=debug/internal APK → Play closed → open → production。
3. 桌面端 SHALL 有打包+签名+自动更新：macOS 复用 `scripts/package-mac-app.sh` + Sparkle appcast；Windows/Linux 依 D-PC-STACK 选定。
4. 版本口径 SHALL 遵循 AGENTS.md version locations；"bump 版本"覆盖所有位置（appcast 仅 macOS Sparkle 发布时动）。
5. 发布前 SHALL 过既有 release 检查（`scripts/release-check.ts` / `pnpm release:check`）。
6. 客户端与 Gateway 协议 SHALL 向后兼容（legacy `openclaw-*` client id 已在 `client-info.ts` 归一，新增须补录）。
7. **最低支持客户端 / 强制升级（净新增网关能力）**：Gateway SHALL 新增"最低支持 app 版本"门禁（当前无）；过旧客户端接入 SHALL 明确拒绝并引导升级。属独立阻塞项 **D-MINCLIENT**，SHALL 在**首个对外阶段（设计伙伴 beta）前**就绪。
8. **商店合规**：GA 前 SHALL 完成 App Store 隐私标签 / Play Data Safety 申报；IF 支持账号创建/登录 THEN SHALL 提供**应用内账号删除入口**（Apple 5.1.1(v)）。
9. **遥测同意**：客户端遥测/诊断 SHALL 遵循区域合规（GDPR/PIPL），提供知情同意 + 可关闭，默认不采集业务明文（与 R10.5 一致）。

### Requirement 10: 安全、端上凭据存储与非回归（含受控例外清单）

**User Story:** 作为平台运维，我希望客户端引入不削弱既有安全边界，端上登录态被安全存储，也不破坏本地/局域网既有用法。

#### Acceptance Criteria

1. 嵌入会话 SHALL 经 HMAC HttpOnly cookie（复用 `establishPlatformSessionCookie`）；`target` SHALL 站内相对白名单 + 前后端双重校验（`isSafeEmbedTarget`）。
2. bootstrap token SHALL 一次性、短 TTL（≤60s）、仅存哈希、用后即焚（`bootstrap-token-store.ts` 不放宽）。
3. Employee Shell WebView 数据存储 SHALL 与 Canvas 非持久存储隔离；WebView SHALL 通过安全审计（Phase 5）。
4. WHEN 本地单操作员 / 局域网既有用法（node 配对、Canvas、语音） THEN 引入客户端壳 SHALL NOT 改变其既有行为。
5. **业务数据默认不出域**：代码/密钥/知识/会话内容 SHALL NOT 外传至 OpenBot/Gateway 域外第三方，**受控例外**：APNs/FCM（仅投递元数据）、App Store/TestFlight/Play、Sparkle 等更新源、**崩溃/诊断上报（为度量 crash-free 必需，最小化/可 opt-out/不含业务明文）**；此外任何外传视为高风险需显式决策。
6. **端上登录态安全存储**：原生侧 Employee/Node 凭据与会话 SHALL 存平台安全存储（iOS Keychain / Android Keystore·`SecurePrefs.kt` / macOS Keychain / Windows Credential Manager·DPAPI / Linux Secret Service），SHALL NOT 明文落盘。
7. **可选应用锁**：SHALL 支持可配置 app-lock / 生物识别（对齐 Android 既有 biometric lock），默认策略可由企业/用户设定。

### Requirement 11: 国际化与本地化（i18n / L10n）

**User Story:** 作为中英文用户，我希望原生壳与嵌入页语言一致，且商店信息本地化。

#### Acceptance Criteria

1. 原生壳文案（登录/onboarding/错误/通知/菜单/托盘）SHALL 至少支持 **zh-CN 与 en**，与嵌入 `ui` 的 i18n（`ui/src/i18n/locales/{zh-CN,en}`）语言选择一致。
2. WHEN 切换语言/地区 THEN 原生壳与嵌入页 SHALL 一致切换，不出现混合语言。
3. 商店 listing（名称/描述/截图文案）SHALL 按目标市场本地化（至少 zh-CN / en）。
4. 文案 SHALL 外置为资源（不硬编码），日期/数字/时区按 locale 呈现。

### Requirement 12: 可访问性（Accessibility）

**User Story:** 作为使用辅助技术的员工，我希望客户端可用（读屏、动态字体、对比度、键盘/焦点）。

#### Acceptance Criteria

1. 嵌入页与原生壳 SHALL 支持读屏（VoiceOver/TalkBack/桌面读屏）在 employee 核心路径（登录/overview/me/打开会话）可导航可朗读。
2. UI SHALL 支持**动态字体/缩放**不破版（配合 R5 手机层与 `env()` 安全区）。
3. 交互 SHALL 满足对比度与焦点可见（对齐 platform-ui-spec 的 `:focus-visible` 基线），点击区 ≥44px（R5.5）。
4. 可访问性 SHALL 作为 **GA 门禁**校验项（R-Matrix）；SHALL NOT 事后补救。
5. 完整 WCAG 合规验证 SHALL 说明需人工 + 辅助技术实测；本规格给出可执行的核心路径校验清单而非声称全量合规。

### Requirement R-Matrix: 平台支持矩阵与成功指标

**User Story:** 作为产品/QA 负责人，我希望有明确的支持矩阵与量化门槛，以便灰度与验收收口。

#### 平台支持矩阵（实体表）

| 平台    | 最低 OS             | 关键设备能力                                        | 降级要求                                 | 首次 Wave |
| ------- | ------------------- | --------------------------------------------------- | ---------------------------------------- | --------- |
| iOS     | `18.0`（§3.5）      | 相机/麦克/推送(APNs)/后台/分享扩展/Watch(companion) | 无相机或无通知时核心 employee 任务仍可用 | Wave 1    |
| Android | `minSdk 31`（§3.5） | 相机/麦克/推送(FCM)/后台/biometric                  | 同上                                     | Wave 1    |
| macOS   | `15`（§3.5）        | 菜单栏/Canvas/Exec 审批/语音唤醒/本地网关托管       | companion 不回归                         | Wave 1    |
| Windows | 待定（网关经 WSL2） | 托盘/深链/系统通知                                  | —                                        | Wave 3    |
| Linux   | 待定（更后）        | —                                                   | —                                        | 更后      |

#### Acceptance Criteria

1. 本规格 SHALL 维护上表（最低 OS、设备能力差异、波次）。
2. 客户端 SHALL 声明设备能力降级：无相机/无通知/后台受限等场景下核心 employee 任务仍可用（明确提示而非崩溃）。
3. 每阶段 SHALL 设量化门禁（初值可评审），**口径唯一**：M-COLD（冷启动含登录+bootstrap 可见关键内容）≤ **10s**；M-TTI（热态 embed overview 首屏）≤ **3s**；crash-free：beta ≥ 99.5% / GA ≥ 99.9%（依赖 R10.5 诊断管道）；登录成功率 ≥ 98%；Wave 1 内部 beta 反馈闭环。
4. 指标 SHALL 可观测（客户端埋点/诊断 + 服务端会话侧），SHALL NOT 依赖主观判断收口。
5. **GA 附加门禁**：a11y 核心路径（R12）、zh-CN/en 本地化（R11）、隐私合规（R9.8/9.9）、最低客户端门禁（R9.7）SHALL 在 GA 前校验通过。

## 决策（Decisions — Wave 1 已定案，其余按波次前确认）

> **定案状态（2026-07-14 · spec/release；Wave 2 push 产品契约 2026-10-08 增补）**：Wave 1 阻塞项 **D-LOGIN / D-MACOS-FORM / D-COMPANION-IA / D-PUSH-SCOPE 已定案**；Wave 2 员工服务端 push 产品项 **D-PUSH-W2-TRIGGER / PLATFORM / MULTI / CREDS / CLICK 已定案**（契约正文 `contracts/push-model.md`）；**D-PUSH-W2-RPC 为提案待 gateway owner 确认**。其余为 `【暂定】`，按各自波次 Deadline 前确认，**不得提前据以落码**（含未确认 RPC 名）。

### 定案表

| 决策                   | 状态           | 定案 / 默认                                                                                                              | 生效波次 |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| **D-LOGIN**            | 【已定案】     | 独立登录面；Wave 1 不引入 employee MFA；SSO = trusted-proxy 既有入口（通用 OIDC 延后，净新增）                           | Wave 1   |
| **D-MACOS-FORM**       | 【已定案】     | 复用主窗口内嵌 employee 壳，保留菜单栏 companion                                                                         | Wave 1   |
| **D-COMPANION-IA**     | 【已定案】     | `Me > Device`                                                                                                            | Wave 1   |
| **D-PUSH-SCOPE**       | 【已定案】     | A：Wave 1 深链 + 本地/系统通知；employee 服务端推送（APNs 重绑 + Android FCM，净新增）移 Wave 2                          | W1 / W2  |
| **D-PUSH-W2-TRIGGER**  | 【已定案】     | MVP 触发 = **仅 @mention**（挂既有 human-mention inbox；远程投递另实现）                                                 | Wave 2   |
| **D-PUSH-W2-PLATFORM** | 【已定案】     | **iOS APNs 首刀** → Android FCM → Mac 远程后置；**Windows WNS 不在 MVP**                                                 | Wave 2   |
| **D-PUSH-W2-MULTI**    | 【已定案】     | 同 `accountId` **多 device registration 并存**                                                                           | Wave 2   |
| **D-PUSH-W2-CREDS**    | 【已定案】     | 员工 **独立** APNs 配置/topic（不写 node 表）；env 占位见 `contracts/push-model.md`；bundle/topic 值 TBD                 | Wave 2   |
| **D-PUSH-W2-CLICK**    | 【已定案】     | 复用 Wave 1 `EmployeeNotificationRouter`；强制 `deepLink`；短 title/body；alert；per-accountId token；logout/switch 注销 | Wave 2   |
| **D-PUSH-W2-RPC**      | 【提案待确认】 | 方法名族在 `contracts/push-model.md` 提案；**gateway owner 确认前禁止落码**                                              | Wave 2   |
| **D-MINCLIENT**        | 【暂定】       | 软门禁（先告警后拒绝）                                                                                                   | W2 前    |
| **D-UPLOAD**           | 【暂定】       | 一期图片                                                                                                                 | W2 前    |
| **D-PC-STACK**         | 【暂定】       | Tauri                                                                                                                    | W3 前    |
| **D-PC-ADMIN**         | 【暂定】       | 是（仅 PC）+ 先 Epic E1                                                                                                  | W4 前    |
| **D-RENAME**           | 【暂定】       | 延后（仅保用户可见品牌统一）                                                                                             | GA 前    |

### 问题/Owner/Deadline 明细（追溯）

> PM 评审：这些是**阻塞项**；Owner 为建议角色，具名于 `loom register` 时确定。

| 决策               | 问题                                                                                                                     | 建议 Owner（待具名） | Deadline（阻塞）          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------- |
| **D-LOGIN**        | 独立登录面 vs 复用既有登录流？**是否为 employee 登录引入 MFA**（当前 employee entry 不经 MFA gate）？SSO/找回/邀请范围？ | 身份/认证 owner      | **Wave 1 前**（最高优先） |
| **D-MACOS-FORM**   | macOS 员工壳：新窗口 / 侧栏内嵌 / 复用主窗口？（§12.3）                                                                  | macOS 客户端 owner   | **Wave 1 前**             |
| **D-COMPANION-IA** | 移动端 companion 入口：顶层 Tab 还是 `Me > Device`？（§12.2）                                                            | 移动端 owner         | **Wave 1 前**             |
| **D-MINCLIENT**    | 最低支持客户端策略 + 新增网关 app 版本门禁（当前无）；兼容窗口与升级引导                                                 | 网关/发布 owner      | **设计伙伴 beta(W2) 前**  |
| **D-UPLOAD**       | 文件上传一期仅图片、二期通用文件？                                                                                       | 员工端产品 owner     | **Wave 2 前**             |
| **D-PC-STACK**     | Windows/Linux 用跨端框架（倾向 Tauri）还是各原生壳？（选跨端框架=显式推翻 §4.2）                                         | 客户端架构 owner     | **Wave 3 前**             |
| **D-PC-ADMIN**     | PC 是否额外嵌入管理面？（=是 则须先立项**前置 Epic E1**）                                                                | 平台/企业产品 owner  | **Wave 4 前**             |
| **D-RENAME**       | 命名债 + Bundle ID/package rename 是否纳入本交付？（倾向延后）                                                           | 发布/运维 owner      | **GA 前**                 |

- 倾向意见已并入上方「定案表」：Wave 1 四项已定案，其余按 `【暂定】` 默认值到各自波次前确认。

## 范围边界（Non-Goals）

- **Wave 1 不含**：Windows/Linux、管理面、跨端会话连续性、通用文件上传、workspace/knowledge/growth 手机重构（属 Wave 2+）。
- **不含 employee MFA 的默认引入**：employee 登录当前不经 MFA gate；如引入作为独立认证改造项（D-LOGIN）。
- **PC 管理面非现成能力**：`/embed/{enterprise|platform}/*` 契约当前不存在，Wave 4 管理面依赖**前置 Epic E1**；Wave 1–3 不交付管理面。
- **不**重写 employee-shell 契约层、`/native/bootstrap`、既有 node/canvas/voice companion。
- **不**在本规格完成命名债大迁移与 Bundle ID/package rename（除非 D-RENAME 另定）。
- **不**为手机端任何波次开发管理原生面。
- **不**引入独立于共享 `ui` 的第二套业务 UI 实现。
- **不**改变 Gateway 作为唯一事实来源的地位。
- **不**做离线写入/编辑（仅只读降级 + 恢复，R2.7）。
- **不**做 MDM / 托管分发、数据驻留 / 网关区域选择。
- **不**把 Watch/Wear（iOS 已有 WatchApp）作为 employee shell 承载端——仅作 companion。
