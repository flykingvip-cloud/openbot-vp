# Wave 1 验收总览与跑绿门禁（Status & Green-Run Gate）

> owner：spec/release · 更新：2026-07-17 · 关联：`tasks.md` / `dispatch.md` / `contracts/*`
> 用途：Wave 1 各 owner 验收状态一览 + 各端「环境跑绿」待办 + 集成门禁（1.9/1.10/1.11）定义。图例：✅ 通过 · ⏳ 待环境跑绿/进行中 · ⚠️ 待收尾/待修。
> **当前态（2026-07-17）**：**唯一未完成 owner = ios**（`1.4-ios` 登录 + `1.8-ios` companion 回归进行中）；其余 owner（web-ui / apple-shared / gateway / macos / android）Wave 1 均已验收。

## 1. 各 owner 验收总览

| owner        | 已验收子任务（代码+契约）           | 交付未深验 / 待办            | 实跑测试                                                                | 结论                     |
| ------------ | ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| web-ui       | 1.1 / 1.9(embed)                    | —                            | ✅ 浏览器 4/4 + node 19/19 + i18n 15/15 + a11y 3/3（本机实跑）          | ✅ 完成                  |
| apple-shared | 1.2-apple                           | —                            | ✅ swift 23/23（本机实跑）                                              | ✅ 完成                  |
| gateway      | Wave-1 契约/端点（既有，无需新码）  | live-cloud（operator 确认）  | ✅ 27/27 本机（bootstrap-token/embed-target/native-bootstrap/contract） | ✅ 通过（代码）          |
| macos        | 1.3/1.4/1.5/1.6/1.7/1.8/1.9(壳)     | 签名/公证 + 打包（待版本）   | ✅ **25/25 跑绿**（P0 已解阻）                                          | ✅ 通过                  |
| android      | 1.2/1.3/1.4/1.5/1.6/1.7/1.8/1.9(壳) | —                            | ⏳ 无 Android SDK（author 报 60/0）                                     | ✅ 代码通过（全 Wave 1） |
| ios          | 1.3/1.5/1.6/1.7                     | **1.4/1.8 进行中（未交付）** | ⏳ 无 iOS 模拟器运行时                                                  | ⏳ 进行中（唯一未完成）  |

> 本机实跑绿：web-ui / apple-shared / gateway / macos。android 代码通过（author 报 60/0，本机缺 SDK 未复现）。ios 为唯一进行中 owner。

## 2. 各端「环境跑绿」待办（阻塞 1.10/1.11）

- **ios（唯一进行中）**：先完成 `1.4-ios`(登录/onboarding/会话接线) + `1.8-ios`(配对/Screen/Voice/相机/后台回归 + Me>Device)；再 Xcode 装 iOS 18+ 模拟器运行时 → `xcodebuild test -scheme OpenClaw -destination 'platform=iOS Simulator,id=<sim-udid>' -only-testing:OpenClawTests/EmployeeAccountIdentityTests -only-testing:OpenClawTests/EmployeeShellBridgeParseTests -only-testing:OpenClawTests/EmployeeEmbedRoutingTests`。
- **android**：`export JAVA_HOME=$(/usr/libexec/java_home -v 17)` + 装/指向 Android SDK（`ANDROID_HOME` 或 `local.properties` 的 `sdk.dir`）→ `./gradlew :app:testDebugUnitTest --tests "ai.openclaw.app.deeplink.*" --tests "ai.openclaw.app.account.*" --tests "ai.openclaw.app.employeeshell.*" --tests "ai.openclaw.app.employeeauth.*"`。
- **gateway**：本机 27/27 已绿；`native-bootstrap-cloud.live.test.ts` 需真实云网关（`gw.openbot.love` 可达 + mint→consume→302 + 测试账号），沙箱不可达 → **operator 在生产环境确认**（非本机复现）。
- **web-ui / apple-shared / macos**：已本机跑绿，无待办。

## 3. 集成门禁定义（1.9 / 1.10 / 1.11 · spec/release 拟定）

### 1.9 i18n(zh/en) + a11y 核心路径 + 品牌 —— 验收清单

