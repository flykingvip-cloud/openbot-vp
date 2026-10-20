# 问法 → 文档 / 技能（主路由表）

先匹配用户意图，再打开**一份**本技能 reference，或移交专门技能。回答前仍优先 fetch 对应 OpenBot 仓库/官方页。

## 产品导览

| 用户在问                    | 优先文档（仓库相对路径）                                                                                                          | 本技能 reference              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| OpenBot 是什么 / 快速上手   | `docs/index.md`, `docs/start/getting-started.md`, `docs/start/openbot.md`                                                         | workbench-basics              |
| 安装 / onboard              | `docs/start/setup.md`, `docs/start/wizard.md`, `docs/install/`                                                                    | workbench-basics              |
| 员工工作台怎么点            | 人类页 `https://www.openbot.love/help/workbench`（员工站同一份 UI）。点按读 `references/workbench/`。不要指向 docs.openbot.love。 | workbench-basics              |
| Gateway 控制台 / Control UI | `docs/web/control-ui.md`, `docs/web/dashboard.md`, `docs/web/webchat.md`                                                          | workbench-basics              |
| 数字员工 / 多 agent         | `docs/concepts/agent.md`, `docs/concepts/multi-agent.md`, `docs/concepts/agent-workspace.md`                                      | workbench-basics              |
| 技能怎么装/加载             | `docs/tools/skills.md`, `docs/tools/skills-cli.md`, `docs/tools/creating-skills.md`                                               | skills-routing                |
| Gateway / 18789             | `docs/gateway/index.md`, `docs/gateway/network-model.md`, `docs/gateway/configuration.md`                                         | gateway-local                 |
| 排障                        | `docs/help/troubleshooting.md`, `docs/gateway/troubleshooting.md`, `docs/channels/troubleshooting.md`                             | troubleshooting               |
| 企微/飞书/钉钉              | `docs/channels/enterprise-im.md`, `docs/channels/wecom.md`, `docs/channels/feishu.md`, `docs/channels/dingtalk.md`                | （docs-first；非个人微信）    |
| 个人微信                    | `docs/channels/wechat.md` + 技能分流                                                                                              | → **wechat-personal-catalog** |

中文镜像可优先 `docs/zh-CN/` 下同名路径。

## 技能移交（本技能不重做）

| 意图                            | 交给                                                      |
| ------------------------------- | --------------------------------------------------------- |
| 个人微信（未分清运营/入库）     | `wechat-personal-catalog`                                 |
| 个人微信扫码/授权数字人         | `wechat-personal-ops`                                     |
| 微信记录入库                    | `wechat-personal-kb`                                      |
| 看板/架构 HTML / canvas.present | `canvas`                                                  |
| 对话内仿真/交互图               | `visualize`                                               |
| 自然语言改 PDF                  | `nano-pdf`                                                |
| OpenAI Images 批量出图          | `openai-image-gen`                                        |
| 建数字人/知识库/定时/身份授权   | `openbot-platform-ops`（必要时 `user-guidance-protocol`） |
| ClawHub 装技能市场包            | `openbot-skills` / clawhub CLI 文档                       |

## 明确不要

- 把 **Grok Bot** 设置（侧栏账号、`Cmd+,`、Computer/Update box）写成 OpenBot 工作台路径。
- 把 **wechat-use** 写成默认接微信步骤。
- 把纯 OpenAI API/Codex 模型迁移题当作本技能主场（除非用户在对比 OpenBot）。
