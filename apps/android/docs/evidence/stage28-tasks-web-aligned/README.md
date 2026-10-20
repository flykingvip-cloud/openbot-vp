# Stage 2.8 — Tasks tab Web-aligned (slice 2)

SoT shell: **定时任务 | 待我处理** +「+」FAB; row → detail sheet with **接受 / 完成** (assigned) or enable/run (cron).

## Web flows mirrored (do not invent Android-only task system)

| Concern | Web SoT | Gateway |
| --- | --- | --- |
| 待我处理 list + accept/complete | `ui/src/ui/ports/employee/views/employee-assigned-tasks-center.ts` | `task.list` / `task.accept` / `task.complete` |
| TaskAssignment model | `ui/src/ui/capability/meeting-lifecycle/endpoints.ts` | via `gateway-client.ts` |
| 定时任务 center | `ui/src/ui/ports/employee/views/employee-personal-cron-center.ts` | `cron.list` / `cron.update` / `cron.run` |
| Create defaults | `ui/src/ui/controllers/cron.ts` `addCronJob` + `ui/src/ui/app-defaults.ts` `DEFAULT_CRON_FORM` | `cron.add` |
| Workbench segments | `ui/src/ui/ports/employee/views/workbench-stage-module.ts` (定时任务 \| 待我处理) | — |
| Visual SoT | four-tab preview `tasks-list.jpg` / `tasks-detail.jpg` | — |

## Gaps

- Full personal-cron multi-step wizard (AI enhance / templates / data bindings) not ported — create sheet is a **reduced** cron.add form (name / message / schedule).
- Task deliverable preview /「打开全文」from SoT HTML preview not wired (Web assigned-tasks center also has no result preview).
- Drag / rich filters from desktop cron center deferred.

## Test

- `./gradlew :app:compileDebugKotlin`
- `./gradlew :app:testDebugUnitTest --tests ai.openbot.app.ui.TasksWebModelsTest`
