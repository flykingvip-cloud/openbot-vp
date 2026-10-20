# 内部 beta 打包清单与关键路径（Internal Beta Packaging & Critical Path）

> owner：spec/release · 2026-07-15 · 关联：`tasks.md`(1.11) / `wave1-status.md` / `requirements.md`(R9) / AGENTS.md 发布规范。
> 范围：Wave 1 **员工端外壳**的 iOS/Android/macOS **内部 beta** 打包（非 npm/CLI 发布、非公开上架）。Windows 属 Wave 3。
> **红线（AGENTS.md）**：改版本号、动签名/公证密钥、跑任何 publish/上传步骤 **须 operator 明确同意**；macOS 构建在 Mac 本机跑（勿 SSH）。

## A. 各端打包清单（内部 beta）

### A0. 通用前置（所有端）

- [ ] **版本口径**：确认内部 beta 版本（`vYYYY.M.D-beta.N` 口径）；如需 bump 覆盖 version locations（`package.json`、`apps/android/app/build.gradle.kts`、iOS/macOS `Info.plist`）——**改版本需 operator 同意**；内部构建也可用 dev 版本号不 tag。
- [ ] **Bundle ID / package 沿用现状**（D-RENAME 延后）：iOS `ai.openbot.*`、Android `ai.openclaw.app`、macOS OpenBot——**不在内部 beta 动迁移**。
- [ ] **云连通**：客户端默认指向 `gw.openbot.love`（或内测网关）；确认可达 + 备好测试员工账号（登录→bootstrap→embed 端到端可跑）。
- [ ] **埋点就绪**（1.11）：M-COLD / M-TTI / crash-free / 登录成功率 采集接入。
- [ ] **测试跑绿**（1.10）：本端 employee 套件全绿（见 `wave1-status.md §2`）。

### A1. iOS（owner: ios + 发布）

- [ ] 签名前置：Apple Development/Distribution 证书 + provisioning；**App Store Connect API key**（`APP_STORE_CONNECT_ISSUER_ID/KEY_ID/API_KEY_P8`）用于 TestFlight；Team ID = `security find-identity -p codesigning -v`。
- [ ] 打包：`xcodebuild archive`（scheme `OpenClaw`）→ export IPA → **fastlane 上传 TestFlight 内部组**（`apps/ios/fastlane`）；或本地 archive 内部分发。
- [ ] 门：employee 测试跑绿 + companion 回归 + a11y 核心路径（1.9）。
- [ ] 产物：**TestFlight 内部构建**（现状 super-alpha/internal-only，仅内部 tester；公开 App Store 属 GA）。

### A2. Android（owner: android + 发布）

- [ ] 签名前置：release keystore（内部 beta 可用内测 keystore/debug 签名）；`versionCode`/`versionName`（`apps/android/app/build.gradle.kts`）。
- [ ] 打包：`./gradlew :app:assembleRelease`（APK）或 `:app:bundleRelease`（AAB）→ 签名 → 内测分发（Play internal testing 或直接分发 APK）。
- [ ] 门：employee 单测在 Android SDK 环境跑绿（`wave1-status.md §2`）+ companion 回归 + a11y。
- [ ] 产物：**internal APK/AAB**（Play closed 属设计伙伴 beta/Wave 2）。

### A3. macOS（owner: macos + 发布 · 须在 Mac 本机）

- [ ] 签名前置：Developer ID Application 证书 + 公证凭据（`APP_STORE_CONNECT_*` / `notarytool`）；内部 beta 若仅内部安装可暂缓公证，**对外分发须公证**。
- [ ] 打包：`scripts/package-mac-app.sh`（默认当前 arch）→ 签名 `.app` →（可选）`.dmg`；对外走 notarize + Sparkle appcast。参考 `docs/platforms/mac/release.md`、`docs/reference/RELEASING.md`。
- [ ] 内部 beta 可按 AGENTS.md「Changelog Release Notes」走 GitHub prerelease（附 `OpenBot-*.zip` + `dSYM.zip`）。
- [ ] 门：先解阻 `MacNodeRuntimeTests` → EmployeeAccountTests/EmployeeShellBridgeTests 跑绿；收尾 `1.4/1.8-macos`；companion（Canvas/Exec/语音唤醒/本地网关托管）不回归。

### A4. 发布前检查（协调 · 发布 owner）

- [ ] `node --import tsx scripts/release-check.ts`
- [ ] `pnpm release:check`
- [ ] 安装冒烟：`pnpm test:install:smoke`（或 `OPENBOT_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke`）
- [ ] **operator 同意**后方可改版本号 / 上传 TestFlight / 发 prerelease。

## B. 到内部 beta 的关键路径（依赖排序 · 甘特式）

| 阶段                           | 任务                                                                                                   | owner           | 依赖                               | 并行          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------- | ------------- |
| **P0 环境跑绿**                | android 配 SDK+JAVA_HOME 跑绿 / ios 装 iOS18+ 模拟器运行时跑绿 / macos 解阻 `MacNodeRuntimeTests` 跑绿 | 各平台          | 现在即可开                         | ✅ 三端并行   |
| **P0′ 签名前置**（常是真瓶颈） | iOS 证书+ASC API key / macOS Developer ID+公证 / Android keystore 就位                                 | 发布 + 各 owner | 现在即可开                         | ✅ 与 P0 并行 |
| **P1 收尾**                    | macos 收尾 `1.4/1.8-macos`                                                                             | macos           | P0(macos)                          | —             |
| **P1 基线**                    | `1.9` a11y/i18n 核心路径（各端 + web-ui embed）                                                        | web-ui + 平台   | P0                                 | ✅ 并行       |
| **P1 云连通**                  | `gw.openbot.love` 可达 + 测试员工账号，登录→bootstrap e2e                                              | ops/gateway     | —                                  | ✅ 并行       |
| **P1 埋点**                    | M-COLD/M-TTI/crash-free/登录成功率 接入                                                                | 各端            | P0                                 | ✅ 并行       |
| **P2 聚合**                    | `1.10` 五套件矩阵全 ✅                                                                                 | spec/release    | P0+P1                              | —             |
| **P3 打包**                    | iOS TestFlight 内部 / Android internal APK / macOS 签名包                                              | 各平台+发布     | P0′ + P2 + 版本口径(operator 同意) | ✅ 三端并行   |
| **P4 门禁**                    | `1.11` companion 回归 + 指标达标 → **内部 beta 达成**                                                  | spec/release    | P3                                 | —             |

### 关键路径与瓶颈提示

- **最长链**：`P0(macos 解阻+跑绿) → P1(macos 1.4/1.8) → P2(1.10) → P3(打包) → P4` —— macOS 链最长，宜最先启动。
- **P0′ 签名/凭据**：iOS ASC key、macOS 公证证书、Android keystore 的准备**常比写代码更耗时**，且是 P3 的硬前置——**立刻并行启动**，别等到打包才办。
- **版本口径**：内部 beta 版本号需 **operator 先定/同意**，否则 P3 卡住。
- **可立刻开工**：P0 与 P0′（无前置）；spec/release 侧 A 清单 + 本路径已就绪。
- **不在关键路径**：Windows（Wave 3）、公开上架/GA（受 iOS 公开分发解禁 + GA 合规门约束）——均不阻塞内部 beta。

> 一句话：内部 beta 的最短路径卡在 **①三端环境跑绿 ②签名凭据就位 ③macOS 收尾 → 1.10 全绿 → 打包 → 1.11**；这些是收尾/环境/凭据级,不含重写。
