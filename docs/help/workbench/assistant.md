---
summary: "How to open a named AI assistant, and how to add a new robot from the sidebar plus."
title: "AI assistant"
---

# AI assistant

Walked on 2026-09-18 at `https://www.openbot.love/`. Chat and the quota-hidden plus were checked while logged in. The create form was opened earlier on the same workbench when the plus was visible.

## What this is

The sidebar list of assistants, the chat stage, and the form that creates a digital employee.

## How to enter

Expand the sidebar. The group is `AI 助手`. Click the name the user asked for. Opening `大白管家` sets the header to `TO: 大白管家`.

To add a robot, use the plus on this group. See [Add a robot](#add-a-robot).

## Add a robot

This is how you **create** a new assistant. It is not the same button as `成员管理` → `添加机器人` inside a collaboration space.

1. Expand the sidebar and find `AI 助手`.
2. Press the `+` on the right of that group title. The accessible name is `add AI 助手`.
3. The page title becomes `新建数字员工`.

The plus is hidden when this seat already has **4** self-created assistants (大白管家 does not count). On the logged-in production account the list had 大白管家 plus five others, so the plus was not on screen. `系统设置` → `我的机器人` also has no `新建` button.

If the plus is missing, say the create slot is full. Do not invent a second create menu.

Asking 大白管家 to add a robot is a **guide** path: 大白 should take the user to this plus button. There is no verified 大白 action that creates a robot in the background. A full seat still cannot add another one.

### Create form

Title: `新建数字员工`.

| Control                  | What it does                                                                                       | Risk                |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------- |
| `你想要什么样的数字员工` | Free-text brief.                                                                                   | Writes a draft only |
| `生成设计`               | Builds a design from the brief. Disabled until the brief is filled.                                | Medium              |
| `机器人名称`             | Name. Placeholder `例如：市场分析助手`.                                                            | Medium              |
| `头像设置`               | Optional.                                                                                          | Low                 |
| `角色模板`               | Starting capability pack. May show `暂无可用模板`.                                                 | Read                |
| `工作空间`               | Cloud seats can say `由 OpenBot 自动管理`. Local seats can ask for a workspace root in `个人设置`. | Medium              |
| `取消`                   | Leaves without creating.                                                                           | Low                 |
| `创建机器人`             | Writes the robot. Confirm first. Disabled until name and workspace are ready.                      | High                |

Do not press `创建机器人` unless the user confirmed. After create, the new name should appear under `AI 助手`.

## Chat controls that were on screen

| Control                              | What it does                                                  | Risk   |
| ------------------------------------ | ------------------------------------------------------------- | ------ |
| `开始引导` / `稍后处理` / `我知道了` | Daibai intro card. `我知道了` dismisses it.                   | Low    |
| `知识库`                             | Expands next to the composer. Contents were not fully opened. | Read   |
| `选择文件` / `添加附件`              | Attach a file.                                                | Medium |
| Voice                                | Voice input.                                                  | Low    |
| `发送`                               | Sends the draft. Enabled while the gateway is connected.      | Medium |
| `复制` / `引用此前回复`              | On an existing message.                                       | Low    |
| `打开成果`                           | On some messages. The result page itself was not opened.      | Read   |

## Not on screen

`进入工作区` on a robot returns to the daily overview chat. It does not open tabs named `概览`, `任务`, `成果`, `工作区`, `技能`, or `记忆`.
