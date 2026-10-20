# OpenBot HarmonyOS（员工端 WebView 壳）

纯血 **HarmonyOS NEXT** 无法直接安装 Android APK。本目录是 **ArkTS Stage 模型** 工程：WebView 加载与 Mac / Android 员工壳相同的 Gateway 嵌入页（默认 `https://gw.openbot.love`）。

## 能力范围（v3）

| 有 | 暂无 |
|----|------|
| **原生登录 / 注册 / 找回密码 / 重置密码** | Android 节点 Gateway 配对 / Camera / Canvas invoke |
| **MFA 提示**（`PLATFORM_AUTH_MFA_*` 时显示验证码框） | 完整 TOTP 扫码绑定 UI |
| **Bootstrap Cookie**（mint → `/native/bootstrap` → HttpOnly 员工会话） | AppGallery 正式上架签名 |
| **`openbotEmployeeShell` JS Bridge**（与 Web `native-host.ts` Android 通道兼容） | 原生独立 Chat Activity（手机壳仍走 Web workspace） |
| 员工端 Web（`shell=mobile`） | — |

### 认证流程

```
原生 login/register → Cookie openbot_platform_session（Preferences）
  → POST /native/bootstrap/mint（带 Cookie）
  → WebView GET /native/bootstrap?token&target
  → 服务端写入 HttpOnly 员工会话 → 302 /embed/employee/…?shell=mobile
```

### Bridge 意图映射（手机壳）

| Intent | 行为 |
|--------|------|
| `ready` | 顶栏状态提示 |
| `openChat` / `openAssistant` / `openSpace` | 重新 bootstrap → `/embed/employee/workspace` |
| `openKnowledgeObject` | → `/embed/employee/knowledge` |
| `openDeviceSettings` | → `/embed/employee/me` |

Web 侧通过 `window.openbotEmployeeShell.postMessage(json)` 调用（与 Android 一致）。

### 代码入口

| 模块 | 路径 |
|------|------|
| 登录 / 注册 / 重置 | `entry/src/main/ets/pages/LoginPage.ets` |
| WebView + bootstrap + bridge | `entry/src/main/ets/pages/EmployeeShellPage.ets` |
| Platform Auth API | `entry/src/main/ets/platformauth/PlatformAuthApi.ets` |
| Bridge 解析 | `entry/src/main/ets/employeeshell/EmployeeShellBridge.ets` |
| Mint / bootstrap URL | `entry/src/main/ets/employeeshell/EmployeeShellBootstrap.ets` |

默认 Gateway：`entry/src/main/ets/common/OpenBotConfig.ets` → `DEFAULT_GATEWAY_BASE_URL`。

## 环境

- [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/) **5.0+**（建议 6.x）
- HarmonyOS SDK **API 12+**（NEXT）
- 华为真机（推荐）或官方模拟器
- 华为开发者账号 + **调试证书 / Profile**（真机 Run 必需）

Mac 上无法在本仓库用 Gradle 打出 HAP；必须在 DevEco Studio 中 **Build → Build Hap(s)/APP(s)**。

## 重要：工程路径不能含中文

DevEco / hvigor **拒绝**路径中含中文（例如 `…/AI项目/openbot/...`）。请始终用纯英文路径打开：

- **推荐打开**：`/Users/daniel/openbot-harmony`（由构建脚本从仓库同步）
- 仓库源码仍在：`apps/harmony/`（改这里，再 sync/build）

命令行构建（本机已验证可出 unsigned HAP）：

```bash
./scripts/build-harmony.sh
# 产物：~/openbot-harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
```

## 打开与运行（签名安装）

1. DevEco Studio → **Open** → **`/Users/daniel/openbot-harmony`**（不要直接打开中文路径下的 apps/harmony）。
2. **File → Project Structure → Signing Configs** → 勾选 **Automatically generate signature**（或导入调试证书）。
3. USB 连接鸿蒙手机，开启开发者模式；终端可执行 `hdc list targets` 确认设备。
4. 点 **Run**（会签名并安装）。仅 `unsigned.hap` 通常无法直接装到真机。

## 修改 Gateway 地址

- 登录页点 **高级** 可编辑 Gateway（默认 `https://gw.openbot.love`），写入 Preferences。
- 默认值：`OpenBotConfig.ets` → `DEFAULT_GATEWAY_BASE_URL`。

## 图标

与 Mac App 同源：更新 logo 后执行：

```bash
python3 scripts/sync_harmony_icons.py
```

## 产物位置

`apps/harmony/entry/build/default/outputs/default/entry-default-signed.hap`

## 与 Android 安装包区别

| | Android APK | Harmony HAP |
|--|-------------|-------------|
| 系统 | Android 12+ | HarmonyOS NEXT |
| 构建 | `./gradlew assembleDebug` | DevEco Studio |
| 包格式 | `.apk` | `.hap` |
| 本仓库脚本 | `pnpm android:assemble` | 无（需 DevEco） |
