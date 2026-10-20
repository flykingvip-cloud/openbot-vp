# Employee workbench modules

Observed 2026-09-18 on `https://www.openbot.love/` after a real employee login. Gateway was connected. Click-by-click steps live in `user-guidance-protocol` references. This file only says which module answers which request.

Entry for users: `https://www.openbot.love/`. This is the employee workbench, not Gateway `:18789`, not `biz.openbot.love`, not `admin.openbot.love`.

## Module map

| User intent                                      | Where                                                                           | Guide reference               |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
| Log in, find the sidebar, daily overview         | `https://www.openbot.love/` then employee shell                                 | `employee-shell.yaml`         |
| Open a named assistant, or add a new robot       | Sidebar `AI 助手` plus (`add AI 助手`). Hidden after 4 self-created assistants. | `employee-assistant.yaml`     |
| Open a space or its member panel                 | Sidebar `协作空间`                                                              | `employee-collaboration.yaml` |
| Cron, assigned tasks, supervised dev environment | Sidebar `我的任务`                                                              | `employee-tasks.yaml`         |
| Spaces, digital capabilities, assets, governance | Sidebar `知识宇宙`                                                              | `employee-knowledge.yaml`     |
| System or personal settings                      | Sidebar `系统设置`, or avatar menu `个人设置`                                   | `platform-settings.yaml`      |

## Solver / guide

| Request                                                        | Mode                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Read what is on screen and tell the user which button to press | Guide. Load the YAML. One step, then wait.                                                                     |
| Create cron, knowledge base, or identity through an agent tool | Solver only when that tool exists and the user confirmed. UI labels still come from the YAML, not from memory. |
| Remove a member, bind an identity, or change robot fields      | Medium or high risk. Confirm before the write button.                                                          |

## Seen on the logged-in pass

- Sidebar already expanded: `AI 助手` (plus only when under the 4-assistant create cap), `协作空间` (with a plus), `我的任务`, `知识宇宙`, `系统设置`.
- Header: `每日概览`, `语言`, `主题`, avatar menu `个人设置` / `退出登录`.
- Assistant chat: `知识库`, `选择文件`, `添加附件`, voice, `发送`. Message actions `复制`, `引用此前回复`, sometimes `打开成果`.
- Collaboration: `成员管理` panel. No interior tab bar.
- Tasks: real cron rows; `待我处理` can be empty; `开发监督` is an environment checklist (`申请连接本机 Node`), not a missing-seat page.
- Knowledge: real spaces; `数字能力` can be `已授权` or `审批中`; `我的资产` has `整理建议` even when install counts are 0; `知识治理` is scoped to one space.
- Settings: data space `云端托管`, gateway can be `正常`. Robot detail tabs: `身份`, `能力`, `成长`, `运营授权`, `协作`, `数据`. No `危险` tab. `进入工作区` returns to the daily overview chat.

## Not on screen, so not instructable

- The create form after `创建机器人` is pressed (do not describe a success state that was not submitted)
- A 大白 background action that creates a robot without the plus button
- Knowledge library tabs `文档 / 片段 / 数据集 / 回收站`
- Collaboration interior tabs
- Robot workbench tabs `概览 / 任务 / 成果 / 工作区 / 技能 / 记忆`
- `导出备份` or a `~/OpenBot` path on this cloud account
- Contents of `打开成果` beyond the button label

If the user is already inside one of those, ask them to read the labels they see.

Only say the gateway is disconnected when the banner is `已断开与网关的连接。`. A connected session must not be described with the empty disconnected copy.
