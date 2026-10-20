# Cron and schedule

## When

User wants recurring automation, reminders, or personal schedule entries.

## Choose mechanism

| Need                                     | Mechanism             | Doc                                    |
| ---------------------------------------- | --------------------- | -------------------------------------- |
| Gateway cron job (isolated/main session) | `cron` agent tool     | `docs/automation/cron-jobs.md`         |
| Personal "today schedule" card           | `schedule` agent tool | Employee schedule UI                   |
| Periodic check-ins on main session       | heartbeat             | `docs/automation/cron-vs-heartbeat.md` |

Read `docs/automation/cron-vs-heartbeat.md` before recommending cron vs heartbeat.

## Agent tools

**`cron`** — Gateway RPC: `cron.status`, `list`, `add`, `update`, `remove`, `run`, `runs`

**`schedule`** — `schedule.entry.*`; steward must confirm before add (`daibai-action-catalog`: `schedule.entry.add` requires confirmation)

## UI

Employee workbench, not the Gateway dashboard:

- Sidebar `我的任务` → tab `定时任务` → `+ 新建任务`
- Step labels seen: 创建方式, 基本信息, 时间触发, 任务与执行, 目标验收, 通知设置, 确认创建
- Click script: `skills/user-guidance-protocol/references/employee-tasks.yaml`
- Implementation: `ui/src/ui/ports/employee/views/employee-personal-cron-center.ts`

## Confirm policy

- **Always confirm** before persisting schedule/cron entries unless user message explicitly authorizes exact payload.
- Restate: name, cadence, target agent/session, timezone.

## Forbidden

Creating cron jobs that exfiltrate secrets or mutate ADMIN configuration.
