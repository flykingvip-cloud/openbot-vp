---
summary: "How to open the employee workbench and recognize the logged-in shell."
title: "Login and shell"
---

# Login and shell

Walked on 2026-09-18 at `https://www.openbot.love/` after a real employee login. Gateway was connected.

## What this is

The public employee entry. After login, the home stage is `每日概览` plus the current conversation.

## How to enter

Open `https://www.openbot.love/`.

Logged-out title line: `面向团队的 AI 工作台`. Top links include `首页` and `企业登录`. Use `企业登录` only when the user asked for the enterprise console.

The right card opens on `注册`. Fields there are `用户名称`, `注册邮箱`, `邀请码核验`, `登录密码`. `去登录 →` switches to login.

Login fields are `邮箱` (placeholder `name@company.com`) and `登录密码` (hint: at least 8 characters). Below the button: `忘记密码？` and `登录遇到问题？`. There is no verification-code box on this login card.

## Screen after login

- The sidebar was already expanded. If it is icon-only, press `展开侧边栏`.
- Groups: `AI 助手` (plus on the group title when this seat still has a create slot; hidden after 4 self-created assistants) and `协作空间` (plus, named spaces).
- Modules under them: `我的任务`, `知识宇宙`, `系统设置`.
- Top right: `语言`, `主题`, and the avatar menu. Menu items: `个人设置`, `退出登录`.
- Stage title: `每日概览`.
- `日程管理` and `待办事项` can contain real rows. Do not describe them as empty unless the empty sentence is on screen.
- Conversation header follows the current target, for example `TO: 大白管家` or a space name. It is not always `TO: AI 助手`.

## Composer when connected

Controls beside the box: expandable `知识库`, `选择文件`, `添加附件`, voice, `发送`. They are enabled when the gateway is up.

## First-run card

Opening `大白管家` can show `你好，我是大白，你的专属工作助手。` Buttons: `开始引导`, `稍后处理`, `我知道了`.

## Do not invent

No `机器人管理`, `技能管理`, or `返回控制台`.

Say the gateway is down only when the banner is `已断开与网关的连接。` and the placeholder is `请先连接网关后再开始聊天…`.
