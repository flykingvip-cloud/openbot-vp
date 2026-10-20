# 《多端共享机制》草案

> **状态：** 草案（Stage 43） · 产品 / 架构对齐用  
> **日期：** 2026-10-02（Asia/Shanghai）  
> **基线分支：** `app/stage42-ios-drop-openclaw-compat`（含 Android stage38 四 Tab 栈 + iOS stage39–42）  
> **本文档路径：** `docs/architecture/multiplatform-sharing.zh-CN.md`  
> **English stub：** [`multiplatform-sharing.md`](./multiplatform-sharing.md)  
> **约束：** 不合并 `main`，除非明确要求；桌面端（Mac/Windows）UI 策略仍待拍板。
> **Stage 45：** 验收矩阵 [`multiplatform-acceptance-matrix.zh-CN.md`](./multiplatform-acceptance-matrix.zh-CN.md)；桌面路径 ADR [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md)（未实现桌面四 Tab）。

---

## 0. 一句话结论

OpenBot 多端已经形成 **「契约共享 + 视觉 SoT + 并行原生壳」** 的工作方式；  
**尚未**形成「单一 UI 组件库 / 单一 Design Token 源 / 正式验收矩阵 / 协调发布里程碑」。  
本草案把已成立事实、刻意缺口、推荐分层与下一步三刀写清，避免把 WebView 嵌入或「一套代码打多端」误当成下一阶段路径。

---

## 1. 已成立（What IS established）

下列事实已在 Android stage22–38 与 iOS stage39–42 栈上被反复验证，应视为团队默认共识：

### 1.1 Web / Gateway RPC：进程与契约复用

| 层           | 说明                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **契约**     | 各端共用 Gateway 方法名与 wire 语义（如 `chat.send` / `chat.abort`、`task.*`、`cron.*`、`knowledge.*`、`agents.*`、`robot.workspace.*`、`device.pair.list`、身份相关 RPC） |
| **行为 SoT** | Web employee 口（`ui/src/ui/ports/employee/…`）是业务行为参考；原生端对齐方法名与载荷形状，不另造端专用 API                                                                |
| **客户端**   | Android Gateway 客户端；iOS / 共享 Kit（`apps/shared/OpenBotKit`：`OpenBotProtocol` / Chat VM / markdown）走同一契约                                                       |

**规则：** 新能力先落 Gateway + Web employee 行为，再在原生端做 **parity 切片**；禁止 iOS/Android 私有 endpoint 漂移。

### 1.2 HTML 桌面预览：视觉与信息架构 SoT

| 工件                                                              | 角色                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `openbot-four-tab-frontend-preview/`（本机 AI VP / Desktop 同步） | 交互式手机框预览；`README.md` / `SUMMARY.zh-CN.md` 中的 **IMPLEMENT** 清单为必做项 |
| 预览中的演示超集                                                  | **非**验收范围；Android / iOS 只实现 IMPLEMENT 行                                  |

**规则：** 视觉与 IA 争议以 HTML SoT 的 IMPLEMENT 行为准；截图 / 演示卡片若未列入 IMPLEMENT，不得阻塞发版。

### 1.3 并行原生 UI（Compose / SwiftUI）

| 端           | 壳与页面                                                                                 | 说明                            |
| ------------ | ---------------------------------------------------------------------------------------- | ------------------------------- |
| **Android**  | Compose：`PostOnboardingTabs`、四 Tab 页、Agent Strip、Me Hub 等（stage22–38）           | 当前最完整的原生参考实现        |
| **iOS**      | SwiftUI：`EmployeeRootTabs` + `MobileUI` tokens/chrome（stage39+）；Chat 复用 OpenBotKit | IA 已切四 Tab；能力页按切片补齐 |
| **共享 Kit** | `OpenBotKit`（协议 / Chat / 传输）                                                       | **不是**四 Tab 壳组件库         |

两端各自用平台惯用 UI 栈实现同一 IA 与契约，**刻意不做**跨端 UI 控件库。

### 1.4 已校准的「刻意缺口」（intentional gaps）

下列缺口是产品/工程选择，不是疏漏：

- 预览演示超集（如部分任务结果卡）→ 原生可不实现
- Web 向导型重流程（完整加身份、部分创建向导）→ 手机端列表 +「Web 向导」提示
- 字体 / 动态字号 / 深色主题等 polish → 可后置
- Mac 菜单栏伴侣 vs 员工四 Tab 桌面壳 → **已拍板**（Stage 52）：员工面 = Web shell；伴侣 = Gateway/TCC/node（见 [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md)）

---

## 2. 尚未成立（What is NOT）

明确写出「不要假装已经有」的事项，防止 PR 描述或排期偷换概念：

