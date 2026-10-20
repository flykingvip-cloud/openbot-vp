# 工作台与数字人（入门）

事实以 OpenBot 仓库/官方文档为准；下列为**高阶摘要**，回答前请打开对应页面核对标签与步骤。

## 产品定位（摘要）

OpenBot（包名 `@upbeyond/openbot`）是面向**数字员工**的企业 Agent OS：Gateway 作控制面；运营者用员工/企业控制台；职场 IM 主推 **企微 / 飞书 / 钉钉**；产品内聊天为 WebChat / Control UI。

参见：`docs/index.md`、`docs/start/openbot.md`。

## 本机最快路径

1. 安装与向导：全局安装最新 OpenBot 包 → `openbot onboard --install-daemon`（见 `docs/start/getting-started.md`）。
2. 确认 Gateway：`openbot gateway status`（期望 `Runtime: running`、`RPC probe: ok`）。
3. 打开控制台：`openbot dashboard`，或在 Gateway 主机打开 `http://127.0.0.1:18789/`（见 `docs/web/control-ui.md`、`docs/web/dashboard.md`）。

Control UI 与 Gateway **同端口**（默认 18789），经 WebSocket 对话、看会话与配置。远程/非 loopback 绑定通常要 token，且新浏览器可能需设备配对（`openbot devices list` / `approve`）。本地 `127.0.0.1` 常自动批准——细节以 `control-ui.md` 为准。

## 「工作台」怎么说

两套界面不要混：

- **员工工作台**：用户入口 `https://www.openbot.love/`。侧栏是 `AI 助手`、`协作空间`、`我的任务`、`知识宇宙`、`系统设置`。先读本技能 `references/workbench/`，点按再读 `user-guidance-protocol` 的 `references/employee-*.yaml`。
- **Control UI / Dashboard**：Gateway 同端口控制台，默认 `http://127.0.0.1:18789/`。那是运维面，不是员工每日概览。

不要把 Grok Bot 侧栏「Settings → Computer」说成 OpenBot 工作台。不要把旧菜单「机器人管理 / 技能管理」说成当前员工侧栏。

## 数字员工

数字员工是带工作区、技能、记忆与审计的托管资产，不是一次性聊天线程。多 agent 时每 agent 有独立 workspace；共享技能在 `~/.openbot/skills`，工作区技能在 `<workspace>/skills`（见 `docs/tools/skills.md`、`docs/concepts/multi-agent.md`）。

创建/配置类诉求：优先移交 `openbot-platform-ops`；需要逐步点 UI 时配合 `user-guidance-protocol`。**禁止**臆造未在文档出现的菜单路径。

## 职场 IM vs 个人微信

| 目标                   | 去向                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| 企微 / 飞书 / 钉钉     | 企业控制台 → 消息渠道；文档 `docs/channels/enterprise-im.md` 等    |
| 个人微信扫码绑定数字人 | `wechat-personal-catalog` → ops/kb；文档 `docs/channels/wechat.md` |

## 不确定时

回到 docs-first：搜索用户原词 → 打开 `docs/start/` 或 `docs/web/` 页面 → 再逐步引导。