- **i18n**：登录 / onboarding / 错误 / 通知 / 菜单 文案 zh-CN + en 外置资源、随语言切换一致、无混合语言（web-ui 负责 embed 与 `ui/src/i18n/**`；各平台 owner 负责各自原生壳文案）。
- **a11y 核心路径（每端）**：登录 → overview → me → 打开会话 —— 读屏（VoiceOver/TalkBack/桌面）可导航可朗读；动态字体/缩放不破版；焦点可见；点击区 ≥44px。
- **品牌**：App 名 / 图标 / 启动页 / 应用内文案 = OpenBot（内部命名债延后，D-RENAME）。
- **进度**：✅ web-ui embed（`e5ec5a5605`，i18n 15/15 + a11y 3/3 本机实跑）· ✅ macOS 原生壳（`021aee1b8e`）· ✅ Android 原生壳（`91ceab9e53`，19/19 键两地）；**剩 ios 原生壳（随 1.4-ios/1.5-ios）**。

### 1.10 Wave 1 测试聚合矩阵（全 ✅ 方可进 1.11）

| 层         | 套件                                                                                                                    | 环境        | 状态     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- | -------- |
| 共享 ui    | `employee-embed-mobile.browser` + `embed-routes.node` + `embed-i18n-parity.node`(15) + `employee-embed-a11y.browser`(3) | 本机        | ✅       |
| gateway    | `bootstrap-token-store` + `embed-target` + `native-bootstrap-http` + `contract-baseline`                                | 本机        | ✅ 27/27 |
| 共享 Swift | `DeepLinksGrammarTests`                                                                                                 | 本机        | ✅       |
| macos      | `EmployeeAccount / EmployeeShellBridge / EmployeeLoginViewModel / EmployeeShellStrings / EmployeeShellTelemetry`        | Mac 本机    | ✅ 25/25 |
| android    | `deeplink.* / account.* / employeeshell.* / employeeauth.*`                                                             | Android SDK | ⏳       |
| ios        | `OpenClawTests/Employee*`                                                                                               | iOS 模拟器  | ⏳       |

### 1.11 Wave 1 Checkpoint —— 内部 beta 门禁

- **构建产物**：iOS TestFlight 内部 / Android internal APK / macOS 包。
- **成功指标（R-Matrix，埋点采集）**：M-COLD ≤ 10s、M-TTI ≤ 3s、crash-free ≥ 99.5%、登录成功率 ≥ 98%（android 已埋 `EmployeeTelemetry` 钩子；ios/macos 待补同款）。
- **companion 不回归**：iOS/Android 配对/Screen/Voice/相机/后台；macOS Canvas/Exec 审批/语音唤醒。
- **前置**：ios 收尾（1.4/1.8-ios）+ §2 android/ios 环境跑绿 + 1.9 ios 壳 + 1.10 矩阵全 ✅。

## 4. 收口顺序（到内部 beta）

1. **ios owner 收尾**：`1.4-ios`(登录/会话) + `1.8-ios`(companion 回归 + Me>Device) + ios 壳 i18n/a11y（1.9 剩余项）。
2. android / ios 在**各自环境**跑绿（§2）；gateway live-cloud operator 确认。
3. spec/release 汇总 **1.10** 矩阵全 ✅ → 触发 **1.11** 内部 beta 门禁（构建 + 指标 + companion 回归）。
4. 通过 → Wave 1 内部 beta 达成；进入 Wave 2（推送后端/连续性/更多 surface + C7）。

## 5. 未决 / 待办清单（tracker）

- [x] web-ui：1.9 embed i18n(15/15) + a11y(3/3) 本机跑绿（`e5ec5a5605`）
- [x] apple-shared：`DeepLinksGrammarTests` 23/23（`e80c59cf21`/`373f709c10`）
- [x] gateway：Wave-1 契约/端点本机 27/27（`04498fb703`/`cedd9d4099`）；live-cloud 待 operator 确认
- [x] macos：25/25 跑绿 + 1.4/1.8-macos 收尾（`732f672100`/`021aee1b8e`）
- [x] android：全 Wave 1 代码验收（`efae1832fd` 记账）；SDK 环境跑绿待补（§2）
- [ ] **ios：`1.4-ios` + `1.8-ios` 进行中（唯一未完成 owner）** + iOS 模拟器跑绿（§2）
- [ ] 1.9：ios 原生壳 i18n/a11y（其余端已 ✅）
- [ ] 1.10：android/ios 两套件环境跑绿（其余 ✅）
- [ ] 1.11：内部 beta 构建 + 指标埋点（ios/macos 补 telemetry）+ companion 回归

> 说明：android「待环境跑绿」为**环境/工具链**问题（缺 Android SDK），非代码缺陷（author 报 60/0，8 个 employee 测试文件在位）；gateway live-cloud 为**沙箱网络不可达**，代码路径本机 27/27 已绿，生产可达性由 operator 确认。ios 为**唯一仍在开发**的 owner。