| 尚未成立                         | 现状                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **共享 UI 组件库**               | 无跨 Compose / SwiftUI / Web 的统一组件包；Chrome 仅「同构移植」                                                                                            |
| **单一 Design Token 源**         | Stage 44 已落地 `design/mobile-tokens.json`（孪生 hex 的校验源，`node scripts/check-mobile-tokens.mjs`）；Android / iOS 仍手写，**尚未**生成                |
| **Mac / Windows 原生员工四 Tab** | **已拒绝**（Stage 52）。员工 UI = **Web shell**；macOS 菜单栏伴侣继续 Gateway broker（`docs/platforms/macos.md`）；Windows 不做原生四 Tab（伴侣仍 planned） |
| **正式多端验收矩阵**             | 有分 stage 的 evidence / ACCEPTANCE 笔记，但无统一的「功能 × 平台 × vs SoT」清单                                                                            |
| **协调多端发布里程碑**           | PR 栈按端推进（Android 与 iOS 串联在同一 tip 上），无跨商店 / 跨安装包的联合 release train                                                                  |

---

## 3. 推荐机制分层（Proposed layers）

```
┌─────────────────────────────────────────────────────────┐
│  Acceptance matrix  功能 × 平台 × vs Visual SoT           │
├─────────────────────────────────────────────────────────┤
│  Native shells      Android Compose / iOS SwiftUI /      │
│                     Mac(?) / Windows(?)                  │
├─────────────────────────────────────────────────────────┤
│  Design Tokens      单源 JSON/YAML → 生成各端            │
├─────────────────────────────────────────────────────────┤
│  Visual SoT         four-tab HTML preview (IMPLEMENT)    │
├─────────────────────────────────────────────────────────┤
│  Contract           Gateway RPC + wire protocol          │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Contract（契约层）— 已共享，继续硬化

- **共享：** Gateway RPCs + wire protocol（方法名、错误形状、会话键语义）
- **客户端：** 各端薄封装；OpenBotKit 承载 iOS/macOS 侧协议与 Chat 传输
- **演进：** 契约变更走 Gateway + Web employee 先行；原生跟进时在 evidence 中写明 RPC 清单

### 3.2 Design Tokens（设计令牌）— 下一优先共享面

- **目标单源：** 例如 `design/mobile-tokens.json`（或 YAML），覆盖色板、字阶、gutter、渐变、Tab 尺寸等
- **生成：** → Android（Kotlin / Compose）、iOS（Swift）、Web/CSS 变量、桌面（若走 Web shell 则复用 CSS）
- **过渡：** Stage 44 已落地 JSON + `node scripts/check-mobile-tokens.mjs`（校验，不是生成）。改色必须同时改 JSON 与两端源文件。禁止第三套「随手写死」色值

### 3.3 Visual SoT（视觉真源）

- **真源：** `openbot-four-tab-frontend-preview` HTML，且仅 **IMPLEMENT** 行
- **用途：** IA、页间关系、主路径视觉；不是可执行生产壳
- **同步：** 预览变更需同步更新 SUMMARY / IMPLEMENT；原生 PR 引用对应行号或条目

### 3.4 Native shells（原生壳）

| 平台        | 推荐姿态                                                   | 备注                                            |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------- |
| **Android** | Compose 继续作为手机参考实现                               | stage38 tip 为四 Tab 最完整基线                 |
| **iOS**     | SwiftUI 四 Tab + Kit Chat；按切片补 Tasks / Knowledge / Me | stage39 shell 已换主路径，避免再嵌 WebView 主壳 |
| **Mac**     | **已拍板：Web shell** + 菜单栏伴侣（Gateway/TCC/node）     | 伴侣 ≠ 员工四 Tab；见 ADR                       |
| **Windows** | **已拍板：不做原生四 Tab**；Web shell 宿主 ✅ Stage 55（`apps/windows`） | WSL2 CLI + Gateway；员工窗 = WebView2；伴侣仍 planned |

**桌面 UI 路径决策（Stage 52 已拍板，Daniel / 2026-10-07）：**

1. **已选：桌面员工 UI 走 Web shell（嵌入或独立窗口加载 employee UI）** — 见 [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md)、[`desktop-web-shell-checklist.zh-CN.md`](./desktop-web-shell-checklist.zh-CN.md)
   - 利：与行为 SoT 同构、避免第三套原生四 Tab、发布节奏可跟 Web
   - 边界：菜单栏伴侣继续管 Gateway / TCC / node，**不**改造成员工 Tab 壳
2. **未选：Mac/Windows 原生四 Tab 与手机视觉对齐** — 明确拒绝

**拍板后：** 手机两端继续并行原生；桌面只排 **Web shell 实现**切片，永不排原生四 Tab。

### 3.5 Acceptance matrix（验收矩阵）

建立一张稳定清单（独立文档，下一切片产出）：

| 列                 | 含义                                   |
| ------------------ | -------------------------------------- |
| Feature / 用户故事 | 与 IMPLEMENT / stage evidence 对齐     |
| Android            | 有 / 部分 / 无 + evidence 路径         |
| iOS                | 同上                                   |
| Web employee       | 行为参考                               |
| Visual SoT         | IMPLEMENT 条目 ID                      |
| Desktop            | **Web shell（已拍板）** / 伴侣非员工面 |

**用法：** 每个 stage PR 只声称矩阵中「本切片触及」的格子；禁止用「多端完成」措辞覆盖未勾选格。

### 3.6 Process（过程）

| 实践                                        | 说明                                                                                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stage evidence**                          | `apps/*/docs/evidence/stageNN-…/`；PR 描述链到 README / ACCEPTANCE                                                                                                                                                                                              |
| **PR 栈**                                   | 新分支基于当前 tip（本草案基于 stage42）；**不**直接改 `main`；base 指向上一 stage 分支                                                                                                                                                                         |
| **何时不用 WebView 嵌 Tab（stage30 教训）** | 曾出现「Employee Shell WebView 作主壳 / 再计划替换」的中间态。结论：**不要**安排「先嵌 Web 再替换」的过渡；主路径应一次切到原生四 Tab（iOS stage39 已按此做）。WebView 仅可用于明确的附属面（文档、向导、桌面 Web shell 决策后的窗口），不得充当手机四 Tab 本体 |
| **跨链文档**                                | Android `IOS_REUSE.md`、AI VP `openbot-four-tab-ios-reuse.md`、本文 互相链接，避免口头口径分叉                                                                                                                                                                  |

---

## 4. 下一步三刀（Concrete next 3 slices）

> **2026-10-07 进度（Stage 52）：** B1 Tokens 校验包已在 main（stage44/50）；B2 验收矩阵已按 [#306](https://github.com/upbeyond/openbot/pull/306) / [#401](https://github.com/upbeyond/openbot/pull/401) 刷新；**B3 桌面 ADR 已拍板选项 1（Web shell）**——见 [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md)。Kotlin/Swift/CSS **生成器**与跨端发版列车仍未做；桌面员工 Web shell **实现**尚未开工。

| #     | 切片                       | 产出                                                                                                                                                           | 完成定义（草案）                                                                |
| ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **1** | **Tokens 包**              | `design/mobile-tokens.json` + `node scripts/check-mobile-tokens.mjs`（stage44 已落地校验；生成器仍未做）                                                       | Android 与 iOS hex 均由该脚本对照 JSON；生成 Kotlin/Swift/CSS 仍是后续          |
| **2** | **验收矩阵文档**           | `docs/architecture/multiplatform-acceptance-matrix.zh-CN.md`（或同目录 EN stub）                                                                               | 覆盖四 Tab 主路径 + Me 次级；格子指向现有 evidence；Desktop=Web shell（待落地） |
| **3** | **Mac / Windows 路径决策** | [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md) **已拍板选项 1**；清单 [`desktop-web-shell-checklist.zh-CN.md`](./desktop-web-shell-checklist.zh-CN.md) | 选项 1 Web shell；**禁止**原生四 Tab；实现切片另开，不在本机制文档内开工        |

次序建议：**1 → 2 → 3** 文档侧已收齐；下一步若排期，只做 **桌面 Web shell 实现**（见清单），永不排原生四 Tab。

---

## 5. 非目标（Non-goals）

本机制 **明确不做** 或 **本阶段不做**：

1. **一套代码打手机 UI**（Flutter / RN / KMP UI 等统一手机 UI 代码库）— 当前选择是契约共享 + 并行原生
2. **stage30 式 WebView-as-tab** — 不以 WebView 作为手机四 Tab 主壳，不安排「先嵌入再替换」中间里程碑
3. **强行统一桌面与手机的二进制** — 已拍板 Web shell；**不**把 macOS 伴侣改造成员工 Tab 壳
4. **用共享 UI 组件库替代 SoT** — 组件库若未来出现，也只能服务 SoT，不能反过来当视觉真源

---

## 6. 文档与仓库索引

| 资源                     | 路径 / 说明                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- |
| 本文（中文主稿）         | `docs/architecture/multiplatform-sharing.zh-CN.md`                               |
| English stub             | `docs/architecture/multiplatform-sharing.md`                                     |
| Android → iOS 复用说明   | `apps/android/docs/evidence/stage38-strip-session-title-kb/IOS_REUSE.md`         |
| AI VP 易读副本（工作区） | `/Users/daniel/AI VP/openbot-four-tab-ios-reuse.md`（含切片建议与 stage30 教训） |
| 视觉 SoT                 | `openbot-four-tab-frontend-preview/`（IMPLEMENT）                                |
| Android tokens           | `apps/android/.../MobileUiTokens.kt`                                             |
| iOS tokens               | `apps/ios/Sources/MobileUI/OpenBotMobileTokens.swift`                            |
| 单源 JSON（stage44）     | `design/mobile-tokens.json`（`node scripts/check-mobile-tokens.mjs`）            |
| macOS 伴侣现状           | `docs/platforms/macos.md`                                                        |

---

## 7. 修订记录

| 日期       | 版本      | 说明                                                 |
| ---------- | --------- | ---------------------------------------------------- |
| 2026-10-02 | draft-1   | Stage 43：首版草案；基线 stage42；开 PR，不合并 main |
| 2026-10-03 | draft-1.1 | Stage 44：补一行指针，JSON 校验源已落地（非生成器）  |
