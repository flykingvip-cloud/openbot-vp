---
summary: "OpenBot 对历史 OpenClaw 标识的兼容层清单（仅兼容，非主品牌）"
read_when:
  - 审计仓库中残留的 openclaw / OpenClaw 字样
  - 决定是否可以删除某条兼容路径
  - 新增环境变量或配置键时避免重新引入主路径 OpenClaw
title: "OpenBot ↔ OpenClaw 兼容层"
---

# OpenBot ↔ OpenClaw 兼容层

> **主品牌是 OpenBot / `openbot`。** 下文列出的 OpenClaw / `openclaw` 出现均为**有意保留的兼容面**，不得再当作用户可见主品牌或新代码主路径。

相关常量集中在 [`src/compat/legacy-names.ts`](https://github.com/upbeyond/openbot/blob/main/src/compat/legacy-names.ts)。

## 已完成的主路径切换（本 PR / Phase A）

| 类别          | 主路径                                                         | 兼容别名                                                                          |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 配置类型      | `OpenBotConfig`（`src/config/types.openbot.ts`）               | `OpenClawConfig`（`@deprecated`）                                                 |
| Zod schema    | `OpenBotSchema`                                                | `OpenClawSchema`（`@deprecated`）                                                 |
| 插件加载      | `loadOpenBotPlugins`                                           | `loadOpenClawPlugins`（`@deprecated`）                                            |
| 测试写配置    | `writeOpenBotConfig`                                           | `writeOpenClawConfig`（`@deprecated`）                                            |
| macOS Sources | **仅** `apps/macos/Sources/OpenBot`（`MACOS_APP_SOURCES_DIR`） | 旧目录 `apps/macos/Sources/OpenClaw` 已删除；记入 `LEGACY_MACOS_APP_SOURCES_DIRS` |
| CLI 入口      | `openbot.mjs` / `openbot`                                      | `openclaw.mjs`（deprecation warning）与 `package.json` bin `openclaw`             |
| 状态目录      | `~/.openbot`、`OPENBOT_*`                                      | 仍可读 `OPENCLAW_*` 与历史 `~/.openclaw`（见路径解析）                            |

## 有意保留（wire / 迁移 / 生态）

### 1. 环境变量双读双写

运行时优先 `OPENBOT_*`，回退 `OPENCLAW_*`。守护进程安装时仍会**同时写出**两组变量，以便旧 LaunchAgent / systemd unit / 脚本不立刻断裂。

典型键：`STATE_DIR`、`CONFIG_PATH`、`GATEWAY_TOKEN`、`GATEWAY_PORT`、`HOME`、`PROFILE`、`LAUNCHD_LABEL`、`SYSTEMD_UNIT` 等。

> Follow-up：新安装可改为只写 `OPENBOT_*`，保留只读回退。

### 2. 文件系统路径

| 主路径         | 兼容                             |
| -------------- | -------------------------------- |
| `~/.openbot`   | 历史 `~/.openclaw`（迁移/探测）  |
| `openbot.json` | 历史配置文件名（若仍有探测逻辑） |

### 3. CLI / 容器别名

- `openclaw.mjs`：发出 DeprecationWarning 后转调 OpenBot 入口。
- `Dockerfile`：`ln -sf /app/openbot.mjs /usr/local/bin/openclaw`。
- `docker-compose.yml` 服务名 / 镜像名仍可能含 `openclaw-*`（Phase B 清理）。
- `package.json` `"bin.openclaw"`、`scripts.openclaw`：兼容脚本。

### 4. 插件与清单生态

- 文件名 `openclaw.plugin.json`（`LEGACY_PLUGIN_MANIFEST_FILENAMES`）
- `package.json` 元数据键 `"openclaw"`
- Front-matter / YAML：`metadata.openclaw`
- npm scope 发现：`@openclaw/skill-*`（能力治理发现器仍查询）

### 5. 本地存储键（UI）

旧 localStorage / sessionStorage 键仍可读，例如：

- `openclaw.i18n.locale`
- `openclaw.device.auth.v1`
- `openclaw-device-identity-v1`
- `openclaw.control.settings.v1` / `openclaw.control.token.v1`

新写入应使用 `openbot.*` 键（若尚未迁移，记入 Phase B）。

### 6. 遗留显示名常量

`LEGACY_PRODUCT_DISPLAY_NAMES`、`LEGACY_GATEWAY_WINDOWS_TASK_NAMES`、`LEGACY_HOOK_TOKEN_HEADER_DISPLAY_NAMES` 等仅用于**识别**旧进程/任务/头，不用于新 UI 文案。

### 7. 遥测指标名

OTLP / 诊断指标仍可能使用 `openclaw.*` 度量名（时序连续性）。文档中的指标名不要在未做双写导出前强行改名。

### 8. 移动端 / 桌面残留（Follow-up）

| 项                                                              | 说明                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| iOS XcodeGen `OpenClaw` / `OpenClawKit` 包名、`ai.openclaw.ios` | 工程与 bundle id；改名需同步签名与商店                                           |
| Android `applicationId`                                         | 现行 `ai.openbot.app`。旧 `ai.openclaw.app` 不能覆盖升级（并列；重装并重新登录） |
| Swift 类型前缀 `OpenClawChat*`、`OpenClaw*Payload` 等           | 内部类型；非用户可见；可在独立 PR 机械重命名                                     |
| App Support 目录名 `OpenClaw`                                   | 已有用户数据路径；需迁移逻辑后才能改                                             |
| ShareExtension `OpenClawShare` domain                           | 错误域字符串                                                                     |
| MS Teams 上传文件夹 `OpenClawShared`                            | 远端文件夹名，改名会影响已有文件                                                 |

### 9. 历史文档与补丁证据

`docs/design/convergence-evidence/**`、部分 `docs/start/openclaw.md`（已标注 inherited leftover）等保留 OpenClaw 字样作为历史记录，不作为产品主叙事。

## 验收口径

- **主路径与用户可见面**：UI 文案、错误提示、新文档 CLI 示例、macOS Sources 构建路径、`OpenBotConfig` 类型主名 → **无 OpenClaw 作为主品牌**。
- **兼容层**：本清单 + `src/compat/legacy-names.ts` + 源码 `@deprecated 仅兼容` 注释。

## Phase B / Follow-up（本 PR 未完全收口）

1. Dockerfile / docker-compose 服务与镜像主名改为 `openbot`，旧名仅 alias。
2. 新守护进程安装只写 `OPENBOT_*`（保留读 `OPENCLAW_*`）。
3. UI 存储键迁移写入 `openbot.*`，读旧键。
4. iOS XcodeGen 工程名。Android `applicationId` 已是 `ai.openbot.app`（旧 `ai.openclaw.app` 不能覆盖升级）。
5. Swift `OpenClaw*` 类型前缀 → `OpenBot*`。
6. 插件类型 `OpenClawPlugin*` → `OpenBotPlugin*`（TS）。
7. OTLP 指标双写 `openbot.*` 后淘汰 `openclaw.*`。
8. `openclaw.podman.env`、`appcast` 等遗留文件名。Android 可安装包名是 `ai.openbot.app`，不是 `ai.openclaw` 目录名。
