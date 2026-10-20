---
summary: "My tasks on the logged-in employee workbench: cron, assigned work, and the supervisor checklist."
title: "My tasks"
---

# My tasks

Walked on 2026-09-18 while logged in. The cron list and the supervisor checklist were on screen. The new-task wizard after the first button was not re-opened.

## What this is

Three tabs under one sidebar item.

## How to enter

Sidebar `我的任务`. Tabs: `定时任务`, `待我处理`, `开发监督`.

## Cron list

Stats on this pass: `总任务` 3, `待执行` 3, `执行中` 0, `已完成` 0, `异常` 0. Read the numbers on screen; do not say the list is empty.

Actions seen: `任务模板`, `批量操作`, `+ 新建任务`.

A real row was visible (executor, repeat time, `待执行`). Do not read HTML comments or knowledge ids from the page source to the user.

`+ 新建任务` is the create button. Later wizard fields were not re-opened. Ask the user to read the next title before naming fields.

## Assigned

This pass was empty:

`会议与协作指派给你的任务`

`暂无指派给你的任务。会议纪要分发后，行动项会出现在这里。`

If rows appear, use those instead of the empty sentence.

## Supervisor

This pass was an environment checklist, not a missing-seat page.

- `环境准备` showed `1/10 就绪`
- `监督子系统` can be `就绪`
- Node and CLI rows show `待处理`, `待探测`, or `待配置`
- Buttons: `申请连接本机 Node`, `刷新状态`
- Copy says to open Mac OpenBot and keep Node mode online. It says not to type tenant or seat info by hand.
- Also on screen: `高级信息（排障用）`, `本机 CLI 状态`, `配置 API KEY`, `添加 KEY`

Do not ask the user to paste an API key into chat. Do not say this tab is blocked on `尚未生效企业岗位` or `operator.write` unless that sentence is actually visible.
