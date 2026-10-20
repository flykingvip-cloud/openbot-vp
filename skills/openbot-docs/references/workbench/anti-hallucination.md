---
summary: "Ten common questions answered from the logged-in production walk on 2026-09-18."
title: "What not to invent"
---

# What not to invent

Rules:

- If a control was not on screen in the logged-in walk, do not tell the user to press it.
- Old names `机器人管理`, `技能管理`, `深色侧栏`, `返回控制台`, and `Dashboard` are not employee-workbench entrances.
- Gateway port 18789 is not the employee home.
- A disconnected local shell is not the production default. Use it only when the banner `已断开与网关的连接。` is actually visible.

## Ten questions

1. **How do I add a robot?** Sidebar `AI 助手`, plus button (`add AI 助手`), title `新建数字员工`, then `创建机器人`. The plus hides after 4 self-created assistants (大白管家 does not count). `系统设置` → `我的机器人` has no create button. Asking 大白管家 only guides the user to that plus; it does not create in the background. `成员管理` → `添加机器人` adds an existing robot to a space.
2. **Where is the knowledge universe?** Sidebar `知识宇宙`. Spaces are listed after load. Do not say there are zero spaces because of a first-paint flash.
3. **How do I add a scheduled task?** `我的任务`, tab `定时任务`, `+ 新建任务`. Stop after that button. Later wizard fields were not re-opened.
4. **Where are settings?** Sidebar `系统设置` for security, devices, robots, groups, and models. Avatar menu `个人设置` for the account. They are not the same page.
5. **How do I add people to a collaboration space?** Open the space, press `成员管理`, then `添加成员` or `添加机器人`. That `添加机器人` only pulls in an existing assistant. A new robot still starts from sidebar `AI 助手` plus. Do not describe an interior tab bar.
6. **How do I log in?** `https://www.openbot.love/`, switch the card to `登录`, fill `邮箱` and `登录密码`. Do not send them to `企业登录` for the employee workbench.
7. **Chat will not send.** Only if the banner is `已断开与网关的连接。` and the placeholder is `请先连接网关后再开始聊天…`. On a connected session, `发送` is enabled. Do not invent a second send button.
8. **Where are my robots?** `系统设置`, tab `我的机器人`. Rows can be `可管理` with `进入工作区`. Detail tabs seen: `身份`, `能力`, `成长`, `运营授权`, `协作`, `数据`. No `危险` tab.
9. **Where do I bind an operational account?** Avatar, `个人设置`, tab `授权`, heading `绑定账户`. Read whether that provider says `已配置`. Do not ask for the secret in chat.
10. **The user says robot management or skill management.** That menu is not on the employee workbench. Robots are `系统设置` then `我的机器人`. Installable-asset counts can be zero while `我的资产` still shows `整理建议`.

## Coverage choice

`user-guidance-protocol` is already always on, and `openbot-platform-ops` is already in the starter pack. The click facts were rewritten from the logged-in walk. `openbot-docs` was not added to the starter pack.
